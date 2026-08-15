/**
 * verifactu-ts — utilidades de VeriFactu (AEAT) para TypeScript y Node.
 *
 * - Huella y encadenamiento de registros, conforme a "Detalle de las especificaciones
 *   técnicas para generación de la huella o hash de los registros de facturación"
 *   (AEAT, v0.1.2, 27/08/2024), verificado contra los tres vectores oficiales.
 * - «QR tributario» de la factura y «URL» del servicio de cotejo, conforme a
 *   "Detalle de las especificaciones técnicas del código «QR» de la factura y de la
 *   «URL» del servicio de cotejo o remisión de información por parte del receptor de
 *   la factura" (AEAT, v0.5.0, 10/12/2025).
 */

export type {
  CamposHuellaAlta,
  CamposHuellaAnulacion,
  CamposHuellaEvento,
  FechaHoraHuso,
  FechaRegistro,
  Huella,
  Importe,
  RegistroEncadenado,
} from './types.js';

export {
  cadenaHuellaAlta,
  cadenaHuellaAnulacion,
  cadenaHuellaEvento,
  huellaAlta,
  huellaAnulacion,
  huellaEvento,
} from './huella.js';

export type {
  AltaSinEncadenar,
  AnulacionSinEncadenar,
  ProblemaCadena,
  RegistroPendiente,
} from './cadena.js';

export { encadenar, encadenarSecuencia, verificarCadena } from './cadena.js';

export type {
  DatosQrFactura,
  EntornoAeat,
  IdiomaCotejo,
  OpcionesUrlCotejo,
  ProblemaQr,
} from './cotejo.js';

export {
  svgQrFactura,
  TEXTO_DEBAJO_QR_VERIFACTU,
  TEXTO_DEBAJO_QR_VERIFACTU_CORTO,
  TEXTO_ENCIMA_QR,
  urlCotejo,
  urlCotejoJson,
  validarDatosQr,
} from './cotejo.js';

export type { OpcionesSvgQr } from './qr.js';

export { matrizQr, svgDesdeMatrizQr, svgQr } from './qr.js';
