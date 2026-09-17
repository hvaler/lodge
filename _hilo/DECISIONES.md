# Registro de Decisiones Arquitectonicas (ADRs)

> **INSTRUCCIONES PARA CLAUDE**: este archivo documenta las decisiones tecnicas importantes.
> SIEMPRE respeta las decisiones ya tomadas a menos que el desarrollador indique lo contrario.
> Antes de proponer una solucion, verifica que no contradiga una decision existente.

**Origen**: todas las decisiones de abajo estan razonadas en el registro de decision fechado el
**14-09-2026** (`Lodge-Runbook-ES.pdf` / `-EN.pdf`, fuera del repositorio). El documento vivo que las
mantiene al dia es [`RUNBOOK.md`](../RUNBOOK.md): el PDF explica **por que** se eligio esta forma,
el markdown es **lo que cambia mientras se construye**.

---

## Indice de Decisiones

| ID | Titulo | Fecha | Estado | Categoria |
|---|---|---|---|---|
| ADR-001 | Servidor MCP en lugar de un chatbot mas | 2026-09-14 | Aceptada | Arquitectura |
| ADR-002 | Exactamente dos adaptadores, ni uno ni tres | 2026-09-14 | Aceptada | Alcance |
| ADR-003 | El nucleo corre en cualquier sitio; AWS es un destino | 2026-09-14 | Aceptada | Despliegue |
| ADR-004 | El catalogo de herramientas se deriva de las capacidades | 2026-09-14 | Aceptada | Arquitectura |
| ADR-005 | Protocolo sin estado (MCP 2026-07-28) | 2026-09-14 | **Superada por ADR-009** | Protocolo |
| ADR-006 | La interfaz de proveedor se congela al cerrar M1 | 2026-09-14 | Aceptada · **congelada el 16-09** | Proceso |
| ADR-007 | Los criterios de aceptacion viven en ingles, junto a los tests | 2026-09-14 | Aceptada | Documentacion |
| ADR-008 | Licencia Apache-2.0 | 2026-09-14 | Aceptada | Legal |
| ADR-009 | MCP 2025-11-25 como revision objetivo, sin estado por transporte | 2026-09-14 | Aceptada | Protocolo |
| ADR-011 | La confirmacion viaja como argumento, no como peticion al cliente | 2026-09-16 | Aceptada | Protocolo |
| ADR-012 | Las tarjetas se adjuntan salvo que el cliente diga que no tiene pantalla | 2026-09-16 | Aceptada | Arquitectura |
| ADR-013 | Lodge es servidor de recursos, nunca servidor de autorizacion | 2026-09-16 | Aceptada | Seguridad |
| ADR-014 | En el destino gestionado solo persisten los avisos; el dataset vive en el codigo | 2026-09-16 | Aceptada | Despliegue |
| ADR-015 | Instrumentar siempre, exportar solo si lo piden | 2026-09-16 | Aceptada | Observabilidad |
| ADR-016 | La demostracion publica es una segunda funcion, con tope diario duro | 2026-09-16 | Aceptada | Despliegue |
| ADR-017 | 'issues' se parte en abrir y consultar | 2026-09-17 | Aceptada | Arquitectura |
| ADR-018 | Los partes van al sistema que la institucion ya vigila | 2026-09-17 | Aceptada | Integracion |
| ADR-019 | 'rooms' se parte en saber cuales hay y saber cuales estan libres | 2026-09-17 | Aceptada | Arquitectura |

---

## ADR-001 · Servidor MCP en lugar de un chatbot mas

**Contexto** — Las universidades llevan anos desplegando asistentes conversacionales en su web.

**Decision** — Exponer el conocimiento del campus como servidor MCP, no como widget.

**Razon** — Casi todos esos asistentes son callejones sin salida: viven dentro de un widget, no se
pueden componer y mueren con el contrato. Un servidor MCP es lo contrario: cualquier agente puede
consumirlo. Hoy Alexa+ en un altavoz, manana el asistente del portatil del estudiante o el de la
plataforma docente. La institucion publica sus capacidades una vez y deja de elegir cliente.

---

## ADR-002 · Exactamente dos adaptadores, ni uno ni tres

**Contexto** — Generalizar "para cualquier institucion" es el agujero de alcance clasico.

**Decision** — `synthetic` (generador determinista, la Universidad de San Telmo) y `standards`
(iCalendar · LDAP · CSV). Ni uno mas.

**Razon** — La disciplina es numerica: **un solo adaptador finge la separacion; tres son orfebreria.
Dos obligan a que la costura sea real y caben en el calendario.**

**Consecuencia** — Fuera de alcance de forma explicita: conectores para plataformas docentes
concretas. Son el primer anadido natural *despues* del hackathon.

