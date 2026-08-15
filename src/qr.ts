/**
 * Generador de códigos QR para el «QR tributario» de la factura.
 *
 * La Orden HAC/1177/2024 (artículo 21.1) exige que el QR siga la norma
 * ISO/IEC 18004:2015 con nivel de corrección de errores M. Esta es una
 * implementación propia, sin dependencias, del subconjunto necesario:
 * codificación en modo byte, versiones 1-40, nivel M fijo.
 *
 * No pretende ser un generador QR de propósito general: si necesitas otros
 * niveles de corrección u otros modos de codificación, usa una librería
 * dedicada.
 */

// ---------------------------------------------------------------------------
// Aritmética en GF(256) con el polinomio 0x11D, para Reed-Solomon.
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/**
 * Polinomio generador de Reed-Solomon para `grado` símbolos de corrección:
 * el producto (x - α⁰)(x - α¹)…(x - α^(grado-1)).
 *
 * Los coeficientes van en orden descendente de grado, así que `poli[0]` es
 * siempre el coeficiente principal (1) y `poli[grado]` el término independiente.
 */
function generadorRs(grado: number): Uint8Array {
  let poli = new Uint8Array([1]);
  for (let i = 0; i < grado; i++) {
    const nuevo = new Uint8Array(poli.length + 1);
    for (let j = 0; j < nuevo.length; j++) {
      // Multiplicar por (x + α^i): desplazar un grado y sumar el término en α^i.
      const porX = j < poli.length ? poli[j]! : 0;
      const porAlfa = j > 0 ? gfMul(poli[j - 1]!, GF_EXP[i]!) : 0;
      nuevo[j] = porX ^ porAlfa;
    }
    poli = nuevo;
  }
  return poli;
}

/** Resto de dividir `datos·x^grado` entre el generador: los símbolos de corrección. */
function restoRs(datos: Uint8Array, generador: Uint8Array): Uint8Array {
  const grado = generador.length - 1;
  const resto = new Uint8Array(grado);
  for (const byte of datos) {
    const factor = byte ^ resto[0]!;
    resto.copyWithin(0, 1);
    resto[grado - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < grado; i++) {
        resto[i] = resto[i]! ^ gfMul(generador[i + 1]!, factor);
      }
    }
  }
  return resto;
}

// ---------------------------------------------------------------------------
// Tablas del nivel M (ISO/IEC 18004, tabla 9) y geometría de cada versión.
// ---------------------------------------------------------------------------

/** Símbolos de corrección por bloque, nivel M, versiones 1-40. */
// prettier-ignore
const ECC_POR_BLOQUE_M = [
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
  26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
] as const;

/** Número de bloques de corrección, nivel M, versiones 1-40. */
// prettier-ignore
const NUM_BLOQUES_M = [
  1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
  17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
] as const;

/** Bits disponibles para palabras de código en la matriz de una versión. */
function bitsBrutos(version: number): number {
  let bits = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlineamiento = Math.floor(version / 7) + 2;
    bits -= (25 * numAlineamiento - 10) * numAlineamiento - 55;
    if (version >= 7) bits -= 36;
  }
  return bits;
}

/** Palabras de código disponibles para DATOS (descontada la corrección de errores). */
function palabrasDatos(version: number): number {
  return (
    Math.floor(bitsBrutos(version) / 8) -
    ECC_POR_BLOQUE_M[version - 1]! * NUM_BLOQUES_M[version - 1]!
  );
}

function elegirVersion(numBytes: number): number {
  for (let version = 1; version <= 40; version++) {
    const bitsNecesarios = 4 + (version <= 9 ? 8 : 16) + 8 * numBytes;
    if (bitsNecesarios <= palabrasDatos(version) * 8) return version;
  }
  throw new RangeError(
    `El texto no cabe en un QR de nivel M: ocupa ${numBytes} bytes y el máximo es 2331`,
  );
}

/** Centros de los patrones de alineamiento de una versión. */
function centrosAlineamiento(version: number, n: number): number[] {
  if (version === 1) return [];
  const cuantos = Math.floor(version / 7) + 2;
  const paso =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (cuantos * 2 - 2)) * 2;
  const centros = [6];
  for (let pos = n - 7; centros.length < cuantos; pos -= paso) {
    centros.splice(1, 0, pos);
  }
  return centros;
}

// ---------------------------------------------------------------------------
// Palabras de código: modo byte + terminador + relleno + Reed-Solomon entrelazado.
// ---------------------------------------------------------------------------

