/**
 * Genera mensajes de remisión de muestra en `tools/muestras/`, para validarlos
 * contra los XSD oficiales de la AEAT con `tools/validar-xsd.py`.
 *
 * Requiere haber compilado antes (`npm test` deja el build en `dist-test/`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const { xmlRegFactuSistemaFacturacion } = await import(
  pathToFileURL(join(raiz, 'dist-test', 'src', 'xml.js')).href
);

const SISTEMA = {
  NombreRazon: 'PRODUCTORA DE SOFTWARE SL',
  NIF: 'B12345674',
  NombreSistemaInformatico: 'FACTURADOR',
  IdSistemaInformatico: 'A1',
  Version: '1.0',
  NumeroInstalacion: '0001',
  TipoUsoPosibleSoloVerifactu: 'S',
  TipoUsoPosibleMultiOT: 'N',
  IndicadorMultiplesOT: 'N',
};

const CABECERA = {
  ObligadoEmision: { NombreRazon: 'EMPRESA EMISORA SL', NIF: '89890001K' },
  RemisionVoluntaria: { Incidencia: 'N' },
};

const ALTA_MINIMA = {
  IDFactura: {
    IDEmisorFactura: '89890001K',
    NumSerieFactura: '12345678/G33',
    FechaExpedicionFactura: '15-01-2025',
  },
  NombreRazonEmisor: 'EMPRESA EMISORA SL',
  TipoFactura: 'F1',
  DescripcionOperacion: 'Servicios de desarrollo',
  Destinatarios: [{ NombreRazon: 'CLIENTE SA', NIF: 'A78222114' }],
  Desglose: [
    {
      Impuesto: '01',
      ClaveRegimen: '01',
      CalificacionOperacion: 'S1',
      TipoImpositivo: '21',
      BaseImponibleOimporteNoSujeto: '100.00',
      CuotaRepercutida: '21.00',
    },
  ],
  CuotaTotal: '21.00',
  ImporteTotal: '121.00',
  Encadenamiento: { PrimerRegistro: 'S' },
  SistemaInformatico: SISTEMA,
  FechaHoraHusoGenRegistro: '2025-01-15T19:20:30+01:00',
  Huella: '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60',
};

/** Alta que ejercita todos los bloques opcionales del esquema. */
const ALTA_COMPLETA = {
  ...ALTA_MINIMA,
  IDFactura: { ...ALTA_MINIMA.IDFactura, NumSerieFactura: '12345679/G34' },
  RefExterna: 'ERP-2025-0001',
  Subsanacion: 'S',
  RechazoPrevio: 'X',
  TipoFactura: 'R1',
  TipoRectificativa: 'S',
  FacturasRectificadas: [
    {
      IDEmisorFactura: '89890001K',
      NumSerieFactura: '12345678/G33',
      FechaExpedicionFactura: '15-01-2025',
    },
  ],
  ImporteRectificacion: {
    BaseRectificada: '100.00',
    CuotaRectificada: '21.00',
    CuotaRecargoRectificado: '0.00',
  },
  FechaOperacion: '14-01-2025',
  FacturaSimplificadaArt7273: 'N',
  FacturaSinIdentifDestinatarioArt61d: 'N',
  Macrodato: 'N',
  EmitidaPorTerceroODestinatario: 'T',
  Tercero: { NombreRazon: 'ASESORIA FISCAL SL', NIF: 'B12345674' },
  Destinatarios: [
    { NombreRazon: 'CLIENTE SA', NIF: 'A78222114' },
    { NombreRazon: 'CLIENTE PORTUGUES LDA', IDOtro: { CodigoPais: 'PT', IDType: '02', ID: 'PT123456789' } },
  ],
  Cupon: 'S',
  Desglose: [
    {
      Impuesto: '01',
      ClaveRegimen: '01',
      CalificacionOperacion: 'S1',
      TipoImpositivo: '21',
      BaseImponibleOimporteNoSujeto: '100.00',
      CuotaRepercutida: '21.00',
      TipoRecargoEquivalencia: '5.2',
      CuotaRecargoEquivalencia: '5.20',
    },
    {
      Impuesto: '01',
      ClaveRegimen: '01',
      OperacionExenta: 'E1',
      BaseImponibleOimporteNoSujeto: '50.00',
    },
  ],
  CuotaTotal: '26.20',
  ImporteTotal: '176.20',
  Encadenamiento: {
    RegistroAnterior: {
      IDEmisorFactura: '89890001K',
      NumSerieFactura: '12345678/G33',
      FechaExpedicionFactura: '15-01-2025',
      Huella: '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60',
    },
  },
  NumRegistroAcuerdoFacturacion: 'ACU-000001',
  IdAcuerdoSistemaInformatico: 'IDACU-0001',
  Huella: 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97',
};

const ANULACION = {
  IDFactura: {
    IDEmisorFactura: '89890001K',
    NumSerieFactura: '12345678/G33',
    FechaExpedicionFactura: '15-01-2025',
  },
  SinRegistroPrevio: 'N',
  RechazoPrevio: 'N',
  GeneradoPor: 'T',
  Generador: { NombreRazon: 'ASESORIA FISCAL SL', NIF: 'B12345674' },
  Encadenamiento: {
    RegistroAnterior: {
      IDEmisorFactura: '89890001K',
      NumSerieFactura: '12345679/G34',
      FechaExpedicionFactura: '15-01-2025',
      Huella: 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97',
    },
  },
  SistemaInformatico: SISTEMA,
  FechaHoraHusoGenRegistro: '2025-01-16T10:00:00+01:00',
  Huella: '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68',
};

const muestras = {
  'alta-minima.xml': xmlRegFactuSistemaFacturacion(CABECERA, [{ alta: ALTA_MINIMA }]),
  'alta-completa.xml': xmlRegFactuSistemaFacturacion(CABECERA, [{ alta: ALTA_COMPLETA }]),
  'anulacion.xml': xmlRegFactuSistemaFacturacion(CABECERA, [{ anulacion: ANULACION }]),
  'lote-mixto.xml': xmlRegFactuSistemaFacturacion(CABECERA, [
    { alta: ALTA_MINIMA },
    { alta: ALTA_COMPLETA },
    { anulacion: ANULACION },
  ]),
  'requerimiento.xml': xmlRegFactuSistemaFacturacion(
    {
      ObligadoEmision: CABECERA.ObligadoEmision,
      Representante: { NombreRazon: 'ASESORIA FISCAL SL', NIF: 'B12345674' },
      RemisionRequerimiento: { RefRequerimiento: 'REQ-0001', FinRequerimiento: 'S' },
    },
    [{ alta: ALTA_MINIMA }],
  ),
  'sin-sangria.xml': xmlRegFactuSistemaFacturacion(CABECERA, [{ alta: ALTA_MINIMA }], { sangria: '' }),
};

const destino = join(raiz, 'tools', 'muestras');
mkdirSync(destino, { recursive: true });
for (const [nombre, xml] of Object.entries(muestras)) {
  writeFileSync(join(destino, nombre), xml, 'utf8');
  console.log(`${nombre}: ${xml.length} bytes`);
}