---

## ADR-003 · El nucleo corre en cualquier sitio; AWS es un destino, no un requisito

**Contexto** — Tension real: un proyecto que aspira a que lo adopte cualquier institucion no puede
exigir una cuenta de nube, porque muchas no la tendran. Pero el mini-reto de AWS pide AWS.

**Decision** — Dos destinos de despliegue **de primera clase**: contenedor distroless + compose
(autonomo), y AWS Lambda · DynamoDB · CDK v2 (gestionado). El mismo artefacto en ambos.

**Razon** — Resuelve la tension sin sacrificar ninguno de los dos publicos. El mini-reto de AWS se
gana con el segundo sin que el primero dependa de el.

---

## ADR-004 · El catalogo de herramientas se deriva de las capacidades declaradas

**Decision** — Cada adaptador declara que sabe hacer y en que idioma trabaja; el catalogo de
herramientas se deriva de esa declaracion en tiempo de ejecucion.

**Razon** — Una institucion sin gestor de incidencias no publica esas herramientas y el agente nunca
ofrece lo que no existe. **Es lo que hace que "generico" signifique algo en tiempo de ejecucion en
lugar de ser una promesa del README.**

---

## ADR-005 · Protocolo sin estado (MCP 2026-07-28)

> ⚠️ **Superada por ADR-009 el 14-09-2026.** La premisa de que 2026-07-28 era «la revision vigente» no resistio la verificacion. Se conserva por que explica de donde venia la idea de que el servidor fuera sin estado, que si sobrevive.

**Decision** — Adoptar la revision 2026-07-28 con degradacion a 2025-11-25 (el minimo que exige el
hackathon). `server/discover` obligatorio. Notificaciones de cambio por `subscriptions/listen`.
*Roots*, *sampling* y el *logging* del protocolo quedan obsoletos y **no se adoptan**.

**Razon** — La revision vuelve el protocolo sin estado: desaparecen las sesiones y el saludo de
`initialize`. Para este proyecto es ventaja directa — **un servidor sin estado se replica sin
coordinacion, que es justo lo que necesita algo pensado para desplegarse en sitios ajenos.**

---

## ADR-006 · La interfaz de proveedor se congela al cerrar M1

**Contexto** — Riesgo alto identificado: "la abstraccion se come el calendario".

**Decision** — El contrato con declaracion de capacidades e idioma se congela el 27 de septiembre.
A partir de ahi **solo se implementa contra el**.

**Razon** — Es la pieza que vuelve reutilizable el proyecto, y la que mas caro sale rehacer: tocarla
impacta a los dos adaptadores y a las seis herramientas a la vez. Sin fecha de congelacion no hay
fecha de entrega creible.

**Congelada el 16-09-2026**, once dias antes de la fecha limite. Se puede adelantar porque M2 se
adelanto tambien: la interfaz ya ha sobrevivido a un segundo adaptador (Carrigmore, en-IE,
Europe/Dublin), a las tarjetas visuales, al enrutado multi-institucion y al orquestador sin una sola
vuelta atras.

Lo que el segundo adaptador le hizo ganar, y que con uno solo se habria congelado mal:

| Cambio | Lo encontro | Por que |
|---|---|---|
| `ProviderDescriptor.timeZone` | Escribir las seis herramientas | El idioma no dice la zona horaria: "tu clase es a las nueve" es falso en la zona de quien escucha |
| `Session.group?` opcional | Carrigmore | No parte su cohorte en grupos; exigirlo obliga al adaptador a inventarse un valor |
| `Route.minutes?` opcional | Carrigmore | Una tabla de aulas no trae matriz de distancias |
| `Provider.listRooms` | Escribir las tarjetas | "Libre" es media ocupacion: una rejilla sin aulas ocupadas es una lista |

**Que la hace cumplir** — `src/provider/frozen.ts` guarda una instantanea que el compilador compara
con las definiciones vivas en cada `npm run build`. No impide el cambio: lo vuelve ruidoso, que es
lo que hacia falta. El riesgo nunca fue el cambio, fue el cambio silencioso descubierto tres dias
despues desde el otro adaptador.

Dos comprobaciones por tipo, porque detectan cosas distintas: igualdad de claves (campo anadido,
quitado o renombrado) y asignabilidad mutua (campo que cambia de tipo, u opcional que pasa a
obligatorio). Ninguna basta sola — un campo **opcional** anadido deja los dos tipos mutuamente
asignables, que es la forma exacta de tres de los cuatro hallazgos de arriba. Verificado rompiendo
la interfaz a proposito con los tres tipos de deriva antes de dar la congelacion por buena.

