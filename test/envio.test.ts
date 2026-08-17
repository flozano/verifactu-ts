/**
 * Cliente de envío y lectura de la respuesta de la AEAT.
 *
 * El transporte se sustituye por uno simulado: lo que se comprueba aquí es el sobre
 * SOAP, los puntos de entrada, el control de flujo del artículo 16.2 y la
 * interpretación de la respuesta. La conexión real con la AEAT exige un certificado
 * electrónico y no puede automatizarse.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ClienteAeat,
  ENDPOINTS,
  ErrorEnvioAeat,
  ESPERA_INICIAL_SEGUNDOS,
  MAX_REGISTROS_POR_ENVIO,
  endpointAeat,
  sobreSoap,
} from '../src/envio.js';
import type { PeticionTransporte, RespuestaTransporte } from '../src/envio.js';
import {
  ErrorSoapAeat,
  lineasPorSubsanar,
  lineasRechazadas,
  parsearRespuestaEnvio,
} from '../src/respuesta.js';
import { parsearXml, buscar, textoDeHijo } from '../src/xml-parser.js';
import type { Cabecera, RegistroAlta, RegistroFactura, SistemaInformatico } from '../src/index.js';

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

const CABECERA: Cabecera = {
  ObligadoEmision: { NombreRazon: 'EMPRESA EMISORA SL', NIF: '89890001K' },
  RemisionVoluntaria: { Incidencia: 'N' },
};

/** Respuesta conforme a RespuestaSuministro.xsd, con un registro correcto. */
function respuestaCorrecta(espera = 60): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <sfR:RespuestaRegFactuSistemaFacturacion xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
      <sfR:CSV>A1B2C3D4E5F6G7H8</sfR:CSV>
      <sfR:DatosPresentacion>
        <sf:NIFPresentador>89890001K</sf:NIFPresentador>
        <sf:TimestampPresentacion>2025-01-15T19:21:00+01:00</sf:TimestampPresentacion>
      </sfR:DatosPresentacion>
      <sfR:Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>EMPRESA EMISORA SL</sf:NombreRazon>
          <sf:NIF>89890001K</sf:NIF>
        </sf:ObligadoEmision>
      </sfR:Cabecera>
      <sfR:TiempoEsperaEnvio>${espera}</sfR:TiempoEsperaEnvio>
      <sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>
          <sf:NumSerieFactura>12345678/G33</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>15-01-2025</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>Alta</sfR:Operacion>
        <sfR:EstadoRegistro>Correcto</sfR:EstadoRegistro>
      </sfR:RespuestaLinea>
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/** Respuesta con un registro correcto, uno aceptado con errores y uno rechazado. */
const RESPUESTA_PARCIAL = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <sfR:RespuestaRegFactuSistemaFacturacion xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
      <sfR:CSV>ZZZZ111122223333</sfR:CSV>
      <sfR:Cabecera/>
      <sfR:TiempoEsperaEnvio>120</sfR:TiempoEsperaEnvio>
      <sfR:EstadoEnvio>ParcialmenteCorrecto</sfR:EstadoEnvio>
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>
          <sf:NumSerieFactura>A/1</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>15-01-2025</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>Alta</sfR:Operacion>
        <sfR:EstadoRegistro>Correcto</sfR:EstadoRegistro>
      </sfR:RespuestaLinea>
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>
          <sf:NumSerieFactura>A/2</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>15-01-2025</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>Alta</sfR:Operacion>
        <sfR:EstadoRegistro>AceptadoConErrores</sfR:EstadoRegistro>
        <sfR:CodigoErrorRegistro>2000</sfR:CodigoErrorRegistro>
        <sfR:DescripcionErrorRegistro>El c&#225;lculo de la huella suministrada es incorrecta.</sfR:DescripcionErrorRegistro>
      </sfR:RespuestaLinea>
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>89890001K</sf:IDEmisorFactura>
          <sf:NumSerieFactura>A/3</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>15-01-2025</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>Alta</sfR:Operacion>
        <sfR:EstadoRegistro>Incorrecto</sfR:EstadoRegistro>
        <sfR:CodigoErrorRegistro>1114</sfR:CodigoErrorRegistro>
        <sfR:RegistroDuplicado>
          <sf:IdPeticionRegistroDuplicado>PET-000123</sf:IdPeticionRegistroDuplicado>
          <sf:EstadoRegistroDuplicado>Correcta</sf:EstadoRegistroDuplicado>
        </sfR:RegistroDuplicado>
      </sfR:RespuestaLinea>
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;

