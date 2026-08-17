/**
 * Lector de XML mínimo, suficiente para las respuestas del servicio de la AEAT.
 *
 * No pretende ser un parser general: no resuelve DTD ni entidades externas, y por eso
 * mismo no arrastra sus riesgos. Cubre lo que aparece en `RespuestaSuministro.xsd` y
 * en los `SOAPFault` del servicio: elementos anidados, atributos, texto, comentarios,
 * secciones CDATA, instrucciones de proceso y las cinco entidades predefinidas de XML
 * más las referencias numéricas.
 *
 * Es interno al paquete; lo que se exporta es `parsearRespuestaEnvio`.
 */

/** Nodo del árbol resultante. */
export interface NodoXml {
  /** Nombre con prefijo, tal cual aparece en el documento (p. ej. `sfR:EstadoEnvio`). */
  nombre: string;
  /** Nombre sin prefijo de espacio de nombres. */
  local: string;
  atributos: Record<string, string>;
  hijos: NodoXml[];
  /** Texto directo del elemento, ya con las entidades resueltas y recortado. */
  texto: string;
}

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Resuelve las entidades predefinidas y las referencias numéricas. */
export function resolverEntidades(texto: string): string {
  return texto.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (completo, referencia: string) => {
    if (referencia.startsWith('#x') || referencia.startsWith('#X')) {
      const codigo = Number.parseInt(referencia.slice(2), 16);
      return Number.isNaN(codigo) ? completo : String.fromCodePoint(codigo);
    }
    if (referencia.startsWith('#')) {
      const codigo = Number.parseInt(referencia.slice(1), 10);
      return Number.isNaN(codigo) ? completo : String.fromCodePoint(codigo);
    }
    return ENTIDADES[referencia] ?? completo;
  });
}

function parsearAtributos(fuente: string): Record<string, string> {
  const atributos: Record<string, string> = {};
  const patron = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = patron.exec(fuente)) !== null) {
    atributos[m[1]!] = resolverEntidades(m[3] ?? m[4] ?? '');
  }
  return atributos;
}

/**
 * Convierte un documento XML en un árbol de nodos.
 *
 * Lanza `SyntaxError` si el documento está mal formado (etiquetas sin cerrar o
 * cruzadas) o si no tiene un único elemento raíz.
 */
export function parsearXml(xml: string): NodoXml {
  const raices: NodoXml[] = [];
  const pila: NodoXml[] = [];
  let posicion = 0;

  const anexarTexto = (crudo: string): void => {
    const actual = pila[pila.length - 1];
    if (!actual) return;
    actual.texto += resolverEntidades(crudo);
  };

  while (posicion < xml.length) {
    const inicio = xml.indexOf('<', posicion);
    if (inicio === -1) {
      anexarTexto(xml.slice(posicion));
      break;
    }
    if (inicio > posicion) anexarTexto(xml.slice(posicion, inicio));

    // Comentarios, CDATA, declaraciones e instrucciones de proceso.
    if (xml.startsWith('<!--', inicio)) {
      const fin = xml.indexOf('-->', inicio);
      if (fin === -1) throw new SyntaxError('Comentario sin cerrar en el XML.');
      posicion = fin + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', inicio)) {
      const fin = xml.indexOf(']]>', inicio);
      if (fin === -1) throw new SyntaxError('Sección CDATA sin cerrar en el XML.');
      const actual = pila[pila.length - 1];
      if (actual) actual.texto += xml.slice(inicio + 9, fin);
      posicion = fin + 3;
      continue;
    }
    if (xml.startsWith('<?', inicio) || xml.startsWith('<!', inicio)) {
      const fin = xml.indexOf('>', inicio);
      if (fin === -1) throw new SyntaxError('Declaración sin cerrar en el XML.');
      posicion = fin + 1;
      continue;
    }

    const fin = xml.indexOf('>', inicio);
    if (fin === -1) throw new SyntaxError('Etiqueta sin cerrar en el XML.');
    const contenido = xml.slice(inicio + 1, fin);
    posicion = fin + 1;

    // Etiqueta de cierre.
    if (contenido.startsWith('/')) {
      const nombre = contenido.slice(1).trim();
      const actual = pila.pop();
      if (!actual) throw new SyntaxError(`Cierre inesperado de </${nombre}>.`);
      if (actual.nombre !== nombre) {
        throw new SyntaxError(`Se esperaba </${actual.nombre}> y se encontró </${nombre}>.`);
      }
      actual.texto = actual.texto.trim();
      continue;
    }

    const vacio = contenido.endsWith('/');
    const cuerpo = vacio ? contenido.slice(0, -1) : contenido;
    const separador = cuerpo.search(/[\s]/);
    const nombre = (separador === -1 ? cuerpo : cuerpo.slice(0, separador)).trim();
    if (nombre === '') throw new SyntaxError('Etiqueta sin nombre en el XML.');

    const nodo: NodoXml = {
      nombre,
      local: nombre.includes(':') ? nombre.slice(nombre.indexOf(':') + 1) : nombre,
      atributos: separador === -1 ? {} : parsearAtributos(cuerpo.slice(separador)),
      hijos: [],
      texto: '',
    };

    const padre = pila[pila.length - 1];
    if (padre) padre.hijos.push(nodo);
    else raices.push(nodo);

    if (!vacio) pila.push(nodo);
  }

  if (pila.length > 0) {
    throw new SyntaxError(`El elemento <${pila[pila.length - 1]!.nombre}> no se ha cerrado.`);
  }
  if (raices.length !== 1) {
    throw new SyntaxError(
      raices.length === 0
        ? 'El documento XML no tiene elemento raíz.'
        : 'El documento XML tiene más de un elemento raíz.',
    );
  }

  return raices[0]!;
}

/** Primer descendiente cuyo nombre local coincide, en recorrido en profundidad. */
export function buscar(nodo: NodoXml, local: string): NodoXml | undefined {
  if (nodo.local === local) return nodo;
  for (const hijo of nodo.hijos) {
    const encontrado = buscar(hijo, local);
    if (encontrado) return encontrado;
  }
  return undefined;
}

/** Hijos directos cuyo nombre local coincide. */
export function hijos(nodo: NodoXml | undefined, local: string): NodoXml[] {
  return nodo ? nodo.hijos.filter((h) => h.local === local) : [];
}

/** Texto del primer descendiente con ese nombre local, o `undefined`. */
export function textoDe(nodo: NodoXml | undefined, local: string): string | undefined {
  if (!nodo) return undefined;
  const encontrado = buscar(nodo, local);
  return encontrado && encontrado.texto !== '' ? encontrado.texto : undefined;
}

/** Texto del primer hijo directo con ese nombre local, o `undefined`. */
export function textoDeHijo(nodo: NodoXml | undefined, local: string): string | undefined {
  const encontrado = nodo?.hijos.find((h) => h.local === local);
  return encontrado && encontrado.texto !== '' ? encontrado.texto : undefined;
}