`frozen.test.ts` cubre lo que el compilador no ve por ser valores y no tipos: los nombres de las
capacidades, de los metodos y de las seis herramientas. Renombrar `campus.find_room` no es una
refactorizacion: ese nombre esta en el video, en la guia de adopcion y en cualquier cliente que una
institucion ya haya apuntado a su servidor.

**ENMENDADA DOS VECES el 17-09-2026**, ambas por el procedimiento que esta misma decision
describe: `rooms` en `room-inventory` y `room-availability` (ADR-019), e `issues` en
`issue-reporting` e `issue-tracking` (ADR-017). Lo que paso, en orden: el compilador fallo
en `frozen.ts` senalando tres lineas, se actualizo la instantanea **a mano**, se repasaron los dos
adaptadores y las seis herramientas, y seis tests del contrato se pusieron en rojo y hubo que
decidir uno por uno si el cambio era correcto. Uno de ellos —"acepta `issue-reporting` declarada
sola"— fallaba porque la comprobacion de dependencias nueva funcionaba.

La fecha de congelacion **no se reinicia**. Una congelacion que reiniciase el reloj cada vez que
alguien cambia algo seria un registro de cambios, no una congelacion; lo que la fecha dice es cuando
el contrato dejo de moverse *por defecto*, y eso sigue siendo cierto. `frozen.ts` lleva ahora
`AMENDED_ON` al lado de `FROZEN_ON`.

Y es un argumento a favor de haber congelado: el contrato aguanto cuatro hitos, dos adaptadores, el
despliegue gestionado, OAuth y las trazas sin moverse, y lo primero que de verdad lo tenso fue una
capacidad que nadie habia construido todavia.

**Consecuencia** — Si M4 o M5 necesitan mover el contrato, se actualiza la instantanea a mano y se
anota aqui. El riesgo se evaluo antes de congelar: OAuth 2.1 vive en la capa de servidor e
identidad y `RequestContext.principal` existe ya para eso, asi que no deberia tocarla.

---

## ADR-007 · Los criterios de aceptacion viven en ingles, junto a los tests

**Decision** — `docs/use-cases.md` esta en ingles y es la **unica** fuente de los criterios de
aceptacion. `_hilo/FUNCIONALIDADES.md` enlaza a el en vez de duplicarlos.

**Razon** — Cada criterio se convierte literalmente en un test de contrato en M1; el fichero
acompana a los tests. Mantener una copia traducida garantiza que las dos versiones diverjan en cuanto
cambie una.

**Consecuencia** — Nomenclatura vigente: **UC-01…UC-07** (la del runbook en PDF, `CU-xx`, esta
obsoleta).

---

## ADR-008 · Licencia Apache-2.0

**Decision** — Apache-2.0, en el repositorio publico **desde el primer commit**.

**Razon** — El publico objetivo del proyecto incluye responsables de TI y oficinas de proteccion de
datos institucionales. La concesion expresa de patentes de Apache-2.0 es lo que miran esos
departamentos juridicos; MIT (lo habitual en el ecosistema Node) no la tiene. Ademas, "repositorio
publico con licencia abierta desde el primer commit" es entregable de M0 y requisito del mini-reto de
codigo abierto.

---

## ADR-010 · El orquestador no activa el razonamiento extendido

**Fecha** 2026-09-15 · **Estado** Aceptada · **Categoria** Rendimiento

**Contexto** — Nova 2 Lite es un modelo de razonamiento hibrido. El `reasoningConfig` viene
`disabled` por defecto en la API, pero el playground de la consola lo enciende: una pregunta de 131
tokens devolvio 361 de salida en **5 293 ms**, mas de diez veces el presupuesto de plataforma.

La documentacion recomienda `maxReasoningEffort: "medium"` precisamente para «agentic workflows that
coordinate multiple tools», que es exactamente lo que hace nuestro orquestador. Es una recomendacion
tentadora y la rechazamos a proposito.

**Decision** — El orquestador llama a `converse` **sin** `reasoningConfig`, quedandose en el
comportamiento por defecto («efficient latent reasoning, optimal for everyday tasks and high-volume
applications»).

**Razon** — El presupuesto es **500 ms de ida y vuelta** y no es negociable: lo fija la plataforma
Alexa+. Un turno hablado que tarda cinco segundos no es una respuesta lenta, es una conversacion
rota. Precision extra no sirve de nada si el altavoz se queda callado mientras tanto.

**Consecuencias**

- Los tokens de razonamiento se facturan como tokens de salida, asi que apagarlo tambien abarata.
- Si la precision resultara insuficiente, el orden correcto es primero mejorar el prompt y las
  descripciones de las herramientas, y solo despues plantearse `low` **midiendo** el coste en
  latencia. Nunca al reves.
- La medicion de latencia de M1 se extiende al orquestador en M3: es donde este ADR se verifica o
  se cae.

