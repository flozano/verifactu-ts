/**
 * Encadenamiento de registros: construir la cadena y verificar su integridad.
 *
 * El encadenamiento es la fuente más habitual de registros "aceptados con errores":
 * basta con que la huella de un registro no cuadre para que la AEAT lo marque.
 * Verificar la cadena en local antes de enviar evita ese viaje.
 */

import { huellaAlta, huellaAnulacion } from './huella.js';
import type {
  CamposHuellaAlta,
  CamposHuellaAnulacion,
  Huella,
  RegistroEncadenado,
} from './types.js';

/** Campos de alta sin la huella anterior: la pone el encadenador. */
export type AltaSinEncadenar = Omit<CamposHuellaAlta, 'Huella'>;
/** Campos de anulación sin la huella anterior. */
export type AnulacionSinEncadenar = Omit<CamposHuellaAnulacion, 'Huella'>;

/** Entrada del encadenador: un registro pendiente de calcular su huella. */
export type RegistroPendiente =
  | { tipo: 'alta'; campos: AltaSinEncadenar }
  | { tipo: 'anulacion'; campos: AnulacionSinEncadenar };

/**
 * Encadena un registro sobre el anterior y devuelve el registro con su huella.
 *
 * @param registro Registro a encadenar.
 * @param huellaAnterior Huella del registro inmediatamente anterior del mismo SIF.
 *                       Se omite (o se pasa '') si es el primer registro.
 */
export function encadenar(
  registro: RegistroPendiente,
  huellaAnterior: Huella | '' = '',
): RegistroEncadenado {
  if (registro.tipo === 'alta') {
    const campos: CamposHuellaAlta = { ...registro.campos, Huella: huellaAnterior };
    return { tipo: 'alta', campos, huella: huellaAlta(campos) };
  }
  const campos: CamposHuellaAnulacion = { ...registro.campos, Huella: huellaAnterior };
  return { tipo: 'anulacion', campos, huella: huellaAnulacion(campos) };
}

/**
 * Encadena una secuencia completa de registros, empezando opcionalmente desde la
 * huella del último registro ya emitido (para continuar una cadena existente).
 */
export function encadenarSecuencia(
  registros: readonly RegistroPendiente[],
  huellaInicial: Huella | '' = '',
): RegistroEncadenado[] {
  const salida: RegistroEncadenado[] = [];
  let anterior: Huella | '' = huellaInicial;
  for (const registro of registros) {
    const encadenado = encadenar(registro, anterior);
    salida.push(encadenado);
    anterior = encadenado.huella;
  }
  return salida;
}

/** Problema detectado al verificar una cadena. */
export interface ProblemaCadena {
  /** Posición del registro en la secuencia (base 0). */
  indice: number;
  /** `huella` = la huella no corresponde a los campos; `encadenamiento` = no apunta al anterior. */
  tipo: 'huella' | 'encadenamiento';
  esperado: string;
  encontrado: string;
  mensaje: string;
}

/**
 * Verifica una cadena ya construida: recalcula cada huella y comprueba que cada
 * registro apunta al anterior. Devuelve la lista de problemas (vacía si todo cuadra).
 */
export function verificarCadena(
  registros: readonly RegistroEncadenado[],
  huellaInicial: Huella | '' = '',
): ProblemaCadena[] {
  const problemas: ProblemaCadena[] = [];
  let anterior: Huella | '' = huellaInicial;

  registros.forEach((registro, indice) => {
    const enlace = registro.campos.Huella ?? '';
    if (enlace !== anterior) {
      problemas.push({
        indice,
        tipo: 'encadenamiento',
        esperado: anterior === '' ? '(vacío: primer registro)' : anterior,
        encontrado: enlace === '' ? '(vacío)' : enlace,
        mensaje: `El registro ${indice} no enlaza con la huella del anterior.`,
      });
    }

    const recalculada =
      registro.tipo === 'alta'
        ? huellaAlta(registro.campos as CamposHuellaAlta)
        : huellaAnulacion(registro.campos as CamposHuellaAnulacion);

    if (recalculada !== registro.huella) {
      problemas.push({
        indice,
        tipo: 'huella',
        esperado: recalculada,
        encontrado: registro.huella,
        mensaje: `La huella del registro ${indice} no corresponde a sus campos.`,
      });
    }

    anterior = registro.huella;
  });

  return problemas;
}
