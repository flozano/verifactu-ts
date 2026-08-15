/**
 * «URL» del servicio de cotejo o remisión de información de la factura: el
 * contenido que va dentro del «QR tributario».
 *
 * Implementa "Detalle de las especificaciones técnicas del código «QR» de la factura
 * y de la «URL» del servicio de cotejo o remisión de información por parte del
 * receptor de la factura", AEAT, versión 0.5.0 (10/12/2025), en desarrollo de los
 * artículos 20 y 21 de la Orden HAC/1177/2024.
 *
 * Las validaciones reproducen el catálogo de errores del apartado 10 de ese
 * documento: si `validarDatosQr` no devuelve nada, el servicio de la AEAT no
 * debería rechazar la «URL» por formato.
 */

import type { FechaRegistro, Importe } from './types.js';
import { svgDesdeMatrizQr, matrizQr, type OpcionesSvgQr } from './qr.js';

/** Datos de la factura que viajan en la «URL» (apartado 6). */
export interface DatosQrFactura {
  /** NIF del obligado a expedir la factura. */
  nif: string;
  /** Nº de serie + nº de factura que identifica a la factura. Máximo 60 caracteres. */
  numserie: string;
  /** Fecha de expedición de la factura, en formato DD-MM-AAAA. */
  fecha: FechaRegistro;
  /**
   * Importe total de la factura. Debe coincidir con el `ImporteTotal` del registro
   * de facturación: la AEAT lo compara al cotejar.
   *
   * Si se pasa un número se formatea con dos decimales; para tener control exacto
   * de la representación, pásalo como cadena.
   */
  importe: Importe | number;
}

/** Entorno de la AEAT al que apunta la «URL» (apartado 5). */
export type EntornoAeat = 'produccion' | 'pruebas';

/** Idiomas admitidos por el servicio de cotejo (apartado 7.1). */
export type IdiomaCotejo = 'es' | 'ca' | 'gl' | 'eu' | 'va' | 'en';

export interface OpcionesUrlCotejo {
  /** Por defecto `'produccion'`. */
  entorno?: EntornoAeat;
  /**
   * `true` (por defecto) para sistemas que emiten facturas verificables (VERI*FACTU);
   * `false` para sistemas no verificables, que usan otro punto de entrada.
   */
  verificable?: boolean;
  /** Idioma de la respuesta en la sede electrónica. Por defecto, castellano. */
  idioma?: IdiomaCotejo;
}

/**
 * Texto que debe preceder al código QR en la factura, encima del propio código
 * (apartado 3 de la especificación).
 */
export const TEXTO_ENCIMA_QR = 'QR tributario:';

/**
 * Frase que debe aparecer justo debajo del QR en las facturas expedidas por
 * sistemas que emiten facturas verificables (artículo 20.1.b de la Orden).
 * La alternativa admitida es {@link TEXTO_DEBAJO_QR_VERIFACTU_CORTO}.
 */
export const TEXTO_DEBAJO_QR_VERIFACTU = 'Factura verificable en la sede electrónica de la AEAT';

/** Forma corta admitida de {@link TEXTO_DEBAJO_QR_VERIFACTU}. */
export const TEXTO_DEBAJO_QR_VERIFACTU_CORTO = 'VERI*FACTU';

const BASES: Record<EntornoAeat, string> = {
  produccion: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/',
  pruebas: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/',
};

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';
const MAX_NUMSERIE = 60;
const MAX_DIGITOS_ENTEROS_IMPORTE = 12;

/** Problema detectado en los datos del QR, con el código de error de la AEAT. */
export interface ProblemaQr {
  /** Parámetro afectado. */
  campo: 'nif' | 'numserie' | 'fecha' | 'importe';
  /** Código del apartado 10 de la especificación (1001-1004 y 2001-2006). */
  codigo: string;
  mensaje: string;
}

