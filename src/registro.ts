/**
 * Tipos del registro de facturación completo, tal y como viaja al servicio de
 * remisión de la AEAT.
 *
 * Los nombres de campo replican literalmente los del esquema oficial
 * `SuministroInformacion.xsd` (versión 1.0 del diseño de registro, 28/10/2024, tras
 * la Orden HAC/1177/2024), porque tanto el XML como la huella se construyen sobre
 * esos nombres exactos.
 *
 * Complementa a `types.ts`, que sólo describe los campos que entran en el cálculo
 * de la huella.
 */

import type { FechaRegistro, FechaHoraHuso, Huella, Importe } from './types.js';

/** Impuesto de aplicación. Lista L1. Si se omite, la AEAT considera `'01'` (IVA). */
export type Impuesto =
  /** Impuesto sobre el Valor Añadido. */
  | '01'
  /** Impuesto sobre la Producción, los Servicios y la Importación de Ceuta y Melilla. */
  | '02'
  /** Impuesto General Indirecto Canario. */
  | '03'
  /** Otros. */
  | '05';

/** Clave del tipo de factura. Lista L2. */
export type TipoFactura =
  /** Factura (art. 6, 7.2 y 7.3 del RD 1619/2012). */
  | 'F1'
  /** Factura simplificada y facturas sin identificación del destinatario art. 6.1.d). */
  | 'F2'
  /** Factura emitida en sustitución de facturas simplificadas facturadas y declaradas. */
  | 'F3'
  /** Rectificativa (error fundado en derecho y art. 80 Uno, Dos y Seis LIVA). */
  | 'R1'
  /** Rectificativa (art. 80.3). */
  | 'R2'
  /** Rectificativa (art. 80.4). */
  | 'R3'
  /** Rectificativa (resto). */
  | 'R4'
  /** Rectificativa en facturas simplificadas. */
  | 'R5';

/** Tipos de factura rectificativa. Lista L2. */
export const TIPOS_FACTURA_RECTIFICATIVA = ['R1', 'R2', 'R3', 'R4', 'R5'] as const;

/** Identifica si la rectificativa es por sustitución o por diferencias. Lista L3. */
export type TipoRectificativa = 'S' | 'I';

/** Calificación de la operación. Lista L9. */
export type CalificacionOperacion =
  /** Sujeta y no exenta, sin inversión del sujeto pasivo. */
  | 'S1'
  /** Sujeta y no exenta, con inversión del sujeto pasivo. */
  | 'S2'
  /** No sujeta por los artículos 7, 14 y otros. */
  | 'N1'
  /** No sujeta por reglas de localización. */
  | 'N2';

/**
 * Causa de exención. Lista L10 para IVA (`E1`-`E6`); con IGIC se admiten además
 * `E7` y `E8`.
 */
export type OperacionExenta = 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7' | 'E8';

/** Clave de régimen. Listas L8A (IVA) y L8B (IGIC). */
export type ClaveRegimen =
  | '01'
  | '02'
  | '03'
  | '04'
  | '05'
  | '06'
  | '07'
  | '08'
  | '09'
  | '10'
  | '11'
  | '14'
  | '15'
  | '17'
  | '18'
  | '19'
  | '20'
  | '21';

/** Claves de régimen admitidas cuando el impuesto es IVA. Lista L8A. */
export const CLAVES_REGIMEN_IVA = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09',
  '10', '11', '14', '15', '17', '18', '19', '20',
] as const;

/**
 * Claves de régimen admitidas cuando el impuesto es IGIC. Lista L8B, más el valor
 * adicional `'20'` (operaciones sujetas al IPSI) y `'21'` (régimen simplificado).
 */
export const CLAVES_REGIMEN_IGIC = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09',
  '10', '11', '14', '15', '17', '18', '19', '20', '21',
] as const;

/** Claves de régimen admitidas cuando el impuesto es IPSI (apartado 15.6). */
export const CLAVES_REGIMEN_IPSI = ['01', '08', '11', '18', '19', '20'] as const;

/** Tipo de identificación en el bloque `IDOtro`. Lista L7. */
export type IDType =
  /** NIF-IVA. */
  | '02'
  /** Pasaporte. */
  | '03'
  /** Documento oficial de identificación del país de residencia. */
  | '04'
  /** Certificado de residencia. */
  | '05'
  /** Otro documento probatorio. */
  | '06'
  /** No censado. */
  | '07';

/** Valor de los campos booleanos del registro. Listas L4, L5 y L14. */
export type SiNo = 'S' | 'N';

