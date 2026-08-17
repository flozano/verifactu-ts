/**
 * Generación del XML del registro de facturación y del mensaje de remisión.
 *
 * Sigue el esquema oficial `SuministroLR.xsd` / `SuministroInformacion.xsd`
 * (versión 1.0 del diseño de registro, 28/10/2024). El orden de los elementos no es
 * negociable: el esquema los declara dentro de `sequence`, así que un XML con los
 * mismos datos en otro orden es rechazado con el error 4102 aunque no falte nada.
 * Por eso la serialización aquí es explícita y no recorre las claves del objeto.
 *
 * Lo que este módulo **no** hace: firmar. La firma electrónica (`ds:Signature`) sólo
 * la exigen los sistemas que NO se acogen a VERI*FACTU; en remisión voluntaria el
 * canal va autenticado con certificado y el registro no se firma.
 */

import type {
  Cabecera,
  DetalleDesglose,
  Encadenamiento,
  IDFactura,
  IDOtro,
  ObligadoEmision,
  PersonaFisicaJuridica,
  RegistroAlta,
  RegistroAnulacion,
  SistemaInformatico,
} from './registro.js';

/** Espacio de nombres del esquema de suministro (prefijo habitual `sfLR`). */
export const NS_SUMINISTRO_LR =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd';

/** Espacio de nombres de los tipos comunes (prefijo habitual `sf`). */
export const NS_SUMINISTRO_INFORMACION =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';

export interface OpcionesXml {
  /**
   * Sangría de cada nivel. Por defecto dos espacios; pasa `''` para obtener el XML
   * en una sola línea.
   */
  sangria?: string;
  /** Incluye la declaración `<?xml …?>`. Por defecto, `true` en el mensaje completo. */
  declaracion?: boolean;
}