---

## Decisiones del entorno de trabajo

| Decision | Razon |
|---|---|
| El Hilo y `CLAUDE.md` se adaptan a TypeScript/Node | El ecosistema hv asume .NET. Dejar los estandares C# haria que `CLAUDE.md` contradijese al proyecto |
| `ecosystem.config.json` omite el bloque `database` | Su enum solo admite motores SQL y Lodge usa DynamoDB, y solo en el destino gestionado. Omitirlo es valido; inventar un motor no lo seria |
| Los hitos M0-M6 del runbook son los evolutivos del Hilo | Hace que `/hv:estado` y `/hv:continuar` trabajen contra el plan real en lugar de contra una lista paralela |
| Los PDF no entran en el repositorio | 1,4 MB de binario cada uno y su papel ya es de archivo historico. El documento vivo es `RUNBOOK.md` |

---

## ADR-009 · MCP 2025-11-25 como revision objetivo, sin estado por transporte

**Fecha** 2026-09-14 · **Estado** Aceptada · **Supera a** ADR-005

**Contexto** — El runbook fijaba MCP 2026-07-28 como revision principal y 2025-11-25 como
«degradacion al minimo exigido». Verificado contra dos fuentes primarias:

1. La documentacion del **Alexa+ MCP Toolkit**: «Alexa+ supports the 2025-11-25 version of the MCP
   specification». Alexa+ es la superficie que se juzga en el track.
2. El codigo del **SDK de TypeScript**: `LATEST_PROTOCOL_VERSION = '2025-11-25'`, y la 2026-07-28
   **no figura** en `SUPPORTED_PROTOCOL_VERSIONS`.

La premisa estaba invertida: 2025-11-25 no es el suelo, es el objetivo.

**Decision** — Apuntar a **MCP 2025-11-25** como revision objetivo, con el servidor **sin estado**
activado por opcion del transporte, y dejar montado el handler multi-era para cuando el SDK soporte
revisiones posteriores.

**Razon** — Fijar una revision que el cliente no habla habria costado el track entero. Y el argumento
arquitectonico que motivaba la 2026-07-28 **no se pierde**: el modo sin estado es una opcion de
`WebStandardStreamableHTTPServerTransportOptions` (no emite identificador de sesion ni lo valida), no
una propiedad de aquella revision. Un servidor sin estado se sigue replicando sin coordinacion, que
es lo que necesita algo pensado para desplegarse en infraestructura ajena.

**Consecuencias**

- `server/discover` y `subscriptions/listen` dejan de ser el camino principal. El SDK expone
  negociacion de version (`legacy` | `auto` | `pin`) y `createMcpHandler(({ era }) => ...)`; se usa el
  handler multi-era para no tener que reabrir la interfaz de proveedor cuando llegue una revision nueva.
- **OAuth 2.1 con PKCE (S256) sube de M4 a la ruta critica**: es obligatorio para conectar con Alexa+,
  no una mejora de identidad. El parametro `resource` apunta al URI canonico del servidor.
- El presupuesto de latencia deja de ser cualitativo: **< 500 ms ida y vuelta**, limite de plataforma.
- En desarrollo local hace falta un tunel (p. ej. `cloudflared`): Alexa+ exige URL remota.


---

## ADR-011 · La confirmacion viaja como argumento, no como peticion al cliente

**Contexto** — UC-05 es `essential` y exige que no exista ningun parte sin confirmacion. Estaba
implementado con `input_required`, que era la eleccion correcta frente a `elicitInput` porque no
bloquea (ADR-009). Al conectar el demostrador por HTTP real aparecio esto:

> `Cannot request input 'confirm' (elicitation/create): ... per-request legacy serving cannot
> receive server-to-client requests`

En una conexion de era 2025 el SDK entrega un `input_required` **como una peticion
`elicitation/create` del servidor al cliente**, y sobre Streamable HTTP servido por peticion ese
canal no existe. UC-05 funcionaba en los tests y en ningun contenedor.

**Decision** — `campus.report_issue` recibe un argumento `confirmed`. La primera llamada valida el
aula y el equipo, devuelve la pregunta hablada y **no escribe nada**. La segunda, con
`confirmed: true`, abre el parte y dice la referencia.

**Razon** — Funciona en cualquier era del protocolo y sobre cualquier transporte, porque son
argumentos y resultados de herramienta y nada mas. Y es, literalmente, lo que hace un altavoz:
pregunta, la persona dice que si, y entonces actua. El criterio de aceptacion de UC-05 no habla de
`input_required` sino de que no exista parte sin confirmacion, y eso se cumple: la primera llamada
no escribe.