function construirPalabras(datos: Uint8Array, version: number): Uint8Array {
  const bits: number[] = [];
  const mete = (valor: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };

  mete(0b0100, 4); // modo byte
  mete(datos.length, version <= 9 ? 8 : 16);
  for (const byte of datos) mete(byte, 8);

  const capacidad = palabrasDatos(version) * 8;
  mete(0, Math.min(4, capacidad - bits.length)); // terminador
  mete(0, (8 - (bits.length % 8)) % 8); // relleno hasta el byte

  const palabras: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    palabras.push(byte);
  }
  // Bytes de relleno alternos que fija la norma.
  for (let alterno = true; palabras.length < capacidad / 8; alterno = !alterno) {
    palabras.push(alterno ? 0xec : 0x11);
  }
  return entrelazar(new Uint8Array(palabras), version);
}

function entrelazar(datos: Uint8Array, version: number): Uint8Array {
  const numBloques = NUM_BLOQUES_M[version - 1]!;
  const eccPorBloque = ECC_POR_BLOQUE_M[version - 1]!;
  const totalPalabras = Math.floor(bitsBrutos(version) / 8);
  const bloquesCortos = numBloques - (totalPalabras % numBloques);
  const datosBloqueCorto = Math.floor(totalPalabras / numBloques) - eccPorBloque;

  const generador = generadorRs(eccPorBloque);
  const bloques: { datos: Uint8Array; ecc: Uint8Array }[] = [];
  let k = 0;
  for (let i = 0; i < numBloques; i++) {
    const largo = datosBloqueCorto + (i < bloquesCortos ? 0 : 1);
    const trozo = datos.subarray(k, k + largo);
    k += largo;
    bloques.push({ datos: trozo, ecc: restoRs(trozo, generador) });
  }

  const salida: number[] = [];
  for (let i = 0; i <= datosBloqueCorto; i++) {
    for (const bloque of bloques) {
      if (i < bloque.datos.length) salida.push(bloque.datos[i]!);
    }
  }
  for (let i = 0; i < eccPorBloque; i++) {
    for (const bloque of bloques) salida.push(bloque.ecc[i]!);
  }
  return new Uint8Array(salida);
}

// ---------------------------------------------------------------------------
// Información de formato y de versión (códigos BCH).
// ---------------------------------------------------------------------------

const G15 = 0b10100110111;
const G15_MASCARA = 0b101010000010010;
const G18 = 0b1111100100101;

function bitAlto(x: number): number {
  let digitos = 0;
  while (x !== 0) {
    digitos++;
    x >>>= 1;
  }
  return digitos;
}

function bitsFormato(mascara: number): number {
  // Los dos bits altos son el nivel de corrección; M es 00 (ISO 18004, tabla 12).
  const dato = mascara;
  let resto = dato << 10;
  while (bitAlto(resto) - bitAlto(G15) >= 0) {
    resto ^= G15 << (bitAlto(resto) - bitAlto(G15));
  }
  return ((dato << 10) | resto) ^ G15_MASCARA;
}

function bitsVersion(version: number): number {
  let resto = version << 12;
  while (bitAlto(resto) - bitAlto(G18) >= 0) {
    resto ^= G18 << (bitAlto(resto) - bitAlto(G18));
  }
  return (version << 12) | resto;
}

// ---------------------------------------------------------------------------
// Construcción de la matriz.
// ---------------------------------------------------------------------------

type Celdas = (boolean | null)[][];

function patronPosicion(m: Celdas, fila: number, col: number, n: number): void {
  for (let r = -1; r <= 7; r++) {
    if (fila + r < 0 || fila + r >= n) continue;
    for (let c = -1; c <= 7; c++) {
      if (col + c < 0 || col + c >= n) continue;
      m[fila + r]![col + c] =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
    }
  }
}

function infoFormato(m: Celdas, mascara: number, n: number): void {
  const bits = bitsFormato(mascara);
  for (let i = 0; i < 15; i++) {
    const bit = ((bits >> i) & 1) === 1;
    // Copia junto al patrón superior-izquierdo (columna 8 / fila 8).
    if (i < 6) m[i]![8] = bit;
    else if (i < 8) m[i + 1]![8] = bit;
    else m[n - 15 + i]![8] = bit;
    // Segunda copia repartida entre el patrón superior-derecho y el inferior-izquierdo.
    if (i < 8) m[8]![n - i - 1] = bit;
    else if (i < 9) m[8]![15 - i] = bit;
    else m[8]![14 - i] = bit;
  }
  m[n - 8]![8] = true; // módulo oscuro fijo
}

