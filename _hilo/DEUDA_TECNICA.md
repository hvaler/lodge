# Deuda Tecnica y Riesgos

> **INSTRUCCIONES PARA CLAUDE**: registro de riesgos, deuda y asuntos abiertos. Consultalo antes de
> proponer trabajo nuevo y anade aqui lo que aparezca.
>
> Estado a **17-09-2026**. M0 a M4 cerrados y desplegados; M5 escrito y el codigo terminado. Los riesgos marcados
> CERRADO se conservan con lo que acabo pasando, porque lo util de un registro de riesgos es
> saber cuales se cumplieron y cuales no.

---

## Riesgos

### 🔴 ALTO · Dos candidaturas, un equipo

Lodge y **la segunda candidatura del equipo** compiten por el mismo tiempo. Llevar dos proyectos en paralelo es la forma mas
fiable de entregar dos cosas a medias.

**Mitigacion** — Las reglas de corte, con fecha concreta y sin reunion de por medio. Lodge tiene
prioridad. **El 14 de octubre es el punto de no retorno**: si ese dia no hay demostracion de punta a
punta, se abandona la otra. Una candidatura terminada vale mas que dos a medias.

### ✅ CERRADO (16-09) · ALTO · La abstraccion se come el calendario

Disenar "para cualquier institucion" es donde se pierde una semana sin darse cuenta.

**Mitigacion** — Dos adaptadores, ni uno mas. **La interfaz de proveedor se congela al cerrar M1** y
a partir de ahi solo se implementa.

**Cerrado el 16-09**, once dias antes de la fecha de ADR-006 y sin gastar el margen: la interfaz
sobrevivio al segundo adaptador, a las tarjetas y al enrutado multi-institucion sin una vuelta
atras. `src/provider/frozen.ts` la sujeta en cada `npm run build`. Si hay que moverla en M4 o M5,
el build lo dice y queda anotado en ADR-006 — que es distinto de que se mueva sola.

### 🟡 MEDIO · Lo generico demuestra peor

Un video sobre algo configurable emociona menos que uno sobre un sitio con nombre propio.

**Mitigacion** — San Telmo con detalle suficiente, y UC-07 (el estudiante de intercambio)
convirtiendo la genericidad en el momento espectacular en lugar de en una nota al pie.

### 🟡 MEDIO · El registro de complementos de Alexa+ esta cerrado

Dos restricciones, las dos citadas, **revisadas de nuevo el 22-09-2026 y sin cambios**:

