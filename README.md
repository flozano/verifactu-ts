# verifactu-ts

Huella (hash), encadenamiento y **código QR** de facturas **VeriFactu** para TypeScript
y Node. Sin dependencias. Verificado contra los vectores de ejemplo oficiales de la AEAT.

> **Estado: v0.2** — cubre las dos piezas que más errores provocan: el cálculo de la
> huella con su encadenamiento y el «QR tributario» que debe llevar impreso cada
> factura. La generación del XML completo y el envío a la AEAT están en la hoja de
> ruta (ver más abajo).

## Por qué existe

El ecosistema VeriFactu tiene librería madura en .NET y algo en PHP, pero el hueco en
TypeScript/Node estaba vacío. Y la huella es justo donde se concentran los fallos: si
no cuadra con el cálculo de la AEAT, el registro se marca como **"Aceptado con errores"**
(apartado 7 de la especificación oficial).

La especificación tiene detalles fáciles de pasar por alto — campos vacíos que aun así
deben aparecer en la cadena, recorte de espacios, decimales no significativos, el orden
exacto de los campos — y cada uno de ellos rompe la huella en silencio.

## Instalación

```bash
npm install verifactu-ts
```

## Uso

### Calcular la huella de un registro de alta

```ts
import { huellaAlta } from 'verifactu-ts';

const huella = huellaAlta({
  IDEmisorFactura: '89890001K',
  NumSerieFactura: '12345678/G33',
  FechaExpedicionFactura: '01-01-2024',
  TipoFactura: 'F1',
  CuotaTotal: '12.35',
  ImporteTotal: '123.45',
  // Sin `Huella`: es el primer registro del sistema.
  FechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00',
});
// '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60'
```

### Encadenar una secuencia

```ts
import { encadenarSecuencia } from 'verifactu-ts';

const cadena = encadenarSecuencia([
  { tipo: 'alta', campos: { /* … */ } },
  { tipo: 'alta', campos: { /* … */ } },
  { tipo: 'anulacion', campos: { /* … */ } },
]);

cadena.map((r) => r.huella);
```

Para continuar una cadena ya existente, pasa la huella del último registro emitido
como segundo argumento.

### Verificar antes de enviar

```ts
import { verificarCadena } from 'verifactu-ts';

const problemas = verificarCadena(cadena);
// [] si todo cuadra; si no, cada problema indica índice, tipo
// ('huella' | 'encadenamiento'), valor esperado y encontrado.
```

### Generar el «QR tributario» de la factura

```ts
import { svgQrFactura } from 'verifactu-ts';

const svg = svgQrFactura({
  nif: '89890001K',          // NIF del obligado a expedir
  numserie: '12345678-G33',  // serie + número
  fecha: '01-09-2024',       // DD-MM-AAAA
  importe: '241.4',          // el mismo ImporteTotal del registro
});
```

Devuelve un SVG autónomo, dimensionado a 35 mm de lado (el rango obligatorio es de
30x30 a 40x40 mm) y codificado con nivel M de corrección de errores, como exige el
artículo 21.1 de la Orden HAC/1177/2024.

Por defecto apunta al entorno de **producción** y al servicio de sistemas
**verificables**. Para el resto de casos:

```ts
svgQrFactura(factura, { entorno: 'pruebas' });      // portal de pruebas externas
svgQrFactura(factura, { verificable: false });      // sistema NO VERI*FACTU
svgQrFactura(factura, { ladoMm: 40, margen: 6 });   // tamaño y zona de silencio
```

Si prefieres pintar el QR con tu propio motor, `urlCotejo(factura)` te da solo la URL
y `matrizQr(texto)` la matriz de módulos (`boolean[][]`, `true` = módulo oscuro).

Junto al código, la factura debe llevar los textos que exige el artículo 20, que se
exportan como constantes para no tener que teclearlos:

```ts
import { TEXTO_ENCIMA_QR, TEXTO_DEBAJO_QR_VERIFACTU } from 'verifactu-ts';
// 'QR tributario:'  /  'Factura verificable en la sede electrónica de la AEAT'
```

### Detectar los errores del QR antes de imprimir la factura

Una URL mal formada da un QR que la AEAT rechaza al escanearlo — y para entonces la
factura ya está emitida. `validarDatosQr` aplica las mismas reglas que el servicio de
cotejo y devuelve los **códigos de error oficiales**:

```ts
import { validarDatosQr } from 'verifactu-ts';

validarDatosQr({ ...factura, importe: '7,2' });
// [{ campo: 'importe', codigo: '2005', mensaje: 'El importe tiene un formato incorrecto…' }]
```

