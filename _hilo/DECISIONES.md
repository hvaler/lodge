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
