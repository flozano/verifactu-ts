/**
 * Serialización del registro de facturación.
 *
 * Lo que se comprueba aquí es sobre todo el ORDEN de los elementos: el esquema
 * oficial los declara dentro de `sequence`, así que un XML con los mismos datos en
 * otro orden es rechazado con el error 4102. El test que valida el XML generado
 * contra los XSD oficiales de la AEAT vive en `tools/validar-xsd.py`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NS_SUMINISTRO_INFORMACION,
  NS_SUMINISTRO_LR,
  xmlRegFactuSistemaFacturacion,
  xmlRegistroAlta,
  xmlRegistroAnulacion,
} from '../src/xml.js';
import type { Cabecera, RegistroAlta, RegistroAnulacion, SistemaInformatico } from '../src/registro.js';

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

const ALTA: RegistroAlta = {
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

/** Nombres de los elementos hijos directos del registro, en orden de aparición. */
function elementosDeNivel(xml: string, sangriaEsperada: string): string[] {
  const nombres: string[] = [];
  for (const linea of xml.split('\n')) {
    const m = new RegExp(`^${sangriaEsperada}<sf:([A-Za-z0-9]+)>`).exec(linea);
    if (m) nombres.push(m[1]!);
  }
  return nombres;
}

test('el registro de alta serializa sus elementos en el orden del esquema', () => {
  const xml = xmlRegistroAlta(ALTA);

  assert.deepEqual(elementosDeNivel(xml, '  '), [
    'IDVersion',
    'IDFactura',
    'NombreRazonEmisor',
    'TipoFactura',
    'DescripcionOperacion',
    'Destinatarios',
    'Desglose',
    'CuotaTotal',
    'ImporteTotal',
    'Encadenamiento',
    'SistemaInformatico',
    'FechaHoraHusoGenRegistro',
    'TipoHuella',
    'Huella',
  ]);
});

test('el orden de las claves del objeto no afecta al XML generado', () => {
  const desordenado: RegistroAlta = {
    Huella: ALTA.Huella,
    FechaHoraHusoGenRegistro: ALTA.FechaHoraHusoGenRegistro,
    SistemaInformatico: SISTEMA,
    Encadenamiento: ALTA.Encadenamiento,
    ImporteTotal: ALTA.ImporteTotal,
    CuotaTotal: ALTA.CuotaTotal,
    Desglose: ALTA.Desglose,
    Destinatarios: ALTA.Destinatarios,
    DescripcionOperacion: ALTA.DescripcionOperacion,
    TipoFactura: ALTA.TipoFactura,
    NombreRazonEmisor: ALTA.NombreRazonEmisor,
    IDFactura: ALTA.IDFactura,
  };

  assert.equal(xmlRegistroAlta(desordenado), xmlRegistroAlta(ALTA));
});

test('IDVersion y TipoHuella se rellenan solos con los valores vigentes', () => {
  const xml = xmlRegistroAlta(ALTA);
  assert.match(xml, /<sf:IDVersion>1\.0<\/sf:IDVersion>/);
  assert.match(xml, /<sf:TipoHuella>01<\/sf:TipoHuella>/);
});

test('los campos opcionales no informados no aparecen en el XML', () => {
  const xml = xmlRegistroAlta(ALTA);
  for (const ausente of ['RefExterna', 'Subsanacion', 'RechazoPrevio', 'TipoRectificativa', 'Cupon']) {
    assert.doesNotMatch(xml, new RegExp(`<sf:${ausente}>`), `no debería aparecer ${ausente}`);
  }
});

test('el texto se escapa: un & en la descripción no rompe el XML', () => {
  const xml = xmlRegistroAlta({ ...ALTA, DescripcionOperacion: 'Servicios I&D <urgente>' });
  assert.match(xml, /<sf:DescripcionOperacion>Servicios I&amp;D &lt;urgente&gt;<\/sf:DescripcionOperacion>/);
});

