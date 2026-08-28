# verifactu-ts

Huella (hash), encadenamiento, **código QR**, **XML del registro** y **validación previa
con los códigos de error oficiales** de **VeriFactu**, para TypeScript y Node. Sin
dependencias. Verificado contra los vectores de ejemplo y los esquemas oficiales de la AEAT.

> **Estado: v0.4** — el ciclo completo: se calcula la huella, se genera el XML, se
> comprueba **antes de enviarlo** qué rechazaría la AEAT y con qué código, se envía al
> servicio de remisión y se interpreta su respuesta. Incluye el mecanismo de control de
> flujo que la Orden HAC/1177/2024 hace obligatorio.

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

### Saber qué rechazaría la AEAT, antes de enviar nada

La AEAT aplica más de doscientas validaciones al registro, y muchas son condicionales:
un campo es obligatorio *porque* otro vale una cosa concreta. `validarRegistroAlta`
reproduce las que se pueden resolver en local y devuelve **el código de error que
devolvería el propio servicio**, con el apartado de la norma que lo establece:

```ts
import { validarRegistroAlta } from 'verifactu-ts';

validarRegistroAlta({
  ...registro,
  TipoFactura: 'R1',   // rectificativa…
  // …pero sin TipoRectificativa
});
// [{
//   codigo: '1114',
//   mensaje: 'Si la factura es de tipo rectificativa, el campo TipoRectificativa debe tener valor.',
//   detalle: 'TipoRectificativa es obligatorio con TipoFactura "R1".',
//   campo: 'TipoRectificativa',
//   apartado: '3.1.3.3',
//   severidad: 'rechazo',
// }]
```

`severidad` distingue lo que la AEAT **rechaza** de lo que **acepta con errores** (el
registro queda anotado, pero hay que subsanarlo): los descuadres de `CuotaTotal` e
`ImporteTotal` dentro del margen, por ejemplo, son avisos y no rechazos.

Se cubren, entre otras, las reglas de fechas (expedición futura, anterior al 28-10-2024,
operación diferida sólo con clave de régimen 14 o 15), las rectificativas y sustitutivas,
la obligatoriedad de destinatarios según el tipo de factura, los tipos impositivos y sus
recargos de equivalencia —incluidas las ventanas temporales del 5 %, el 2 % y el 7,5 %—,
las reglas propias de cada clave de régimen, el cuadre de bases y cuotas con el margen de
10 € que admite la AEAT, el límite de 3.000 € de las simplificadas, el macrodato, el
formato de la huella y del encadenamiento, y el bloque `SistemaInformatico`.

Lo que **no** puede comprobarse en local es lo que depende de datos que sólo tiene la
AEAT: si un NIF está en el censo, si existe un acuerdo de facturación o si la referencia
de un requerimiento es real. Una lista vacía no garantiza la aceptación; garantiza que no
te van a rechazar por algo que estaba en tu mano.

El catálogo oficial completo también se exporta, por si prefieres interpretar tú la
respuesta del servicio:

```ts
import { errorAeat } from 'verifactu-ts';

errorAeat(4102);
// { codigo: '4102', mensaje: 'El XML no cumple el esquema…', categoria: 'envio' }
```

### Generar el XML del registro

```ts
import { xmlRegFactuSistemaFacturacion } from 'verifactu-ts';

const xml = xmlRegFactuSistemaFacturacion(
  { ObligadoEmision: { NombreRazon: 'EMPRESA SL', NIF: '89890001K' } },
  [{ alta: registro }],
);
```

Devuelve el mensaje `RegFactuSistemaFacturacion` completo, listo para el cuerpo de la
petición. Para un solo registro, `xmlRegistroAlta` y `xmlRegistroAnulacion` dan el
fragmento suelto.

El detalle que cuesta caro: el esquema declara los elementos dentro de `sequence`, así
que **el mismo contenido en otro orden se rechaza con el error 4102** aunque no falte
nada. Por eso la serialización es explícita y el orden no depende de cómo hayas
construido el objeto. Lo mismo vale para el espacio de nombres de cada elemento:
`Cabecera` pertenece a `SuministroLR` y sus hijos a `SuministroInformacion`, y equivocar
el prefijo tumba el envío entero.

### Enviar los registros a la AEAT