**Lo que se pierde** — La elicitacion permite al cliente dibujar un dialogo de confirmacion de
confianza, ajeno al modelo. Con un argumento, quien decide que la persona dijo que si es el modelo.
Se acepta porque la alternativa no es un dialogo mejor: es que no haya confirmacion ninguna.

**Consecuencia** — Un solo camino, no dos. Mantener la elicitacion "para cuando haya sesion" seria
mantener un camino que solo recorren los tests, que es exactamente como se colo este fallo. Si una
revision futura del SDK permite negociar 2026-07-28, el sobre `_meta` vuelve a estar disponible y
`input_required` vuelve a ser el mecanismo preferible; entonces se revisa esta decision.

---

## ADR-012 · Las tarjetas se adjuntan salvo que el cliente diga que no tiene pantalla

**Contexto** — La regla era la contraria: adjuntar solo si el cliente declara la extension de UI.
Sobre Streamable HTTP `createMcpHandler` construye un `McpServer` por peticion, asi que
`getClientCapabilities()` devuelve `null` en toda llamada a herramienta — con estado o sin el. Las
capacidades solo las conoce el `initialize`, que ocurrio en otra peticion y en otra instancia. Las
tarjetas se dibujaban en todos los tests y en ningun despliegue, porque los tests usan un transporte
en memoria, que es la unica forma en la que la regla vieja funcionaba.

**Decision** — Adjuntar salvo que sepamos que no hay pantalla. Tres casos:

| Lo que llega | Que se hace | Por que |
|---|---|---|
| El cliente declara pantalla | Adjuntar | La ha pedido |
| Declara sus capacidades y ninguna es pantalla | No adjuntar | Contesto, y la respuesta fue no |
| No llega ninguna capacidad | Adjuntar | No saber no es lo mismo que que te digan que no |

**Razon** — La extension de MCP Apps esta disenada para que un cliente que no sepa representar
`text/html;profile=mcp-app` **ignore** el bloque. Y la respuesta hablada es completa por si sola —
hay un test que lo comprueba palabra por palabra, con pantalla y sin ella. De las dos formas de
equivocarse, mandarle bytes de mas a un altavoz es la barata; la cara es que una tablet no vea nunca
una tarjeta.

**Consecuencia** — El sobre `_meta` por peticion se lee primero y es la respuesta del protocolo a
esto, pero hoy solo se auto-emite en conexiones 2026-07-28 y este SDK negocia 2025-11-25 como
maximo. Queda puesto para cuando eso cambie.

---


## ADR-013 · Lodge es servidor de recursos, nunca servidor de autorizacion

**Contexto** — Alexa+ exige OAuth 2.1 con authorization code + PKCE (S256) para conectar. La
pregunta no es si hay OAuth, sino **quien emite los tokens**.

**Decision** — Lodge no emite ninguno. Publica un documento RFC 9728 en
`/.well-known/oauth-protected-resource/...` que dice cual es su URI canonico y en que servidor de
autorizacion confia, y verifica las firmas de ese servidor. El PKCE ocurre entre el cliente y ese
servidor; Lodge no lo ve. La institucion escribe dos lineas en su fichero de configuracion:
`issuer` y `jwksUri`.

**Razon** — Es la tesis del runbook aplicada a la identidad. Una institucion que tiene directorio
casi seguro tiene un proveedor OIDC delante, y lo que nadie quiere desplegar es **un segundo sitio
donde vivan las contrasenas de sus estudiantes**. Nombrar un emisor es una tarde; operar un
proveedor de identidad es un proyecto. Un servidor MCP que ademas fuera IdP dejaria de ser algo que
se instala en una tarde, que es la promesa entera.

**La parte que se gana el sueldo** — El token se verifica contra el **URI canonico de esa
institucion** (RFC 8707), no solo contra la firma y el emisor. Un mismo proceso responde por varias
instituciones (UC-07), asi que sin esa comprobacion un token de Carrigmore valdria en San Telmo:
firma buena, emisor bueno, institucion equivocada. Hay un test que lo comprueba, y se verifico que
falla al quitar la comprobacion antes de darlo por bueno.

**Consecuencia** — El `jwksUri` se exige en la configuracion en vez de descubrirse desde el emisor.
Descubrirlo significaria una llamada de red al IdP de la institucion antes de que Lodge pueda
responder nada, convirtiendo una caida breve suya en una nuestra. Y el claim del sujeto es
configurable (`subjectClaim`), porque `sub` suele ser un identificador opaco del proveedor mientras
el adaptador indexa por lo que reconoce el directorio.

**Lo que queda fuera** — Registro dinamico de clientes y Client ID Metadata Documents. Son cosa del
servidor de autorizacion, no del de recursos.

---


## ADR-014 · En el destino gestionado solo persisten los avisos

