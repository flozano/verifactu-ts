/**
 * Validación previa del registro de facturación contra las reglas oficiales de la
 * AEAT, con los códigos de error que devolvería el propio servicio.
 *
 * Implementa el documento "Validaciones. Sistemas Informáticos de Facturación y
 * Sistemas VERI*FACTU" (AEAT, v1.2.2, 08/04/2026) y asigna a cada problema el
 * código del catálogo oficial (`errores.properties`) que corresponde.
 *
 * ## Qué se puede comprobar aquí y qué no
 *
 * Sólo se comprueban las reglas resolubles con la información del propio registro:
 * formatos, obligatoriedades condicionadas, coherencia entre campos y cuadre de
 * importes. Las validaciones que dependen de datos que sólo tiene la AEAT —si un NIF
 * está en el censo, si existe un acuerdo de facturación, si la referencia de un
 * requerimiento es real— **no** se pueden reproducir en local y no se intentan.
 *
 * Que `validarRegistroAlta` no devuelva nada no garantiza, por tanto, la aceptación:
 * garantiza que el registro no será rechazado por ninguna de las causas que estaban
 * en tu mano evitar antes de enviarlo.
 */

import type { CategoriaError } from './errores.js';
import { ERRORES_AEAT } from './errores.js';
import type {
  ClaveRegimen,
  DetalleDesglose,
  Encadenamiento,
  IDFactura,
  PersonaFisicaJuridica,
  RegistroAlta,
  RegistroAnulacion,
  SistemaInformatico,
} from './registro.js';
import { CLAVES_REGIMEN_IGIC, CLAVES_REGIMEN_IPSI, CLAVES_REGIMEN_IVA } from './registro.js';

/**
 * Consecuencia de un problema.
 *
 * - `rechazo`: la AEAT rechaza el registro (error no admisible).
 * - `aviso`: la AEAT acepta y anota el registro, pero marca el error para que se
 *   subsane después (error admisible).
 */
export type Severidad = 'rechazo' | 'aviso';

/** Problema detectado en un registro de facturación. */
export interface ProblemaRegistro {
  /**
   * Código del catálogo oficial de la AEAT, o `null` cuando el documento de
   * validaciones define la regla pero la AEAT no publica un código propio para ella.
   */
  codigo: string | null;
  /** Descripción oficial del error, cuando hay código; si no, la de la regla. */
  mensaje: string;
  /** Explicación con los valores concretos del registro. */
  detalle: string;
  /** Ruta del campo afectado, p. ej. `Desglose[0].TipoImpositivo`. */
  campo: string;
  /** Apartado del documento de validaciones que establece la regla. */
  apartado: string;
  severidad: Severidad;
}

export interface OpcionesValidacion {
  /**
   * Fecha con la que se comparan las validaciones que hablan de «la fecha actual».
   * Por defecto, el momento de la llamada. Se expone para poder escribir pruebas
   * deterministas.
   */
  fechaReferencia?: Date;
}

/** Margen que admite la AEAT al cuadrar importes, en euros. */
const MARGEN_IMPORTES = 10;

/** Importe a partir del cual la factura es macrodato, en valor absoluto. */
const UMBRAL_MACRODATO = 100_000_000;

/** Límite de las facturas simplificadas, en euros (apartado 15.8). */
const LIMITE_SIMPLIFICADA = 3000;

/** Entrada en vigor de la Orden HAC/1177/2024. */
const FECHA_MINIMA_EXPEDICION = Date.UTC(2024, 9, 28);

const TIPOS_RECTIFICATIVOS = new Set(['R1', 'R2', 'R3', 'R4', 'R5']);
const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';

// --- Utilidades -------------------------------------------------------------

/** Convierte una fecha DD-MM-AAAA a marca de tiempo UTC, o `null` si no es válida. */
function comoFecha(fecha: string | undefined): number | null {
  if (!fecha) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(fecha.trim());
  if (!m) return null;
  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1) return null;
  if (dia > new Date(Date.UTC(anio, mes, 0)).getUTCDate()) return null;
  return Date.UTC(anio, mes - 1, dia);
}

/** Día (sin hora) de una fecha, en UTC. */
function soloDia(fecha: Date): number {
  return Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
}

/** Convierte un importe del registro a número, o `null` si no tiene el formato válido. */
function comoNumero(importe: string | undefined): number | null {
  if (importe === undefined || importe === null || String(importe).trim() === '') return null;
  const texto = String(importe).trim();
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(texto)) return null;
  return Number(texto);
}

/** Comprueba el dígito de control de un NIF, NIE o CIF español. */
function nifValido(nif: string): boolean {
  const valor = nif.trim().toUpperCase();

  let m = /^(\d{8})([A-Z])$/.exec(valor);
  if (m) return m[2] === LETRAS_DNI[Number(m[1]) % 23];

  m = /^([XYZ])(\d{7})([A-Z])$/.exec(valor);
  if (m) return m[3] === LETRAS_DNI[Number(`${'XYZ'.indexOf(m[1]!)}${m[2]}`) % 23];

  m = /^([KLM])(\d{7})([A-Z])$/.exec(valor);
  if (m) return m[3] === LETRAS_DNI[Number(m[2]) % 23];

  m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(valor);
  if (m) {
    let suma = 0;
    for (let i = 0; i < 7; i++) {
      const digito = Number(m[2]![i]);
      if (i % 2 === 0) suma += Math.floor((digito * 2) / 10) + ((digito * 2) % 10);
      else suma += digito;
    }
    const control = (10 - (suma % 10)) % 10;
    const letra = 'JABCDEFGHI'[control]!;
    if ('PQRSNW'.includes(m[1]!)) return m[3] === letra;
    if ('ABEH'.includes(m[1]!)) return m[3] === String(control);
    return m[3] === letra || m[3] === String(control);
  }

  return false;
}

/** Acumulador de problemas que rellena el mensaje oficial a partir del código. */
class Problemas {
  readonly lista: ProblemaRegistro[] = [];

  /** Añade un problema con código oficial de la AEAT. */
  con(codigo: string, campo: string, apartado: string, detalle: string): void {
    const oficial = ERRORES_AEAT[codigo];
    this.lista.push({
      codigo,
      mensaje: oficial?.mensaje ?? '',
      detalle,
      campo,
      apartado,
      severidad: severidadDe(oficial?.categoria),
    });
  }

  /** Añade un problema de una regla que la AEAT no publica con código propio. */
  sinCodigo(
    campo: string,
    apartado: string,
    mensaje: string,
    detalle: string,
    severidad: Severidad = 'rechazo',
  ): void {
    this.lista.push({ codigo: null, mensaje, detalle, campo, apartado, severidad });
  }
}

function severidadDe(categoria: CategoriaError | undefined): Severidad {
  return categoria === 'admisible' ? 'aviso' : 'rechazo';
}

// --- Bloques comunes --------------------------------------------------------

/**
 * Valida la identificación de una persona por NIF o `IDOtro`, que son excluyentes
 * y de los que hay que informar exactamente uno.
 */