```ts
import { ClienteAeat } from 'verifactu-ts';
import { readFileSync } from 'node:fs';

const cliente = new ClienteAeat({
  entorno: 'pruebas',                       // por defecto, para no publicar sin querer
  certificado: { pfx: readFileSync('certificado.p12'), passphrase: '…' },
});

const respuesta = await cliente.enviar(cabecera, [{ alta: registro }]);

respuesta.EstadoEnvio;   // 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto'
respuesta.CSV;           // guárdalo: no se puede recuperar después
```

Cada línea de la respuesta llega ya interpretada, con su código cruzado contra el
catálogo oficial:

```ts
import { lineasRechazadas, lineasPorSubsanar } from 'verifactu-ts';

lineasRechazadas(respuesta);    // no quedaron anotadas: hay que corregirlas y reenviarlas
lineasPorSubsanar(respuesta);   // anotadas, pero con errores admisibles que subsanar
```

Un detalle que cuesta caro descubrir tarde: **el CSV sólo se entrega en el momento del
alta y la AEAT no lo devuelve en consultas posteriores**. Si no se almacena, se pierde la
constancia de la remisión.

**Control de flujo.** El artículo 16.2 de la Orden HAC/1177/2024 obliga a los sistemas
VERI*FACTU a esperar entre envíos los segundos que indique la última respuesta —60 al
principio—, o hasta acumular el máximo de registros. El cliente lo lleva solo: reutiliza
la misma instancia y `enviar` esperará lo que haga falta.

```ts
cliente.tiempoEsperaSegundos;   // el que fijó la última respuesta
cliente.esperaPendienteMs();    // lo que falta para poder enviar de nuevo

// Para listas largas: trocea en lotes de 1000 como máximo y respeta la espera.
await cliente.enviarPorLotes(cabecera, registros);
```

Los errores llegan tipados y con su significado: `ErrorSoapAeat` cuando la AEAT rechaza
el envío completo con un `SOAPFault` —con el código extraído del `faultstring` y un
campo `reintentable` que distingue el fallo del servidor del mensaje mal construido— y
`ErrorEnvioAeat` para los problemas de transporte.

Si necesitas otro transporte (un proxy corporativo, trazas, o pruebas sin red), se puede
sustituir sin tocar el resto:

```ts
new ClienteAeat({ transporte: async ({ url, cuerpo, cabeceras }) => ({ estado: 200, cuerpo: '…' }) });
```

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
| `validarRegistroAlta(registro, opciones?)` | Valida el registro de alta con los códigos de error de la AEAT |
| `validarRegistroAnulacion(registro, opciones?)` | Ídem para el registro de anulación |
| `xmlRegistroAlta(registro, opciones?)` | XML del registro de alta |
| `xmlRegistroAnulacion(registro, opciones?)` | XML del registro de anulación |
| `xmlRegFactuSistemaFacturacion(cabecera, registros, opciones?)` | Mensaje de remisión completo |
| `errorAeat(codigo)` / `ERRORES_AEAT` | Catálogo oficial de los 247 códigos de error |
| `new ClienteAeat(opciones)` | Cliente del servicio de remisión, con control de flujo |
| `cliente.enviar(cabecera, registros)` | Envía un lote y devuelve la respuesta interpretada |
| `cliente.enviarPorLotes(cabecera, registros, tamano?)` | Trocea una lista larga y la envía respetando la espera |
| `parsearRespuestaEnvio(xml)` | Interpreta una respuesta o `SOAPFault` recibido por otra vía |
| `lineasRechazadas(r)` / `lineasPorSubsanar(r)` | Filtra los registros no anotados y los que hay que subsanar |
| `endpointAeat(opciones)` / `ENDPOINTS` | Puntos de entrada publicados en el WSDL |
| `sobreSoap(xml)` | Envuelve el mensaje en un sobre SOAP 1.1 |

Todos los tipos (`CamposHuellaAlta`, `CamposHuellaAnulacion`, `CamposHuellaEvento`,
`RegistroEncadenado`, `ProblemaCadena`, `DatosQrFactura`, `ProblemaQr`, `RegistroAlta`,
`RegistroAnulacion`, `DetalleDesglose`, `SistemaInformatico`, `Cabecera`,
`ProblemaRegistro`…) se exportan con la ruta XML de cada campo documentada en el propio
tipo.