/** Quién generó el registro de anulación. Lista L16. */
export type GeneradoPor = 'E' | 'D' | 'T';

/** Identificación de una factura. */
export interface IDFactura {
  /** NIF del obligado a expedir la factura. */
  IDEmisorFactura: string;
  /** Nº de serie + nº de factura. De 1 a 60 caracteres. */
  NumSerieFactura: string;
  /** Fecha de expedición, en formato DD-MM-AAAA. */
  FechaExpedicionFactura: FechaRegistro;
}

/** Identificación alternativa al NIF, para no residentes. */
export interface IDOtro {
  /** Código de país ISO 3166-1 alfa-2. No es exigible si `IDType` es `'02'`. */
  CodigoPais?: string;
  IDType: IDType;
  /** Número de identificación en el país de residencia. */
  ID: string;
}

/** Persona física o jurídica identificada por NIF o por `IDOtro` (excluyentes). */
export interface PersonaFisicaJuridica {
  NombreRazon: string;
  NIF?: string;
  IDOtro?: IDOtro;
}

/** Importes rectificados en una rectificativa por sustitución. */
export interface ImporteRectificacion {
  BaseRectificada: Importe;
  CuotaRectificada: Importe;
  CuotaRecargoRectificado?: Importe;
}

/**
 * Línea del desglose de la operación.
 *
 * `CalificacionOperacion` y `OperacionExenta` son excluyentes entre sí, y es
 * obligatorio informar exactamente una de las dos (el esquema las declara como
 * `choice`).
 */
export interface DetalleDesglose {
  /** Si se omite, la AEAT lo considera `'01'` (IVA). */
  Impuesto?: Impuesto;
  ClaveRegimen?: ClaveRegimen;
  CalificacionOperacion?: CalificacionOperacion;
  OperacionExenta?: OperacionExenta;
  /** Porcentaje, no importe. P. ej. `'21'` para el 21 %. */
  TipoImpositivo?: Importe;
  BaseImponibleOimporteNoSujeto: Importe;
  BaseImponibleACoste?: Importe;
  CuotaRepercutida?: Importe;
  TipoRecargoEquivalencia?: Importe;
  CuotaRecargoEquivalencia?: Importe;
}

/** Datos del sistema informático de facturación que genera el registro. */
export interface SistemaInformatico {
  /** Nombre o razón social de quien produce el sistema informático. */
  NombreRazon: string;
  /** NIF del productor. Excluyente con `IDOtro`; uno de los dos es obligatorio. */
  NIF?: string;
  IDOtro?: IDOtro;
  /** Nombre comercial del sistema. Máximo 30 caracteres. */
  NombreSistemaInformatico: string;
  /**
   * Identificador del sistema. Exactamente 2 caracteres, cada uno letra mayúscula
   * (salvo la Ñ) o dígito.
   */
  IdSistemaInformatico: string;
  /** Versión del sistema. Máximo 50 caracteres. */
  Version: string;
  /** Número de instalación del sistema. Máximo 100 caracteres. */
  NumeroInstalacion: string;
  /** `'S'` si el sistema sólo puede usarse como VERI*FACTU. */
  TipoUsoPosibleSoloVerifactu: SiNo;
  /** `'S'` si el sistema puede ser usado por varios obligados tributarios. */
  TipoUsoPosibleMultiOT: SiNo;
  /** `'S'` si en el momento de generar el registro lo usan varios obligados. */
  IndicadorMultiplesOT: SiNo;
}

/** Datos del registro de facturación inmediatamente anterior de la misma cadena. */
export interface RegistroAnterior {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: FechaRegistro;
  Huella: Huella;
}

/**
 * Encadenamiento del registro: o es el primero de la cadena, o apunta al anterior.
 * Son excluyentes.
 */
export interface Encadenamiento {
  /** `'S'` sólo en el primer registro de facturación del sistema para ese obligado. */
  PrimerRegistro?: 'S';
  RegistroAnterior?: RegistroAnterior;
}

