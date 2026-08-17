/**
 * Cliente de envío de registros de facturación a la AEAT.
 *
 * Implementa "Sistemas Informáticos de Facturación. Remisión voluntaria y remisión
 * bajo requerimiento de la AEAT" (AEAT, v1.0.3, 28/07/2025) y el WSDL
 * `SistemaFacturacion.wsdl`: servicio web SOAP 1.1 en modo documento/literal sobre
 * HTTPS, con autenticación por certificado electrónico y codificación UTF-8.
 *
 * Incluye el **mecanismo de control de flujo** que el artículo 16.2 de la Orden
 * HAC/1177/2024 hace obligatorio para los sistemas VERI*FACTU: entre dos envíos hay
 * que esperar los segundos que indique la última respuesta —60 por defecto—, salvo
 * que antes se acumule el máximo de registros por envío.
 */

import { request as peticionHttps } from 'node:https';

import type { Cabecera } from './registro.js';
import type { RespuestaEnvio } from './respuesta.js';
import { parsearRespuestaEnvio } from './respuesta.js';
import type { OpcionesXml, RegistroFactura } from './xml.js';
import { xmlRegFactuSistemaFacturacion } from './xml.js';

/** Espacio de nombres del sobre SOAP 1.1. */
export const NS_SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';

/** Número máximo de registros de facturación por envío (esquema `SuministroLR.xsd`). */
export const MAX_REGISTROS_POR_ENVIO = 1000;

/** Espera inicial entre envíos, en segundos (artículo 16.2 de la Orden). */
export const ESPERA_INICIAL_SEGUNDOS = 60;

/** Entorno de la AEAT. */
export type EntornoEnvio = 'produccion' | 'pruebas';

/**
 * Modalidad de remisión.
 *
 * - `verifactu`: remisión voluntaria de sistemas que emiten facturas verificables.
 * - `requerimiento`: remisión de sistemas no verificables, en respuesta a un
 *   requerimiento de la AEAT.
 */
export type ModalidadEnvio = 'verifactu' | 'requerimiento';

/**
 * Puntos de entrada publicados en `SistemaFacturacion.wsdl`.
 *
 * Los de sello son los que hay que usar cuando se accede con un certificado de sello
 * electrónico en vez de con uno de representante.
 */
export const ENDPOINTS: Readonly<Record<ModalidadEnvio, Readonly<Record<EntornoEnvio, { normal: string; sello: string }>>>> =
  Object.freeze({
    verifactu: Object.freeze({
      produccion: {
        normal: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
        sello: 'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
      },
      pruebas: {
        normal: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
        sello: 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
      },
    }),
    requerimiento: Object.freeze({
      produccion: {
        normal: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/RequerimientoSOAP',
        sello: 'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/RequerimientoSOAP',
      },
      pruebas: {
        normal: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/RequerimientoSOAP',
        sello: 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/RequerimientoSOAP',
      },
    }),
  });

/** Certificado electrónico con el que se autentica el envío. */
export interface CertificadoCliente {
  /** Contenido del fichero PKCS#12 (.p12 / .pfx). */
  pfx?: Buffer;
  /** Certificado en PEM, si no se usa PKCS#12. */
  cert?: string | Buffer;
  /** Clave privada en PEM, si no se usa PKCS#12. */
  key?: string | Buffer;
  /** Contraseña del PKCS#12 o de la clave privada. */
  passphrase?: string;
  /** Autoridades de certificación adicionales para verificar al servidor. */
  ca?: string | Buffer | Array<string | Buffer>;
}

/** Petición HTTP que sale hacia la AEAT. */
export interface PeticionTransporte {
  url: string;
  cuerpo: string;
  cabeceras: Record<string, string>;
}

/** Respuesta HTTP en bruto. */
export interface RespuestaTransporte {
  estado: number;
  cuerpo: string;
}

/**
 * Función que realiza el envío por HTTP.
 *
 * Se puede sustituir para enrutar por un proxy corporativo, registrar las peticiones
 * o hacer pruebas sin tocar la red.
 */
export type Transporte = (peticion: PeticionTransporte) => Promise<RespuestaTransporte>;

