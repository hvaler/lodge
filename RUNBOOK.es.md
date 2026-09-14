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
| 06 | Identidad | OAuth 2.1 · Client ID Metadata Documents | Cada persona ve solo lo suyo |
| 07 | Despliegue autónomo | Contenedor · compose | Un fichero de configuración y credenciales propias |
| 08 | Despliegue gestionado | AWS Lambda · DynamoDB · CDK v2 | El camino documentado para el mini-reto de AWS |
| 09 | Observabilidad | OpenTelemetry | Contexto de traza en las cabeceras del protocolo |

**El núcleo corre en cualquier sitio; AWS es un destino, no un requisito.** Un proyecto que aspira a que lo adopte cualquier institución no puede exigir una cuenta de nube.

## 6. Herramientas MCP

Publicadas según capacidades. Las de escritura confirman por petición multivuelta: devuelven `input_required` y el cliente reintenta con la respuesta.

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
| Protocolo | MCP 2026-07-28 | Revisión vigente, con degradación a 2025-11-25 (mínimo exigido) |
| Modelo del orquestador | Amazon Nova 2 Lite | Latencia en el turno hablado |
| Infraestructura | AWS CDK v2 (2.263+) | No existe una v3 |
| Contenedor | Imagen distroless | Superficie mínima dentro de otra institución |

**Qué implica 2026-07-28.** El protocolo pasa a ser **sin estado**: desaparecen las sesiones y el saludo de `initialize`, y `server/discover` es obligatorio. Aquí es ventaja directa: un servidor sin estado se replica sin coordinación. *Roots*, *sampling* y el *logging* del protocolo quedan obsoletos y no se adoptan. Las notificaciones de cambio van por `subscriptions/listen`.

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
- [ ] Servidor MCP autoalojado, Streamable HTTP, spec 2026-07-28
- [ ] Tecnología del track importada e invocada en tiempo de ejecución
- [ ] Demostración funcional accesible para el jurado
- [ ] Vídeo público de menos de 3 minutos
- [ ] Feedback de producto sobre todas las APIs utilizadas
- [ ] Track declarado y ambos mini-retos seleccionados
- [ ] Registro de fricción (hasta un 10 % de bonificación)
- [ ] Guía de adopción validada por alguien ajeno al desarrollo

## 11. Riesgos

| Severidad | Riesgo | Mitigación |
| :-- | :-- | :-- |
| Alto | Dos candidaturas, un equipo | Las reglas de corte. El 14 de octubre es el punto de no retorno |
| Alto | La abstracción se come el calendario | Dos adaptadores, ni uno más. Interfaz congelada en M1 |
| Medio | Lo genérico demuestra peor | San Telmo con detalle; el estudiante de intercambio como momento espectacular |
| Medio | El registro de complementos de Alexa+ está cerrado (EE. UU. y socios seleccionados) | Las reglas admiten servidor autoalojado con simulación propia; ese orquestador se publica |
| Bajo | Datos y privacidad | Datos generados, comprobación de secretos en CI, ninguna credencial institucional |

## 12. Nota de alcance

Este proyecto no contiene datos, marcas, sistemas ni nomenclatura de ninguna institución concreta, y no requiere autorización de ninguna. La Universidad de San Telmo es ficticia y sus datos están generados. Si una institución quisiera desplegarlo más adelante, lo haría adoptando un proyecto de código abierto ya publicado: una conversación distinta y bastante más sencilla.
