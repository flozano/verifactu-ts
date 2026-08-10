/**
 * verifactu-ts — utilidades de VeriFactu (AEAT) para TypeScript y Node.
 *
 * v0.1: cálculo de la huella y encadenamiento de registros, conforme a
 * "Detalle de las especificaciones técnicas para generación de la huella o hash
 * de los registros de facturación" (AEAT, v0.1.2, 27/08/2024), verificado contra
 * los tres vectores de ejemplo oficiales.
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