/** Comprueba el dígito de control de un NIF, NIE o CIF español. */
function nifValido(nif: string): boolean {
  const valor = nif.toUpperCase();

  // DNI: 8 dígitos y letra de control.
  let m = /^(\d{8})([A-Z])$/.exec(valor);
  if (m) return m[2] === LETRAS_DNI[Number(m[1]) % 23];

  // NIE: X, Y y Z sustituyen al 0, 1 y 2 iniciales.
  m = /^([XYZ])(\d{7})([A-Z])$/.exec(valor);
  if (m) return m[3] === LETRAS_DNI[Number(`${'XYZ'.indexOf(m[1]!)}${m[2]}`) % 23];

  // Personas físicas sin DNI: K, L y M, con la misma letra de control.
  m = /^([KLM])(\d{7})([A-Z])$/.exec(valor);
  if (m) return m[3] === LETRAS_DNI[Number(m[2]) % 23];

  // NIF de personas jurídicas y entidades.
  m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(valor);
  if (m) {
    let suma = 0;
    for (let i = 0; i < 7; i++) {
      const digito = Number(m[2]![i]);
      // Las posiciones impares se duplican y se suman sus cifras.
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

function fechaValida(fecha: string): boolean {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(fecha);
  if (!m) return false;
  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1) return false;
  // El día 0 del mes siguiente es el último del mes buscado.
  return dia <= new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Normaliza el importe a la representación que espera la «URL». */
function importeComoTexto(importe: Importe | number): string {
  return typeof importe === 'number' ? importe.toFixed(2) : importe.trim();
}

/**
 * Valida los datos de la factura contra las reglas del servicio de cotejo.
 * Devuelve la lista de problemas (vacía si todo cuadra), cada uno con el código
 * de error que devolvería la propia AEAT.
 */
export function validarDatosQr(datos: DatosQrFactura): ProblemaQr[] {
  const problemas: ProblemaQr[] = [];
  const nif = (datos.nif ?? '').trim();
  const numserie = (datos.numserie ?? '').trim();
  const fecha = (datos.fecha ?? '').trim();
  const importe = importeComoTexto(datos.importe ?? '');

  if (nif === '') {
    problemas.push({
      campo: 'nif',
      codigo: '1001',
      mensaje: 'No se ha remitido el parámetro: nif (NIF del obligado a expedir la factura).',
    });
  } else if (!nifValido(nif)) {
    problemas.push({
      campo: 'nif',
      codigo: '2001',
      mensaje: `El NIF tiene un formato erróneo o no es válido: "${nif}".`,
    });
  }

  if (numserie === '') {
    problemas.push({
      campo: 'numserie',
      codigo: '1002',
      mensaje: 'No se ha remitido el parámetro: numserie (nº de serie y número de factura).',
    });
  } else if (numserie.length > MAX_NUMSERIE) {
    problemas.push({
      campo: 'numserie',
      codigo: '2002',
      mensaje:
        `El número de serie excede el número máximo de caracteres: ` +
        `${numserie.length} de ${MAX_NUMSERIE}.`,
    });
  } else if (!/^[\x20-\x7E]+$/.test(numserie)) {
    problemas.push({
      campo: 'numserie',
      codigo: '2003',
      mensaje:
        'El número de serie contiene caracteres no permitidos: solo se admite ASCII imprimible ' +
        '(códigos 32 a 126), sin acentos ni eñes.',
    });
  }

  if (fecha === '') {
    problemas.push({
      campo: 'fecha',
      codigo: '1003',
      mensaje: 'No se ha remitido el parámetro: fecha (fecha de expedición de la factura).',
    });
  } else if (!fechaValida(fecha)) {
    problemas.push({
      campo: 'fecha',
      codigo: '2004',
      mensaje: `La fecha de expedición tiene formato inválido y debe tener el formato DD-MM-AAAA: "${fecha}".`,
    });
  }

  if (importe === '') {
    problemas.push({
      campo: 'importe',
      codigo: '1004',
      mensaje: 'No se ha remitido el parámetro: importe (importe total de la factura).',
    });
  } else if (!/^-?\d+(\.\d{1,2})?$/.test(importe)) {
    problemas.push({
      campo: 'importe',
      codigo: '2005',
      mensaje:
        `El importe tiene un formato incorrecto: "${importe}". Debe ser numérico, con el punto ` +
        'como separador decimal y un máximo de dos decimales.',
    });
  } else if (importe.replace('-', '').split('.')[0]!.length > MAX_DIGITOS_ENTEROS_IMPORTE) {
    problemas.push({
      campo: 'importe',
      codigo: '2006',
      mensaje: `El importe excede el número máximo de caracteres: ${MAX_DIGITOS_ENTEROS_IMPORTE} dígitos enteros.`,
    });
  }

  return problemas;
}

/**
 * Codifica el valor de un parámetro para la «URL» (apartado 4).
 *
 * `encodeURIComponent` cubre lo que exige la especificación —codificación UTF-8 de
 * todo carácter con significado en la «URL», empezando por el `&` del ejemplo—.
 * Difiere del ejemplo en Java de la especificación en que el espacio se codifica
 * como `%20` en vez de `+`; ambas formas se decodifican como espacio, y `%20` es
 * la válida fuera de un cuerpo de formulario.
 */
function codificarParametro(valor: string): string {
  return encodeURIComponent(valor);
}

function construirUrl(
  datos: DatosQrFactura,
  opciones: OpcionesUrlCotejo,
  extra?: Record<string, string>,
): string {
  const problemas = validarDatosQr(datos);
  if (problemas.length > 0) {
    throw new TypeError(
      `Los datos de la factura no son válidos para el QR de cotejo:\n` +
        problemas.map((p) => `  [${p.codigo}] ${p.mensaje}`).join('\n'),
    );
  }

  const servicio = (opciones.verificable ?? true) ? 'ValidarQR' : 'ValidarQRNoVerifactu';
  const parametros: Record<string, string> = {
    nif: datos.nif.trim(),
    numserie: datos.numserie.trim(),
    fecha: datos.fecha.trim(),
    importe: importeComoTexto(datos.importe),
    ...(opciones.idioma ? { idioma: opciones.idioma } : {}),
    ...extra,
  };

  const consulta = Object.entries(parametros)
    .map(([clave, valor]) => `${clave}=${codificarParametro(valor)}`)
    .join('&');

  return `${BASES[opciones.entorno ?? 'produccion']}${servicio}?${consulta}`;
}

/**
 * Construye la «URL» del servicio de cotejo que debe ir dentro del código QR
 * de la factura.
 *
 * Lanza `TypeError` si los datos no pasan las validaciones de {@link validarDatosQr}:
 * una «URL» mal formada produce un QR que la AEAT rechaza al escanearlo, y eso solo
 * se descubre con la factura ya emitida.
 *
 * @example
 * urlCotejo({
 *   nif: '89890001K',
 *   numserie: '12345678-G33',
 *   fecha: '01-09-2024',
 *   importe: '241.4',
 * }, { entorno: 'pruebas' });
 * // https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=12345678-G33&fecha=01-09-2024&importe=241.4
 */
export function urlCotejo(datos: DatosQrFactura, opciones: OpcionesUrlCotejo = {}): string {
  return construirUrl(datos, opciones);
}

/**
 * Igual que {@link urlCotejo} pero añadiendo el parámetro `formato=json`, que hace
 * que la AEAT responda en JSON en vez de HTML (apartado 7.2).
 *
 * Es para que el sistema del receptor de una factura electrónica coteje la
 * información de forma automatizada. **Nunca debe incorporarse a la «URL» que va
 * dentro del código QR de la factura**, según la propia especificación.
 */
export function urlCotejoJson(datos: DatosQrFactura, opciones: OpcionesUrlCotejo = {}): string {
  return construirUrl(datos, opciones, { formato: 'json' });
}

/**
 * Devuelve el «QR tributario» de una factura como SVG, listo para incrustar.
 *
 * Codifica la «URL» de cotejo con nivel de corrección M, tal y como exige el
 * artículo 21.1 de la Orden HAC/1177/2024. El SVG se dimensiona por defecto a
 * 35 mm de lado, dentro del rango obligatorio de 30x30 a 40x40 mm.
 *
 * Recuerda que la factura debe llevar además el texto {@link TEXTO_ENCIMA_QR}
 * encima del código y, si el sistema emite facturas verificables, la frase
 * {@link TEXTO_DEBAJO_QR_VERIFACTU} debajo.
 */
export function svgQrFactura(
  datos: DatosQrFactura,
  opciones: OpcionesUrlCotejo & OpcionesSvgQr = {},
): string {
  return svgDesdeMatrizQr(matrizQr(urlCotejo(datos, opciones)), opciones);
}
