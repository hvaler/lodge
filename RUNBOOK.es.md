# Lodge

> La conserjería que no cierra.

Un servidor MCP autoalojado que responde por voz a las preguntas del campus —qué aula está libre, dónde se ha movido la clase, cuándo acaba el plazo— y que funciona sobre los sistemas que cualquier institución ya tiene.

| | |
| :-- | :-- |
| **Evento** | Build, Ship, Shape: Amazon Developer Hackathon 2026 |
| **Track primario** | Alexa+ · MCP |
| **Mini-retos** | AWS Builder · Open Source |
| **Prioridad** | Primera candidatura |
| **Envío interno** | 21 de octubre de 2026 |
| **Cierre** | 23 de octubre de 2026 · 21:00 CEST |

> **Estado:** documento vivo. El registro de decisión fechado el 14-09-2026 explica *por qué* se eligió esta forma; este fichero es lo que cambia mientras se construye.
>
> **Revisado el 14-09-2026** contra la documentación del Alexa+ MCP Toolkit, el código del SDK de MCP para TypeScript y las bases del hackathon. Cambian cuatro cosas: la revisión del protocolo (§7), que OAuth es obligatorio para conectar siquiera (§5), un número real para el presupuesto de latencia (§7) y los créditos de participación (§10). Lo que el runbook acertó: la fecha límite, el techo en metálico y la forma del proyecto.

---

## 1. La idea

Lo que sabe el conserje no está en ningún sistema: está repartido entre un horario colgado, un correo de secretaría, el calendario académico y veinte años de memoria. Y solo es accesible mientras la garita está abierta.

Lodge expone ese conocimiento como servidor MCP para que Alexa+ lo responda a cualquier hora. La decisión que lo define: **no se construye para una universidad concreta.** Se construye contra los estándares que todas usan ya —calendarios iCalendar, directorio LDAP, inventario de espacios en tabla— de modo que una institución lo despliega en una tarde en vez de encargar una integración.

**Por qué MCP y no un chatbot más.** Los asistentes de campus viven dentro de un widget, no se pueden componer y mueren con el contrato. Un servidor MCP es lo contrario: cualquier agente puede consumirlo. Hoy Alexa+ en un altavoz; mañana el asistente del portátil del estudiante o el de la plataforma docente. La institución publica sus capacidades una vez y deja de elegir cliente.

## 2. Actores

| Actor | Qué hace | Qué necesita |
| :-- | :-- | :-- |
| Estudiante | El grueso del volumen: aulas libres, horario, plazos, cómo llegar | Respuesta en segundos, sin sesión ni contexto previo |
| Docente | Aula asignada, tutorías, avisar de un equipo averiado | Fiabilidad: fallar cinco minutos antes de una clase es un problema real |
| Conserjería y mantenimiento | No hablan con el agente: *reciben* las incidencias | Que los avisos entren en la cola que ya miran |
| Responsable de TI | Despliega, integra y mantiene | Directorio, contenedor, actualizaciones. La guía es para él |
| Protección de datos | No usa nada. Puede vetar | Minimización por diseño, despliegue propio |
| Desarrollador tercero | Escribe el adaptador de su institución | Interfaz estable y documentación |
| Sistemas | Calendarios, directorio, inventario, gestor de incidencias | — |

Dos consecuencias gobiernan el proyecto:

1. **El vídeo le habla al estudiante y la documentación al responsable de TI.** Confundirlos pierde a uno de los dos.
2. **Una herramienta que abre incidencias solo sirve si escribe en la cola que mantenimiento ya revisa.** Generar avisos que nadie procesa es fracasar con el código impecable.

## 3. Alcance — la costura

Generalizar es el agujero de alcance clásico. La disciplina es numérica: un adaptador finge la costura, tres son orfebrería, **dos la obligan a ser real**.

| Adaptador | Origen | Para qué |
| :-- | :-- | :-- |
| `synthetic` | Generador determinista | Referencia, demostración, reproducibilidad. Es la Universidad de San Telmo |
| `standards` | iCalendar · LDAP · CSV | Lo que cualquier institución ya tiene, sin desarrollar nada |

**Fuera de alcance, explícitamente:** conectores para plataformas docentes concretas. Primer añadido natural *después* del hackathon.

**Negociación de capacidades.** Cada adaptador declara qué sabe hacer y en qué idioma, y el catálogo de herramientas se deriva de esa declaración. Una institución sin gestor de incidencias no publica esas herramientas, y el agente nunca ofrece lo que no existe.

## 4. La institución de demostración

**Universidad de San Telmo** — ficticia, completa, generada (no anonimizada).

- Tres edificios: Mendizábal, Santa Clara, El Faro, con plantas, aulas, aforos y equipamiento
- Seis titulaciones con cursos, grupos y solapamientos realistas
- Calendario académico: matrícula, exámenes, festivos
- Cero datos reales: ninguna persona, ninguna institución existente, ningún sistema en producción