/** SOAPFault tal y como lo documenta el apartado 5.1. */
const RESPUESTA_FAULT = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
   <env:Body>
      <env:Fault>
         <faultcode>env:Client</faultcode>
         <faultstring>Codigo[4104].El NIF del titular en la cabecera no est&#225; identificado. NIF:iii. NOMBRE_RAZON:xxx</faultstring>
         <detail>
            <callstack>WSExcepcion [faultcode=null, detailMap=null, version=0]</callstack>
         </detail>
      </env:Fault>
   </env:Body>
</env:Envelope>`;

/** Transporte simulado que devuelve respuestas prefijadas y guarda lo enviado. */
function transporteFalso(respuestas: Array<string | RespuestaTransporte>) {
  const enviadas: PeticionTransporte[] = [];
  let indice = 0;
  const transporte = async (peticion: PeticionTransporte): Promise<RespuestaTransporte> => {
    enviadas.push(peticion);
    const siguiente = respuestas[Math.min(indice++, respuestas.length - 1)]!;
    return typeof siguiente === 'string' ? { estado: 200, cuerpo: siguiente } : siguiente;
  };
  return { transporte, enviadas };
}

// --- Lector de XML ----------------------------------------------------------

test('el lector de XML resuelve anidamiento, atributos y entidades', () => {
  const raiz = parsearXml('<a x="1"><b>uno &amp; dos</b><c/></a>');
  assert.equal(raiz.local, 'a');
  assert.equal(raiz.atributos.x, '1');
  assert.equal(raiz.hijos.length, 2);
  assert.equal(textoDeHijo(raiz, 'b'), 'uno & dos');
});

test('el lector resuelve referencias numéricas y CDATA, e ignora comentarios', () => {
  const raiz = parsearXml('<a><!-- nota --><b>c&#225;lculo</b><c><![CDATA[<sin> & tocar]]></c></a>');
  assert.equal(textoDeHijo(raiz, 'b'), 'cálculo');
  assert.equal(textoDeHijo(raiz, 'c'), '<sin> & tocar');
});

test('el lector rechaza el XML mal formado', () => {
  assert.throws(() => parsearXml('<a><b></a>'), SyntaxError);
  assert.throws(() => parsearXml('<a>'), SyntaxError);
  assert.throws(() => parsearXml('<a/><b/>'), SyntaxError);
});

test('buscar encuentra por nombre local, ignorando el prefijo', () => {
  const raiz = parsearXml('<env:Body xmlns:env="x"><sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio></env:Body>');
  assert.equal(buscar(raiz, 'EstadoEnvio')?.texto, 'Correcto');
});

// --- Respuesta --------------------------------------------------------------

test('se interpreta una respuesta correcta', () => {
  const respuesta = parsearRespuestaEnvio(respuestaCorrecta());
  assert.equal(respuesta.EstadoEnvio, 'Correcto');
  assert.equal(respuesta.CSV, 'A1B2C3D4E5F6G7H8');
  assert.equal(respuesta.NIFPresentador, '89890001K');
  assert.equal(respuesta.TimestampPresentacion, '2025-01-15T19:21:00+01:00');
  assert.equal(respuesta.TiempoEsperaEnvio, 60);
  assert.equal(respuesta.lineas.length, 1);
  assert.equal(respuesta.lineas[0]!.NumSerieFactura, '12345678/G33');
  assert.equal(respuesta.lineas[0]!.anotado, true);
});

test('cada código de error de la respuesta se cruza con el catálogo oficial', () => {
  const respuesta = parsearRespuestaEnvio(RESPUESTA_PARCIAL);
  const conError = respuesta.lineas.find((l) => l.CodigoErrorRegistro === '2000')!;
  assert.equal(conError.error?.categoria, 'admisible');
  assert.equal(conError.error?.mensaje, 'El cálculo de la huella suministrada es incorrecta.');

  const rechazada = respuesta.lineas.find((l) => l.CodigoErrorRegistro === '1114')!;
  assert.equal(rechazada.error?.categoria, 'registro');
});

test('se distinguen los registros anotados, los rechazados y los que hay que subsanar', () => {
  const respuesta = parsearRespuestaEnvio(RESPUESTA_PARCIAL);
  assert.equal(respuesta.EstadoEnvio, 'ParcialmenteCorrecto');
  assert.deepEqual(lineasRechazadas(respuesta).map((l) => l.NumSerieFactura), ['A/3']);
  assert.deepEqual(lineasPorSubsanar(respuesta).map((l) => l.NumSerieFactura), ['A/2']);
  // El aceptado con errores queda anotado en la AEAT, aunque haya que subsanarlo.
  assert.equal(respuesta.lineas.find((l) => l.NumSerieFactura === 'A/2')!.anotado, true);
});

test('el rechazo por duplicado trae los datos del registro ya anotado', () => {
  const respuesta = parsearRespuestaEnvio(RESPUESTA_PARCIAL);
  const duplicado = respuesta.lineas.find((l) => l.NumSerieFactura === 'A/3')!.RegistroDuplicado!;
  assert.equal(duplicado.IdPeticionRegistroDuplicado, 'PET-000123');
  assert.equal(duplicado.EstadoRegistroDuplicado, 'Correcta');
});

test('un SOAPFault se convierte en ErrorSoapAeat con su código del catálogo', () => {
  assert.throws(
    () => parsearRespuestaEnvio(RESPUESTA_FAULT),
    (error: unknown) => {
      assert.ok(error instanceof ErrorSoapAeat);
      assert.equal(error.codigo, '4104');
      assert.equal(error.error?.categoria, 'envio');
      assert.equal(error.faultcode, 'env:Client');
      // faultcode de tipo Client: hay que corregir el mensaje, no reintentarlo.
      assert.equal(error.reintentable, false);
      return true;
    },
  );
});

test('un fault de servidor sí se marca como reintentable', () => {
  const fault = RESPUESTA_FAULT.replace('env:Client', 'env:Server');
  assert.throws(
    () => parsearRespuestaEnvio(fault),
    (error: unknown) => error instanceof ErrorSoapAeat && error.reintentable,
  );
});

test('una respuesta irreconocible falla con SyntaxError', () => {
  assert.throws(() => parsearRespuestaEnvio('<a><b>algo</b></a>'), SyntaxError);
});

// --- Sobre SOAP y puntos de entrada -----------------------------------------

test('el sobre SOAP lleva un solo prólogo XML y el cuerpo dentro de Body', () => {
  const sobre = sobreSoap('<?xml version="1.0" encoding="UTF-8"?>\n<sfLR:RegFactu/>\n');
  assert.equal(sobre.match(/<\?xml/g)?.length, 1);
  assert.ok(sobre.includes('<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'));
  assert.match(sobre, /<soapenv:Body>[\s\S]*<sfLR:RegFactu\/>[\s\S]*<\/soapenv:Body>/);
});

test('los puntos de entrada son los publicados en el WSDL', () => {
  assert.equal(
    endpointAeat({ entorno: 'produccion' }),
    'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  );
  assert.equal(
    endpointAeat({ entorno: 'produccion', sello: true }),
    'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  );
  assert.equal(
    endpointAeat({ modalidad: 'requerimiento' }),
    'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/RequerimientoSOAP',
  );
  assert.equal(endpointAeat({ url: 'https://ejemplo/ws' }), 'https://ejemplo/ws');
});

test('por defecto se apunta a pruebas, no a producción', () => {
  assert.equal(endpointAeat(), ENDPOINTS.verifactu.pruebas.normal);
});

// --- Cliente ----------------------------------------------------------------

test('el envío manda el sobre SOAP con las cabeceras que exige el servicio', async () => {
  const { transporte, enviadas } = transporteFalso([respuestaCorrecta()]);
  const cliente = new ClienteAeat({ transporte, controlDeFlujo: false });

  const respuesta = await cliente.enviar(CABECERA, [{ alta: ALTA }]);

  assert.equal(respuesta.EstadoEnvio, 'Correcto');
  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0]!.cabeceras['Content-Type'], 'text/xml; charset=UTF-8');
  assert.equal(enviadas[0]!.cabeceras.SOAPAction, '""');
  assert.ok(enviadas[0]!.cuerpo.includes('<soapenv:Body>'));
  assert.ok(enviadas[0]!.cuerpo.includes('<sfLR:RegFactuSistemaFacturacion'));
  assert.ok(enviadas[0]!.cuerpo.includes('<sf:Huella>'));
});

test('el lote no puede estar vacío ni exceder los 1000 registros', async () => {
  const { transporte } = transporteFalso([respuestaCorrecta()]);
  const cliente = new ClienteAeat({ transporte, controlDeFlujo: false });

  await assert.rejects(() => cliente.enviar(CABECERA, []), RangeError);

  const demasiados: RegistroFactura[] = Array.from(
    { length: MAX_REGISTROS_POR_ENVIO + 1 },
    () => ({ alta: ALTA }),
  );
  await assert.rejects(() => cliente.enviar(CABECERA, demasiados), RangeError);
});

test('el control de flujo arranca en 60 s y se actualiza con la respuesta', async () => {
  const { transporte } = transporteFalso([respuestaCorrecta(120)]);
  const cliente = new ClienteAeat({ transporte, controlDeFlujo: false });

  assert.equal(cliente.tiempoEsperaSegundos, ESPERA_INICIAL_SEGUNDOS);
  assert.equal(cliente.esperaPendienteMs(), 0, 'el primer envío no espera');

  await cliente.enviar(CABECERA, [{ alta: ALTA }]);

  assert.equal(cliente.tiempoEsperaSegundos, 120);
  assert.ok(cliente.esperaPendienteMs() > 119_000);
  // Pasados los 120 segundos, vuelve a poder enviarse.
  assert.equal(cliente.esperaPendienteMs(Date.now() + 120_000), 0);
});

test('el reloj del control de flujo cuenta aunque el envío falle', async () => {
  const transporte = async (): Promise<RespuestaTransporte> => {
    throw new Error('red caída');
  };
  const cliente = new ClienteAeat({ transporte, controlDeFlujo: false });

  await assert.rejects(() => cliente.enviar(CABECERA, [{ alta: ALTA }]));
  assert.ok(cliente.esperaPendienteMs() > 0);
});

test('un código HTTP inesperado sin Fault produce ErrorEnvioAeat', async () => {
  const { transporte } = transporteFalso([{ estado: 503, cuerpo: 'Servicio no disponible' }]);
  const cliente = new ClienteAeat({ transporte, controlDeFlujo: false });

  await assert.rejects(
    () => cliente.enviar(CABECERA, [{ alta: ALTA }]),
    (error: unknown) => error instanceof ErrorEnvioAeat && error.estado === 503,
  );
});

test('un 500 que trae SOAPFault se interpreta como error de negocio, no de transporte', async () => {
  const { transporte } = transporteFalso([{ estado: 500, cuerpo: RESPUESTA_FAULT }]);
  const cliente = new ClienteAeat({ transporte, controlDeFlujo: false });

  await assert.rejects(
    () => cliente.enviar(CABECERA, [{ alta: ALTA }]),
    (error: unknown) => error instanceof ErrorSoapAeat && error.codigo === '4104',
  );
});

test('enviarPorLotes trocea la lista y devuelve una respuesta por lote', async () => {
  const { transporte, enviadas } = transporteFalso([respuestaCorrecta()]);
  const cliente = new ClienteAeat({ transporte, controlDeFlujo: false });

  const registros: RegistroFactura[] = Array.from({ length: 5 }, () => ({ alta: ALTA }));
  const respuestas = await cliente.enviarPorLotes(CABECERA, registros, 2);

  assert.equal(respuestas.length, 3);
  assert.equal(enviadas.length, 3);
  // 2 + 2 + 1 registros.
  assert.equal(enviadas[0]!.cuerpo.match(/<sfLR:RegistroFactura>/g)?.length, 2);
  assert.equal(enviadas[2]!.cuerpo.match(/<sfLR:RegistroFactura>/g)?.length, 1);
});

test('el control de flujo hace esperar de verdad entre lotes', async () => {
  // Espera de 1 segundo: la respuesta la fija, y el segundo envío debe respetarla.
  const { transporte } = transporteFalso([respuestaCorrecta(1)]);
  const cliente = new ClienteAeat({ transporte });

  const inicio = Date.now();
  await cliente.enviarPorLotes(CABECERA, [{ alta: ALTA }, { alta: ALTA }], 1);
  const transcurrido = Date.now() - inicio;

  assert.ok(transcurrido >= 950, `el segundo envío debería haber esperado ~1 s, esperó ${transcurrido} ms`);
});