export interface OpcionesCliente {
  /** Por defecto `'pruebas'`, para no enviar a producción por descuido. */
  entorno?: EntornoEnvio;
  /** Por defecto `'verifactu'`. */
  modalidad?: ModalidadEnvio;
  /** `true` si el certificado es de sello electrónico. Por defecto, `false`. */
  sello?: boolean;
  /** Punto de entrada explícito, que prevalece sobre entorno, modalidad y sello. */
  url?: string;
  certificado?: CertificadoCliente;
  /** Milisegundos antes de abandonar la petición. Por defecto, 60.000. */
  timeoutMs?: number;
  /** Transporte alternativo. Por defecto, HTTPS con el certificado indicado. */
  transporte?: Transporte;
  /**
   * `false` para no esperar entre envíos. El mecanismo es obligatorio para los
   * sistemas VERI*FACTU, así que desactivarlo sólo tiene sentido si el control de
   * flujo lo lleva tu propio planificador. Por defecto, `true`.
   */
  controlDeFlujo?: boolean;
  /** Opciones de serialización del XML. */
  xml?: OpcionesXml;
}

/** Error de transporte o de protocolo, antes de llegar a una respuesta de negocio. */
export class ErrorEnvioAeat extends Error {
  readonly estado?: number;
  readonly cuerpo?: string;

  constructor(mensaje: string, estado?: number, cuerpo?: string) {
    super(mensaje);
    this.name = 'ErrorEnvioAeat';
    this.estado = estado;
    this.cuerpo = cuerpo;
  }
}

/** Devuelve el punto de entrada que corresponde a las opciones dadas. */
export function endpointAeat(opciones: OpcionesCliente = {}): string {
  if (opciones.url) return opciones.url;
  const modalidad = ENDPOINTS[opciones.modalidad ?? 'verifactu'];
  const entorno = modalidad[opciones.entorno ?? 'pruebas'];
  return opciones.sello ? entorno.sello : entorno.normal;
}