## 5. Arquitectura

| # | Capa | Stack | Nota |
| :-- | :-- | :-- | :-- |
| 01 | Servidor MCP | TypeScript · Node 24 LTS · SDK oficial | Streamable HTTP, `server/discover`, sin estado |
| 02 | Interfaz de proveedor | Núcleo del proyecto | Capacidades e idioma. **Se congela al cerrar M1** |
| 03 | Adaptadores | `synthetic` · `standards` | Mismo contrato, distinto origen |
| 04 | Tarjetas visuales | Extensión MCP Apps | Parrilla, plano de planta, ficha de incidencia |
| 05 | Orquestador de demostración | Amazon Bedrock · Nova 2 Lite | Simulación propia de Alexa+; se publica |
| 06 | Identidad | OAuth 2.1 · authorization code + PKCE (S256) | **Obligatorio para conectar siquiera con Alexa+**, con `resource` apuntando al URI canónico del servidor. Cada persona ve solo lo suyo |
| 07 | Despliegue autónomo | Contenedor · compose | Un fichero de configuración y credenciales propias |
| 08 | Despliegue gestionado | AWS Lambda · DynamoDB · CDK v2 | El camino documentado para el mini-reto de AWS |
| 09 | Observabilidad | OpenTelemetry | Contexto de traza en las cabeceras del protocolo |

**El núcleo corre en cualquier sitio; AWS es un destino, no un requisito.** Un proyecto que aspira a que lo adopte cualquier institución no puede exigir una cuenta de nube.

## 6. Herramientas MCP

Publicadas según capacidades. Las de escritura confirman antes de actuar: la primera llamada valida, devuelve la pregunta y no escribe nada; la segunda lleva `confirmed` y la ejecuta (ADR-011). Se diseñó con `input_required`, pero sobre Streamable HTTP servido por petición no hay canal del servidor al cliente que lo entregue, así que la confirmación viaja como argumento y funciona en cualquier transporte.

| Herramienta | Pregunta que resuelve | Nivel |
| :-- | :-- | :-- |
| `campus.find_room` | "¿Dónde puedo estudiar ahora mismo?" | lectura |
| `campus.timetable` | "¿Qué tengo mañana a primera hora?" | lectura |
| `campus.deadlines` | "¿Cuándo acaba el plazo de matrícula?" | lectura |
| `campus.wayfind` | "¿Cómo llego al aula del examen?" | lectura |
| `campus.report_issue` | "El proyector del aula 203 no enciende" | **escritura** |
| `campus.issue_status` | "¿Cómo va el aviso de ayer?" | lectura |

Criterios de aceptación: [`docs/use-cases.md`](docs/use-cases.md) — en inglés, porque es el fichero que acompaña a los tests.

## 7. Versiones fijadas

Se fijan en M1, se revalidan una vez en M3 y se congelan tras M4. Nada en preview.

| Componente | Versión | Criterio |
| :-- | :-- | :-- |
| Ejecución | Node 24 LTS | LTS activa. Node 26 aún no está en soporte a largo plazo |
| SDK MCP | TypeScript SDK | Ecosistema más maduro; único con extensión de tarjetas |
| Protocolo | **MCP 2025-11-25** | Lo que habla Alexa+, y lo que el SDK de TypeScript llama `LATEST_PROTOCOL_VERSION`. La 2026-07-28 no está en su lista de versiones soportadas |
| Latencia | **< 500 ms ida y vuelta** | Límite de la plataforma Alexa+, no una aspiración |
| Modelo del orquestador | Amazon Nova 2 Lite | Latencia en el turno hablado |
| Infraestructura | AWS CDK v2 (2.263+) | No existe una v3 |
| Contenedor | Imagen distroless | Superficie mínima dentro de otra institución |

**Por qué 2025-11-25 y no 2026-07-28.** El primer borrador de este runbook fijaba la 2026-07-28 y trataba la 2025-11-25 como degradación. Estaba del revés: Alexa+ —la superficie que se juzga— habla 2025-11-25, y el SDK de TypeScript ni siquiera lista la 2026-07-28 entre sus versiones soportadas. Fijar una revisión que el cliente no habla nos habría costado el track.

**El servidor sigue sin estado.** El argumento a favor de 2026-07-28 era que elimina las sesiones, y un servidor sin estado se replica sin coordinación: justo lo que necesita algo pensado para desplegarse en infraestructura ajena. Resulta que el modo sin estado es una *opción del transporte* (`WebStandardStreamableHTTPServerTransportOptions`: no emite identificador de sesión ni lo valida), no una propiedad de aquella revisión. Conservamos la propiedad arquitectónica sin perder nada.

El SDK trae además `createMcpHandler(({ era }) => …)` para servir varias eras de protocolo desde un mismo handler. Las revisiones nuevas se añaden ahí cuando el SDK las soporte, sin reabrir la interfaz de proveedor.