## Conformidad

Implementa la documentación oficial de la AEAT, en el marco del Real Decreto 1007/2023 y
la Orden HAC/1177/2024:

- *"Detalle de las especificaciones técnicas para generación de la huella o hash de los
  registros de facturación"*, **versión 0.1.2 (27/08/2024)**.
- *"Detalle de las especificaciones técnicas del código «QR» de la factura y de la «URL»
  del servicio de cotejo o remisión de información por parte del receptor de la
  factura"*, **versión 0.5.0 (10/12/2025)**.
- *"Validaciones. Sistemas Informáticos de Facturación y Sistemas VERI*FACTU"*,
  **versión 1.2.2 (08/04/2026)**, y el catálogo de códigos de error al que remite su
  apartado 4.4.
- *"Diseños de registro de facturación"* y los esquemas `SuministroLR.xsd` /
  `SuministroInformacion.xsd`, **versión 1.0 (28/10/2024)**.
- *"Sistemas Informáticos de Facturación. Remisión voluntaria y remisión bajo
  requerimiento de la AEAT"*, **versión 1.0.3 (28/07/2025)**, y el WSDL
  `SistemaFacturacion.wsdl` del que salen los puntos de entrada.

La suite de tests incluye **los vectores de ejemplo oficiales**: los tres casos de huella
del apartado 6 del primer documento con sus hashes, y las cuatro URL del apartado 8 del
segundo, más los casos límite que las especificaciones describen (recorte de espacios,
campo ausente frente a campo vacío, codificación del `&` en el número de serie, catálogo
de errores del apartado 10).

Nada se da por bueno porque lo diga este paquete:

- El código QR se genera con una implementación propia de ISO/IEC 18004 (modo byte, nivel
  de corrección M) y **cada test lo decodifica con un lector independiente**.
- El XML generado se valida **contra los XSD que publica la propia AEAT**, con un
  validador externo y sobre muestras que ejercitan todos los bloques opcionales del
  esquema (rectificativas, terceros, destinatarios extranjeros, exenciones, recargo de
  equivalencia, encadenamiento, lotes mixtos y remisión bajo requerimiento). Una de las
  muestras es el sobre SOAP completo, para comprobar que envolverlo no altera el mensaje
  que ve la AEAT.

```bash
npm test              # 118 tests, sin dependencias externas
npm run validar:xsd   # además, valida el XML contra los esquemas oficiales (requiere Python y lxml)
```

Lo que **no** está cubierto por tests automáticos es la conexión real con la AEAT: exige
un certificado electrónico cualificado y un obligado tributario dado de alta. El cliente
se prueba con un transporte simulado, así que el sobre, las cabeceras, el troceado en
lotes, el control de flujo y la lectura de la respuesta sí están verificados de extremo a
extremo; el apretón de manos TLS con el servicio, no.

## Hoja de ruta

- [x] Huella de registros de alta, anulación y evento
- [x] Encadenamiento y verificación de la cadena
- [x] Código QR de cotejo (URL de validación AEAT) y validación de sus datos
- [x] Generación del XML del registro, validado contra los XSD oficiales
- [x] Validación previa del registro con el catálogo de errores de la AEAT
- [x] Cliente de envío a los entornos de la AEAT, con control de flujo
- [ ] Consulta de registros presentados (`ConsultaFactuSistemaFacturacion`)
- [ ] Registro de evento (`RegistroEvento`) y su XML
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

---

## Sobre este fork

El repositorio original —[JuanArchidona/verifactu-ts](https://github.com/JuanArchidona/verifactu-ts)—
fue archivado por su autor el 21 de agosto de 2026 y es de sólo lectura. Este
fork existe para poder seguir manteniéndolo: la obligación del RD 1007/2023
entra en vigor el 1 de enero de 2027 para las sociedades, y los documentos de
la AEAT sobre los que está construido —validaciones, huella, QR, servicio de
remisión— siguen publicando versiones.

El único cambio respecto al original es el guion `prepare`, que es el que npm y
pnpm ejecutan al instalar una dependencia apuntada a un repositorio git. El
paquete publicado en npm sólo lleva `dist`, así que sin él la instalación desde
git deja el paquete sin construir.

El mérito y la autoría son de Juan Archidona; la licencia sigue siendo MIT.