- **Quien.** *«Alexa+ for Builders is currently available to select partners working directly with
  our team»* — [la pagina de programa](https://developer.amazon.com/alexaplus/).
- **Donde.** *«The MCP Toolkit is available in the United States»* —
  [la pagina del toolkit](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html),
  actualizada el 3 de agosto de 2026.

No se puede publicar un complemento oficial.

> **Historia de este parrafo, que es una leccion en si misma.** Decia «y a un solo pais (EE. UU.)»
> sin cita; se retiro, porque una restriccion sin verificar no se afirma. El 22-09, al revisar si el
> registro se habia abierto, aparecio la fuente oficial: **la afirmacion era correcta y quien la
> retiro se equivoco al no buscarla mejor.** Retirar algo por falta de fuente es correcto; darlo por
> falso no lo era. Queda repuesta con el enlace.

> **Y la L-001 volvio a intentarlo el 22-09**, con el mismo mecanismo: un documento tecnico que
> explica el toolkit, el CLI y el registro con todo detalle, sin mencionar el acceso ni una vez. La
> ausencia de la restriccion en la documentacion tecnica no es su ausencia. Se comprobo en la pagina
> de programa antes de cambiar nada, y no habia cambiado nada.

**Mitigacion** — Las reglas admiten un servidor MCP autoalojado con la experiencia simulada en
aplicacion web propia. Ese orquestador se construye una vez, **se publica**, y suma en el mini-reto
de codigo abierto.

### ✅ CERRADO (16-09) · MEDIO · UC-05 depende de que el cliente soporte elicitation

Descubierto el 14-09-2026 al probar las herramientas contra un cliente MCP real. En una conexion de
**era 2025** —la que habla Alexa+ (ADR-009)— un resultado `input_required` se entrega como peticion
`elicitation/create` del servidor al cliente. Un cliente que no declare la capacidad `elicitation`
recibe un error en lugar de una peticion de confirmacion:

> «Cannot request input 'confirm' (elicitation/create): the client on this 2025-era connection did
> not declare the required capability»

UC-05 es **essential** y su criterio de aceptacion es que no exista ningun aviso sin confirmacion.
Si Alexa+ no soporta elicitation, `campus.report_issue` no puede confirmar y el caso no se cumple
tal como esta escrito.

**Mitigacion** — Verificar en el simulador o en las *office hours* antes de M3 si Alexa+ declara
`elicitation`. Si no lo hace hay dos salidas, y conviene decidir cual antes de que apremie:
confirmar en dos llamadas de herramienta (una que devuelve lo que se va a hacer y otra que lo
ejecuta), o que el orquestador propio —que es nuestro— declare la capacidad y confirme el.

**Cerrado el 16-09 con la primera de las dos salidas** (ADR-011), y resulto ser peor de lo que esta
entrada suponia. No hace falta que Alexa+ no declare `elicitation`: sobre Streamable HTTP servido
por peticion **no existe canal del servidor al cliente**, asi que la peticion no se puede enviar
aunque el cliente la soporte. El error real, con el demostrador conectado por HTTP:

> «... per-request legacy serving cannot receive server-to-client requests»

Ya no depende de lo que declare ningun cliente: la confirmacion es un argumento y una segunda
llamada. Queda de aqui que la segunda salida —"que nuestro orquestador declare la capacidad"— no
habria servido, porque el problema no estaba en el cliente. Ver tambien L-002.

### 🟢 BAJO · Datos y privacidad

El proyecto no toca ningun sistema real ni ninguna institucion existente.

**Mitigacion** — Datos generados, **no anonimizados**; comprobacion de secretos en integracion
continua; ninguna credencial institucional en el repositorio.

---

## Latencia: qué número aplica a qué

Medido el 16-09-2026 con el orquestador real contra Bedrock, desde España a `us-east-1`:

| Qué | Medido | Presupuesto | ¿Cumple? |
|---|---|---|---|
| **El servidor MCP respondiendo a una llamada de herramienta** | p95 muy por debajo | **500 ms** (límite de plataforma Alexa+) | ✅ con mucho margen |
| El turno completo del orquestador de demostración | 1 508 – 2 004 ms | — | n/a |
| **El turno completo sobre el despliegue, en caliente** (22-09) | mediana **1 505 ms**, p90 2 691 ms, n=6 | **8 s** (corte de una skill clásica) | ✅ |
| **El mismo turno en frío** (22-09) | **4 457 ms**, una medida | **8 s** | ✅ con ~3,5 s de margen |

### El corte de ocho segundos, medido el 22-09-2026

Antes de escribir una línea del puente a un dispositivo físico había que saber si el turno cabe en
el presupuesto de una **skill clásica** de Alexa, que corta a los 8 s. Medido contra el despliegue
real (Lambda → Lambda → Bedrock, desde España): **cabe.**

- **En caliente**, mediana 1 505 ms y p90 2 691 ms sobre seis preguntas. Es *más rápido* que en
  local, y tiene explicación: la función corre en eu-west-1, al lado de Bedrock, mientras que en
  local la llamada al modelo sale desde España.
- **En frío**, 4 457 ms. Es el número que decide, porque una skill que nadie ha invocado en un rato
  arranca en frío justo cuando la enciende quien graba. Deja unos 3,5 s de margen, y ahí dentro
  falta todavía la red entre el servicio de Alexa y nuestro extremo, que no podemos medir desde
  aquí.

**Dos cosas que conviene hacer si el puente se construye**, y ninguna es cara:

1. **Respuesta progresiva.** La API de Alexa permite mandar un «dame un segundo» mientras se
   trabaja. Es lo que hace cualquier skill seria y quita el riesgo del frío por completo.
2. **Concurrencia aprovisionada**, una instancia, solo mientras dure la grabación. Elimina el
   arranque en frío por unos euros.

> **Por confirmar contra la documentación vigente de Alexa** antes de construir: los 8 s son la
> cifra documentada para una skill clásica, pero no se ha verificado en esta ronda. Si fuese menos,
> la respuesta progresiva pasa de recomendable a obligatoria.

**La distinción importa y conviene no confundirla.** Los 500 ms que documenta Alexa+ son para *el
servidor MCP respondiendo a una llamada*, no para el turno conversacional entero: en un despliegue
real de Alexa+ el modelo lo pone Amazon y ese tiempo no es nuestro. Lo nuestro son las herramientas,
y ahí sobra margen.

Los 1,5–2 s del orquestador son de nuestra simulación, y se explican solos: **dos viajes al modelo**
—uno para elegir herramienta, otro para redactar— más la red España→Virginia, sobre ~3 170 tokens de
entrada que se reenvían en cada vuelta.

**Para el vídeo sí conviene bajarlo**, porque dos segundos de silencio en cámara se hacen largos:

1. **Prompt caching** (soportado, 5 min, mínimo 1K tokens). El prompt de sistema y las seis
   definiciones de herramienta son idénticos en cada vuelta: es exactamente el caso de uso.
2. ~~**Perfil EU**~~ — **hecho el 16-09**. Se desbloqueó solo; la verificación iba por regiones y
   EU tardó más. Medido con el orquestador completo, seis turnos por configuración desde España:

   | Configuración | Mediana | Mín | Máx |
   |---|---|---|---|
   | **EU · perfil EU** | **1 437 ms** | 1 203 | 1 840 |
   | EU · perfil GLOBAL | 1 479 ms | 1 345 | 1 573 |
   | US · perfil US | 1 669 ms | 1 489 | 2 378 |

   EU gana ~230 ms, un 14 %. Es el nuevo defecto, y no solo por velocidad: nombrar seis regiones
   europeas es una conversación más corta con una oficina de protección de datos que «en algún
   sitio de Estados Unidos». Un despliegue en US cambia una variable de entorno.

---

## Reglas de corte

Aplicables **sin convocar una reunion**. Tienen fecha, no criterio.

| # | Disparador | Recorte |
|---|---|---|
| 1 | M2 se pasa del **4 de octubre** | El adaptador de estandares se recorta a calendarios e inventario; el directorio LDAP queda fuera |
| 2 | M3 se pasa del **11 de octubre** | Caen las tarjetas visuales. La voz sola cumple el track |
| 3 | El **14 de octubre** no hay demostracion de punta a punta | Se abandona la otra candidatura y todo el equipo pasa a Lodge |

Transversal a las tres: los casos `essential` de `docs/use-cases.md` sobreviven a cualquier recorte;
los `improvement` (hoy solo UC-06) caen primero.

---

## Abierto ahora mismo (a 22-09)

Lo del envio no puede hacerlo quien escribio el proyecto, y hay una decision de codigo sin tomar:

| Asunto | Estado | Cuando |
|---|---|---|
| Grabar el video | ⬜ guion re-presupuestado a 2:47 sobre un limite duro de 3:00 | antes del 21 oct |
| **Que alguien AJENO recorra `docs/adopting.md`** y rellene el cronometro | ⬜ el entregable lo pide explicitamente, y validarla desde dentro no vale | antes del 21 oct |
| Revisar `docs/management/devpost-submission.md` antes de enviarlo | ⬜ lo redacto Claude y va con el nombre del autor | antes del 21 oct |
| Reenviar el formulario de creditos nombrando **Alexa+** | ⬜ el primero se rechazo por no nombrar ningun track; es UNO POR PERSONA | cuanto antes |
| Probar el altavoz en un Echo fisico y elegir con que backend se graba | ⬜ el simulador ya no ensena nada nuevo | antes de grabar |
| **Decidir si `dotnet/` entra en el texto de envio** | ⬜ se acordo dejarlo fuera; ahora existe y funciona, y callarlo tambien es una decision | antes del 21 oct |

### ✅ ARREGLADO (22-09) · MEDIO · `campus.timetable` se inventaba el motivo

**Encontrado el 22-09, sin decidir.** La herramienta solo acepta `when: today | tomorrow`
(`src/tools/index.ts:220`), cosa deliberada. Pero al pedirle «que tengo el jueves», el modelo
improvisa que «la agenda del jueves no esta disponible **en este momento**» y remite a la intranet.

No llega a violar UC-03 -no invento ningun horario-, pero **la excusa si es inventada**: sugiere una
caida temporal que no existe. Y eso es justo lo que el proyecto promete no hacer.

La causa probable es que el limite vive solo en el `enum` del esquema y no en la descripcion de la
herramienta, que dice unicamente «Your own timetable. Resolves against who you are signed in as, not
a name.». Nova 2 Lite no parece razonar del enum a «solo puedo con hoy o manana».

**ARREGLADO el mismo dia.** La descripcion pasa a decir el limite en prosa: «Your own timetable,
for today or tomorrow only - it cannot look further ahead than that.» Una linea, sin tocar la
interfaz congelada ni ningun test. Desplegado y verificado preguntando TRES veces, porque una sola
respuesta de un modelo con temperatura no prueba nada:

- «la agenda solo muestra horarios para hoy o manana, y el jueves no es uno de esos dias»
- «no esta disponible desde esta herramienta. Solo puedo mostrar la de hoy o manana»

Las tres nombran el limite real y NINGUNA dice «en este momento». La caida inventada desaparecio.

### ✅ ARREGLADO (22-09) · MEDIO · El modelo nombraba sitios donde mirar que no constaban

**Visto el 22-09 al verificar lo anterior.** Una de las tres respuestas remitio a «la intranet o
**la aplicacion movil del campus**». San Telmo NO TIENE aplicacion movil: no aparece en docs/, ni en
src/, ni en fixtures/. El modelo se la invento.

Es la misma familia que lo anterior y toca la regla 1 del prompt de sistema, que autoriza sugerir
«the registry» y nada mas. Declinar esta bien; inventarse donde mirar, no: un estudiante puede irse
a buscar una aplicacion que no existe.

**Se probo primero la frase en la regla 1**, prohibiendole nombrar otro canal. REDUJO EL PROBLEMA Y
NO LO ELIMINO: una de cada tres respuestas seguia mandando a «tu portal o aplicacion movil».

**La causa era otra, y la destapo el propio repaso.** `systemPrompt()` recibia institucion, idioma y
herramientas, y NO LA FECHA; el `now` del orquestador es un reloj monotono para medir tiempos, no un
calendario. **El modelo no sabia que dia era**, asi que cualquier pregunta que nombrase un dia de la
semana le obligaba a adivinar — y una respuesta llego a decir «hoy es miercoles» siendo martes, y
acto seguido se contradijo. Prohibirle inventar no le daba la informacion que le faltaba.

**Arreglado dandole la fecha**, en el idioma y la zona horaria de la institucion, igual que `dayOf()`
en la capa de herramientas. Verificado preguntando por el jueves CUATRO veces: las cuatro aciertan
que el jueves es el 24, que manana es miercoles 23, explican el limite real, y **ninguna inventa un
portal ni se equivoca de dia**. Dos dan ademas el consejo util: «vuelve a preguntar manana».

Repasados despues los cuatro planos del guion, porque ese prompt gobierna todas las respuestas:
aula libre, horario, las DOS vueltas del parte de averia (la segunda escribe y devuelve
INC-2026-0033) y el plano 5 en Carrigmore, este ultimo en las DOS implementaciones.

### 🟡 MEDIO · Los tests de TypeScript no se typechequean

**Encontrado el 22-09 por accidente, y es la leccion de la casa otra vez.** `tsconfig.json` tiene
`exclude: ['src/**/*.test.ts']`, asi que los 441 tests compilan pero **no pasan por el compilador**.
Se noto al hacer obligatorio un parametro de `systemPrompt()`: los tests seguian llamandola con uno
menos, seguian en verde, y el prompt que estaban comprobando decia literalmente «Today is undefined».

Peor: una docena de llamadas a `ask()` pasaban un contexto sin `timeZone`, es decir una forma que en
produccion no puede existir. Esas doce estan arregladas porque eran de este cambio.

**Lo que queda**: al quitar el `exclude` salen **8 errores mas**, todos previos y mecanicos — un
import que debe ser `type-only`, dos sobrecargas, cuatro conversiones desde `undefined` y un tipo de
aula en linea. Arreglarlos y quitar el `exclude` cerraria el agujero. No se hace ahora porque toca
ficheros de test ajenos al cambio a cuatro semanas del envio, y porque conviene decidirlo con la
cifra delante en vez de a ciegas.

### Lo que estaba abierto y se cerro

| Asunto | Como acabo |
|---|---|
| Repositorio publico con licencia en el primer commit | ✅ https://github.com/hvaler/lodge, Apache-2.0, 14 sep |
| Universidad de San Telmo | ✅ definicion cerrada en `docs/san-telmo.md`, 14 sep |
| Cuenta AWS con acceso a Bedrock | ✅ verificado el 15 sep respondiendo en plan Free; el 16 sep la pila CDK estaba desplegada en eu-west-1 y medida a 214 ms de mediana desde Espana |
| Version de protocolo a la que apuntar | ✅ **2025-11-25** (ADR-009), con handler multi-era para revisiones posteriores. Decidido antes de M1, que cerro el 16 sep |

---

## Administrativo del hackathon (verificado 14-09-2026)

Cifras y requisitos leidos de las bases y de la pagina de recursos, no del runbook.

| Asunto | Estado |
|---|---|
| **Plan de la cuenta AWS** | ⚠️ **Free plan** (confirmado 14-09-2026 por captura de la consola). El free tier nuevo son 100 $ inmediatos + hasta 100 $ por actividades, 6 meses, y la cuenta **se cierra sola** a los 6 meses o al agotar creditos |
| **Creditos de actividades: 100 $** | ⬜ 0 de 5 hechas. Dos estan en la ruta de Lodge: *modelo fundacional en el playground de Bedrock* (20 $, **es la verificacion que cierra M0**) y *aplicacion web con Lambda* (20 $, destino de M4). *AWS Budgets* (20 $) no es de Lodge pero conviene. EC2 y Aurora/RDS (40 $) estan fuera de ruta |
| **Bedrock en plan Free** | ⚠️ La pagina de free tier dice que **no cubre inferencia de Bedrock**, y AgentCore figura como exclusivo de plan de pago. El orquestador de M3 vive de Nova 2 Lite: verificar que se puede invocar desde este plan |
| **Creditos AWS de participacion: 150 $** | ⬜ https://forms.gle/GaHFxSbBQNG9Kti6A — **exige Devpost Profile URL**, asi que la cuenta de Devpost va primero. Se piden por **perfil de Devpost, no por proyecto**: son 150 $ para la persona, compartidos entre las dos candidaturas. Desplegable de dispositivo: Alexa+ (el formulario dice que se puede cambiar despues) |
| Presupuesto de nube | El *free tier* "es suficiente para empezar" segun las bases; 150 $ cubren Bedrock y Lambda de la demo |
| Video | Menos de 3 min **y publico en YouTube o Vimeo**. Debe mostrar el proyecto *funcionando en el dispositivo para el que se construyo* |
| Criterios de evaluacion | Tech Implementation · Design · Potential Impact · Quality of the Idea. **No estaban en el runbook** |
| Registro de friccion | Hasta **10 %** de bonificacion. Confirmado |
| Feedback de producto | Debe responder: que herramientas se usaron, que funciono, que hay que mejorar, como fue el *onboarding* y si volverias a construir con ellas |
| Repositorio | Publico, con fichero de licencia abierta, con **todo** el codigo, assets e instrucciones. ✅ hecho en M0 |
| Fecha limite | **23 oct 2026, 12:00 PDT** = 21:00 CEST. ✅ el runbook acertaba |
| **Elegibilidad** | ✅ **Espana no esta excluida.** La lista es: Brasil, Quebec, Rusia, Crimea, Cuba, Iran y Corea del Norte. Individuos, equipos y organizaciones admitidos |
| Periodo de envio | 31 ago 2026 10:15 PT - 23 oct 2026 12:00 PT. El primer commit (14 sep) entra de sobra en "creado despues del 31 de agosto" |
| Premios (Alexa+ 1.º) | 25.000 $ + 15.000 $ en creditos. Mini-retos: 5.000 $ + 5.000 $ en creditos cada uno, pero **un proyecto solo puede ganar UN mini-reto**: «A project can only win one (1) track prize and one (1) mini challenge prize» |
| **Techo real de Lodge** | **30.000 $** en metalico (25k + 5k) y **20.000 $** en creditos (15k + 5k). Optar a los dos mini-retos sigue mereciendo la pena: se gana uno |
| Varias candidaturas | ✅ Permitidas: «An Entrant may submit more than one Submission, however, each Submission must be unique and substantially different». La segunda no esta bloqueada; el limite de un proyecto por pantalla es de la interfaz de Devpost, no de las bases |

> **Correccion de una correccion (14-09-2026).** Se anoto aqui que el techo de creditos era 25.000 $
> en lugar de los 20.000 $ del runbook. Estaba mal: asumia que un proyecto podia ganar los dos
> mini-retos, y las bases lo limitan a uno. Las cifras buenas son 30.000 $ en metalico y 20.000 $
> en creditos — o sea, el runbook acertaba en los creditos y se pasaba en el metalico.

---

## Deuda asumida a proposito

| Decision | Por que se asume | Cuando se paga |
|---|---|---|
| Imagen LDAP del compose en namespace 'legacy' | Bitnami saco sus imagenes del namespace gratuito en 2025; se usa bitnamilegacy fijada por digest. Es un FIXTURE que sustituye al directorio que la institucion ya tiene, nunca parte de un despliegue real | Si molesta, cambiar a otra imagen OpenLDAP: el adaptador habla LDAP estandar |
| Solo dos adaptadores | Tres son orfebreria y se comen el calendario | Despues del hackathon: conectores a plataformas docentes |
| Sin conectores a plataformas docentes | Fuera de alcance explicito | Primer anadido natural post-hackathon |
| Interfaz congelada tras M1 | Sin congelacion no hay fecha de entrega creible | No se paga: es la pieza reutilizable del proyecto |
| `soluciones: []` y sin pipelines R25 en el Hilo | El modelo del ecosistema hv es .NET y aqui no aplica | No se paga |

---

## Fricciones del ecosistema

El ecosistema hv/Ovillo asume .NET (estandares C#, `dotnet build`, `.sln`, integracion con Visual
Studio, enum SQL en la configuracion). Lodge es TypeScript/Node sobre AWS. Lo adaptado durante el
onboarding queda anotado en `FEEDBACK_ECOSISTEMA.md`; no es deuda del proyecto, es cobertura del
ecosistema.

> **Registro de friccion del hackathon**: es un entregable aparte (hasta un 10 % de bonificacion) y
> se escribe **mientras duele, no al final** — arranca en M4. No confundirlo con este fichero.