**Contexto** — El destino gestionado corre en Lambda, donde "en memoria" significa *la memoria de
este contenedor*: un aviso dado en una invocacion es invisible para la siguiente. UC-06 —perseguir
el parte que acabas de dar— funcionaria o no segun que contenedor respondiese, que es peor que no
funcionar.

**Decision** — Una tabla de DynamoDB con **solo la cola de incidencias**. Los avisos sembrados de la
Universidad de San Telmo **no entran en la tabla**: viven en el codigo y se mezclan al leer.

**Razon** — El conjunto de datos de San Telmo es generado y determinista, y eso es una promesa del
proyecto: quien clone el repositorio obtiene las respuestas del video. Sembrar la tabla al desplegar
introduce un paso que puede quedarse a medias, una migracion que mantener, y la posibilidad de que
dos despliegues respondan distinto a la misma pregunta. Mezclando al leer no hay paso de siembra, no
hay migracion y un despliegue recien creado ya contesta UC-06.

**Consecuencia sobre el esquema** — Particionada por quien dio el aviso, que es la unica pregunta
que se le hace: `campus.issue_status` devuelve lo tuyo y nada mas. Sin indices y sin scans. El
contador de referencias comparte tabla bajo una clave de particion que ningun `sub` puede ser, y es
atomico: dos personas dando parte del mismo proyector a la vez tienen que recibir referencias
distintas.

**Permisos** — `Query`, `PutItem` y `UpdateItem`, y nada mas. `grantReadWriteData` habria concedido
tambien `Scan` y `DeleteItem`; un parte de averia no es nuestro para borrarlo, y un permiso concedido
por comodidad es uno que nadie vuelve a revisar.

**El interruptor del sandbox** — `LODGE_DEV_IDENTITY` deja que cualquiera diga quien es, y
`identity.ts` fija que su unico valor por defecto seguro es apagado. La pila lo respeta: hace falta
`-c sandbox=true`. Encenderlo es defendible **en este despliegue concreto** porque
`src/lambda/handler.ts` construye el proveedor sintetico y ningun otro — no hay camino de
configuracion desde esta pila hasta los datos de una institucion real, asi que lo peor que puede
exponer es una universidad ficticia. Esa propiedad es estructural, no una promesa.

---


## ADR-015 · Instrumentar siempre, exportar solo si lo piden

**Contexto** — La capa 09 de la arquitectura pide OpenTelemetry. El SDK completo son trece
paquetes, y Lodge se autoaloja en la infraestructura de otros: cada dependencia es algo que alguien
tiene que aprobar.

**Decision** — El codigo depende de `@opentelemetry/api`, que **no tiene dependencias** y es un
no-op mientras nadie registre un proveedor. Los tramos existen siempre y no cuestan nada. El
exportador se carga con `import()` dinamico y **solo** si hay `OTEL_EXPORTER_OTLP_ENDPOINT`: un
despliegue sin colector nunca toca esos trece paquetes.

**Razon** — Es el patron idiomatico para una libreria: la libreria instrumenta, la aplicacion
cablea. Lodge es las dos cosas, asi que hace las dos, pero por separado. Y quien prefiera el camino
estandar —arrancar Node con `--import` y su propio arranque de SDK— encuentra los tramos sin que
este fichero intervenga.

**Lo que lo hace valer la pena en un servidor MCP** y no ser higiene generica: **la traza continua
la del que llama**. Un estudiante pregunta a Alexa+, el agente llama a `campus.find_room`, y la
institucion ve **un solo dibujo** desde la pregunta hasta la consulta LDAP que provoco. Eso solo
funciona si se recoge el contexto W3C que trae la peticion en vez de empezar una traza nueva, y un
tramo con traza nueva se ve identico en el codigo. Hay tres tests sobre eso, y se comprobo que
fallan al quitar la extraccion.

Dos sitios de donde recogerlo, porque MCP viaja sobre mas de un transporte: la cabecera
`traceparent` sobre HTTP, y el `_meta` de la peticion para transportes que no tienen cabeceras
(stdio). Los nombres son los mismos, asi que un solo extractor sirve; gana el `_meta`, porque lo
puso el cliente del *protocolo* y no el ultimo proxy que toco la conexion.

**Donde hay tramos** — Uno por peticion, en la frontera donde se mide el presupuesto de 500 ms. Y
debajo, solo lo que de verdad va a algun sitio: la consulta al directorio y la lectura de un
calendario. El del directorio envuelve la consulta real y no la cache, asi que **que el tramo exista
significa que la cache fallo**; una traza sin el se respondio de memoria.

**Lo que no se registra** — La URL de un feed iCalendar. Suele llevar dentro el token de
suscripcion que lo hace funcionar, y una traza es justo donde esas cosas se guardan, se buscan y se
comparten. Se anota el host y ya.

