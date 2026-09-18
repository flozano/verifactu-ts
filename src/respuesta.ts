/**
 * Respuesta del servicio de remisión de registros de facturación.
 *
 * Implementa `RespuestaSuministro.xsd` y el tratamiento de `SOAPFault` descrito en el
 * apartado 5.1 de "Sistemas Informáticos de Facturación. Remisión voluntaria y
 * remisión bajo requerimiento" (AEAT, v1.0.3, 28/07/2025).
 *
 * Cada código de error que devuelve la AEAT se cruza con el catálogo oficial que ya
 * incorpora el paquete, así que la respuesta llega interpretada y no como un número
 * suelto.
 */

import type { ErrorAeat } from './errores.js';
import { errorAeat } from './errores.js';
import type { NodoXml } from './xml-parser.js';
import { buscar, hijos, parsearXml, textoDeHijo } from './xml-parser.js';

/** Estado global del envío. */
export type EstadoEnvio = 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto';

/** Estado de un registro concreto dentro del envío. */
export type EstadoRegistro = 'Correcto' | 'AceptadoConErrores' | 'Incorrecto';

/** Estado del registro que ya constaba en la AEAT, cuando se rechaza por duplicado. */
export type EstadoRegistroDuplicado = 'Correcta' | 'AceptadaConErrores' | 'Anulada';

/** Datos del registro previamente anotado, cuando el envío se rechaza por duplicado. */
export interface RegistroDuplicado {
  IdPeticionRegistroDuplicado: string;
  EstadoRegistroDuplicado: EstadoRegistroDuplicado;
  CodigoErrorRegistro?: string;
  DescripcionErrorRegistro?: string;
}

/** Resultado de un registro concreto del envío. */
export interface RespuestaLinea {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
  /** `'Alta'` o `'Anulacion'`. */
  Operacion: string;
  RefExterna?: string;
  EstadoRegistro: EstadoRegistro;
  CodigoErrorRegistro?: string;
  DescripcionErrorRegistro?: string;
  RegistroDuplicado?: RegistroDuplicado;
  /**
   * Entrada del catálogo oficial correspondiente a `CodigoErrorRegistro`, si la AEAT
   * devolvió alguno y está catalogado.
   */
  error?: ErrorAeat;
  /** `true` si el registro quedó anotado (correcto o aceptado con errores). */
  anotado: boolean;
}

/** Respuesta completa del servicio a un envío de registros. */
export interface RespuestaEnvio {
  /**
   * Código seguro de verificación de la remisión. Sólo se genera si no hubo rechazo
   * del envío.
   *
   * **Guárdalo en el momento del alta.** La documentación de la AEAT avisa de que no
   * puede recuperarse con consultas posteriores: es la constancia de que la remisión
   * se produjo, y si no se almacena, se pierde.
   */
  CSV?: string;
  NIFPresentador?: string;
  TimestampPresentacion?: string;
  EstadoEnvio: EstadoEnvio;
  /**
   * Segundos que hay que esperar antes del siguiente envío, según el mecanismo de
   * control de flujo del artículo 16.2 de la Orden HAC/1177/2024.
   */
  TiempoEsperaEnvio: number;
  lineas: RespuestaLinea[];
  /** XML recibido, por si hace falta conservarlo como evidencia. */
  xml: string;
  /**
   * XML que se envió, tal cual salió: el sobre SOAP entero.
   *
   * Lo rellena `ClienteAeat.enviar`, que es quien lo tiene; `parsearRespuestaEnvio`
   * por sí sola no puede saberlo, y por eso es opcional. Quien conserve la
   * respuesta como evidencia suele querer también la pregunta.
   */
  xmlEnviado?: string;
}

/**
 * Error devuelto por el servicio como `SOAPFault`.
 *
 * Se produce cuando el mensaje no cumple el esquema o falla la validación de la
 * cabecera: en ese caso se rechaza el envío completo y no hay respuesta de negocio.
 */
export class ErrorSoapAeat extends Error {
  /** `Client` si el mensaje es incorrecto, `Server` si es un problema de la AEAT. */
  readonly faultcode: string;
  readonly faultstring: string;
  /** Código del catálogo, extraído del patrón `Codigo[NNNN]` del `faultstring`. */
  readonly codigo?: string;
  readonly error?: ErrorAeat;
  /**
   * `true` si conviene reintentar el envío tal cual. Según el apartado 5.1, con
   * `faultcode` de tipo `Server` hay que reenviar; con `Client` hay que corregir
   * el mensaje antes de volver a intentarlo.
   */
  readonly reintentable: boolean;
  readonly xml: string;
  /** XML que se envió, cuando quien construye el error lo conoce. */
  readonly xmlEnviado?: string;