/** Envuelve el XML de la remisión en un sobre SOAP 1.1. */
export function sobreSoap(cuerpoXml: string): string {
  // Se descarta la declaración XML del cuerpo: la lleva el sobre.
  const cuerpo = cuerpoXml.replace(/^<\?xml[^?]*\?>\s*/, '');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<soapenv:Envelope xmlns:soapenv="${NS_SOAP}">\n` +
    '  <soapenv:Header/>\n' +
    '  <soapenv:Body>\n' +
    cuerpo.replace(/^/gm, '    ').trimEnd() +
    '\n  </soapenv:Body>\n' +
    '</soapenv:Envelope>\n'
  );
}

/** Transporte por defecto: HTTPS con el certificado del obligado o su representante. */
function transporteHttps(certificado: CertificadoCliente | undefined, timeoutMs: number): Transporte {
  return (peticion) =>
    new Promise<RespuestaTransporte>((resolver, rechazar) => {
      const destino = new URL(peticion.url);
      const cuerpo = Buffer.from(peticion.cuerpo, 'utf8');

      const solicitud = peticionHttps(
        {
          protocol: destino.protocol,
          hostname: destino.hostname,
          port: destino.port || 443,
          path: `${destino.pathname}${destino.search}`,
          method: 'POST',
          headers: { ...peticion.cabeceras, 'Content-Length': String(cuerpo.byteLength) },
          pfx: certificado?.pfx,
          cert: certificado?.cert,
          key: certificado?.key,
          passphrase: certificado?.passphrase,
          ca: certificado?.ca,
        },
        (respuesta) => {
          const trozos: Buffer[] = [];
          respuesta.on('data', (trozo: Buffer) => trozos.push(trozo));
          respuesta.on('end', () =>
            resolver({
              estado: respuesta.statusCode ?? 0,
              cuerpo: Buffer.concat(trozos).toString('utf8'),
            }),
          );
        },
      );

      solicitud.setTimeout(timeoutMs, () => {
        solicitud.destroy(new ErrorEnvioAeat(`La AEAT no respondió en ${timeoutMs} ms.`));
      });
      solicitud.on('error', (error) => rechazar(error));
      solicitud.end(cuerpo);
    });
}

/**
 * Cliente del servicio de remisión.
 *
 * Mantiene el estado del control de flujo entre envíos, así que conviene reutilizar
 * la misma instancia en lugar de crear una por envío.
 *
 * @example
 * const cliente = new ClienteAeat({
 *   entorno: 'pruebas',
 *   certificado: { pfx: readFileSync('certificado.p12'), passphrase: '…' },
 * });
 *
 * const respuesta = await cliente.enviar(cabecera, [{ alta: registro }]);
 * respuesta.EstadoEnvio;  // 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto'
 */
export class ClienteAeat {
  readonly url: string;
  private readonly transporte: Transporte;
  private readonly controlDeFlujo: boolean;
  private readonly opcionesXml: OpcionesXml;

  /** Segundos de espera exigidos por la última respuesta de la AEAT. */
  private esperaSegundos = ESPERA_INICIAL_SEGUNDOS;
  /** Momento del último envío, en milisegundos. */
  private ultimoEnvio: number | null = null;

  constructor(opciones: OpcionesCliente = {}) {
    this.url = endpointAeat(opciones);
    this.controlDeFlujo = opciones.controlDeFlujo ?? true;
    this.opcionesXml = opciones.xml ?? {};
    this.transporte =
      opciones.transporte ?? transporteHttps(opciones.certificado, opciones.timeoutMs ?? 60_000);
  }

  /**
   * Milisegundos que faltan para poder hacer el siguiente envío. Cero si ya se puede
   * enviar.
   */
  esperaPendienteMs(ahora: number = Date.now()): number {
    if (this.ultimoEnvio === null) return 0;
    const transcurrido = ahora - this.ultimoEnvio;
    return Math.max(0, this.esperaSegundos * 1000 - transcurrido);
  }

  /** Segundos de espera entre envíos que fijó la última respuesta. */
  get tiempoEsperaSegundos(): number {
    return this.esperaSegundos;
  }

  /**
   * Envía un lote de registros y devuelve la respuesta ya interpretada.
   *
   * Si el control de flujo está activo, espera lo que haga falta antes de enviar.
   *
   * @throws {RangeError} si el lote excede el máximo de registros o viene vacío.
   * @throws {ErrorSoapAeat} si la AEAT responde con un `SOAPFault`.
   * @throws {ErrorEnvioAeat} ante un error de transporte o un código HTTP inesperado.
   */
  async enviar(cabecera: Cabecera, registros: RegistroFactura[]): Promise<RespuestaEnvio> {
    if (registros.length === 0) {
      throw new RangeError('El envío debe llevar al menos un registro de facturación.');
    }
    if (registros.length > MAX_REGISTROS_POR_ENVIO) {
      throw new RangeError(
        `El envío admite como máximo ${MAX_REGISTROS_POR_ENVIO} registros y se han pasado ${registros.length}. ` +
          'Divide el lote antes de enviarlo.',
      );
    }

    if (this.controlDeFlujo) {
      const pendiente = this.esperaPendienteMs();
      if (pendiente > 0) await new Promise((listo) => setTimeout(listo, pendiente));
    }

    const cuerpo = sobreSoap(xmlRegFactuSistemaFacturacion(cabecera, registros, this.opcionesXml));

    let respuesta: RespuestaTransporte;
    try {
      respuesta = await this.transporte({
        url: this.url,
        cuerpo,
        cabeceras: {
          'Content-Type': 'text/xml; charset=UTF-8',
          // El WSDL declara soapAction vacío, pero SOAP 1.1 exige la cabecera.
          SOAPAction: '""',
        },
      });
    } finally {
      // El reloj del control de flujo cuenta desde el envío, haya ido bien o mal.
      this.ultimoEnvio = Date.now();
    }

    // Un 500 con SOAPFault es una respuesta válida del protocolo: se deja pasar para
    // que `parsearRespuestaEnvio` lo convierta en ErrorSoapAeat con su código.
    const esFault = respuesta.cuerpo.includes('Fault');
    if (respuesta.estado !== 200 && !esFault) {
      throw new ErrorEnvioAeat(
        `La AEAT respondió con el código HTTP ${respuesta.estado}.`,
        respuesta.estado,
        respuesta.cuerpo,
      );
    }

    const interpretada = parsearRespuestaEnvio(respuesta.cuerpo);
    this.esperaSegundos = interpretada.TiempoEsperaEnvio;
    return interpretada;
  }

  /**
   * Envía una lista de cualquier tamaño, troceándola en lotes del máximo admitido y
   * respetando el control de flujo entre uno y otro.
   *
   * Devuelve la respuesta de cada lote, en orden. Si un lote falla, la excepción se
   * propaga: los lotes anteriores ya están anotados en la AEAT.
   */
  async enviarPorLotes(
    cabecera: Cabecera,
    registros: RegistroFactura[],
    tamanoLote: number = MAX_REGISTROS_POR_ENVIO,
  ): Promise<RespuestaEnvio[]> {
    if (tamanoLote < 1 || tamanoLote > MAX_REGISTROS_POR_ENVIO) {
      throw new RangeError(`El tamaño de lote debe estar entre 1 y ${MAX_REGISTROS_POR_ENVIO}.`);
    }

    const respuestas: RespuestaEnvio[] = [];
    for (let i = 0; i < registros.length; i += tamanoLote) {
      respuestas.push(await this.enviar(cabecera, registros.slice(i, i + tamanoLote)));
    }
    return respuestas;
  }
}
