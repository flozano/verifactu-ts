# verifactu-ts

Huella (hash) y encadenamiento de registros **VeriFactu** para TypeScript y Node.
Sin dependencias. Verificado contra los vectores de ejemplo oficiales de la AEAT.

> **Estado: v0.1** — cubre el núcleo que más errores provoca: el cálculo de la huella
> y el encadenamiento. La generación del XML completo, el QR y el envío a la AEAT
> están en la hoja de ruta (ver más abajo).

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

Todos los tipos (`CamposHuellaAlta`, `CamposHuellaAnulacion`, `CamposHuellaEvento`,
`RegistroEncadenado`, `ProblemaCadena`…) se exportan con la ruta XML de cada campo
documentada en el propio tipo.

## Conformidad

Implementa *"Detalle de las especificaciones técnicas para generación de la huella o hash
de los registros de facturación"*, **AEAT, versión 0.1.2 (27/08/2024)**, en el marco del
Real Decreto 1007/2023 y la Orden HAC/1177/2024.

La suite de tests incluye **los tres casos de ejemplo del apartado 6 de ese documento**
con sus huellas oficiales, más los casos límite que la especificación describe
(recorte de espacios, campo ausente frente a campo vacío).

```bash
npm test
```

## Hoja de ruta

- [x] Huella de registros de alta, anulación y evento
- [x] Encadenamiento y verificación de la cadena
- [ ] Código QR de cotejo (URL de validación AEAT)
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
