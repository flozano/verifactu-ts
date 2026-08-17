/**
 * Validación previa del registro contra las reglas del documento "Validaciones.
 * Sistemas Informáticos de Facturación y Sistemas VERI*FACTU" (AEAT, v1.2.2).
 *
 * Cada test comprueba que una regla concreta se detecta y que se le asigna el código
 * de error con el que la AEAT la devolvería.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validarRegistroAlta, validarRegistroAnulacion } from '../src/validacion.js';
import type { ProblemaRegistro } from '../src/validacion.js';
import { ERRORES_AEAT, errorAeat } from '../src/errores.js';
import type { RegistroAlta, RegistroAnulacion, SistemaInformatico } from '../src/registro.js';

/** Momento fijo para que las validaciones con «la fecha actual» sean deterministas. */
const AHORA = new Date('2025-06-15T12:00:00Z');
const OPCIONES = { fechaReferencia: AHORA };

const SISTEMA: SistemaInformatico = {
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

/** Registro de alta correcto, base de los casos negativos. */
const VALIDO: RegistroAlta = {
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

function codigos(problemas: ProblemaRegistro[]): string[] {
  return problemas.map((p) => p.codigo ?? `(sin código: ${p.apartado})`);
}

/** Valida una variante del registro base y devuelve los códigos detectados. */
function codigosDe(cambios: Partial<RegistroAlta>): string[] {
  return codigos(validarRegistroAlta({ ...VALIDO, ...cambios }, OPCIONES));
}

test('un registro correcto no produce ningún problema', () => {
  assert.deepEqual(validarRegistroAlta(VALIDO, OPCIONES), []);
});

test('todo problema con código lleva el mensaje literal de la AEAT', () => {
  const problemas = validarRegistroAlta({ ...VALIDO, TipoRectificativa: 'S' }, OPCIONES);
  for (const problema of problemas) {
    if (problema.codigo === null) continue;
    assert.equal(problema.mensaje, ERRORES_AEAT[problema.codigo]?.mensaje);
    assert.notEqual(problema.detalle, '');
    assert.notEqual(problema.campo, '');
  }
});

// --- Identificación de la factura -------------------------------------------

test('1130: NumSerieFactura con caracteres prohibidos', () => {
  assert.ok(codigosDe({
    IDFactura: { ...VALIDO.IDFactura, NumSerieFactura: 'FRA<2025>1' },
  }).includes('1130'));
});

test('1112: fecha de expedición posterior a hoy', () => {
  assert.ok(codigosDe({
    IDFactura: { ...VALIDO.IDFactura, FechaExpedicionFactura: '01-12-2025' },
  }).includes('1112'));
});

test('1152: fecha de expedición anterior a la entrada en vigor de la orden', () => {
  assert.ok(codigosDe({
    IDFactura: { ...VALIDO.IDFactura, FechaExpedicionFactura: '01-10-2024' },
  }).includes('1152'));
});

test('1105: fecha de expedición inexistente en el calendario', () => {
  assert.ok(codigosDe({
    IDFactura: { ...VALIDO.IDFactura, FechaExpedicionFactura: '31-02-2025' },
  }).includes('1105'));
});

test('1219: NIF del emisor con dígito de control incorrecto', () => {
  assert.ok(codigosDe({
    IDFactura: { ...VALIDO.IDFactura, IDEmisorFactura: '89890001A' },
  }).includes('1219'));
});

// --- Rectificativas ---------------------------------------------------------

test('1114: rectificativa sin TipoRectificativa', () => {
  assert.ok(codigosDe({ TipoFactura: 'R1' }).includes('1114'));
});

test('1115: TipoRectificativa en una factura que no es rectificativa', () => {
  assert.ok(codigosDe({ TipoRectificativa: 'I' }).includes('1115'));
});

test('1118: rectificativa por sustitución sin ImporteRectificacion', () => {
  assert.ok(codigosDe({ TipoFactura: 'R1', TipoRectificativa: 'S' }).includes('1118'));
});

test('1116: FacturasSustituidas fuera de una factura F3', () => {
  assert.ok(codigosDe({
    FacturasSustituidas: [{ ...VALIDO.IDFactura, NumSerieFactura: 'SIMP-1' }],
  }).includes('1116'));
});

// --- Destinatarios y terceros -----------------------------------------------

test('1189: factura F1 sin destinatarios', () => {
  assert.ok(codigosDe({ Destinatarios: [] }).includes('1189'));
});

test('1190: factura simplificada F2 con destinatarios', () => {
  assert.ok(codigosDe({ TipoFactura: 'F2' }).includes('1190'));
});

test('1193: el destinatario no puede ser el propio emisor', () => {
  assert.ok(codigosDe({
    Destinatarios: [{ NombreRazon: 'EMPRESA EMISORA SL', NIF: '89890001K' }],
  }).includes('1193'));
});

test('1126: IDType 07 (no censado) exige CodigoPais ES', () => {
  assert.ok(codigosDe({
    Destinatarios: [
      { NombreRazon: 'CLIENTE EXTRANJERO', IDOtro: { CodigoPais: 'FR', IDType: '07', ID: 'X1' } },
    ],
  }).includes('1126'));
});

test('1239: identificar al destinatario con NIF e IDOtro a la vez', () => {
  assert.ok(codigosDe({
    Destinatarios: [
      { NombreRazon: 'CLIENTE SA', NIF: 'A78222114', IDOtro: { CodigoPais: 'PT', IDType: '04', ID: 'X1' } },
    ],
  }).includes('1239'));
});

test('1186: emisión por tercero sin bloque Tercero', () => {
  assert.ok(codigosDe({ EmitidaPorTerceroODestinatario: 'T' }).includes('1186'));
});

test('1155: bloque Tercero sin EmitidaPorTerceroODestinatario', () => {
  assert.ok(codigosDe({
    Tercero: { NombreRazon: 'ASESORIA SL', NIF: 'B12345674' },
  }).includes('1155'));
});

// --- Desglose ---------------------------------------------------------------

test('1124: tipo impositivo que no existe en IVA', () => {
  assert.ok(codigosDe({
    Desglose: [{ ...VALIDO.Desglose[0]!, TipoImpositivo: '18', CuotaRepercutida: '18.00' }],
    CuotaTotal: '18.00',
    ImporteTotal: '118.00',
  }).includes('1124'));
});

test('1194: el tipo del 5 % sólo vale dentro de su ventana temporal', () => {
  assert.ok(codigosDe({
    Desglose: [{ ...VALIDO.Desglose[0]!, TipoImpositivo: '5', CuotaRepercutida: '5.00' }],
    CuotaTotal: '5.00',
    ImporteTotal: '105.00',
  }).includes('1194'));
});

test('1162: recargo de equivalencia incompatible con el tipo del 21 %', () => {
  assert.ok(codigosDe({
    Desglose: [{ ...VALIDO.Desglose[0]!, TipoRecargoEquivalencia: '1.4', CuotaRecargoEquivalencia: '1.40' }],
    CuotaTotal: '22.40',
    ImporteTotal: '122.40',
  }).includes('1162'));
});

test('1142: la cuota repercutida no cuadra con base por tipo', () => {
  assert.ok(codigosDe({
    Desglose: [{ ...VALIDO.Desglose[0]!, CuotaRepercutida: '50.00' }],
    CuotaTotal: '50.00',
    ImporteTotal: '150.00',
  }).includes('1142'));
});

test('la cuota se acepta dentro del margen de 10 € de la AEAT', () => {
  const problemas = codigosDe({
    Desglose: [{ ...VALIDO.Desglose[0]!, CuotaRepercutida: '25.00' }],
    CuotaTotal: '25.00',
    ImporteTotal: '125.00',
  });
  assert.equal(problemas.includes('1142'), false);
});

test('1143: base y cuota con signos distintos', () => {
  assert.ok(codigosDe({
    Desglose: [{ ...VALIDO.Desglose[0]!, BaseImponibleOimporteNoSujeto: '-100.00', CuotaRepercutida: '21.00' }],
    CuotaTotal: '21.00',
    ImporteTotal: '-79.00',
  }).includes('1143'));
});

test('1195: detalle sin calificación ni exención', () => {
  assert.ok(codigosDe({
    Desglose: [{ Impuesto: '01', ClaveRegimen: '01', BaseImponibleOimporteNoSujeto: '100.00' }],
    CuotaTotal: '0.00',
    ImporteTotal: '100.00',
  }).includes('1195'));
});

test('1196: calificación y exención son excluyentes', () => {
  assert.ok(codigosDe({
    Desglose: [
      {
        Impuesto: '01',
        ClaveRegimen: '01',
        CalificacionOperacion: 'S1',
        OperacionExenta: 'E1',
        BaseImponibleOimporteNoSujeto: '100.00',
      },
    ],
    CuotaTotal: '0.00',
    ImporteTotal: '100.00',
  }).includes('1196'));
});

test('1238: una operación exenta no puede llevar tipo ni cuota', () => {
  assert.ok(codigosDe({
    Desglose: [
      {
        Impuesto: '01',
        ClaveRegimen: '01',
        OperacionExenta: 'E1',
        TipoImpositivo: '21',
        CuotaRepercutida: '21.00',
        BaseImponibleOimporteNoSujeto: '100.00',
      },
    ],
  }).includes('1238'));
});

test('1237: una operación no sujeta no puede llevar tipo ni cuota', () => {
  assert.ok(codigosDe({
    Desglose: [
      {
        Impuesto: '01',
        ClaveRegimen: '01',
        CalificacionOperacion: 'N1',
        TipoImpositivo: '21',
        CuotaRepercutida: '21.00',
        BaseImponibleOimporteNoSujeto: '100.00',
      },
    ],
  }).includes('1237'));
});

test('1206: el arrendamiento de local de negocio sólo admite el 21 %', () => {
  assert.ok(codigosDe({
    Desglose: [
      {
        Impuesto: '01',
        ClaveRegimen: '11',
        CalificacionOperacion: 'S1',
        TipoImpositivo: '10',
        BaseImponibleOimporteNoSujeto: '100.00',
        CuotaRepercutida: '10.00',
      },
    ],
    CuotaTotal: '10.00',
    ImporteTotal: '110.00',
  }).includes('1206'));
});

test('1202: el grupo de entidades avanzado exige BaseImponibleACoste', () => {
  assert.ok(codigosDe({
    Desglose: [
      {
        Impuesto: '01',
        ClaveRegimen: '06',
        CalificacionOperacion: 'S1',
        TipoImpositivo: '21',
        BaseImponibleOimporteNoSujeto: '100.00',
        CuotaRepercutida: '21.00',
      },
    ],
  }).includes('1202'));
});

test('2009: con IPSI la clave de régimen es obligatoria', () => {
  assert.ok(codigosDe({
    Desglose: [
      {
        Impuesto: '02',
        CalificacionOperacion: 'S1',
        TipoImpositivo: '10',
        BaseImponibleOimporteNoSujeto: '100.00',
        CuotaRepercutida: '10.00',
      },
    ],
    CuotaTotal: '10.00',
    ImporteTotal: '110.00',
  }).includes('2009'));
});

// --- Totales ----------------------------------------------------------------

test('2005 y 2006: los totales que no cuadran son avisos, no rechazos', () => {
  const problemas = validarRegistroAlta(
    { ...VALIDO, CuotaTotal: '999.00', ImporteTotal: '999.00' },
    OPCIONES,
  );
  const totales = problemas.filter((p) => p.codigo === '2005' || p.codigo === '2006');
  assert.equal(totales.length, 2);
  for (const problema of totales) assert.equal(problema.severidad, 'aviso');
});

test('el cuadre de totales no se aplica a las claves de régimen exceptuadas', () => {
  const problemas = codigosDe({
    Desglose: [
      {
        Impuesto: '01',
        ClaveRegimen: '05',
        CalificacionOperacion: 'S1',
        TipoImpositivo: '21',
        BaseImponibleOimporteNoSujeto: '100.00',
        CuotaRepercutida: '21.00',
      },
    ],
    CuotaTotal: '999.00',
    ImporteTotal: '999.00',
  });
  assert.equal(problemas.includes('2005'), false);
  assert.equal(problemas.includes('2006'), false);
});

test('1139: una factura de 100 millones debe marcarse como macrodato', () => {
  assert.ok(codigosDe({
    Desglose: [
      {
        Impuesto: '01',
        ClaveRegimen: '01',
        CalificacionOperacion: 'S1',
        TipoImpositivo: '0',
        BaseImponibleOimporteNoSujeto: '100000000.00',
        CuotaRepercutida: '0',
      },
    ],
    CuotaTotal: '0',
    ImporteTotal: '100000000.00',
  }).includes('1139'));
});

test('1150: una factura simplificada no puede superar los 3.000 €', () => {
  assert.ok(codigosDe({
    TipoFactura: 'F2',
    Destinatarios: [],
    Desglose: [
      {
        Impuesto: '01',
        ClaveRegimen: '01',
        CalificacionOperacion: 'S1',
        TipoImpositivo: '21',
        BaseImponibleOimporteNoSujeto: '5000.00',
        CuotaRepercutida: '1050.00',
      },
    ],
    CuotaTotal: '1050.00',
    ImporteTotal: '6050.00',
  }).includes('1150'));
});

// --- Encadenamiento, huella y sistema informático ---------------------------

test('2002: huella del registro anterior con longitud incorrecta', () => {
  assert.ok(codigosDe({
    Encadenamiento: {
      RegistroAnterior: {
        IDEmisorFactura: '89890001K',
        NumSerieFactura: '12345677/G32',
        FechaExpedicionFactura: '14-01-2025',
        Huella: 'ABC123',
      },
    },
  }).includes('2002'));
});

test('2003: huella del registro anterior en minúsculas', () => {
  assert.ok(codigosDe({
    Encadenamiento: {
      RegistroAnterior: {
        IDEmisorFactura: '89890001K',
        NumSerieFactura: '12345677/G32',
        FechaExpedicionFactura: '14-01-2025',
        Huella: 'f7b94cfd8924edff273501b01ee5153e4ce8f259766f88cf6acb8935802a2b97',
      },
    },
  }).includes('2003'));
});

test('1180: el encadenamiento no puede ser primero y tener anterior a la vez', () => {
  assert.ok(codigosDe({
    Encadenamiento: {
      PrimerRegistro: 'S',
      RegistroAnterior: {
        IDEmisorFactura: '89890001K',
        NumSerieFactura: '12345677/G32',
        FechaExpedicionFactura: '14-01-2025',
        Huella: 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97',
      },
    },
  }).includes('1180'));
});

test('2008: la huella del registro anterior no puede ser la del actual', () => {
  assert.ok(codigosDe({
    Encadenamiento: {
      RegistroAnterior: {
        IDEmisorFactura: '89890001K',
        NumSerieFactura: '12345677/G32',
        FechaExpedicionFactura: '14-01-2025',
        Huella: VALIDO.Huella,
      },
    },
  }).includes('2008'));
});

test('2000: la huella propia debe ser SHA-256 en hexadecimal y mayúsculas', () => {
  assert.ok(codigosDe({ Huella: 'no-es-una-huella' }).includes('2000'));
});

test('1177: IdSistemaInformatico debe tener exactamente dos caracteres válidos', () => {
  assert.ok(codigosDe({
    SistemaInformatico: { ...SISTEMA, IdSistemaInformatico: 'A' },
  }).includes('1177'));
});

test('1223: el sistema informático no puede llevar NIF e IDOtro a la vez', () => {
  assert.ok(codigosDe({
    SistemaInformatico: {
      ...SISTEMA,
      IDOtro: { CodigoPais: 'PT', IDType: '04', ID: 'X1' },
    },
  }).includes('1223'));
});

test('1244: FechaHoraHusoGenRegistro sin huso horario', () => {
  assert.ok(codigosDe({ FechaHoraHusoGenRegistro: '2025-01-15T19:20:30' }).includes('1244'));
});

test('2004: FechaHoraHusoGenRegistro posterior al momento actual', () => {
  assert.ok(codigosDe({ FechaHoraHusoGenRegistro: '2025-12-31T10:00:00+01:00' }).includes('2004'));
});

// --- Anulación --------------------------------------------------------------

const ANULACION: RegistroAnulacion = {
  IDFactura: {
    IDEmisorFactura: '89890001K',
    NumSerieFactura: '12345678/G33',
    FechaExpedicionFactura: '15-01-2025',
  },
  Encadenamiento: { PrimerRegistro: 'S' },
  SistemaInformatico: SISTEMA,
  FechaHoraHusoGenRegistro: '2025-01-16T10:00:00+01:00',
  Huella: '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68',
};

test('una anulación correcta no produce problemas', () => {
  assert.deepEqual(validarRegistroAnulacion(ANULACION, OPCIONES), []);
});

test('1224: GeneradoPor y Generador van siempre juntos', () => {
  const problemas = validarRegistroAnulacion({ ...ANULACION, GeneradoPor: 'T' }, OPCIONES);
  assert.ok(codigos(problemas).includes('1224'));
});

test('1227: si genera el expedidor, el generador debe llevar NIF', () => {
  const problemas = validarRegistroAnulacion(
    {
      ...ANULACION,
      GeneradoPor: 'E',
      Generador: { NombreRazon: 'TERCERO SL', IDOtro: { CodigoPais: 'PT', IDType: '04', ID: 'X1' } },
    },
    OPCIONES,
  );
  assert.ok(codigos(problemas).includes('1227'));
});

// --- Catálogo de errores ----------------------------------------------------

test('el catálogo trae los 247 códigos oficiales, clasificados', () => {
  const entradas = Object.values(ERRORES_AEAT);
  assert.equal(entradas.length, 247);
  assert.equal(entradas.filter((e) => e.categoria === 'envio').length, 44);
  assert.equal(entradas.filter((e) => e.categoria === 'registro').length, 193);
  assert.equal(entradas.filter((e) => e.categoria === 'admisible').length, 10);
});

test('errorAeat acepta el código como número o como cadena', () => {
  assert.equal(errorAeat(4102)?.mensaje, 'El XML no cumple el esquema. Falta informar campo obligatorio.');
  assert.equal(errorAeat('4102')?.codigo, '4102');
  assert.equal(errorAeat('9999'), undefined);
});
