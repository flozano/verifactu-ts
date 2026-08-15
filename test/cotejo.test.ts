/**
 * Vectores de test oficiales de la «URL» del servicio de cotejo.
 *
 * Las «URL» esperadas están copiadas literalmente del apartado 8 ("Ejemplos de «URL»
 * de código «QR» válidas") de "Detalle de las especificaciones técnicas del código
 * «QR» de la factura y de la «URL» del servicio de cotejo o remisión de información
 * por parte del receptor de la factura", AEAT v0.5.0 (10/12/2025). Los códigos de
 * error comprobados son los del apartado 10.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  urlCotejo,
  urlCotejoJson,
  validarDatosQr,
  type DatosQrFactura,
} from '../src/cotejo.js';

/** Factura de los ejemplos del apartado 8. */
const factura: DatosQrFactura = {
  nif: '89890001K',
  numserie: '12345678-G33',
  fecha: '01-09-2024',
  importe: '241.4',
};

const COLA = 'nif=89890001K&numserie=12345678-G33&fecha=01-09-2024&importe=241.4';

test('apartado 8.1: entorno de pruebas, sistema que emite facturas verificables', () => {
  assert.equal(
    urlCotejo(factura, { entorno: 'pruebas' }),
    `https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?${COLA}`,
  );
});

test('apartado 8.2: entorno de pruebas, sistema que emite facturas no verificables', () => {
  assert.equal(
    urlCotejo(factura, { entorno: 'pruebas', verificable: false }),
    `https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQRNoVerifactu?${COLA}`,
  );
});

test('apartado 8.3: producción, sistema que emite facturas verificables', () => {
  assert.equal(
    urlCotejo(factura),
    `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?${COLA}`,
  );
});

test('apartado 8.4: producción, sistema que emite facturas no verificables', () => {
  assert.equal(
    urlCotejo(factura, { verificable: false }),
    `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQRNoVerifactu?${COLA}`,
  );
});

test('apartado 4: el «&» del número de serie se codifica como %26', () => {
  // Ejemplo literal de la especificación: numserie "12345678&G33" sin codificar
  // rompe la URL, porque el «&» separa parámetros.
  assert.equal(
    urlCotejo(
      { ...factura, numserie: '12345678&G33', fecha: '01-01-2024' },
      { entorno: 'pruebas' },
    ),
    'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR' +
      '?nif=89890001K&numserie=12345678%26G33&fecha=01-01-2024&importe=241.4',
  );
});

test('los espacios del número de serie se codifican como %20, no se dejan crudos', () => {
  const url = urlCotejo({ ...factura, numserie: 'FC 2026/0042' });
  assert.match(url, /numserie=FC%202026%2F0042&/);
  assert.doesNotMatch(url, / /);
});

test('apartado 7.1: el idioma es opcional y viaja como un parámetro más', () => {
  assert.equal(urlCotejo(factura, { idioma: 'eu' }), `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?${COLA}&idioma=eu`);
});

test('apartado 7.2: formato=json solo aparece en la URL de cotejo automatizado', () => {
  assert.equal(urlCotejoJson(factura), `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?${COLA}&formato=json`);
  // La URL del QR nunca puede llevarlo.
  assert.doesNotMatch(urlCotejo(factura), /formato/);
});

test('un importe numérico se formatea con dos decimales', () => {
  assert.match(urlCotejo({ ...factura, importe: 1210 }), /importe=1210\.00$/);
});

test('los datos válidos no producen ningún problema', () => {
  assert.deepEqual(validarDatosQr(factura), []);
});

test('apartado 10: faltan parámetros (1001-1004)', () => {
  const problemas = validarDatosQr({ nif: '', numserie: '', fecha: '', importe: '' });
  assert.deepEqual(
    problemas.map((p) => p.codigo),
    ['1001', '1002', '1003', '1004'],
  );
});

test('apartado 10: NIF con formato erróneo o no válido (2001)', () => {
  // El ejemplo de NIF incorrecto del apartado 9.3.3 de la especificación.
  assert.equal(validarDatosQr({ ...factura, nif: '891K' })[0]?.codigo, '2001');
  // Longitud correcta pero letra de control equivocada.
  assert.equal(validarDatosQr({ ...factura, nif: '89890001X' })[0]?.codigo, '2001');
});

test('se admiten NIF de persona física, NIE y NIF de entidad', () => {
  for (const nif of ['89890001K', '12345678Z', 'X1234567L', 'B12345674', 'P1234567D']) {
    assert.deepEqual(validarDatosQr({ ...factura, nif }), [], `debería ser válido: ${nif}`);
  }
});

test('apartado 10: número de serie demasiado largo (2002) o con caracteres no permitidos (2003)', () => {
  assert.equal(validarDatosQr({ ...factura, numserie: 'A'.repeat(61) })[0]?.codigo, '2002');
  assert.deepEqual(validarDatosQr({ ...factura, numserie: 'A'.repeat(60) }), []);
  // Fuera del rango ASCII 32-126 que exige el apartado 6.
  assert.equal(validarDatosQr({ ...factura, numserie: 'FC-2026/AÑO' })[0]?.codigo, '2003');
});

test('apartado 10: fecha de expedición inválida (2004)', () => {
  for (const fecha of ['2024-09-01', '1-9-2024', '01/09/2024', '31-02-2024']) {
    assert.equal(validarDatosQr({ ...factura, fecha })[0]?.codigo, '2004', fecha);
  }
  // El 29 de febrero solo existe en año bisiesto.
  assert.deepEqual(validarDatosQr({ ...factura, fecha: '29-02-2024' }), []);
  assert.equal(validarDatosQr({ ...factura, fecha: '29-02-2025' })[0]?.codigo, '2004');
});

test('apartado 10: importe con formato incorrecto (2005) o demasiado largo (2006)', () => {
  // El ejemplo del apartado 9.3.2: separador decimal con coma.
  assert.equal(validarDatosQr({ ...factura, importe: '7,2' })[0]?.codigo, '2005');
  assert.equal(validarDatosQr({ ...factura, importe: '241.456' })[0]?.codigo, '2005');
  assert.equal(validarDatosQr({ ...factura, importe: '1'.repeat(13) })[0]?.codigo, '2006');
  // Un abono puede ser negativo; una factura rectificativa lo necesita.
  assert.deepEqual(validarDatosQr({ ...factura, importe: '-241.40' }), []);
});

test('urlCotejo se niega a construir una URL con datos inválidos', () => {
  assert.throws(
    () => urlCotejo({ ...factura, importe: '7,2' }),
    /\[2005\].*formato incorrecto/s,
  );
});
