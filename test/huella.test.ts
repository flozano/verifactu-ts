/**
 * Vectores de test oficiales.
 *
 * Los tres casos y sus huellas están copiados literalmente del apartado 6
 * ("Ejemplos") de "Detalle de las especificaciones técnicas para generación de la
 * huella o hash de los registros de facturación", AEAT v0.1.2 (27/08/2024).
 * Si alguno de estos tests falla, el SDK no cumple la especificación.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cadenaHuellaAlta, cadenaHuellaAnulacion, huellaAlta, huellaAnulacion } from '../src/huella.js';
import { encadenarSecuencia, verificarCadena } from '../src/cadena.js';
import type { CamposHuellaAlta, CamposHuellaAnulacion } from '../src/types.js';

const HUELLA_CASO_1 = '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60';
const HUELLA_CASO_2 = 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97';
const HUELLA_CASO_3 = '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68';

const caso1: CamposHuellaAlta = {
  IDEmisorFactura: '89890001K',
  NumSerieFactura: '12345678/G33',
  FechaExpedicionFactura: '01-01-2024',
  TipoFactura: 'F1',
  CuotaTotal: '12.35',
  ImporteTotal: '123.45',
  // Sin huella anterior: es el primer registro del SIF.
  FechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00',
};

const caso2: CamposHuellaAlta = {
  IDEmisorFactura: '89890001K',
  NumSerieFactura: '12345679/G34',
  FechaExpedicionFactura: '01-01-2024',
  TipoFactura: 'F1',
  CuotaTotal: '12.35',
  ImporteTotal: '123.45',
  Huella: HUELLA_CASO_1,
  FechaHoraHusoGenRegistro: '2024-01-01T19:20:35+01:00',
};

const caso3: CamposHuellaAnulacion = {
  IDEmisorFacturaAnulada: '89890001K',
  NumSerieFacturaAnulada: '12345679/G34',
  FechaExpedicionFacturaAnulada: '01-01-2024',
  Huella: HUELLA_CASO_2,
  FechaHoraHusoGenRegistro: '2024-01-01T19:20:40+01:00',
};

test('caso 1 AEAT: primer registro de alta (sin huella anterior)', () => {
  assert.equal(
    cadenaHuellaAlta(caso1),
    'IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024' +
      '&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=' +
      '&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00',
  );
  assert.equal(huellaAlta(caso1), HUELLA_CASO_1);
});

test('caso 2 AEAT: registro de alta encadenado al anterior', () => {
  assert.equal(huellaAlta(caso2), HUELLA_CASO_2);
});

test('caso 3 AEAT: registro de anulación encadenado', () => {
  assert.equal(
    cadenaHuellaAnulacion(caso3),
    'IDEmisorFacturaAnulada=89890001K&NumSerieFacturaAnulada=12345679/G34' +
      '&FechaExpedicionFacturaAnulada=01-01-2024&Huella=' + HUELLA_CASO_2 +
      '&FechaHoraHusoGenRegistro=2024-01-01T19:20:40+01:00',
  );
  assert.equal(huellaAnulacion(caso3), HUELLA_CASO_3);
});

test('los espacios al inicio y al final del valor se eliminan', () => {
  // El propio ejemplo de la especificación: "    12345678 / G33  " -> "12345678 / G33".
  const conEspacios: CamposHuellaAlta = { ...caso1, NumSerieFactura: '   12345678/G33  ' };
  assert.equal(huellaAlta(conEspacios), HUELLA_CASO_1);
});

test('un campo ausente y uno vacío producen la misma cadena', () => {
  const vacio: CamposHuellaAlta = { ...caso1, Huella: '' };
  assert.equal(cadenaHuellaAlta(vacio), cadenaHuellaAlta(caso1));
});

test('encadenarSecuencia reproduce la cadena completa de los tres casos', () => {
  const { Huella: _h1, ...alta1 } = caso1;
  const { Huella: _h2, ...alta2 } = caso2;
  const { Huella: _h3, ...anulacion } = caso3;

  const cadena = encadenarSecuencia([
    { tipo: 'alta', campos: alta1 },
    { tipo: 'alta', campos: alta2 },
    { tipo: 'anulacion', campos: anulacion },
  ]);

  assert.deepEqual(
    cadena.map((r) => r.huella),
    [HUELLA_CASO_1, HUELLA_CASO_2, HUELLA_CASO_3],
  );
  assert.deepEqual(verificarCadena(cadena), []);
});

test('verificarCadena detecta una huella manipulada', () => {
  const { Huella: _h, ...alta1 } = caso1;
  const cadena = encadenarSecuencia([{ tipo: 'alta', campos: alta1 }]);
  cadena[0]!.huella = '0'.repeat(64);

  const problemas = verificarCadena(cadena);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0]!.tipo, 'huella');
  assert.equal(problemas[0]!.esperado, HUELLA_CASO_1);
});

test('verificarCadena detecta un eslabón roto', () => {
  const { Huella: _h1, ...alta1 } = caso1;
  const { Huella: _h2, ...alta2 } = caso2;
  const cadena = encadenarSecuencia([
    { tipo: 'alta', campos: alta1 },
    { tipo: 'alta', campos: alta2 },
  ]);

  // Se rompe el enlace y se recalcula la huella para que solo falle el encadenamiento.
  (cadena[1]!.campos as CamposHuellaAlta).Huella = '1'.repeat(64);
  cadena[1]!.huella = huellaAlta(cadena[1]!.campos as CamposHuellaAlta);

  const problemas = verificarCadena(cadena);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0]!.tipo, 'encadenamiento');
  assert.equal(problemas[0]!.indice, 1);
});
