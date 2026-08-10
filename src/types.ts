/**
 * Tipos del registro de facturación VeriFactu.
 *
 * Referencia normativa: RD 1007/2023 y Orden HAC/1177/2024. Los nombres de campo
 * replican literalmente los del diseño de registro XML publicado por la AEAT,
 * porque la huella se calcula sobre esos nombres exactos.
 */

/** Fecha en el formato del registro: dd-mm-aaaa (p. ej. "01-01-2024"). */
export type FechaRegistro = string;

/**
 * Marca temporal de generación con huso horario, ISO 8601
 * (p. ej. "2024-01-01T19:20:30+01:00"). El huso es obligatorio.
 */
export type FechaHoraHuso = string;

/** Huella SHA-256 en hexadecimal y mayúsculas (64 caracteres). */
export type Huella = string;

/**
 * Importe tal y como viaja en el XML. Se admite una o dos posiciones decimales:
 * la AEAT considera "123.1" y "123.10" igualmente válidos para la huella.
 */
export type Importe = string;

/** Campos de un registro de ALTA que entran en el cálculo de la huella. */
export interface CamposHuellaAlta {
  /** NIF del emisor. Ruta: RegistroAlta/IDFactura/IDEmisorFactura */
  IDEmisorFactura: string;
  /** Nº de serie y número de factura. Ruta: RegistroAlta/IDFactura/NumSerieFactura */
  NumSerieFactura: string;
  /** Ruta: RegistroAlta/IDFactura/FechaExpedicionFactura */
  FechaExpedicionFactura: FechaRegistro;
  /** Clave del tipo de factura (F1, F2, R1…). Ruta: RegistroAlta/TipoFactura */
  TipoFactura: string;
  /** Ruta: RegistroAlta/CuotaTotal */
  CuotaTotal: Importe;
  /** Ruta: RegistroAlta/ImporteTotal */
  ImporteTotal: Importe;
  /**
   * Huella del registro inmediatamente anterior del mismo SIF.
   * Se omite o se deja vacía en el primer registro.
   * Ruta: RegistroAlta/Encadenamiento/RegistroAnterior/Huella
   */
  Huella?: Huella | '';
  /** Ruta: RegistroAlta/FechaHoraHusoGenRegistro */
  FechaHoraHusoGenRegistro: FechaHoraHuso;
}

/** Campos de un registro de ANULACIÓN que entran en el cálculo de la huella. */
export interface CamposHuellaAnulacion {
  /** Ruta: RegistroAnulacion/IDFactura/IDEmisorFacturaAnulada */
  IDEmisorFacturaAnulada: string;
  /** Ruta: RegistroAnulacion/IDFactura/NumSerieFacturaAnulada */
  NumSerieFacturaAnulada: string;
  /** Ruta: RegistroAnulacion/IDFactura/FechaExpedicionFacturaAnulada */
  FechaExpedicionFacturaAnulada: FechaRegistro;
  /** Huella del registro anterior. Ruta: RegistroAnulacion/Encadenamiento/RegistroAnterior/Huella */
  Huella?: Huella | '';
  /** Ruta: RegistroAnulacion/FechaHoraHusoGenRegistro */
  FechaHoraHusoGenRegistro: FechaHoraHuso;
}

/** Campos de un registro de EVENTO que entran en el cálculo de la huella. */
export interface CamposHuellaEvento {
  /** Ruta: RegistroEvento/Evento/SistemaInformatico/NIF */
  NIF?: string;
  /**
   * Identificador alternativo al NIF (excluyentes entre sí).
   * Ruta: RegistroEvento/Evento/SistemaInformatico/IDOtro/ID
   */
  ID?: string;
  /** Ruta: RegistroEvento/Evento/SistemaInformatico/IdSistemaInformatico */
  IdSistemaInformatico: string;
  /** Ruta: RegistroEvento/Evento/SistemaInformatico/Version */
  Version: string;
  /** Ruta: RegistroEvento/Evento/SistemaInformatico/NumeroInstalacion */
  NumeroInstalacion: string;
  /** NIF del obligado a expedir. Ruta: RegistroEvento/Evento/ObligadoEmision/NIF */
  NIFObligadoEmision: string;
  /** Ruta: RegistroEvento/Evento/TipoEvento */
  TipoEvento: string;
  /** Ruta: RegistroEvento/Evento/Encadenamiento/EventoAnterior/HuellaEvento */
  HuellaEvento?: Huella | '';
  /** Ruta: RegistroEvento/Evento/FechaHoraHusoGenEvento */
  FechaHoraHusoGenEvento: FechaHoraHuso;
}

/** Un eslabón de la cadena, con su huella ya calculada. */
export interface RegistroEncadenado {
  tipo: 'alta' | 'anulacion';
  campos: CamposHuellaAlta | CamposHuellaAnulacion;
  huella: Huella;
}