  constructor(faultcode: string, faultstring: string, xml: string, xmlEnviado?: string) {
    const codigo = /Codigo\[(\d+)\]/.exec(faultstring)?.[1];
    const catalogado = codigo ? errorAeat(codigo) : undefined;
    super(
      codigo
        ? `La AEAT rechazó el envío con el error ${codigo}: ${catalogado?.mensaje ?? faultstring}`
        : `La AEAT rechazó el envío: ${faultstring}`,
    );
    this.name = 'ErrorSoapAeat';
    this.faultcode = faultcode;
    this.faultstring = faultstring;
    this.codigo = codigo;
    this.error = catalogado;
    this.reintentable = /server/i.test(faultcode);
    this.xml = xml;
    this.xmlEnviado = xmlEnviado;
  }
}

function lineaDesde(nodo: NodoXml): RespuestaLinea {
  const idFactura = nodo.hijos.find((h) => h.local === 'IDFactura');
  const duplicado = nodo.hijos.find((h) => h.local === 'RegistroDuplicado');
  const estado = (textoDeHijo(nodo, 'EstadoRegistro') ?? 'Incorrecto') as EstadoRegistro;
  const codigo = textoDeHijo(nodo, 'CodigoErrorRegistro');

  return {
    IDEmisorFactura: textoDeHijo(idFactura, 'IDEmisorFactura') ?? '',
    NumSerieFactura: textoDeHijo(idFactura, 'NumSerieFactura') ?? '',
    FechaExpedicionFactura: textoDeHijo(idFactura, 'FechaExpedicionFactura') ?? '',
    Operacion: textoDeHijo(nodo, 'Operacion') ?? '',
    RefExterna: textoDeHijo(nodo, 'RefExterna'),
    EstadoRegistro: estado,
    CodigoErrorRegistro: codigo,
    DescripcionErrorRegistro: textoDeHijo(nodo, 'DescripcionErrorRegistro'),
    RegistroDuplicado: duplicado
      ? {
          IdPeticionRegistroDuplicado: textoDeHijo(duplicado, 'IdPeticionRegistroDuplicado') ?? '',
          EstadoRegistroDuplicado: (textoDeHijo(duplicado, 'EstadoRegistroDuplicado') ??
            'Correcta') as EstadoRegistroDuplicado,
          CodigoErrorRegistro: textoDeHijo(duplicado, 'CodigoErrorRegistro'),
          DescripcionErrorRegistro: textoDeHijo(duplicado, 'DescripcionErrorRegistro'),
        }
      : undefined,
    error: codigo ? errorAeat(codigo) : undefined,
    anotado: estado === 'Correcto' || estado === 'AceptadoConErrores',
  };
}

/**
 * Interpreta la respuesta del servicio, venga dentro de un sobre SOAP o suelta.
 *
 * @throws {ErrorSoapAeat} si la respuesta es un `SOAPFault`.
 * @throws {SyntaxError} si el XML está mal formado o no es una respuesta reconocible.
 */
export function parsearRespuestaEnvio(xml: string, xmlEnviado?: string): RespuestaEnvio {
  const raiz = parsearXml(xml);

  const fault = buscar(raiz, 'Fault');
  if (fault) {
    throw new ErrorSoapAeat(
      textoDeHijo(fault, 'faultcode') ?? '',
      textoDeHijo(fault, 'faultstring') ?? '',
      xml,
      xmlEnviado,
    );
  }

  const respuesta = buscar(raiz, 'RespuestaRegFactuSistemaFacturacion');
  if (!respuesta) {
    throw new SyntaxError(
      'La respuesta no contiene el elemento RespuestaRegFactuSistemaFacturacion ni un SOAPFault.',
    );
  }

  const presentacion = respuesta.hijos.find((h) => h.local === 'DatosPresentacion');
  const espera = Number(textoDeHijo(respuesta, 'TiempoEsperaEnvio'));

  return {
    CSV: textoDeHijo(respuesta, 'CSV'),
    NIFPresentador: textoDeHijo(presentacion, 'NIFPresentador'),
    TimestampPresentacion: textoDeHijo(presentacion, 'TimestampPresentacion'),
    EstadoEnvio: (textoDeHijo(respuesta, 'EstadoEnvio') ?? 'Incorrecto') as EstadoEnvio,
    // El valor inicial que fija el artículo 16.2 es de 60 segundos.
    TiempoEsperaEnvio: Number.isFinite(espera) && espera > 0 ? espera : 60,
    lineas: hijos(respuesta, 'RespuestaLinea').map(lineaDesde),
    xml,
    ...(xmlEnviado === undefined ? {} : { xmlEnviado }),
  };
}

/** Registros del envío que la AEAT no llegó a anotar. */
export function lineasRechazadas(respuesta: RespuestaEnvio): RespuestaLinea[] {
  return respuesta.lineas.filter((l) => !l.anotado);
}

/**
 * Registros anotados pero con errores admisibles, que hay que subsanar con un envío
 * posterior (apartado 4.3.1 del documento de validaciones).
 */
export function lineasPorSubsanar(respuesta: RespuestaEnvio): RespuestaLinea[] {
  return respuesta.lineas.filter((l) => l.EstadoRegistro === 'AceptadoConErrores');
}