/** Registro de facturación de alta, completo. */
export interface RegistroAlta {
  /** Versión del esquema. Actualmente `'1.0'`. */
  IDVersion?: '1.0';
  IDFactura: IDFactura;
  /** Referencia interna del emisor, opcional. Máximo 60 caracteres. */
  RefExterna?: string;
  /** Nombre o razón social del obligado a expedir la factura. */
  NombreRazonEmisor: string;
  /** `'S'` si el registro subsana otro anterior. */
  Subsanacion?: SiNo;
  /** Sólo con `Subsanacion = 'S'`. */
  RechazoPrevio?: 'N' | 'S' | 'X';
  TipoFactura: TipoFactura;
  /** Obligatorio si `TipoFactura` es rectificativa. */
  TipoRectificativa?: TipoRectificativa;
  /** Sólo en rectificativas. */
  FacturasRectificadas?: IDFactura[];
  /** Sólo si `TipoFactura` es `'F3'`. */
  FacturasSustituidas?: IDFactura[];
  /** Obligatorio si `TipoRectificativa` es `'S'`. */
  ImporteRectificacion?: ImporteRectificacion;
  FechaOperacion?: FechaRegistro;
  /** Descripción de la operación. Máximo 500 caracteres. */
  DescripcionOperacion: string;
  FacturaSimplificadaArt7273?: SiNo;
  FacturaSinIdentifDestinatarioArt61d?: SiNo;
  /** Obligatorio con valor `'S'` si `ImporteTotal` alcanza 100.000.000 en valor absoluto. */
  Macrodato?: SiNo;
  /** `'T'` (tercero) o `'D'` (destinatario). */
  EmitidaPorTerceroODestinatario?: 'D' | 'T';
  /** Sólo si `EmitidaPorTerceroODestinatario` es `'T'`. */
  Tercero?: PersonaFisicaJuridica;
  Destinatarios?: PersonaFisicaJuridica[];
  Cupon?: SiNo;
  /** Líneas del desglose. De 1 a 12 ocurrencias. */
  Desglose: DetalleDesglose[];
  CuotaTotal: Importe;
  ImporteTotal: Importe;
  Encadenamiento: Encadenamiento;
  SistemaInformatico: SistemaInformatico;
  FechaHoraHusoGenRegistro: FechaHoraHuso;
  NumRegistroAcuerdoFacturacion?: string;
  IdAcuerdoSistemaInformatico?: string;
  /** Algoritmo de huella. Actualmente sólo `'01'` (SHA-256). */
  TipoHuella?: '01';
  Huella: Huella;
}

/** Registro de facturación de anulación, completo. */
export interface RegistroAnulacion {
  IDVersion?: '1.0';
  /** Identifica la factura que se anula. */
  IDFactura: IDFactura;
  RefExterna?: string;
  /** `'S'` si se anula una factura que nunca llegó a registrarse. */
  SinRegistroPrevio?: SiNo;
  RechazoPrevio?: SiNo;
  GeneradoPor?: GeneradoPor;
  /** Obligatorio si se informa `GeneradoPor`. */
  Generador?: PersonaFisicaJuridica;
  Encadenamiento: Encadenamiento;
  SistemaInformatico: SistemaInformatico;
  FechaHoraHusoGenRegistro: FechaHoraHuso;
  TipoHuella?: '01';
  Huella: Huella;
}

/** Datos del obligado a expedir las facturas, en la cabecera del mensaje. */
export interface ObligadoEmision {
  NombreRazon: string;
  NIF: string;
}

/** Datos propios de la remisión voluntaria (sistemas que emiten facturas verificables). */
export interface RemisionVoluntaria {
  /**
   * Fecha de fin del periodo en modalidad VERI*FACTU. A partir del 1 de enero de
   * 2027 debe tener el formato 31-12-AAAA.
   */
  FechaFinVeriFactu?: FechaRegistro;
  /** `'S'` si la remisión se produce por una incidencia. */
  Incidencia?: SiNo;
}

/** Datos propios de la remisión bajo requerimiento (sistemas no verificables). */
export interface RemisionRequerimiento {
  /** Referencia del requerimiento de la AEAT. Máximo 18 caracteres. */
  RefRequerimiento: string;
  /** `'S'` si es la última remisión asociada al requerimiento. */
  FinRequerimiento?: SiNo;
}

/**
 * Cabecera del mensaje de remisión.
 *
 * `RemisionVoluntaria` y `RemisionRequerimiento` son excluyentes: la primera
 * corresponde a los sistemas que emiten facturas verificables y la segunda a los que
 * responden a un requerimiento de la AEAT.
 */
export interface Cabecera {
  ObligadoEmision: ObligadoEmision;
  /** Asesor o representante del obligado, si lo hay. */
  Representante?: ObligadoEmision;
  RemisionVoluntaria?: RemisionVoluntaria;
  RemisionRequerimiento?: RemisionRequerimiento;
}