function validarPersona(
  p: Problemas,
  persona: PersonaFisicaJuridica,
  campo: string,
  apartado: string,
  codigoExclusion: string,
): void {
  const tieneNif = Boolean(persona.NIF && persona.NIF.trim() !== '');
  const tieneOtro = Boolean(persona.IDOtro);

  if (tieneNif === tieneOtro) {
    p.con(
      codigoExclusion,
      campo,
      apartado,
      tieneNif
        ? 'Se han informado a la vez NIF e IDOtro, que son excluyentes.'
        : 'No se ha informado ni NIF ni IDOtro, y uno de los dos es obligatorio.',
    );
    return;
  }

  if (tieneNif && !nifValido(persona.NIF!)) {
    p.con(
      '1123',
      `${campo}.NIF`,
      apartado,
      `El NIF "${persona.NIF}" no supera la comprobación de su dígito de control.`,
    );
  }

  if (tieneOtro) {
    const otro = persona.IDOtro!;
    if (otro.IDType !== '02' && (!otro.CodigoPais || otro.CodigoPais.trim() === '')) {
      p.con(
        '1111',
        `${campo}.IDOtro.CodigoPais`,
        apartado,
        `CodigoPais es obligatorio porque IDType es "${otro.IDType}" y no NIF-IVA (02).`,
      );
    }
    if (otro.IDType === '02' && otro.CodigoPais && otro.ID) {
      const prefijo = otro.ID.trim().slice(0, 2).toUpperCase();
      if (prefijo !== otro.CodigoPais.trim().toUpperCase()) {
        p.con(
          '1122',
          `${campo}.IDOtro`,
          apartado,
          `CodigoPais "${otro.CodigoPais}" no coincide con los dos primeros caracteres del ID "${otro.ID}".`,
        );
      }
    }
  }
}

/** Valida la agrupación `SistemaInformatico` (apartado 3.1.5). */
function validarSistemaInformatico(p: Problemas, sistema: SistemaInformatico, campo: string): void {
  const apartado = '3.1.5';
  const tieneNif = Boolean(sistema.NIF && sistema.NIF.trim() !== '');
  const tieneOtro = Boolean(sistema.IDOtro);

  if (tieneNif === tieneOtro) {
    p.con(
      '1223',
      campo,
      apartado,
      tieneNif
        ? 'Se han informado a la vez NIF e IDOtro en SistemaInformatico, que son excluyentes.'
        : 'SistemaInformatico no informa ni NIF ni IDOtro, y uno de los dos es obligatorio.',
    );
  } else if (tieneNif && !nifValido(sistema.NIF!)) {
    p.con(
      '1176',
      `${campo}.NIF`,
      apartado,
      `El NIF "${sistema.NIF}" del productor del sistema no supera la comprobación de su dígito de control.`,
    );
  }

  if (tieneOtro) {
    const otro = sistema.IDOtro!;
    if (otro.IDType === '07') {
      p.con(
        '1221',
        `${campo}.IDOtro.IDType`,
        apartado,
        'No se admite el tipo de identificación "07" (no censado) para el productor del sistema.',
      );
    }
    if (otro.CodigoPais?.trim().toUpperCase() === 'ES' && otro.IDType !== '03') {
      p.con(
        '1232',
        `${campo}.IDOtro.IDType`,
        apartado,
        `Con CodigoPais "ES" el IDType debe ser "03" (pasaporte), y es "${otro.IDType}".`,
      );
    }
    if (otro.IDType !== '02' && (!otro.CodigoPais || otro.CodigoPais.trim() === '')) {
      p.con(
        '1111',
        `${campo}.IDOtro.CodigoPais`,
        apartado,
        `CodigoPais es obligatorio porque IDType es "${otro.IDType}" y no NIF-IVA (02).`,
      );
    }
  }

  if (!/^[A-Z0-9]{2}$/.test(sistema.IdSistemaInformatico ?? '') ||
      sistema.IdSistemaInformatico.includes('Ñ')) {
    p.con(
      '1177',
      `${campo}.IdSistemaInformatico`,
      apartado,
      `IdSistemaInformatico debe tener exactamente 2 caracteres, cada uno letra mayúscula ` +
        `(salvo la Ñ) o dígito; se ha recibido "${sistema.IdSistemaInformatico ?? ''}".`,
    );
  }

  if (!sistema.NombreSistemaInformatico || sistema.NombreSistemaInformatico.trim() === '') {
    p.con(
      '1220',
      `${campo}.NombreSistemaInformatico`,
      apartado,
      'NombreSistemaInformatico es obligatorio y debe tener contenido.',
    );
  }

  if (sistema.TipoUsoPosibleSoloVerifactu !== 'S' && sistema.TipoUsoPosibleSoloVerifactu !== 'N') {
    p.con(
      '1212',
      `${campo}.TipoUsoPosibleSoloVerifactu`,
      apartado,
      'TipoUsoPosibleSoloVerifactu es obligatorio y sólo admite "S" o "N".',
    );
  }
  if (sistema.TipoUsoPosibleMultiOT !== 'S' && sistema.TipoUsoPosibleMultiOT !== 'N') {
    p.con(
      '1213',
      `${campo}.TipoUsoPosibleMultiOT`,
      apartado,
      'TipoUsoPosibleMultiOT es obligatorio y sólo admite "S" o "N".',
    );
  }
  if (sistema.IndicadorMultiplesOT !== 'S' && sistema.IndicadorMultiplesOT !== 'N') {
    p.con(
      '1226',
      `${campo}.IndicadorMultiplesOT`,
      apartado,
      'IndicadorMultiplesOT sólo admite "S" o "N".',
    );
  }
}

/** Valida el bloque `Encadenamiento` y el formato de la huella anterior. */
function validarEncadenamiento(p: Problemas, encadenamiento: Encadenamiento, campo: string): void {
  const apartado = '3.1.3.18';
  const primero = encadenamiento?.PrimerRegistro === 'S';
  const anterior = encadenamiento?.RegistroAnterior;

  if (primero === Boolean(anterior)) {
    p.con(
      '1180',
      campo,
      apartado,
      primero
        ? 'Encadenamiento informa a la vez PrimerRegistro y RegistroAnterior, que son excluyentes.'
        : 'Encadenamiento debe informar PrimerRegistro o RegistroAnterior.',
    );
    return;
  }

  if (!anterior) return;

  if (!/^[0-9A-F]{64}$/.test(anterior.Huella ?? '')) {
    const huella = anterior.Huella ?? '';
    if (huella.length !== 64) {
      p.con(
        '2002',
        `${campo}.RegistroAnterior.Huella`,
        apartado,
        `La huella del registro anterior debe tener 64 caracteres y tiene ${huella.length}.`,
      );
    } else {
      p.con(
        '2003',
        `${campo}.RegistroAnterior.Huella`,
        apartado,
        'La huella del registro anterior debe estar en hexadecimal y en mayúsculas.',
      );
    }
  }

  if (anterior.IDEmisorFactura && !nifValido(anterior.IDEmisorFactura)) {
    p.con(
      '1219',
      `${campo}.RegistroAnterior.IDEmisorFactura`,
      apartado,
      `El NIF "${anterior.IDEmisorFactura}" del registro anterior no supera la comprobación de su dígito de control.`,
    );
  }

  if (comoFecha(anterior.FechaExpedicionFactura) === null) {
    p.con(
      '1174',
      `${campo}.RegistroAnterior.FechaExpedicionFactura`,
      apartado,
      `La fecha "${anterior.FechaExpedicionFactura}" no tiene el formato DD-MM-AAAA o no existe.`,
    );
  }
}