**Presupuesto** — Exportacion por lotes, nunca sincrona. Esperar a un colector dentro de una
peticion seria gastar el presupuesto de latencia en telemetria sobre el presupuesto de latencia.
En Lambda es la excepcion: el contenedor se congela al devolver, asi que ahi se vacia antes de
retornar — y ese coste solo lo paga quien configuro un colector.

---


## ADR-016 · La demostracion publica es una segunda funcion, con tope diario duro

**Contexto** — El endpoint MCP desplegado lo puede usar entero quien tenga un cliente MCP. Quien no
lo tenga ve JSON y tiene que fiarse del video. Un jurado no deberia tener que instalar nada.

**Decision** — Desplegar tambien la pagina, como **una segunda Lambda que habla con la primera por
HTTP**, y ponerle un **tope diario** de preguntas respaldado por DynamoDB.

**Por que dos funciones y no una** — Porque lo que se demuestra es que Lodge es un servidor con el
que puede hablar el agente de cualquiera. Una demostracion que metiera la mano en el proceso
demostraria otra cosa. Cuesta una ida y vuelta y es exactamente lo que hace `npm run demo` en local,
asi que ademas las dos disposiciones son la misma y no divergen.

**Por que un tope y no un limite por IP** — Limitar por direccion tiene la forma equivocada aqui:
una sala llena de jurados detras de un NAT es justo quien no debe ser estrangulado, y quien quiera
agotar el presupuesto usara mas de una direccion. Lo que importa es que el total este acotado. Son
500 preguntas al dia, contadas **antes** de responder: contarlas despues dejaria pasar una rafaga
entera, que es el unico caso para el que existe el tope.

Al agotarse devuelve `429` con una frase util — el video ensena lo mismo y `npm run demo` lo corre
en local sin limite — en vez de una pagina rota. La pagina y el catalogo se siguen sirviendo, porque
no cuestan nada.

**Permisos** — La funcion puede invocar **un** modelo, nombrado por ARN de perfil de inferencia, e
incrementar **un** contador. Nada mas.

**Consecuencia** — Es la unica parte de Lodge que gasta dinero por pregunta, y por eso la unica que
vive detras de `-c sandbox=true`. La pagina desplegada sirve solo San Telmo: los ficheros de
Carrigmore no estan en el paquete de esa funcion, y ofrecer el cambio de institucion seria ofrecer
un boton que falla. Ese momento esta en el video y en `npm run demo`, donde es real.

---


## ADR-017 · `issues` se parte en abrir y consultar

**Contexto** — Hasta hoy una sola capacidad, `issues`, obligaba a implementar `reportIssue` **y**
`issueStatus`. Al ponerse a integrar un gestor de incidencias real aparecio el problema: una mesa de
servicio a la que se llega por correo puede **recibir** un parte y no puede responder "como va el
mio". Esa institucion tendria que declarar una herramienta que no funciona, que es exactamente el
fallo que la negociacion de capacidades existe para impedir.

**Decision** — Dos capacidades: `issue-reporting` (publica `campus.report_issue`) e `issue-tracking`
(publica `campus.issue_status`). Una institucion declara las que pueda.

**Y una dependencia entre capacidades**, que es nueva en el modelo: `issue-reporting` exige `rooms`.
Dar un parte comprueba que el aula existe y que tiene ese equipo **antes** de pedir confirmacion, asi
que sin `rooms` la herramienta reventaria en su primera llamada. Se comprueba al cargar, con todo lo
demas. La alternativa —dejar que la herramienta se degrade y abrir un parte contra un aula que nadie
encuentra— convierte un error de configuracion en un aviso de mantenimiento para un aula inexistente.

**Lo que cuesta** — La dependencia es a nivel de *capacidad*, no de metodo, y eso es mas estricto de
lo que suena: `rooms` exige a su vez inventario **y** horario, asi que una institucion con gestor de
incidencias y lista de aulas pero sin horario no puede dar partes. Se acepta porque "las capacidades
dependen de capacidades" es el modelo mas simple de mantener honesto; si a alguien le aprieta, lo
siguiente que se parte es `rooms`, y la congelacion volvera a hacerlo deliberado.

---

## ADR-018 · Los partes van al sistema que la institucion ya vigila

**Contexto** — Un proyector roto tiene que llegar a quien arregla proyectores, y esa gente no mira
una cola que Lodge se invento: mira la que ya tiene abierta.

**Decision** — El adaptador de estandares escribe hacia fuera, y el destino lo elige la institucion
en su fichero de configuracion. **Exactamente uno**: dos abririan dos avisos por el mismo proyector.

