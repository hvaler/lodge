# Deuda Tecnica y Riesgos

> **INSTRUCCIONES PARA CLAUDE**: registro de riesgos, deuda y asuntos abiertos. Consultalo antes de
> proponer trabajo nuevo y anade aqui lo que aparezca.
>
> Estado a **14-09-2026** (cierre del onboarding). El codigo aun no existe: M0 arranca el 15 de
> septiembre. Por eso no hay deuda de implementacion todavia — lo que hay son **riesgos con fecha**.

---

## Riesgos

### 🔴 ALTO · Dos candidaturas, un equipo

Lodge y **LREA** compiten por el mismo tiempo. Llevar dos proyectos en paralelo es la forma mas
fiable de entregar dos cosas a medias.

**Mitigacion** — Las reglas de corte, con fecha concreta y sin reunion de por medio. Lodge tiene
prioridad. **El 14 de octubre es el punto de no retorno**: si ese dia no hay demostracion de punta a
punta, se abandona LREA. Una candidatura terminada vale mas que dos a medias.

### 🔴 ALTO · La abstraccion se come el calendario

Disenar "para cualquier institucion" es donde se pierde una semana sin darse cuenta.

**Mitigacion** — Dos adaptadores, ni uno mas. **La interfaz de proveedor se congela al cerrar M1** y
a partir de ahi solo se implementa.

### 🟡 MEDIO · Lo generico demuestra peor

Un video sobre algo configurable emociona menos que uno sobre un sitio con nombre propio.

**Mitigacion** — San Telmo con detalle suficiente, y UC-07 (el estudiante de intercambio)
convirtiendo la genericidad en el momento espectacular en lugar de en una nota al pie.

### 🟡 MEDIO · El registro de complementos de Alexa+ esta cerrado

Limitado a socios seleccionados y a un solo pais (EE. UU.). No se puede publicar un complemento
oficial.

**Mitigacion** — Las reglas admiten un servidor MCP autoalojado con la experiencia simulada en
aplicacion web propia. Ese orquestador se construye una vez, **se publica**, y suma en el mini-reto
de codigo abierto.

### 🟡 MEDIO · UC-05 depende de que el cliente soporte elicitation

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
2. **Perfil EU** (`eu.amazon.nova-2-lite-v1:0` desde `eu-west-1`). Ahorraría el salto atlántico.
   Bloqueado hoy: esa región seguía dando `AccessDeniedException` por verificación cuando US ya
   funcionaba, así que la verificación parece ir por regiones.

---

## Reglas de corte

Aplicables **sin convocar una reunion**. Tienen fecha, no criterio.

| # | Disparador | Recorte |
|---|---|---|
| 1 | M2 se pasa del **4 de octubre** | El adaptador de estandares se recorta a calendarios e inventario; el directorio LDAP queda fuera |
| 2 | M3 se pasa del **11 de octubre** | Caen las tarjetas visuales. La voz sola cumple el track |
| 3 | El **14 de octubre** no hay demostracion de punta a punta | Se abandona LREA y todo el equipo pasa a Lodge |

Transversal a las tres: los casos `essential` de `docs/use-cases.md` sobreviven a cualquier recorte;
los `improvement` (hoy solo UC-06) caen primero.

---

## Abierto ahora mismo (M0, arrancado el 14 sep)

| Asunto | Estado | Fecha limite |
|---|---|---|
| Repositorio publico con licencia en el primer commit | ✅ https://github.com/hvaler/lodge, Apache-2.0 | hecho 14 sep |
| Universidad de San Telmo | ✅ definicion cerrada en `docs/san-telmo.md` | hecho 14 sep |
| Creditos AWS de participacion (150 $) | ⬜ formulario sin enviar | cuanto antes |
| Cuenta AWS con acceso a Bedrock en `us-east-1` | ⬜ el AWS CLI no esta instalado en la maquina | 17 sep |
| Version de protocolo a la que apuntar | ⬜ **decision pendiente** tras verificar que Alexa+ habla 2025-11-25 | antes de M1, 18 sep |

---

## Administrativo del hackathon (verificado 14-09-2026)

Cifras y requisitos leidos de las bases y de la pagina de recursos, no del runbook.

| Asunto | Estado |
|---|---|
| **Plan de la cuenta AWS** | ⚠️ **Free plan** (confirmado 14-09-2026 por captura de la consola). El free tier nuevo son 100 $ inmediatos + hasta 100 $ por actividades, 6 meses, y la cuenta **se cierra sola** a los 6 meses o al agotar creditos |
| **Creditos de actividades: 100 $** | ⬜ 0 de 5 hechas. Dos estan en la ruta de Lodge: *modelo fundacional en el playground de Bedrock* (20 $, **es la verificacion que cierra M0**) y *aplicacion web con Lambda* (20 $, destino de M4). *AWS Budgets* (20 $) no es de Lodge pero conviene. EC2 y Aurora/RDS (40 $) estan fuera de ruta |
| **Bedrock en plan Free** | ⚠️ La pagina de free tier dice que **no cubre inferencia de Bedrock**, y AgentCore figura como exclusivo de plan de pago. El orquestador de M3 vive de Nova 2 Lite: verificar que se puede invocar desde este plan |
| **Creditos AWS de participacion: 150 $** | ⬜ https://forms.gle/GaHFxSbBQNG9Kti6A — **exige Devpost Profile URL**, asi que la cuenta de Devpost va primero. Se piden por **perfil de Devpost, no por proyecto**: son 150 $ para la persona, compartidos entre Lodge y LREA. Desplegable de dispositivo: Alexa+ (el formulario dice que se puede cambiar despues) |
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
| Varias candidaturas | ✅ Permitidas: «An Entrant may submit more than one Submission, however, each Submission must be unique and substantially different». LREA no esta bloqueada; el limite de un proyecto por pantalla es de la interfaz de Devpost, no de las bases |

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