## 8. Hitos

| ID | Fechas | Objetivo | Salida |
| :-- | :-- | :-- | :-- |
| M0 | 15–17 sep | Cimientos | Conjunto de datos de referencia cerrado |
| M1 | 18–27 sep | Núcleo, interfaz de proveedor, adaptador sintético, seis herramientas | Responde a un cliente MCP genérico |
| M2 | 28 sep–4 oct | Adaptador de estándares, catálogo derivado, contenedor | La costura es real, no una promesa |
| M3 | 5–11 oct | Orquestador, tarjetas, localización, confirmación multivuelta | Conversación completa extremo a extremo |
| M4 | 12–16 oct | Pila CDK, OAuth 2.1, trazas OpenTelemetry | Dos destinos de despliegue funcionando |
| M5 | 17–20 oct | Guía de adopción, documentación, vídeo, feedback | Instalable por un desconocido |
| M6 | 21 oct | Envío en Devpost | 48 h antes del cierre |

Detalle:

- **M0** — repositorio público con licencia abierta desde el primer commit; cuenta AWS con acceso a Bedrock en `us-east-1`; San Telmo definida.
- **M1** — tests de contrato y medición de latencia en cada compilación. **La interfaz de proveedor se congela al cerrar el hito.**
- **M2** — calendarios iCalendar, directorio LDAP, inventario en tabla; imagen de contenedor y fichero de composición.
- **M3** — traza de llamadas visible en la aplicación de demostración; respuestas y tarjetas localizadas.
- **M4** — el registro de fricción se escribe mientras duele, no al final.
- **M5** — la guía se cronometra en máquina limpia con alguien ajeno al proyecto.

## 9. Reglas de corte

El equipo lleva además una segunda candidatura (LREA). Lodge tiene prioridad. Se aplican sin convocar reunión:

1. **Si M2 se pasa del 4 de octubre** — el adaptador de estándares se recorta a calendarios e inventario, dejando el directorio fuera.
2. **Si M3 se pasa del 11 de octubre** — caen las tarjetas visuales. La voz sola cumple el track.
3. **Si el 14 de octubre no hay demostración de punta a punta** — se abandona el segundo proyecto y todo el equipo pasa a Lodge.

Los casos marcados *essential* en `docs/use-cases.md` sobreviven a cualquier recorte; los marcados *improvement* caen primero.

## 10. Entregables

- [ ] Proyecto creado o actualizado sustancialmente después del 31-08-2026
- [ ] Repositorio público, licencia abierta, instrucciones verificadas
- [ ] Servidor MCP autoalojado, Streamable HTTP, spec 2025-11-25
- [ ] Tecnología del track importada e invocada en tiempo de ejecución
- [ ] Demostración funcional accesible para el jurado
- [ ] Vídeo público de menos de 3 minutos
- [ ] Feedback de producto sobre todas las APIs utilizadas
- [ ] Track declarado y ambos mini-retos seleccionados
- [ ] Registro de fricción (hasta un 10 % de bonificación)
- [ ] Pedir los 150 $ de créditos AWS de participación (https://forms.gle/GaHFxSbBQNG9Kti6A) — distintos de los 15.000 $ del premio
- [ ] Vídeo público en YouTube o Vimeo, menos de 3 minutos
- [ ] Feedback de producto: herramientas usadas, qué funcionó, qué mejorar, onboarding, si volveríamos a construir con ellas
- [ ] Guía de adopción validada por alguien ajeno al desarrollo

## 11. Riesgos

| Severidad | Riesgo | Mitigación |
| :-- | :-- | :-- |
| Alto | Dos candidaturas, un equipo | Las reglas de corte. El 14 de octubre es el punto de no retorno |
| Alto | La abstracción se come el calendario | Dos adaptadores, ni uno más. Interfaz congelada en M1 |
| Medio | Lo genérico demuestra peor | San Telmo con detalle; el estudiante de intercambio como momento espectacular |
| Medio | El registro de complementos de Alexa+ está cerrado | **Confirmado el 14-09-2026**: «Alexa+ for Builders is currently available to select partners working directly with our team». El hackathon no abre excepción: su propia guía dice «simulate an Alexa+ experience using your preferred agentic tools via a web app» | Las bases admiten servidor MCP autoalojado con simulación propia; ese orquestador se publica y suma en el mini-reto de código abierto |
| Bajo | Datos y privacidad | Datos generados, comprobación de secretos en CI, ninguna credencial institucional |

## 12. Nota de alcance

Este proyecto no contiene datos, marcas, sistemas ni nomenclatura de ninguna institución concreta, y no requiere autorización de ninguna. La Universidad de San Telmo es ficticia y sus datos están generados. Si una institución quisiera desplegarlo más adelante, lo haría adoptando un proyecto de código abierto ya publicado: una conversación distinta y bastante más sencilla.