function infoVersion(m: Celdas, version: number, n: number): void {
  const bits = bitsVersion(version);
  for (let i = 0; i < 18; i++) {
    const bit = ((bits >> i) & 1) === 1;
    m[Math.floor(i / 3)]![(i % 3) + n - 11] = bit;
    m[(i % 3) + n - 11]![Math.floor(i / 3)] = bit;
  }
}

function aplicaMascara(patron: number, f: number, c: number): boolean {
  switch (patron) {
    case 0: return (f + c) % 2 === 0;
    case 1: return f % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (f + c) % 3 === 0;
    case 4: return (Math.floor(f / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((f * c) % 2) + ((f * c) % 3) === 0;
    case 6: return (((f * c) % 2) + ((f * c) % 3)) % 2 === 0;
    default: return (((f + c) % 2) + ((f * c) % 3)) % 2 === 0;
  }
}

/** Recorrido en zigzag de las celdas libres, escribiendo los bits enmascarados. */
function colocarDatos(m: Celdas, palabras: Uint8Array, mascara: number, n: number): void {
  let incremento = -1;
  let fila = n - 1;
  let indiceBit = 7;
  let indiceByte = 0;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--; // la columna de temporización se salta entera
    for (;;) {
      for (const c of [col, col - 1]) {
        if (m[fila]![c] !== null) continue;
        let oscuro = false;
        if (indiceByte < palabras.length) {
          oscuro = ((palabras[indiceByte]! >>> indiceBit) & 1) === 1;
        }
        if (aplicaMascara(mascara, fila, c)) oscuro = !oscuro;
        m[fila]![c] = oscuro;
        indiceBit--;
        if (indiceBit === -1) {
          indiceByte++;
          indiceBit = 7;
        }
      }
      fila += incremento;
      if (fila < 0 || fila >= n) {
        fila -= incremento;
        incremento = -incremento;
        break;
      }
    }
  }
}

function dibujar(version: number, palabras: Uint8Array, mascara: number): boolean[][] {
  const n = version * 4 + 17;
  const m: Celdas = Array.from({ length: n }, () => Array<boolean | null>(n).fill(null));

  patronPosicion(m, 0, 0, n);
  patronPosicion(m, n - 7, 0, n);
  patronPosicion(m, 0, n - 7, n);

  // El alineamiento va antes que la temporización: sus patrones pisan la línea.
  const centros = centrosAlineamiento(version, n);
  for (const fila of centros) {
    for (const col of centros) {
      if (m[fila]![col] !== null) continue; // solapa con un patrón de posición
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          m[fila + r]![col + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        }
      }
    }
  }

  for (let i = 8; i < n - 8; i++) {
    if (m[i]![6] === null) m[i]![6] = i % 2 === 0;
    if (m[6]![i] === null) m[6]![i] = i % 2 === 0;
  }

  infoFormato(m, mascara, n);
  if (version >= 7) infoVersion(m, version, n);

  colocarDatos(m, palabras, mascara, n);
  return m as boolean[][];
}

/** Penalización de una matriz según las cuatro reglas de la norma (apartado 7.8.3). */
function penalizacion(m: boolean[][]): number {
  const n = m.length;
  let total = 0;

  // Regla 1: rachas de 5 o más módulos seguidos del mismo color.
  for (let f = 0; f < n; f++) {
    let rachaFila = 1;
    let rachaColumna = 1;
    for (let i = 1; i < n; i++) {
      if (m[f]![i] === m[f]![i - 1]) {
        rachaFila++;
        if (rachaFila === 5) total += 3;
        else if (rachaFila > 5) total += 1;
      } else rachaFila = 1;
      if (m[i]![f] === m[i - 1]![f]) {
        rachaColumna++;
        if (rachaColumna === 5) total += 3;
        else if (rachaColumna > 5) total += 1;
      } else rachaColumna = 1;
    }
  }

  // Regla 2: bloques 2x2 de un mismo color.
  for (let f = 0; f < n - 1; f++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[f]![c];
      if (v === m[f]![c + 1] && v === m[f + 1]![c] && v === m[f + 1]![c + 1]) total += 3;
    }
  }

  // Regla 3: secuencias 1:1:3:1:1 con 4 módulos claros a un lado (falso patrón de posición).
  const patron1 = [false, false, false, false, true, false, true, true, true, false, true];
  const patron2 = [true, false, true, true, true, false, true, false, false, false, false];
  for (let f = 0; f < n; f++) {
    for (let c = 0; c + 11 <= n; c++) {
      let fila1 = true, fila2 = true, columna1 = true, columna2 = true;
      for (let i = 0; i < 11; i++) {
        if (m[f]![c + i] !== patron1[i]) fila1 = false;
        if (m[f]![c + i] !== patron2[i]) fila2 = false;
        if (m[c + i]![f] !== patron1[i]) columna1 = false;
        if (m[c + i]![f] !== patron2[i]) columna2 = false;
      }
      if (fila1 || fila2) total += 40;
      if (columna1 || columna2) total += 40;
    }
  }

  // Regla 4: desviación de la proporción de módulos oscuros respecto al 50%.
  let oscuros = 0;
  for (const fila of m) for (const v of fila) if (v) oscuros++;
  total += 10 * Math.floor(Math.abs((oscuros * 100) / (n * n) - 50) / 5);

  return total;
}

