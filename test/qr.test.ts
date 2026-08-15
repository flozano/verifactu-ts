/**
 * Tests del codificador QR.
 *
 * El criterio de corrección es la lectura: cada código generado se decodifica con
 * `jsqr` —un decodificador independiente— y debe devolver exactamente el texto de
 * partida. Así se comprueba de extremo a extremo la codificación en modo byte, la
 * corrección Reed-Solomon, el entrelazado de bloques y el enmascarado.
 *
 * `jsqr` es solo dependencia de desarrollo: el paquete publicado no tiene ninguna.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { QRCode } from 'jsqr';

import { matrizQr, svgQr } from '../src/qr.js';
import { svgQrFactura, urlCotejo, type DatosQrFactura } from '../src/cotejo.js';

// jsqr se publica como CommonJS y exporta la función directamente en `module.exports`,
// que no es lo que describe su declaración de tipos: se carga con `require`.
const jsQR = createRequire(import.meta.url)('jsqr') as (
  datos: Uint8ClampedArray,
  ancho: number,
  alto: number,
) => QRCode | null;

/** Pinta la matriz como imagen RGBA en blanco y negro, con su zona de silencio. */
function aImagen(matriz: boolean[][], escala = 3, margen = 4) {
  const n = matriz.length;
  const lado = (n + margen * 2) * escala;
  const datos = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < n; c++) {
      if (!matriz[f]![c]) continue;
      for (let dy = 0; dy < escala; dy++) {
        for (let dx = 0; dx < escala; dx++) {
          const i = (((f + margen) * escala + dy) * lado + (c + margen) * escala + dx) * 4;
          datos[i] = 0;
          datos[i + 1] = 0;
          datos[i + 2] = 0;
        }
      }
    }
  }
  return { datos, lado };
}

function decodificar(texto: string): string | null {
  const { datos, lado } = aImagen(matrizQr(texto));
  return jsQR(datos, lado, lado)?.data ?? null;
}

const factura: DatosQrFactura = {
  nif: '89890001K',
  numserie: '12345678-G33',
  fecha: '01-09-2024',
  importe: '241.4',
};

test('el QR de una factura se lee y devuelve la URL de cotejo', () => {
  const url = urlCotejo(factura, { entorno: 'pruebas' });
  assert.equal(decodificar(url), url);
});

test('el QR de producción también se lee', () => {
  const url = urlCotejo(factura);
  assert.equal(decodificar(url), url);
});

test('el número de serie con caracteres codificados sobrevive al viaje', () => {
  const url = urlCotejo({ ...factura, numserie: 'FC 2026/0042 &%' });
  assert.equal(decodificar(url), url);
});

test('texto largo: versión alta, indicador de longitud de 16 bits y varios bloques', () => {
  // 300 bytes fuerzan una versión ≥ 10 (contador de 16 bits, módulos de información
  // de versión) y varios bloques de corrección entrelazados.
  const largo = 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?x=' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(7);
  assert.ok(largo.length > 280);
  assert.equal(decodificar(largo), largo);
});

test('el modo byte codifica UTF-8 correctamente', () => {
  const texto = 'Facturación española: 1.210,00 € — año 2026 · ñÑ';
  assert.equal(decodificar(texto), texto);
});

test('la matriz es cuadrada y su lado es 4·versión + 17', () => {
  const matriz = matrizQr(urlCotejo(factura));
  assert.ok(matriz.every((fila) => fila.length === matriz.length));
  assert.equal((matriz.length - 17) % 4, 0);
});

test('los tres patrones de posición están en su sitio', () => {
  const m = matrizQr('https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR');
  const n = m.length;
  for (const [f0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
    assert.ok(m[f0]![c0], 'esquina del patrón');
    assert.ok(!m[f0 + 1]![c0 + 1], 'anillo claro del patrón');
    assert.ok(m[f0 + 3]![c0 + 3], 'centro del patrón');
  }
});

test('el SVG lleva el tamaño en milímetros que exige la Orden (30-40 mm)', () => {
  const svg = svgQrFactura(factura);
  const lado = Number(/width="([\d.]+)mm"/.exec(svg)?.[1]);
  const modulos = matrizQr(urlCotejo(factura)).length;
  // El atributo incluye la zona de silencio; el símbolo en sí debe caer en el rango.
  const ladoSimbolo = (lado * modulos) / (modulos + 8);
  assert.ok(ladoSimbolo >= 30 && ladoSimbolo <= 40, `lado del símbolo: ${ladoSimbolo} mm`);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test('el SVG deja la zona de silencio de 4 módulos por defecto', () => {
  const matriz = matrizQr('prueba');
  const svg = svgQr('prueba');
  assert.match(svg, new RegExp(`viewBox="0 0 ${matriz.length + 8} ${matriz.length + 8}"`));
});

test('los colores y el margen son configurables', () => {
  const svg = svgQr('prueba', { margen: 0, colorModulo: '#123456', colorFondo: 'none' });
  const matriz = matrizQr('prueba');
  assert.match(svg, new RegExp(`viewBox="0 0 ${matriz.length} ${matriz.length}"`));
  assert.match(svg, /fill="#123456"/);
  assert.match(svg, /fill="none"/);
});

test('un margen o un tamaño imposibles se rechazan', () => {
  assert.throws(() => svgQr('prueba', { margen: -1 }), /margen inválido/);
  assert.throws(() => svgQr('prueba', { ladoMm: 0 }), /ladoMm inválido/);
});