**El orden en que se han construido importa, y no es el que se pide primero:**

| | Puede | Por que en este puesto |
|---|---|---|
| **Webhook** | Abrir | Sin proveedor, sin libreria y sin cuenta. Se publica un payload documentado y la institucion lo conecta a lo que tenga |
| **Jira** | Abrir y consultar | El ejemplo trabajado de un gestor de verdad, porque puede con las dos cosas y porque es el que la gente pregunta |
| **Correo** | Abrir | El unico de los tres que de verdad es un estandar que ya tienen todas. Una dependencia, `nodemailer`, que no tiene ninguna suya |

**Detalles que no son obvios:**

En el **correo**, al reves, Lodge **si** acuna la referencia y la escribe en el asunto. No es una
incoherencia con lo de abajo: un webhook pertenece a un sistema que asigna las suyas, y un buzon no
asigna nada hasta que alguien tria el mensaje. Hasta entonces no existe identificador ninguno, y el
del asunto es lo unico que ambas partes pueden buscar. El alfabeto evita O, 0, I, 1 y L, porque esa
referencia la dice un sintetizador, la repite una persona y la teclea alguien en una mesa.

En el **webhook**, la referencia se exige, no se inventa. Es lo que la persona cita luego en la mesa de servicio;
darle un numero nuestro seria darle uno que no significa nada para quien se lo va a decir. Si el
endpoint no devuelve referencia, el parte falla y se dice.

En **Jira** se atribuye con una **etiqueta** (`lodge-<subject>`) y no con el campo `reporter`, porque
eso ultimo exigiria una cuenta de Jira por estudiante, que es una conversacion de licencias y no una
integracion. `openedBy` busca por esa etiqueta, asi que el limite de privacidad esta en la consulta
y no en un filtro aplicado despues.

El **estado** se mapea desde la *categoria* de Jira y no desde el nombre del estado, que cada
proyecto renombra a su gusto.

Los errores de Jira **no se repiten hacia fuera**: sus cuerpos llevan nombres de campos y detalles de
configuracion del proyecto, y ese mensaje llega a una persona por un altavoz.

**Consecuencia para la demostracion** — Carrigmore sigue **sin** configurar destino a proposito. Que
no pueda dar un parte es lo mas convincente que hace la demostracion: el agente no se niega, es que
no puede, porque la herramienta nunca estuvo en el catalogo que le dieron.

---


## ADR-019 · `rooms` se parte en saber cuales hay y saber cuales estan libres

**Contexto** — Una sola capacidad `rooms` obligaba a `findFreeRooms`, `getRoom` y `listRooms`, y el
adaptador de estandares solo la declaraba con inventario **y** horario, porque sin ocupacion no se
puede decir que un aula esta libre.

Al enchufar los destinos de incidencias (ADR-018) eso dejo una consecuencia que nadie defenderia en
voz alta: **una institucion que no puede exportar su horario tampoco puede dar parte de un proyector
roto.** Dar un parte necesita saber que el aula existe y que tiene ese equipo. Nada mas. La ocupacion
no pinta nada ahi.

**Decision** — Dos capacidades:

| | Obliga | Necesita | Publica |
|---|---|---|---|
| `room-inventory` | `getRoom`, `listRooms` | la tabla de aulas | **nada** |
| `room-availability` | `findFreeRooms` | la tabla **y** la ocupacion | `campus.find_room` |

Y dos dependencias: `room-availability` exige `room-inventory` —su tarjeta ensena la rejilla entera,
no solo lo libre— e `issue-reporting` tambien.

**Lo raro, dicho a proposito** — `room-inventory` **no publica ninguna herramienta**. Es la primera
capacidad asi, y describe un hecho sobre la institucion —"se que aulas tengo"— en el que se apoyan
otras dos. "Enumerame todas las aulas" no es una pregunta que nadie le haga a un altavoz.

**Lo que desbloquea** — Una lista de aulas en CSV y una direccion de correo bastan ahora para dar
partes. Eso es exactamente lo que el runbook promete: se despliega con lo que la institucion ya
tiene, y lo que no tenga simplemente no se publica.

**Como se hizo** — El compilador fallo en tres lineas de `frozen.ts`, se actualizo la instantanea a
mano, y cayeron **trece tests**. Diez eran del contrato y habia que decidirlos uno a uno. Los otros
tres eran de latencia y resultaron ser otra cosa: la suite habia crecido lo bastante como para que un
test que mide milisegundos de reloj con veinticuatro workers compitiendo midiera el planificador. Uno
de ellos ni siquiera fallaba su asercion — se agotaba su tiempo antes de llegar a ella. Reformulados
como guardias de regresion, con la medida de verdad donde de verdad esta: 214 ms contra el servidor
desplegado.

---