Cubre los códigos 1001-1004 (parámetros ausentes) y 2001-2006 (NIF inválido —con su
dígito de control—, número de serie demasiado largo o con caracteres no permitidos,
fecha inexistente, importe mal formado o excesivo). `urlCotejo` y `svgQrFactura` lanzan
`TypeError` si algo no cuadra, en vez de generar un QR inútil.

### Cotejar una factura recibida (respuesta en JSON)

```ts
import { urlCotejoJson } from 'verifactu-ts';

const respuesta = await fetch(urlCotejoJson(facturaRecibida)).then((r) => r.json());
// { status: 'OK', mensaje: 'Encontrada', respuesta: { resultado: '00', … } }
```

El parámetro `formato=json` **nunca** debe ir en el QR impreso; por eso vive en una
función aparte.

### Depurar una huella que no cuadra

Cuando la AEAT rechaza un registro, el problema casi nunca está en el SHA-256: está en
la cadena de entrada. Puedes inspeccionarla:

```ts
import { cadenaHuellaAlta } from 'verifactu-ts';

console.log(cadenaHuellaAlta(campos));
// IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&…&Huella=&FechaHoraHusoGenRegistro=…
```

## API

| Función | Qué hace |
|---|---|
| `huellaAlta(campos)` | Huella SHA-256 de un registro de alta |
| `huellaAnulacion(campos)` | Huella de un registro de anulación |
| `huellaEvento(campos)` | Huella de un registro de evento |
| `cadenaHuella*(campos)` | La cadena exacta sobre la que se aplica SHA-256 (depuración) |
| `encadenar(registro, huellaAnterior?)` | Calcula la huella enlazando con el registro anterior |
| `encadenarSecuencia(registros, huellaInicial?)` | Encadena una secuencia completa |
| `verificarCadena(registros, huellaInicial?)` | Recalcula y comprueba enlaces; devuelve los problemas |
| `svgQrFactura(datos, opciones?)` | El «QR tributario» de la factura, como SVG |
| `urlCotejo(datos, opciones?)` | La URL del servicio de cotejo que va dentro del QR |
| `urlCotejoJson(datos, opciones?)` | Ídem con `formato=json`, para cotejo automatizado |
| `validarDatosQr(datos)` | Valida los datos con los códigos de error oficiales |
| `matrizQr(texto)` / `svgQr(texto, opciones?)` | Codificador QR genérico (nivel M) |

Todos los tipos (`CamposHuellaAlta`, `CamposHuellaAnulacion`, `CamposHuellaEvento`,
`RegistroEncadenado`, `ProblemaCadena`, `DatosQrFactura`, `ProblemaQr`…) se exportan con
la ruta XML de cada campo documentada en el propio tipo.

## Conformidad

Implementa dos especificaciones oficiales de la AEAT, en el marco del Real Decreto
1007/2023 y la Orden HAC/1177/2024:

- *"Detalle de las especificaciones técnicas para generación de la huella o hash de los
  registros de facturación"*, **versión 0.1.2 (27/08/2024)**.
- *"Detalle de las especificaciones técnicas del código «QR» de la factura y de la «URL»
  del servicio de cotejo o remisión de información por parte del receptor de la
  factura"*, **versión 0.5.0 (10/12/2025)**.

La suite de tests incluye **los vectores de ejemplo de ambos documentos**: los tres casos
de huella del apartado 6 del primero con sus hashes oficiales, y las cuatro URL del
apartado 8 del segundo, más los casos límite que las especificaciones describen (recorte
de espacios, campo ausente frente a campo vacío, codificación del `&` en el número de
serie, catálogo de errores del apartado 10).

El código QR se genera con una implementación propia de ISO/IEC 18004 (modo byte, nivel
de corrección M) y **cada test lo decodifica con un lector independiente** para
comprobar que lo que se imprime es exactamente lo que se quería codificar.

```bash
npm test
```

## Hoja de ruta

- [x] Huella de registros de alta, anulación y evento
- [x] Encadenamiento y verificación de la cadena
- [x] Código QR de cotejo (URL de validación AEAT) y validación de sus datos
- [ ] Generación y validación del XML del registro contra los XSD oficiales
- [ ] Cliente de envío a los entornos de la AEAT (pruebas y producción)
- [ ] Estados de factura del RD 238/2026 (factura electrónica B2B)

### ¿Te está costando la conformidad?

Estoy construyendo herramientas alrededor de esto: un **emulador local del entorno de
pruebas de la AEAT** (para testear sin certificado y en CI) y un **informe de evidencias
de testeo** para respaldar la declaración responsable. Si te interesa, abre un issue
contando tu caso — las prioridades salen de ahí.

## Licencia

MIT © Juan Archidona

---

Este proyecto es una utilidad técnica de código abierto. No es asesoramiento fiscal ni
jurídico, y no sustituye a la verificación del cumplimiento normativo por parte del
responsable del sistema informático de facturación.