/** Escapa el texto que va dentro de un elemento XML. */
function escapar(valor: string): string {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Constructor de XML que mantiene el nivel de sangría y el prefijo de espacio de nombres. */
class Escritor {
  private readonly partes: string[] = [];
  private nivel = 0;
  private readonly prefijo: string;
  private readonly sangria: string;

  constructor(prefijo: string, sangria: string) {
    this.prefijo = prefijo;
    this.sangria = sangria;
  }

  private get margen(): string {
    return this.sangria ? this.sangria.repeat(this.nivel) : '';
  }

  private get salto(): string {
    return this.sangria ? '\n' : '';
  }

  /** Elemento con texto. Se omite si el valor es `undefined`. */
  hoja(nombre: string, valor: string | undefined): void {
    if (valor === undefined) return;
    const etiqueta = `${this.prefijo}${nombre}`;
    this.partes.push(`${this.margen}<${etiqueta}>${escapar(valor)}</${etiqueta}>${this.salto}`);
  }

  /** Elemento contenedor con hijos. */
  rama(nombre: string, contenido: () => void): void {
    const etiqueta = `${this.prefijo}${nombre}`;
    this.partes.push(`${this.margen}<${etiqueta}>${this.salto}`);
    this.nivel++;
    contenido();
    this.nivel--;
    this.partes.push(`${this.margen}</${etiqueta}>${this.salto}`);
  }

  /** Inserta un fragmento ya serializado, respetando la sangría actual. */
  fragmento(xml: string): void {
    if (!this.sangria) {
      this.partes.push(xml);
      return;
    }
    for (const linea of xml.split('\n')) {
      if (linea !== '') this.partes.push(`${this.margen}${linea}\n`);
    }
  }

  texto(): string {
    return this.partes.join('');
  }
}

function escribirIDOtro(w: Escritor, otro: IDOtro): void {
  w.rama('IDOtro', () => {
    w.hoja('CodigoPais', otro.CodigoPais);
    w.hoja('IDType', otro.IDType);
    w.hoja('ID', otro.ID);
  });
}

function escribirPersona(w: Escritor, nombre: string, persona: PersonaFisicaJuridica): void {
  w.rama(nombre, () => {
    w.hoja('NombreRazon', persona.NombreRazon);
    if (persona.NIF !== undefined) w.hoja('NIF', persona.NIF);
    else if (persona.IDOtro) escribirIDOtro(w, persona.IDOtro);
  });
}

function escribirPersonaES(w: Escritor, nombre: string, persona: ObligadoEmision): void {
  w.rama(nombre, () => {
    w.hoja('NombreRazon', persona.NombreRazon);
    w.hoja('NIF', persona.NIF);
  });
}

function escribirIDFactura(w: Escritor, nombre: string, factura: IDFactura, emisor: string): void {
  w.rama(nombre, () => {
    w.hoja(emisor, factura.IDEmisorFactura);
    w.hoja(emisor === 'IDEmisorFacturaAnulada' ? 'NumSerieFacturaAnulada' : 'NumSerieFactura', factura.NumSerieFactura);
    w.hoja(
      emisor === 'IDEmisorFacturaAnulada' ? 'FechaExpedicionFacturaAnulada' : 'FechaExpedicionFactura',
      factura.FechaExpedicionFactura,
    );
  });
}

function escribirDetalle(w: Escritor, detalle: DetalleDesglose): void {
  w.rama('DetalleDesglose', () => {
    w.hoja('Impuesto', detalle.Impuesto);
    w.hoja('ClaveRegimen', detalle.ClaveRegimen);
    // El esquema declara CalificacionOperacion y OperacionExenta como choice.
    if (detalle.CalificacionOperacion !== undefined) {
      w.hoja('CalificacionOperacion', detalle.CalificacionOperacion);
    } else {
      w.hoja('OperacionExenta', detalle.OperacionExenta);
    }
    w.hoja('TipoImpositivo', detalle.TipoImpositivo);
    w.hoja('BaseImponibleOimporteNoSujeto', detalle.BaseImponibleOimporteNoSujeto);
    w.hoja('BaseImponibleACoste', detalle.BaseImponibleACoste);
    w.hoja('CuotaRepercutida', detalle.CuotaRepercutida);
    w.hoja('TipoRecargoEquivalencia', detalle.TipoRecargoEquivalencia);
    w.hoja('CuotaRecargoEquivalencia', detalle.CuotaRecargoEquivalencia);
  });
}

function escribirEncadenamiento(w: Escritor, encadenamiento: Encadenamiento): void {
  w.rama('Encadenamiento', () => {
    if (encadenamiento.PrimerRegistro === 'S') {
      w.hoja('PrimerRegistro', 'S');
      return;
    }
    const anterior = encadenamiento.RegistroAnterior;
    if (!anterior) return;
    w.rama('RegistroAnterior', () => {
      w.hoja('IDEmisorFactura', anterior.IDEmisorFactura);
      w.hoja('NumSerieFactura', anterior.NumSerieFactura);
      w.hoja('FechaExpedicionFactura', anterior.FechaExpedicionFactura);
      w.hoja('Huella', anterior.Huella);
    });
  });
}

function escribirSistemaInformatico(w: Escritor, sistema: SistemaInformatico): void {
  w.rama('SistemaInformatico', () => {
    w.hoja('NombreRazon', sistema.NombreRazon);
    if (sistema.NIF !== undefined) w.hoja('NIF', sistema.NIF);
    else if (sistema.IDOtro) escribirIDOtro(w, sistema.IDOtro);
    w.hoja('NombreSistemaInformatico', sistema.NombreSistemaInformatico);
    w.hoja('IdSistemaInformatico', sistema.IdSistemaInformatico);
    w.hoja('Version', sistema.Version);
    w.hoja('NumeroInstalacion', sistema.NumeroInstalacion);
    w.hoja('TipoUsoPosibleSoloVerifactu', sistema.TipoUsoPosibleSoloVerifactu);
    w.hoja('TipoUsoPosibleMultiOT', sistema.TipoUsoPosibleMultiOT);
    w.hoja('IndicadorMultiplesOT', sistema.IndicadorMultiplesOT);
  });
}

/**
 * Serializa un registro de alta como elemento `sf:RegistroAlta`.
 *
 * No valida: pasa antes por `validarRegistroAlta` si quieres saber qué rechazaría
 * la AEAT.
 */
export function xmlRegistroAlta(registro: RegistroAlta, opciones: OpcionesXml = {}): string {
  const w = new Escritor('sf:', opciones.sangria ?? '  ');

  w.rama('RegistroAlta', () => {
    w.hoja('IDVersion', registro.IDVersion ?? '1.0');
    escribirIDFactura(w, 'IDFactura', registro.IDFactura, 'IDEmisorFactura');
    w.hoja('RefExterna', registro.RefExterna);
    w.hoja('NombreRazonEmisor', registro.NombreRazonEmisor);
    w.hoja('Subsanacion', registro.Subsanacion);
    w.hoja('RechazoPrevio', registro.RechazoPrevio);
    w.hoja('TipoFactura', registro.TipoFactura);
    w.hoja('TipoRectificativa', registro.TipoRectificativa);

    if (registro.FacturasRectificadas?.length) {
      w.rama('FacturasRectificadas', () => {
        for (const f of registro.FacturasRectificadas!) {
          escribirIDFactura(w, 'IDFacturaRectificada', f, 'IDEmisorFactura');
        }
      });
    }
    if (registro.FacturasSustituidas?.length) {
      w.rama('FacturasSustituidas', () => {
        for (const f of registro.FacturasSustituidas!) {
          escribirIDFactura(w, 'IDFacturaSustituida', f, 'IDEmisorFactura');
        }
      });
    }
    if (registro.ImporteRectificacion) {
      w.rama('ImporteRectificacion', () => {
        w.hoja('BaseRectificada', registro.ImporteRectificacion!.BaseRectificada);
        w.hoja('CuotaRectificada', registro.ImporteRectificacion!.CuotaRectificada);
        w.hoja('CuotaRecargoRectificado', registro.ImporteRectificacion!.CuotaRecargoRectificado);
      });
    }

    w.hoja('FechaOperacion', registro.FechaOperacion);
    w.hoja('DescripcionOperacion', registro.DescripcionOperacion);
    w.hoja('FacturaSimplificadaArt7273', registro.FacturaSimplificadaArt7273);
    w.hoja('FacturaSinIdentifDestinatarioArt61d', registro.FacturaSinIdentifDestinatarioArt61d);
    w.hoja('Macrodato', registro.Macrodato);
    w.hoja('EmitidaPorTerceroODestinatario', registro.EmitidaPorTerceroODestinatario);
    if (registro.Tercero) escribirPersona(w, 'Tercero', registro.Tercero);

    if (registro.Destinatarios?.length) {
      w.rama('Destinatarios', () => {
        for (const d of registro.Destinatarios!) escribirPersona(w, 'IDDestinatario', d);
      });
    }

    w.hoja('Cupon', registro.Cupon);
    w.rama('Desglose', () => {
      for (const detalle of registro.Desglose ?? []) escribirDetalle(w, detalle);
    });
    w.hoja('CuotaTotal', registro.CuotaTotal);
    w.hoja('ImporteTotal', registro.ImporteTotal);
    escribirEncadenamiento(w, registro.Encadenamiento);
    escribirSistemaInformatico(w, registro.SistemaInformatico);
    w.hoja('FechaHoraHusoGenRegistro', registro.FechaHoraHusoGenRegistro);
    w.hoja('NumRegistroAcuerdoFacturacion', registro.NumRegistroAcuerdoFacturacion);
    w.hoja('IdAcuerdoSistemaInformatico', registro.IdAcuerdoSistemaInformatico);
    w.hoja('TipoHuella', registro.TipoHuella ?? '01');
    w.hoja('Huella', registro.Huella);
  });

  return w.texto();
}

/** Serializa un registro de anulación como elemento `sf:RegistroAnulacion`. */
export function xmlRegistroAnulacion(registro: RegistroAnulacion, opciones: OpcionesXml = {}): string {
  const w = new Escritor('sf:', opciones.sangria ?? '  ');

  w.rama('RegistroAnulacion', () => {
    w.hoja('IDVersion', registro.IDVersion ?? '1.0');
    escribirIDFactura(w, 'IDFactura', registro.IDFactura, 'IDEmisorFacturaAnulada');
    w.hoja('RefExterna', registro.RefExterna);
    w.hoja('SinRegistroPrevio', registro.SinRegistroPrevio);
    w.hoja('RechazoPrevio', registro.RechazoPrevio);
    w.hoja('GeneradoPor', registro.GeneradoPor);
    if (registro.Generador) escribirPersona(w, 'Generador', registro.Generador);
    escribirEncadenamiento(w, registro.Encadenamiento);
    escribirSistemaInformatico(w, registro.SistemaInformatico);
    w.hoja('FechaHoraHusoGenRegistro', registro.FechaHoraHusoGenRegistro);
    w.hoja('TipoHuella', registro.TipoHuella ?? '01');
    w.hoja('Huella', registro.Huella);
  });

  return w.texto();
}

/** Un registro dentro del mensaje de remisión: de alta o de anulación. */
export type RegistroFactura =
  | { alta: RegistroAlta; anulacion?: never }
  | { anulacion: RegistroAnulacion; alta?: never };

/**
 * Serializa el mensaje completo `RegFactuSistemaFacturacion`, que es el cuerpo de la
 * petición al servicio de remisión.
 *
 * El esquema admite de 1 a 1000 registros por mensaje, y alta y anulación no pueden
 * ir en la misma ocurrencia de `RegistroFactura`.
 *
 * @example
 * xmlRegFactuSistemaFacturacion(
 *   { ObligadoEmision: { NombreRazon: 'EMPRESA SL', NIF: 'B12345674' } },
 *   [{ alta: registro }],
 * );
 */
export function xmlRegFactuSistemaFacturacion(
  cabecera: Cabecera,
  registros: RegistroFactura[],
  opciones: OpcionesXml = {},
): string {
  const sangria = opciones.sangria ?? '  ';

  // `Cabecera` se declara dentro de RegFactuSistemaFacturacion en SuministroLR.xsd,
  // así que el elemento pertenece al espacio de nombres sfLR aunque su tipo venga de
  // SuministroInformacion.xsd; sus hijos, definidos en ese otro esquema, van en sf.
  const cab = new Escritor('sf:', sangria);
  escribirPersonaES(cab, 'ObligadoEmision', cabecera.ObligadoEmision);
  if (cabecera.Representante) escribirPersonaES(cab, 'Representante', cabecera.Representante);
  if (cabecera.RemisionVoluntaria) {
    cab.rama('RemisionVoluntaria', () => {
      cab.hoja('FechaFinVeriFactu', cabecera.RemisionVoluntaria!.FechaFinVeriFactu);
      cab.hoja('Incidencia', cabecera.RemisionVoluntaria!.Incidencia);
    });
  }
  if (cabecera.RemisionRequerimiento) {
    cab.rama('RemisionRequerimiento', () => {
      cab.hoja('RefRequerimiento', cabecera.RemisionRequerimiento!.RefRequerimiento);
      cab.hoja('FinRequerimiento', cabecera.RemisionRequerimiento!.FinRequerimiento);
    });
  }

  const raiz = `sfLR:RegFactuSistemaFacturacion`;
  const salto = sangria ? '\n' : '';
  const partes: string[] = [];

  if (opciones.declaracion ?? true) partes.push(`<?xml version="1.0" encoding="UTF-8"?>${salto}`);
  partes.push(
    `<${raiz} xmlns:sfLR="${NS_SUMINISTRO_LR}" xmlns:sf="${NS_SUMINISTRO_INFORMACION}">${salto}`,
  );

  const cuerpo = new Escritor('sfLR:', sangria);
  cuerpo.rama('Cabecera', () => cuerpo.fragmento(cab.texto()));
  for (const registro of registros) {
    cuerpo.rama('RegistroFactura', () => {
      const xml = registro.alta
        ? xmlRegistroAlta(registro.alta, { sangria })
        : xmlRegistroAnulacion(registro.anulacion!, { sangria });
      cuerpo.fragmento(xml);
    });
  }

  // El escritor del cuerpo empieza en nivel 0, así que se sangra un nivel completo.
  const cuerpoSangrado = sangria
    ? cuerpo
        .texto()
        .split('\n')
        .map((linea) => (linea === '' ? linea : `${sangria}${linea}`))
        .join('\n')
    : cuerpo.texto();

  partes.push(cuerpoSangrado);
  partes.push(`</${raiz}>${salto}`);

  return partes.join('');
}