test('el desglose respeta el choice entre calificación y exención', () => {
  const exenta = xmlRegistroAlta({
    ...ALTA,
    Desglose: [
      {
        Impuesto: '01',
        ClaveRegimen: '01',
        OperacionExenta: 'E1',
        BaseImponibleOimporteNoSujeto: '100.00',
      },
    ],
  });
  assert.match(exenta, /<sf:OperacionExenta>E1<\/sf:OperacionExenta>/);
  assert.doesNotMatch(exenta, /<sf:CalificacionOperacion>/);
});

test('el encadenamiento con registro anterior serializa sus cuatro campos en orden', () => {
  const xml = xmlRegistroAlta({
    ...ALTA,
    Encadenamiento: {
      RegistroAnterior: {
        IDEmisorFactura: '89890001K',
        NumSerieFactura: '12345677/G32',
        FechaExpedicionFactura: '14-01-2025',
        Huella: 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97',
      },
    },
  });

  assert.match(
    xml.replace(/\s+/g, ''),
    /<sf:RegistroAnterior><sf:IDEmisorFactura>89890001K<\/sf:IDEmisorFactura><sf:NumSerieFactura>12345677\/G32<\/sf:NumSerieFactura><sf:FechaExpedicionFactura>14-01-2025<\/sf:FechaExpedicionFactura><sf:Huella>/,
  );
});

test('el registro de anulación usa los nombres de campo con sufijo Anulada', () => {
  const anulacion: RegistroAnulacion = {
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

  const xml = xmlRegistroAnulacion(anulacion);
  assert.match(xml, /<sf:IDEmisorFacturaAnulada>89890001K<\/sf:IDEmisorFacturaAnulada>/);
  assert.match(xml, /<sf:NumSerieFacturaAnulada>12345678\/G33<\/sf:NumSerieFacturaAnulada>/);
  assert.match(xml, /<sf:FechaExpedicionFacturaAnulada>15-01-2025<\/sf:FechaExpedicionFacturaAnulada>/);
});

test('el mensaje completo declara los dos espacios de nombres y encierra cada registro', () => {
  const cabecera: Cabecera = {
    ObligadoEmision: { NombreRazon: 'EMPRESA EMISORA SL', NIF: '89890001K' },
    RemisionVoluntaria: { Incidencia: 'N' },
  };

  const xml = xmlRegFactuSistemaFacturacion(cabecera, [{ alta: ALTA }, { alta: ALTA }]);

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.ok(xml.includes(`xmlns:sfLR="${NS_SUMINISTRO_LR}"`));
  assert.ok(xml.includes(`xmlns:sf="${NS_SUMINISTRO_INFORMACION}"`));
  assert.equal(xml.match(/<sfLR:RegistroFactura>/g)?.length, 2);

  const posicionCabecera = xml.indexOf('<sfLR:Cabecera>');
  assert.notEqual(posicionCabecera, -1, 'debe existir el elemento Cabecera');
  assert.ok(posicionCabecera < xml.indexOf('<sfLR:RegistroFactura>'));
});

test('Cabecera va en el espacio de nombres sfLR y sus hijos en sf', () => {
  // El esquema declara Cabecera dentro de RegFactuSistemaFacturacion (SuministroLR),
  // así que el elemento es sfLR aunque su tipo esté definido en SuministroInformacion.
  // Con el prefijo equivocado la AEAT rechaza el envío entero con el error 4102.
  const xml = xmlRegFactuSistemaFacturacion(
    { ObligadoEmision: { NombreRazon: 'EMPRESA EMISORA SL', NIF: '89890001K' } },
    [{ alta: ALTA }],
  );

  assert.ok(xml.includes('<sfLR:Cabecera>'));
  assert.equal(xml.includes('<sf:Cabecera>'), false);
  assert.match(xml, /<sfLR:Cabecera>\s*<sf:ObligadoEmision>/);
});

test('sin sangría el XML sale en una sola línea', () => {
  const xml = xmlRegistroAlta(ALTA, { sangria: '' });
  assert.equal(xml.includes('\n'), false);
});
