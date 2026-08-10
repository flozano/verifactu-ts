/**
 * Cálculo de la huella (hash) de los registros de facturación VeriFactu.
 *
 * Implementa "Detalle de las especificaciones técnicas para generación de la huella
 * o hash de los registros de facturación", AEAT, v0.1.2 (27/08/2024).
 *
 * Reglas que impone la especificación:
 *  - Los campos se concatenan en el orden exacto del diseño de registro, con la
 *    forma `nombreCampo1=valor1&nombreCampo2=valor2`.
 *  - Los valores se toman del XML eliminando espacios al inicio y al final.
 *  - Un campo ausente o vacío aparece igualmente, como `nombreCampo=` sin valor.
 *  - La cadena se codifica en UTF-8 y se le aplica SHA-256.
 *  - La salida es hexadecimal en MAYÚSCULAS.
 */

import { createHash } from 'node:crypto';
import type {
  CamposHuellaAlta,
  CamposHuellaAnulacion,
  CamposHuellaEvento,
  Huella,
} from './types.js';

/** Orden de campos para registros de alta (apartado 3.a de la especificación). */
const ORDEN_ALTA = [
  'IDEmisorFactura',
  'NumSerieFactura',
  'FechaExpedicionFactura',
  'TipoFactura',
  'CuotaTotal',
  'ImporteTotal',
  'Huella',
  'FechaHoraHusoGenRegistro',
] as const;

/** Orden de campos para registros de anulación (apartado 3.b). */
const ORDEN_ANULACION = [
  'IDEmisorFacturaAnulada',
  'NumSerieFacturaAnulada',
  'FechaExpedicionFacturaAnulada',
  'Huella',
  'FechaHoraHusoGenRegistro',
] as const;

/** Orden de campos para registros de evento (apartado 3.c). */
const ORDEN_EVENTO = [
  'NIF',
  'ID',
  'IdSistemaInformatico',
  'Version',
  'NumeroInstalacion',
  'NIFObligadoEmision',
  'TipoEvento',
  'HuellaEvento',
  'FechaHoraHusoGenEvento',
] as const;

/**
 * En el XML el NIF del obligado a emisión se llama `NIF`, igual que el del sistema
 * informático; se distinguen por su ruta. En la cadena de la huella ambos aparecen
 * como `NIF`, así que aquí traducimos nuestro nombre interno al nombre del XML.
 */
const NOMBRE_EN_CADENA: Record<string, string> = {
  NIFObligadoEmision: 'NIF',
};

function componerCadena(orden: readonly string[], valores: Record<string, unknown>): string {
  return orden
    .map((campo) => {
      const bruto = valores[campo];
      // Ausente, null o vacío se representan igual: solo el nombre y el "=".
      const valor = bruto === undefined || bruto === null ? '' : String(bruto).trim();
      return `${NOMBRE_EN_CADENA[campo] ?? campo}=${valor}`;
    })
    .join('&');
}

function sha256Mayusculas(cadena: string): Huella {
  return createHash('sha256').update(cadena, 'utf8').digest('hex').toUpperCase();
}

/**
 * Devuelve la cadena exacta sobre la que se aplica SHA-256 para un registro de alta.
 * Útil para depurar discrepancias con la AEAT: si la huella no cuadra, el problema
 * casi siempre está en esta cadena, no en el algoritmo.
 */
export function cadenaHuellaAlta(campos: CamposHuellaAlta): string {
  return componerCadena(ORDEN_ALTA, campos as unknown as Record<string, unknown>);
}

/** Ídem para un registro de anulación. */
export function cadenaHuellaAnulacion(campos: CamposHuellaAnulacion): string {
  return componerCadena(ORDEN_ANULACION, campos as unknown as Record<string, unknown>);
}

/** Ídem para un registro de evento. */
export function cadenaHuellaEvento(campos: CamposHuellaEvento): string {
  return componerCadena(ORDEN_EVENTO, campos as unknown as Record<string, unknown>);
}

/** Calcula la huella de un registro de alta. */
export function huellaAlta(campos: CamposHuellaAlta): Huella {
  return sha256Mayusculas(cadenaHuellaAlta(campos));
}

/** Calcula la huella de un registro de anulación. */
export function huellaAnulacion(campos: CamposHuellaAnulacion): Huella {
  return sha256Mayusculas(cadenaHuellaAnulacion(campos));
}

/** Calcula la huella de un registro de evento. */
export function huellaEvento(campos: CamposHuellaEvento): Huella {
  return sha256Mayusculas(cadenaHuellaEvento(campos));
}
