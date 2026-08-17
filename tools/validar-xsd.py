"""Valida los XML generados por el SDK contra los esquemas oficiales de la AEAT.

Es la comprobación equivalente a la que hace `qr.test.ts` decodificando cada QR con
un lector independiente: aquí quien juzga el XML no es el SDK, sino los XSD que
publica la propia AEAT.

Uso:
    npm test                      # deja el build en dist-test/
    node tools/generar-muestras.mjs
    python tools/validar-xsd.py

Requiere `lxml` (no es dependencia del paquete; sólo de esta comprobación).
Los XSD se descargan a `tools/xsd/` la primera vez.
"""

import sys
import urllib.request
from pathlib import Path

try:
    from lxml import etree
except ImportError:
    sys.exit("Falta lxml. Instálalo con: python -m pip install lxml")

RAIZ = Path(__file__).resolve().parent.parent
DIR_XSD = RAIZ / "tools" / "xsd"
DIR_MUESTRAS = RAIZ / "tools" / "muestras"

BASE_AEAT = (
    "https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/"
    "es/aeat/tikeV1.0/cont/ws/"
)

ESQUEMAS = [
    "SuministroLR.xsd",
    "SuministroInformacion.xsd",
    "RespuestaSuministro.xsd",
    "EventosSIF.xsd",
]

# El esquema de firma que importa SuministroInformacion.xsd apunta a w3.org; se
# descarga aparte y se resuelve en local para no depender de esa URL al validar.
XMLDSIG = "http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd"


def descargar(url: str, destino: Path) -> None:
    if destino.exists():
        return
    destino.parent.mkdir(parents=True, exist_ok=True)
    print(f"  descargando {destino.name}...")
    with urllib.request.urlopen(url, timeout=60) as respuesta:
        destino.write_bytes(respuesta.read())


def preparar_esquemas() -> Path:
    print("Esquemas oficiales:")
    for nombre in ESQUEMAS:
        descargar(BASE_AEAT + nombre, DIR_XSD / nombre)
    descargar(XMLDSIG, DIR_XSD / "xmldsig-core-schema.xsd")

    # Reescribe el schemaLocation remoto de la firma por la copia local.
    info = DIR_XSD / "SuministroInformacion.xsd"
    texto = info.read_text(encoding="utf-8")
    if XMLDSIG in texto:
        info.write_text(texto.replace(XMLDSIG, "xmldsig-core-schema.xsd"), encoding="utf-8")

    return DIR_XSD / "SuministroLR.xsd"


def main() -> int:
    principal = preparar_esquemas()
    esquema = etree.XMLSchema(etree.parse(str(principal)))

    muestras = sorted(DIR_MUESTRAS.glob("*.xml"))
    if not muestras:
        sys.exit(
            f"No hay muestras en {DIR_MUESTRAS}. Ejecuta antes:\n"
            "  npm test && node tools/generar-muestras.mjs"
        )

    print(f"\nValidando {len(muestras)} muestras contra SuministroLR.xsd:\n")
    NS_SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
    fallos = 0
    for muestra in muestras:
        documento = etree.parse(str(muestra))

        # Si la muestra es un sobre SOAP, se valida el mensaje que lleva dentro.
        raiz = documento.getroot()
        if raiz.tag == f"{{{NS_SOAP}}}Envelope":
            cuerpo = raiz.find(f"{{{NS_SOAP}}}Body")
            hijos = list(cuerpo) if cuerpo is not None else []
            if len(hijos) != 1:
                fallos += 1
                print(f"  FALLA {muestra.name}")
                print(f"          el Body del sobre SOAP debe tener un único hijo, tiene {len(hijos)}")
                continue
            documento = etree.ElementTree(hijos[0])

        if esquema.validate(documento):
            print(f"  OK    {muestra.name}")
        else:
            fallos += 1
            print(f"  FALLA {muestra.name}")
            for error in esquema.error_log:
                print(f"          línea {error.line}: {error.message}")

    print()
    if fallos:
        print(f"{fallos} de {len(muestras)} muestras NO cumplen el esquema oficial.")
        return 1
    print(f"Las {len(muestras)} muestras cumplen el esquema oficial de la AEAT.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