/** Valida la agrupación `IDFactura`. */
function validarIDFactura(
  p: Problemas,
  factura: IDFactura,
  campo: string,
  apartado: string,
  hoy: number,
  comprobarLimites: boolean,
): void {
  if (!factura) return;

  if (factura.IDEmisorFactura && !nifValido(factura.IDEmisorFactura)) {
    p.con(
      '1219',
      `${campo}.IDEmisorFactura`,
      apartado,
      `El NIF "${factura.IDEmisorFactura}" no supera la comprobación de su dígito de control.`,
    );
  }

  const numserie = factura.NumSerieFactura ?? '';
  if (numserie.length < 1 || numserie.length > 60) {
    p.con(
      '1104',
      `${campo}.NumSerieFactura`,
      apartado,
      `NumSerieFactura debe tener entre 1 y 60 caracteres y tiene ${numserie.length}.`,
    );
  } else if (!/^[\x20-\x7E]+$/.test(numserie) || /["'<>=]/.test(numserie)) {
    p.con(
      '1130',
      `${campo}.NumSerieFactura`,
      apartado,
      `NumSerieFactura sólo admite ASCII imprimible (32 a 126) y no puede contener " ' < > = ; ` +
        `se ha recibido "${numserie}".`,
    );
  }

  const expedicion = comoFecha(factura.FechaExpedicionFactura);
  if (expedicion === null) {
    p.con(
      '1105',
      `${campo}.FechaExpedicionFactura`,
      apartado,
      `La fecha "${factura.FechaExpedicionFactura}" no tiene el formato DD-MM-AAAA o no existe.`,
    );
    return;
  }

  if (!comprobarLimites) return;

  if (expedicion > hoy) {
    p.con(
      '1112',
      `${campo}.FechaExpedicionFactura`,
      apartado,
      `La fecha de expedición ${factura.FechaExpedicionFactura} es posterior a la fecha actual.`,
    );
  }
  if (expedicion < FECHA_MINIMA_EXPEDICION) {
    p.con(
      '1152',
      `${campo}.FechaExpedicionFactura`,
      apartado,
      `La fecha de expedición ${factura.FechaExpedicionFactura} es anterior al 28-10-2024, ` +
        'fecha de entrada en vigor de la Orden HAC/1177/2024.',
    );
  }
  const hace20anios = new Date(hoy);
  hace20anios.setUTCFullYear(hace20anios.getUTCFullYear() - 20);
  if (expedicion < hace20anios.getTime()) {
    p.con(
      '1133',
      `${campo}.FechaExpedicionFactura`,
      apartado,
      `La fecha de expedición ${factura.FechaExpedicionFactura} es anterior a la fecha actual menos veinte años.`,
    );
  }
}

// --- Desglose ---------------------------------------------------------------

/** Tipos impositivos de IVA sin restricción temporal. */
const TIPOS_IVA_PERMANENTES = new Set([0, 4, 10, 21]);

/** Tipos impositivos de IVA admitidos sólo en una ventana temporal (apartado 15.1). */
const TIPOS_IVA_TEMPORALES: Array<{ tipo: number; desde: number; hasta: number; codigo: string }> = [
  { tipo: 5, desde: Date.UTC(2022, 6, 1), hasta: Date.UTC(2024, 8, 30), codigo: '1194' },
  { tipo: 2, desde: Date.UTC(2024, 9, 1), hasta: Date.UTC(2024, 11, 31), codigo: '1235' },
  { tipo: 7.5, desde: Date.UTC(2024, 9, 1), hasta: Date.UTC(2024, 11, 31), codigo: '1236' },
];

/** Recargos de equivalencia admitidos para cada tipo impositivo (apartado 15.3). */
const RECARGOS_POR_TIPO: Array<{ tipo: number; recargos: number[]; codigo: string }> = [
  { tipo: 21, recargos: [5.2, 1.75], codigo: '1162' },
  { tipo: 10, recargos: [1.4], codigo: '1163' },
  { tipo: 7.5, recargos: [1], codigo: '1169' },
  { tipo: 5, recargos: [0.5, 0.62], codigo: '1160' },
  { tipo: 4, recargos: [0.5], codigo: '1164' },
  { tipo: 2, recargos: [0.26], codigo: '1166' },
  { tipo: 0, recargos: [0], codigo: '1165' },
];

const RECARGOS_PERMITIDOS = new Set([0, 0.26, 0.5, 0.62, 1, 1.4, 1.75, 5.2]);

function clavesRegimenDe(impuesto: string): readonly string[] {
  if (impuesto === '02') return CLAVES_REGIMEN_IPSI;
  if (impuesto === '03') return CLAVES_REGIMEN_IGIC;
  return CLAVES_REGIMEN_IVA;
}

function validarDetalle(
  p: Problemas,
  detalle: DetalleDesglose,
  indice: number,
  registro: RegistroAlta,
  fechaOperacionEfectiva: number | null,
): void {
  const campo = `Desglose[${indice}]`;
  const impuesto = detalle.Impuesto ?? '01';
  const esIvaOIgic = impuesto === '01' || impuesto === '03';
  const calificacion = detalle.CalificacionOperacion;
  const exenta = detalle.OperacionExenta;
  const clave = detalle.ClaveRegimen;
  const tipo = comoNumero(detalle.TipoImpositivo);
  const recargo = comoNumero(detalle.TipoRecargoEquivalencia);
  const base = comoNumero(detalle.BaseImponibleOimporteNoSujeto);
  const baseCoste = comoNumero(detalle.BaseImponibleACoste);
  const cuota = comoNumero(detalle.CuotaRepercutida);

  // Calificación y exención son excluyentes, y una es obligatoria.
  if (!calificacion && !exenta) {
    p.con('1195', campo, '15.4', 'Debe informarse CalificacionOperacion u OperacionExenta.');
  } else if (calificacion && exenta) {
    p.con(
      '1196',
      campo,
      '15.4',
      `CalificacionOperacion ("${calificacion}") y OperacionExenta ("${exenta}") son excluyentes.`,
    );
  }

  if (comoNumero(detalle.BaseImponibleOimporteNoSujeto) === null) {
    p.con(
      '1100',
      `${campo}.BaseImponibleOimporteNoSujeto`,
      '15',
      `BaseImponibleOimporteNoSujeto es obligatoria y debe ser numérica con hasta dos decimales; ` +
        `se ha recibido "${detalle.BaseImponibleOimporteNoSujeto}".`,
    );
  }

  // Clave de régimen: obligatoriedad y pertenencia a la lista del impuesto.
  if (clave === undefined) {
    if (impuesto === '02') {
      p.con(
        '2009',
        `${campo}.ClaveRegimen`,
        '15.6',
        'Con Impuesto "02" (IPSI) el campo ClaveRegimen debe estar cumplimentado.',
      );
    } else {
      p.con(
        '1245',
        `${campo}.ClaveRegimen`,
        '15.6',
        `Con Impuesto "${impuesto}" el campo ClaveRegimen debe estar cumplimentado.`,
      );
    }
  } else if (impuesto === '05') {
    p.sinCodigo(
      `${campo}.ClaveRegimen`,
      '15.6',
      'ClaveRegimen sólo puede informarse si Impuesto es "01", "02", "03" o no se cumplimenta.',
      `Se ha informado ClaveRegimen "${clave}" con Impuesto "05" (Otros).`,
    );
  } else if (!clavesRegimenDe(impuesto).includes(clave)) {
    p.con(
      '1100',
      `${campo}.ClaveRegimen`,
      '15.6',
      `La clave de régimen "${clave}" no pertenece a la lista admitida para el impuesto "${impuesto}".`,
    );
  }

  // Tipo impositivo (apartado 15.1).
  if (tipo !== null && impuesto === '01' && calificacion === 'S1') {
    if (!TIPOS_IVA_PERMANENTES.has(tipo)) {
      const temporal = TIPOS_IVA_TEMPORALES.find((t) => t.tipo === tipo);
      if (!temporal) {
        p.con(
          '1124',
          `${campo}.TipoImpositivo`,
          '15.1',
          `El tipo impositivo ${tipo} no está entre los admitidos para IVA (0, 2, 4, 5, 7,5, 10 y 21).`,
        );
      } else if (
        fechaOperacionEfectiva !== null &&
        (fechaOperacionEfectiva < temporal.desde || fechaOperacionEfectiva > temporal.hasta)
      ) {
        p.con(
          temporal.codigo,
          `${campo}.TipoImpositivo`,
          '15.1',
          `El tipo impositivo ${tipo} sólo se admite dentro de su ventana temporal, y la fecha de ` +
            'la operación queda fuera.',
        );
      }
    }
  }

  // Recargo de equivalencia (apartado 15.3).
  if (recargo !== null && impuesto === '01' && calificacion === 'S1') {
    if (!RECARGOS_PERMITIDOS.has(recargo)) {
      p.con(
        '1127',
        `${campo}.TipoRecargoEquivalencia`,
        '15.3',
        `El recargo de equivalencia ${recargo} no está entre los admitidos ` +
          '(0, 0,26, 0,5, 0,62, 1, 1,4, 1,75 y 5,2).',
      );
    } else if (tipo !== null) {
      const esperado = RECARGOS_POR_TIPO.find((r) => r.tipo === tipo);
      if (esperado && !esperado.recargos.includes(recargo)) {
        p.con(
          esperado.codigo,
          `${campo}.TipoRecargoEquivalencia`,
          '15.3',
          `Con TipoImpositivo ${tipo} sólo se admite TipoRecargoEquivalencia ` +
            `${esperado.recargos.join(' o ')}; se ha recibido ${recargo}.`,
        );
      }
    }
  }

  // Base imponible a coste (apartado 15.2).
  if (baseCoste !== null && !(clave === '06' || impuesto === '02' || impuesto === '05')) {
    p.sinCodigo(
      `${campo}.BaseImponibleACoste`,
      '15.2',
      'BaseImponibleACoste sólo puede cumplimentarse si ClaveRegimen es "06" o el impuesto es IPSI u Otros.',
      `Se ha informado BaseImponibleACoste con ClaveRegimen "${clave ?? ''}" e Impuesto "${impuesto}".`,
    );
  }

  // Calificación S2: inversión del sujeto pasivo.
  if (calificacion === 'S2') {
    if (!['F1', 'F3', 'R1', 'R2', 'R3', 'R4'].includes(registro.TipoFactura)) {
      p.con(
        '1197',
        `${campo}.CalificacionOperacion`,
        '15.4',
        `Con CalificacionOperacion "S2" el TipoFactura sólo puede ser F1, F3, R1, R2, R3 o R4; ` +
          `es "${registro.TipoFactura}".`,
      );
    }
    if (tipo !== 0 || cuota !== 0) {
      p.con(
        '1198',
        campo,
        '15.4',
        'Con CalificacionOperacion "S2", TipoImpositivo y CuotaRepercutida deben existir y valer 0.',
      );
    }
  }

  // Calificación N1/N2: operación no sujeta.
  if ((calificacion === 'N1' || calificacion === 'N2') && impuesto === '01') {
    const informados = (
      ['TipoImpositivo', 'CuotaRepercutida', 'TipoRecargoEquivalencia', 'CuotaRecargoEquivalencia'] as const
    ).filter((c) => detalle[c] !== undefined);
    if (informados.length > 0) {
      p.con(
        '1237',
        campo,
        '15.4',
        `Con CalificacionOperacion "${calificacion}" no puede informarse ${informados.join(', ')}.`,
      );
    }
  }

  // Operación exenta.
  if (exenta) {
    const informados = (
      ['TipoImpositivo', 'CuotaRepercutida', 'TipoRecargoEquivalencia', 'CuotaRecargoEquivalencia'] as const
    ).filter((c) => detalle[c] !== undefined);
    if (informados.length > 0) {
      p.con(
        '1238',
        campo,
        '15.5',
        `Con OperacionExenta "${exenta}" no puede informarse ${informados.join(', ')}.`,
      );
    }
    if (impuesto === '01' && (exenta === 'E7' || exenta === 'E8')) {
      p.con(
        '1182',
        `${campo}.OperacionExenta`,
        '15.5',
        `Los valores "E7" y "E8" sólo se admiten con Impuesto "03" (IGIC); el impuesto es "${impuesto}".`,
      );
    }
    if (esIvaOIgic && clave === '01' && (exenta === 'E2' || exenta === 'E3')) {
      p.con(
        '1199',
        `${campo}.OperacionExenta`,
        '15.5',
        `Con ClaveRegimen "01" no se admite OperacionExenta "${exenta}".`,
      );
    }
  }

  // Reglas por clave de régimen (apartado 15.6).
  validarClaveRegimen(p, detalle, campo, registro, impuesto, clave, tipo);

  // Cuota repercutida (apartado 15.7).
  if (cuota !== null && cuota !== 0 && calificacion !== 'S1') {
    p.con(
      '1207',
      `${campo}.CuotaRepercutida`,
      '15.7',
      `CuotaRepercutida sólo puede ser distinta de cero con CalificacionOperacion "S1"; ` +
        `la calificación es "${calificacion ?? ''}".`,
    );
  }

  if (calificacion === 'S1') {
    const baseAplicable = baseCoste !== null ? baseCoste : base;
    const campoBase = baseCoste !== null ? 'BaseImponibleACoste' : 'BaseImponibleOimporteNoSujeto';

    if (tipo === null || cuota === null) {
      p.con(
        baseCoste !== null ? '1209' : '1208',
        campo,
        '15.7',
        'Con CalificacionOperacion "S1", TipoImpositivo y CuotaRepercutida son obligatorios.',
      );
    } else if (
      baseAplicable !== null &&
      registro.TipoRectificativa !== 'I' &&
      registro.TipoFactura !== 'R2' &&
      registro.TipoFactura !== 'R3'
    ) {
      if (cuota !== 0 && baseAplicable !== 0 && Math.sign(cuota) !== Math.sign(baseAplicable)) {
        p.con(
          baseCoste !== null ? '1140' : '1143',
          `${campo}.CuotaRepercutida`,
          '15.7',
          `CuotaRepercutida (${cuota}) y ${campoBase} (${baseAplicable}) deben tener el mismo signo.`,
        );
      }
      const esperada = (baseAplicable * tipo) / 100;
      if (Math.abs(cuota - esperada) > MARGEN_IMPORTES) {
        p.con(
          baseCoste !== null ? '1144' : '1142',
          `${campo}.CuotaRepercutida`,
          '15.7',
          `CuotaRepercutida es ${cuota} y de ${campoBase} (${baseAplicable}) al ${tipo} % ` +
            `resulta ${esperada.toFixed(2)}; la diferencia supera el margen de ${MARGEN_IMPORTES} €.`,
        );
      }
    }
  }
}

function validarClaveRegimen(
  p: Problemas,
  detalle: DetalleDesglose,
  campo: string,
  registro: RegistroAlta,
  impuesto: string,
  clave: ClaveRegimen | undefined,
  tipo: number | null,
): void {
  if (clave === undefined) return;
  const esIvaOIgic = impuesto === '01' || impuesto === '03';
  const calificacion = detalle.CalificacionOperacion;
  const exenta = detalle.OperacionExenta;

  if (clave === '02' && esIvaOIgic && !exenta) {
    p.sinCodigo(
      campo,
      '15.6.1',
      'Con ClaveRegimen "02" (exportación) sólo puede estar cumplimentado OperacionExenta.',
      `Se ha informado CalificacionOperacion "${calificacion ?? ''}" en lugar de OperacionExenta.`,
    );
  }

  if (clave === '03' && esIvaOIgic && calificacion && calificacion !== 'S1') {
    p.con(
      '1200',
      `${campo}.CalificacionOperacion`,
      '15.6.2',
      `Con ClaveRegimen "03" (REBU) la calificación sólo puede ser "S1"; es "${calificacion}".`,
    );
  }

  if (clave === '04' && esIvaOIgic && !exenta && calificacion !== 'S2') {
    p.con(
      '1201',
      campo,
      '15.6.3',
      `Con ClaveRegimen "04" (oro de inversión) la calificación sólo puede ser "S2", o bien ` +
        `informarse OperacionExenta; la calificación es "${calificacion ?? ''}".`,
    );
  }

  if (clave === '06' && esIvaOIgic) {
    if (['F2', 'F3', 'R5'].includes(registro.TipoFactura) || detalle.BaseImponibleACoste === undefined) {
      p.con(
        '1202',
        campo,
        '15.6.4',
        `Con ClaveRegimen "06" el TipoFactura no puede ser F2, F3 o R5 (es "${registro.TipoFactura}") ` +
          'y BaseImponibleACoste debe estar cumplimentada.',
      );
    }
  }

  if (clave === '07' && esIvaOIgic) {
    const calificacionProhibida = calificacion === 'S2' || calificacion === 'N1' || calificacion === 'N2';
    const exentaProhibida = exenta ? ['E2', 'E3', 'E4', 'E5'].includes(exenta) : false;
    if (calificacionProhibida || exentaProhibida) {
      p.con(
        '1203',
        campo,
        '15.6.5',
        'Con ClaveRegimen "07" (criterio de caja) no se admiten las calificaciones S2, N1 y N2 ' +
          'ni las exenciones E2, E3, E4 y E5.',
      );
    }
  }

  if (clave === '08' && esIvaOIgic && calificacion !== 'N2') {
    p.sinCodigo(
      `${campo}.CalificacionOperacion`,
      '15.6.6',
      'Con ClaveRegimen "08" la CalificacionOperacion tiene que ser "N2" y estar siempre rellena.',
      `La calificación es "${calificacion ?? ''}".`,
    );
  }

  if (clave === '10' && esIvaOIgic) {
    const destinatariosConNif =
      (registro.Destinatarios ?? []).length > 0 &&
      (registro.Destinatarios ?? []).every((d) => Boolean(d.NIF && d.NIF.trim() !== ''));
    if (calificacion !== 'N1' || registro.TipoFactura !== 'F1' || !destinatariosConNif) {
      p.con(
        '1205',
        campo,
        '15.6.7',
        'Con ClaveRegimen "10" la calificación tiene que ser "N1", el TipoFactura "F1" y todos los ' +
          'destinatarios estar identificados mediante NIF.',
      );
    }
  }

  if (clave === '11' && impuesto === '01' && tipo !== null && tipo !== 21) {
    p.con(
      '1206',
      `${campo}.TipoImpositivo`,
      '15.6.8',
      `Con ClaveRegimen "11" (arrendamiento de local de negocio) sólo se admite el tipo 21 %; es ${tipo} %.`,
    );
  }

  if (clave === '14' && esIvaOIgic) {
    if (!['F1', 'R1', 'R2', 'R3', 'R4'].includes(registro.TipoFactura)) {
      p.con(
        '1148',
        `${campo}.ClaveRegimen`,
        '15.6.9',
        `Con ClaveRegimen "14" el TipoFactura debe ser F1, R1, R2, R3 o R4; es "${registro.TipoFactura}".`,
      );
    }
    const destinatarios = registro.Destinatarios ?? [];
    const todosAdmin =
      destinatarios.length > 0 &&
      destinatarios.every((d) => Boolean(d.NIF) && /^[PQSV]/i.test(d.NIF!.trim()));
    if (!todosAdmin) {
      p.con(
        '1149',
        'Destinatarios',
        '15.6.9',
        'Con ClaveRegimen "14" todos los destinatarios deben identificarse mediante NIF que empiece ' +
          'por P, Q, S o V.',
      );
    }
  }

  if (clave === '20' && impuesto === '03' && calificacion !== 'N2') {
    p.sinCodigo(
      `${campo}.CalificacionOperacion`,
      '15.6.10',
      'Con Impuesto "03" (IGIC) y ClaveRegimen "20" la CalificacionOperacion tiene que ser "N2".',
      `La calificación es "${calificacion ?? ''}".`,
    );
  }
}

// --- Registro de alta -------------------------------------------------------

/**
 * Valida un registro de facturación de alta.
 *
 * Devuelve la lista de problemas, cada uno con el código de error que devolvería la
 * AEAT y el apartado del documento de validaciones que lo establece. Una lista vacía
 * significa que no hay nada rechazable comprobable en local; consulta la nota del
 * encabezado del módulo sobre lo que no puede verificarse sin el censo de la AEAT.
 */
export function validarRegistroAlta(
  registro: RegistroAlta,
  opciones: OpcionesValidacion = {},
): ProblemaRegistro[] {
  const p = new Problemas();
  const hoy = soloDia(opciones.fechaReferencia ?? new Date());

  validarIDFactura(p, registro.IDFactura, 'IDFactura', '3.1.3.1', hoy, true);

  const esRectificativa = TIPOS_RECTIFICATIVOS.has(registro.TipoFactura);
  const expedicion = comoFecha(registro.IDFactura?.FechaExpedicionFactura);
  const operacion = comoFecha(registro.FechaOperacion);
  const fechaEfectiva = operacion ?? expedicion;

  // Subsanación y rechazo previo (apartado 3.1.3.2).
  if (registro.RechazoPrevio === 'X' && registro.Subsanacion !== 'S') {
    p.con(
      '1153',
      'RechazoPrevio',
      '3.1.3.2',
      'RechazoPrevio sólo puede valer "X" si Subsanacion vale "S".',
    );
  }
  if (registro.RechazoPrevio === 'S' && registro.Subsanacion !== 'S') {
    p.con(
      '1161',
      'RechazoPrevio',
      '3.1.3.2',
      'RechazoPrevio no puede valer "S" si Subsanacion no está informado o vale "N".',
    );
  }

  // Rectificativas (apartados 3.1.3.3 a 3.1.3.6).
  if (esRectificativa && !registro.TipoRectificativa) {
    p.con(
      '1114',
      'TipoRectificativa',
      '3.1.3.3',
      `TipoRectificativa es obligatorio con TipoFactura "${registro.TipoFactura}".`,
    );
  }
  if (!esRectificativa && registro.TipoRectificativa) {
    p.con(
      '1115',
      'TipoRectificativa',
      '3.1.3.3',
      `TipoRectificativa no puede informarse con TipoFactura "${registro.TipoFactura}".`,
    );
  }
  if (!esRectificativa && registro.FacturasRectificadas?.length) {
    p.con(
      '1117',
      'FacturasRectificadas',
      '3.1.3.4',
      `FacturasRectificadas sólo puede informarse en rectificativas; TipoFactura es "${registro.TipoFactura}".`,
    );
  }
  if (registro.FacturasSustituidas?.length && registro.TipoFactura !== 'F3') {
    p.con(
      '1116',
      'FacturasSustituidas',
      '3.1.3.5',
      `FacturasSustituidas sólo puede informarse con TipoFactura "F3"; es "${registro.TipoFactura}".`,
    );
  }
  if (registro.TipoRectificativa === 'S' && !registro.ImporteRectificacion) {
    p.con(
      '1118',
      'ImporteRectificacion',
      '3.1.3.6',
      'ImporteRectificacion es obligatorio en rectificativas por sustitución.',
    );
  }
  if (registro.TipoRectificativa !== 'S' && registro.ImporteRectificacion) {
    p.con(
      '1119',
      'ImporteRectificacion',
      '3.1.3.6',
      'ImporteRectificacion sólo puede informarse en rectificativas por sustitución.',
    );
  }
  for (const [i, f] of (registro.FacturasRectificadas ?? []).entries()) {
    validarIDFactura(p, f, `FacturasRectificadas[${i}]`, '3.1.3.4', hoy, false);
  }
  for (const [i, f] of (registro.FacturasSustituidas ?? []).entries()) {
    validarIDFactura(p, f, `FacturasSustituidas[${i}]`, '3.1.3.5', hoy, false);
  }

  // Fecha de operación (apartado 3.1.3.7).
  if (registro.FechaOperacion !== undefined && operacion === null) {
    p.con(
      '1145',
      'FechaOperacion',
      '3.1.3.7',
      `La fecha "${registro.FechaOperacion}" no tiene el formato DD-MM-AAAA o no existe.`,
    );
  }
  if (operacion !== null) {
    const hace20anios = new Date(hoy);
    hace20anios.setUTCFullYear(hace20anios.getUTCFullYear() - 20);
    if (operacion < hace20anios.getTime()) {
      p.con(
        '1134',
        'FechaOperacion',
        '3.1.3.7',
        `La fecha de operación ${registro.FechaOperacion} es anterior a la fecha actual menos veinte años.`,
      );
    }
    const finAnioSiguiente = Date.UTC(new Date(hoy).getUTCFullYear() + 1, 11, 31);
    if (operacion > finAnioSiguiente) {
      p.con(
        '1125',
        'FechaOperacion',
        '3.1.3.7',
        `La fecha de operación ${registro.FechaOperacion} supera el año siguiente al actual.`,
      );
    }
  }

  const clavesDesglose = new Set((registro.Desglose ?? []).map((d) => d.ClaveRegimen));
  const impuestosIvaIgic = (registro.Desglose ?? []).every((d) => {
    const imp = d.Impuesto ?? '01';
    return imp === '01' || imp === '03';
  });
  const admiteDiferimiento = clavesDesglose.has('14') || clavesDesglose.has('15');

  if (expedicion !== null && operacion !== null && impuestosIvaIgic) {
    if (expedicion < operacion && !admiteDiferimiento) {
      p.con(
        '1146',
        'FechaOperacion',
        '3.1.3.7',
        'La fecha de expedición sólo puede ser anterior a la de operación con ClaveRegimen "14" o "15".',
      );
    }
    if (operacion > hoy && !admiteDiferimiento) {
      p.con(
        '1173',
        'FechaOperacion',
        '3.1.3.7',
        'La fecha de operación sólo puede ser posterior a la actual con ClaveRegimen "14" o "15".',
      );
    }
  }
  if (clavesDesglose.has('14') && (operacion === null || expedicion === null || operacion <= expedicion)) {
    p.con(
      '1147',
      'FechaOperacion',
      '15.6.9',
      'Con ClaveRegimen "14" la FechaOperacion es obligatoria y debe ser posterior a la de expedición.',
    );
  }

  // Marcas de la factura (apartados 3.1.3.8 a 3.1.3.10).
  if (registro.FacturaSimplificadaArt7273 === 'S' &&
      !['F1', 'F3', 'R1', 'R2', 'R3', 'R4'].includes(registro.TipoFactura)) {
    p.con(
      '1183',
      'FacturaSimplificadaArt7273',
      '3.1.3.8',
      `Sólo puede valer "S" con TipoFactura F1, F3, R1, R2, R3 o R4; es "${registro.TipoFactura}".`,
    );
  }
  if (registro.FacturaSinIdentifDestinatarioArt61d === 'S' &&
      !['F2', 'R5'].includes(registro.TipoFactura)) {
    p.con(
      '1185',
      'FacturaSinIdentifDestinatarioArt61d',
      '3.1.3.9',
      `Sólo puede valer "S" con TipoFactura F2 o R5; es "${registro.TipoFactura}".`,
    );
  }

  const importeTotal = comoNumero(registro.ImporteTotal);
  if (importeTotal === null) {
    p.con(
      '1100',
      'ImporteTotal',
      '17',
      `ImporteTotal es obligatorio y debe ser numérico con hasta dos decimales; ` +
        `se ha recibido "${registro.ImporteTotal}".`,
    );
  } else {
    const esMacrodato = Math.abs(importeTotal) >= UMBRAL_MACRODATO;
    if (esMacrodato && registro.Macrodato !== 'S') {
      p.con(
        '1139',
        'Macrodato',
        '3.1.3.10',
        `ImporteTotal es ${importeTotal} y alcanza el umbral de macrodato, así que Macrodato debe valer "S".`,
      );
    }
    if (!esMacrodato && registro.Macrodato === 'S') {
      p.con(
        '1138',
        'Macrodato',
        '3.1.3.10',
        `Macrodato sólo puede valer "S" si ImporteTotal alcanza ${UMBRAL_MACRODATO} en valor absoluto; ` +
          `es ${importeTotal}.`,
      );
    }
  }

  // Emisión por tercero o destinatario (apartados 3.1.3.11 y 3.1.3.12).
  const emitidaPor = registro.EmitidaPorTerceroODestinatario;
  if (emitidaPor === 'T' && !registro.Tercero) {
    p.con('1186', 'Tercero', '3.1.3.11', 'Con EmitidaPorTerceroODestinatario "T", el bloque Tercero es obligatorio.');
  }
  if (emitidaPor === 'D' && !(registro.Destinatarios ?? []).length) {
    p.con(
      '1158',
      'Destinatarios',
      '3.1.3.11',
      'Con EmitidaPorTerceroODestinatario "D", el bloque Destinatarios es obligatorio.',
    );
  }
  if (registro.Tercero && emitidaPor === undefined) {
    p.con(
      '1155',
      'Tercero',
      '3.1.3.12',
      'Se informa el bloque Tercero sin informar EmitidaPorTerceroODestinatario.',
    );
  }
  if (registro.Tercero && emitidaPor === 'D') {
    p.con('1159', 'Tercero', '3.1.3.12', 'No puede informarse Tercero cuando la emisión es del destinatario.');
  }
  if (registro.Tercero) {
    validarPersona(p, registro.Tercero, 'Tercero', '3.1.3.12', '1178');
    if (registro.Tercero.IDOtro?.IDType === '07') {
      p.con(
        '1211',
        'Tercero.IDOtro.IDType',
        '3.1.3.12',
        'El bloque Tercero no puede identificarse con IDType "07" (no censado).',
      );
    }
    if (
      registro.Tercero.NIF &&
      registro.IDFactura?.IDEmisorFactura &&
      registro.Tercero.NIF.trim().toUpperCase() === registro.IDFactura.IDEmisorFactura.trim().toUpperCase()
    ) {
      p.con(
        '1188',
        'Tercero.NIF',
        '3.1.3.12',
        'El NIF del tercero debe ser distinto del NIF del obligado a expedir la factura.',
      );
    }
  }

  // Destinatarios (apartado 3.1.3.13).
  const destinatarios = registro.Destinatarios ?? [];
  if (['F1', 'F3', 'R1', 'R2', 'R3', 'R4'].includes(registro.TipoFactura) && destinatarios.length === 0) {
    p.con(
      '1189',
      'Destinatarios',
      '3.1.3.13',
      `Con TipoFactura "${registro.TipoFactura}" hay que informar al menos un destinatario.`,
    );
  }
  if (['F2', 'R5'].includes(registro.TipoFactura) && destinatarios.length > 0) {
    p.con(
      '1190',
      'Destinatarios',
      '3.1.3.13',
      `Con TipoFactura "${registro.TipoFactura}" no puede informarse el bloque Destinatarios.`,
    );
  }
  for (const [i, destinatario] of destinatarios.entries()) {
    const campo = `Destinatarios[${i}]`;
    validarPersona(p, destinatario, campo, '3.1.3.13', '1239');
    const otro = destinatario.IDOtro;
    if (otro) {
      if (otro.IDType === '07' && otro.CodigoPais?.trim().toUpperCase() !== 'ES') {
        p.con(
          '1126',
          `${campo}.IDOtro.CodigoPais`,
          '3.1.3.13',
          'Con IDType "07" (no censado) el CodigoPais debe ser "ES".',
        );
      }
      if (otro.CodigoPais?.trim().toUpperCase() === 'ES' && !['03', '07'].includes(otro.IDType)) {
        p.con(
          '1234',
          `${campo}.IDOtro.IDType`,
          '3.1.3.13',
          `Con CodigoPais "ES" el IDType debe ser "03" o "07"; es "${otro.IDType}".`,
        );
      }
      if (otro.IDType === '02' && !['F1', 'F3', 'R1', 'R2', 'R3', 'R4'].includes(registro.TipoFactura)) {
        p.con(
          '1156',
          `${campo}.IDOtro`,
          '3.1.3.13',
          `Con IDType "02" (NIF-IVA) el TipoFactura debe ser F1, F3, R1, R2, R3 o R4; ` +
            `es "${registro.TipoFactura}".`,
        );
      }
    }
    if (
      destinatario.NIF &&
      registro.IDFactura?.IDEmisorFactura &&
      destinatario.NIF.trim().toUpperCase() === registro.IDFactura.IDEmisorFactura.trim().toUpperCase()
    ) {
      p.con(
        '1193',
        `${campo}.NIF`,
        '3.1.3.13',
        'El NIF del destinatario debe ser distinto del NIF del obligado a expedir la factura.',
      );
    }
  }

  // Cupón (apartado 3.1.3.14).
  if (registro.Cupon === 'S' && !['R1', 'R5'].includes(registro.TipoFactura)) {
    p.con(
      '1157',
      'Cupon',
      '3.1.3.14',
      `Cupon sólo puede valer "S" con TipoFactura R1 o R5; es "${registro.TipoFactura}".`,
    );
  }

  // Desglose.
  const desglose = registro.Desglose ?? [];
  if (desglose.length === 0) {
    p.con('1100', 'Desglose', '15', 'El desglose debe tener al menos una línea de detalle.');
  }
  for (const [i, detalle] of desglose.entries()) {
    validarDetalle(p, detalle, i, registro, fechaEfectiva);
  }

  // Límite de las facturas simplificadas (apartado 15.8).
  if (
    registro.TipoFactura === 'F2' &&
    !registro.NumRegistroAcuerdoFacturacion &&
    registro.FacturaSinIdentifDestinatarioArt61d !== 'S'
  ) {
    const suma = desglose.reduce(
      (total, d) =>
        total + (comoNumero(d.BaseImponibleOimporteNoSujeto) ?? 0) + (comoNumero(d.CuotaRepercutida) ?? 0),
      0,
    );
    if (suma > LIMITE_SIMPLIFICADA + MARGEN_IMPORTES) {
      p.con(
        '1150',
        'Desglose',
        '15.8',
        `La suma de bases y cuotas de una factura simplificada es ${suma.toFixed(2)} € y no puede ` +
          `superar ${LIMITE_SIMPLIFICADA} €.`,
      );
    }
  }

  // Cuadre de CuotaTotal e ImporteTotal (apartados 16 y 17).
  const clavesExcluidasDelCuadre = ['03', '05', '06', '08', '09'];
  const cuadreAplicable = !desglose.some((d) =>
    d.ClaveRegimen ? clavesExcluidasDelCuadre.includes(d.ClaveRegimen) : false,
  );

  if (cuadreAplicable) {
    const cuotaTotal = comoNumero(registro.CuotaTotal);
    const sumaCuotas = desglose.reduce(
      (total, d) =>
        total + (comoNumero(d.CuotaRepercutida) ?? 0) + (comoNumero(d.CuotaRecargoEquivalencia) ?? 0),
      0,
    );
    if (cuotaTotal === null) {
      p.con(
        '1100',
        'CuotaTotal',
        '16',
        `CuotaTotal es obligatorio y debe ser numérico con hasta dos decimales; ` +
          `se ha recibido "${registro.CuotaTotal}".`,
      );
    } else if (Math.abs(cuotaTotal - sumaCuotas) > MARGEN_IMPORTES) {
      p.con(
        '2006',
        'CuotaTotal',
        '16',
        `CuotaTotal es ${cuotaTotal} y la suma de cuotas del desglose es ${sumaCuotas.toFixed(2)}; ` +
          `la diferencia supera el margen de ${MARGEN_IMPORTES} €.`,
      );
    }

    if (importeTotal !== null) {
      const sumaImportes = desglose.reduce(
        (total, d) =>
          total +
          (comoNumero(d.BaseImponibleOimporteNoSujeto) ?? 0) +
          (comoNumero(d.CuotaRepercutida) ?? 0) +
          (comoNumero(d.CuotaRecargoEquivalencia) ?? 0),
        0,
      );
      if (Math.abs(importeTotal - sumaImportes) > MARGEN_IMPORTES) {
        p.con(
          '2005',
          'ImporteTotal',
          '17',
          `ImporteTotal es ${importeTotal} y la suma del desglose es ${sumaImportes.toFixed(2)}; ` +
            `la diferencia supera el margen de ${MARGEN_IMPORTES} €.`,
        );
      }
    }
  }

  // Campos obligatorios de texto.
  if (!registro.NombreRazonEmisor || registro.NombreRazonEmisor.trim() === '') {
    p.con('1215', 'NombreRazonEmisor', '3.1.3', 'NombreRazonEmisor es obligatorio y debe tener contenido.');
  }
  if (!registro.DescripcionOperacion || registro.DescripcionOperacion.trim() === '') {
    p.con('1100', 'DescripcionOperacion', '3.1.3', 'DescripcionOperacion es obligatoria y debe tener contenido.');
  }

  validarEncadenamiento(p, registro.Encadenamiento, 'Encadenamiento');
  validarHuellaPropia(p, registro.Huella, registro.Encadenamiento);
  validarSistemaInformatico(p, registro.SistemaInformatico, 'SistemaInformatico');
  validarFechaHoraHuso(p, registro.FechaHoraHusoGenRegistro, opciones.fechaReferencia ?? new Date());

  return p.lista;
}

// --- Registro de anulación --------------------------------------------------

/**
 * Valida un registro de facturación de anulación (apartado 3.1.4).
 *
 * Igual que {@link validarRegistroAlta}, sólo comprueba lo que no depende del censo
 * ni de datos internos de la AEAT.
 */
export function validarRegistroAnulacion(
  registro: RegistroAnulacion,
  opciones: OpcionesValidacion = {},
): ProblemaRegistro[] {
  const p = new Problemas();
  const hoy = soloDia(opciones.fechaReferencia ?? new Date());

  validarIDFactura(p, registro.IDFactura, 'IDFactura', '3.1.4.1', hoy, true);

  const generadoPor = registro.GeneradoPor;
  if (Boolean(generadoPor) !== Boolean(registro.Generador)) {
    p.con(
      '1224',
      generadoPor ? 'Generador' : 'GeneradoPor',
      '3.1.4.2',
      'GeneradoPor y Generador deben informarse juntos.',
    );
  }

  if (registro.Generador) {
    validarPersona(p, registro.Generador, 'Generador', '3.1.4.3', '1228');
    const otro = registro.Generador.IDOtro;

    if (generadoPor === 'E' && !registro.Generador.NIF) {
      p.con(
        '1227',
        'Generador.NIF',
        '3.1.4.3',
        'Con GeneradoPor "E" (expedidor) hay que informar el NIF del generador.',
      );
    }
    if (generadoPor === 'T' && otro?.IDType === '07') {
      p.con(
        '1229',
        'Generador.IDOtro.IDType',
        '3.1.4.3',
        'Con GeneradoPor "T" no se admite IDType "07" (no censado).',
      );
    }
    if (
      generadoPor === 'T' &&
      otro?.CodigoPais?.trim().toUpperCase() === 'ES' &&
      otro.IDType !== '03'
    ) {
      p.con(
        '1232',
        'Generador.IDOtro.IDType',
        '3.1.4.3',
        `Con GeneradoPor "T" y CodigoPais "ES" el IDType debe ser "03"; es "${otro.IDType}".`,
      );
    }
    if (
      generadoPor === 'D' &&
      otro?.CodigoPais?.trim().toUpperCase() === 'ES' &&
      !['03', '07'].includes(otro.IDType)
    ) {
      p.con(
        '1230',
        'Generador.IDOtro.IDType',
        '3.1.4.3',
        `Con GeneradoPor "D" y CodigoPais "ES" el IDType debe ser "03" o "07"; es "${otro.IDType}".`,
      );
    }
    if (
      registro.Generador.NIF &&
      registro.IDFactura?.IDEmisorFactura &&
      registro.Generador.NIF.trim().toUpperCase() ===
        registro.IDFactura.IDEmisorFactura.trim().toUpperCase()
    ) {
      p.con(
        '1228',
        'Generador.NIF',
        '3.1.4.3',
        'El NIF del generador debe ser distinto del NIF del obligado a expedir la factura anulada.',
      );
    }
  }

  validarEncadenamiento(p, registro.Encadenamiento, 'Encadenamiento');
  validarHuellaPropia(p, registro.Huella, registro.Encadenamiento);
  validarSistemaInformatico(p, registro.SistemaInformatico, 'SistemaInformatico');
  validarFechaHoraHuso(p, registro.FechaHoraHusoGenRegistro, opciones.fechaReferencia ?? new Date());

  return p.lista;
}

// --- Comunes a alta y anulación ---------------------------------------------

function validarHuellaPropia(p: Problemas, huella: string, encadenamiento: Encadenamiento): void {
  if (!/^[0-9A-F]{64}$/.test(huella ?? '')) {
    p.con(
      '2000',
      'Huella',
      '3.1.3.23',
      'La huella debe ser la salida de SHA-256: 64 caracteres hexadecimales en mayúsculas.',
    );
    return;
  }
  const anterior = encadenamiento?.RegistroAnterior?.Huella;
  if (anterior && anterior === huella) {
    p.con(
      '2008',
      'Huella',
      '3.1.3.18',
      'La huella del registro anterior no puede coincidir con la del registro actual.',
    );
  }
}

function validarFechaHoraHuso(p: Problemas, valor: string, referencia: Date): void {
  const texto = (valor ?? '').trim();
  const conHuso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(texto);
  if (!conHuso || Number.isNaN(Date.parse(texto))) {
    p.con(
      '1244',
      'FechaHoraHusoGenRegistro',
      '3.1.3.20',
      `FechaHoraHusoGenRegistro debe seguir ISO 8601 con huso horario obligatorio ` +
        `(p. ej. 2024-01-01T19:20:30+01:00); se ha recibido "${texto}".`,
    );
    return;
  }
  if (Date.parse(texto) > referencia.getTime()) {
    p.con(
      '2004',
      'FechaHoraHusoGenRegistro',
      '3.1.3.20',
      `FechaHoraHusoGenRegistro (${texto}) es posterior al momento actual.`,
    );
  }
}