// ---------------------------------------------------------------------------
// API pública.
// ---------------------------------------------------------------------------

/**
 * Codifica `texto` como matriz QR de nivel M (el que exige la Orden HAC/1177/2024).
 * Devuelve la matriz de módulos sin zona de silencio: `true` es módulo oscuro.
 * La versión (tamaño) se elige automáticamente: la menor en la que quepa el texto.
 */
export function matrizQr(texto: string): boolean[][] {
  const datos = new TextEncoder().encode(texto);
  const version = elegirVersion(datos.length);
  const palabras = construirPalabras(datos, version);

  let mejor: boolean[][] | null = null;
  let mejorPenalizacion = Infinity;
  for (let mascara = 0; mascara < 8; mascara++) {
    const candidata = dibujar(version, palabras, mascara);
    const puntos = penalizacion(candidata);
    if (puntos < mejorPenalizacion) {
      mejorPenalizacion = puntos;
      mejor = candidata;
    }
  }
  return mejor!;
}

export interface OpcionesSvgQr {
  /**
   * Zona de silencio alrededor del código, en módulos. Por defecto 4 (el mínimo
   * de la norma ISO). Impresa, la especificación de la AEAT pide al menos 2 mm
   * de blanco alrededor y recomienda 6 mm.
   */
  margen?: number;
  /**
   * Lado del símbolo QR (sin contar la zona de silencio) en milímetros, usado
   * para los atributos width/height del SVG. Por defecto 35: la Orden exige
   * entre 30x30 y 40x40 mm impreso.
   */
  ladoMm?: number;
  /** Color de los módulos oscuros. Por defecto `#000`. */
  colorModulo?: string;
  /** Color del fondo (incluida la zona de silencio). Por defecto `#fff`. */
  colorFondo?: string;
}

/** Genera el SVG de un QR ya codificado con {@link matrizQr}. */
export function svgDesdeMatrizQr(
  matriz: ReadonlyArray<ReadonlyArray<boolean>>,
  opciones: OpcionesSvgQr = {},
): string {
  const n = matriz.length;
  const margen = opciones.margen ?? 4;
  const ladoMm = opciones.ladoMm ?? 35;
  if (!Number.isInteger(margen) || margen < 0) {
    throw new RangeError(`margen inválido: ${margen} (entero no negativo, en módulos)`);
  }
  if (!(ladoMm > 0)) {
    throw new RangeError(`ladoMm inválido: ${ladoMm} (debe ser positivo)`);
  }
  const colorModulo = opciones.colorModulo ?? '#000';
  const colorFondo = opciones.colorFondo ?? '#fff';

  const total = n + 2 * margen;
  const ladoTotalMm = ((ladoMm * total) / n).toFixed(2);
  let trazos = '';
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < n; c++) {
      if (matriz[f]![c]) trazos += `M${c + margen} ${f + margen}h1v1h-1z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `width="${ladoTotalMm}mm" height="${ladoTotalMm}mm" shape-rendering="crispEdges" ` +
    `role="img" aria-label="QR tributario">` +
    `<rect width="${total}" height="${total}" fill="${colorFondo}"/>` +
    `<path d="${trazos}" fill="${colorModulo}"/>` +
    `</svg>`
  );
}

/** Codifica `texto` y devuelve directamente el SVG del QR (nivel M). */
export function svgQr(texto: string, opciones: OpcionesSvgQr = {}): string {
  return svgDesdeMatrizQr(matrizQr(texto), opciones);
}
