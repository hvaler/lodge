# Mapa de Dependencias

> **INSTRUCCIONES PARA CLAUDE**: consulta este archivo antes de modificar codigo, para no romper
> nada aguas abajo. Actualizalo cuando crees una dependencia nueva.
>
> **Fuente de verdad**: [`RUNBOOK.md`](../RUNBOOK.md) §5 y §7.

---

## Arquitectura — las nueve capas

| # | Capa | Stack | Nota |
|---|---|---|---|
| 01 | Servidor MCP | TypeScript · Node 24 LTS · SDK oficial | Streamable HTTP, `server/discover`, **sin estado** |
| 02 | Interfaz de proveedor | Nucleo del proyecto | Capacidades e idioma. **Congelada el 16-09** (ADR-006) |
| 03 | Adaptadores | `synthetic` · `standards` | Mismo contrato, distinto origen |
| 04 | Tarjetas visuales | Extension MCP Apps | Parrilla, plano de planta, ficha de incidencia |
| 05 | Orquestador de demostracion | Amazon Bedrock · Nova 2 Lite | Simulacion propia de Alexa+; se publica |
| 06 | Identidad | OAuth 2.1 · **servidor de recursos** (`jose`) | Cada persona ve solo lo suyo. Lodge verifica, no emite: ADR-013 |
| 07 | Despliegue autonomo | Contenedor · compose | Un fichero de configuracion y credenciales propias |
| 08 | Despliegue gestionado | AWS Lambda (nodejs24.x, arm64) · DynamoDB · CDK v2 | Una funcion, dos tablas y una URL. Las tablas guardan **solo** lo que escribe una persona: los avisos (ADR-014) y las reservas (ADR-020) |
| 09 | Observabilidad | OpenTelemetry (`api` siempre, SDK bajo demanda) | La traza **continua** la del cliente, por cabecera o por `_meta`: ADR-015 |

**El nucleo corre en cualquier sitio; AWS es un destino, no un requisito.** Un proyecto que aspira a
que lo adopte cualquier institucion no puede exigir una cuenta de nube, porque muchas no la tendran.

```
Cliente MCP (Alexa+ / orquestador propio / cualquier agente)
        |
        v
Servidor MCP  ──  Streamable HTTP, sin estado, server/discover
        |
        v
Interfaz de proveedor  ──  capacidades + idioma   [CONGELADA TRAS M1]
        |
   +----+----+
   v         v
synthetic  standards
(San Telmo) (iCalendar · LDAP · CSV)
```

---

## Versiones fijadas

**Politica**: se fijan en M1, se revalidan **una vez** en M3 y se congelan tras M4. **Nada en
preview.** Es lo que evita el goteo de upgrades a tres semanas del cierre.

| Componente | Version | Criterio |
|---|---|---|
| Ejecucion | Node 24 LTS | LTS activa. Node 26 aun no esta en soporte a largo plazo |
| SDK MCP | TypeScript SDK | Ecosistema mas maduro; unico con extension de tarjetas |
| Protocolo | **MCP 2025-11-25** | Revision objetivo: la que habla Alexa+ y el `LATEST` del SDK. La 2026-07-28 no esta en `SUPPORTED_PROTOCOL_VERSIONS` (ADR-009) |
| Latencia | **< 500 ms ida y vuelta** | Limite de la plataforma Alexa+, no una aspiracion |
| Modelo del orquestador | Amazon Nova 2 Lite | Latencia en el turno hablado |
| Infraestructura | AWS CDK v2 (2.263+) | No existe una v3 |
| Contenedor | Imagen distroless | Superficie minima dentro de otra institucion |
| Verificacion de tokens | `jose` 6.2.12 | JWT y JWKS remoto con cache y rotacion de claves. Sin dependencias, mantenido por el autor de la spec. Anadida en M4, dentro de la politica: se fija ahora y se congela al cerrar el hito |
| Cola de incidencias gestionada | `@aws-sdk/client-dynamodb` 3.1133.0 | Solo el cliente base: tres operaciones con seis atributos planos no justifican tambien `lib-dynamodb` |
| Infraestructura | `aws-cdk-lib` 2.269.0 · `constructs` 10.8.1 · `aws-cdk` 2.1141.0 | Rama 2.x; no existe v3. Solo desarrollo: no viaja en el contenedor |
| Empaquetado de la funcion | `esbuild` 0.28.2 | Lo usa `NodejsFunction` al sintetizar. Local, sin Docker, 889 kB de artefacto |
| Instrumentacion | `@opentelemetry/api` 1.9.1 | **Cero dependencias** y no-op sin proveedor. Va en el codigo del servidor y de los adaptadores |
| Exportacion de trazas | `sdk-trace-node` · `exporter-trace-otlp-http` · `resources` · `semantic-conventions` | Trece paquetes con lo transitivo, cargados con `import()` dinamico y solo si hay `OTEL_EXPORTER_OTLP_ENDPOINT` |

### Que implica la eleccion de revision

El servidor es **sin estado**, pero por **opcion del transporte**
(`WebStandardStreamableHTTPServerTransportOptions`: no emite identificador de sesion ni lo valida), no
por la revision del protocolo. La propiedad arquitectonica se conserva — se replica sin coordinacion,
que es lo que necesita algo pensado para desplegarse en sitios ajenos — sin pagar el precio de fijar
una revision que el cliente no habla.

- El SDK ofrece negociacion de version (`legacy` | `auto` | `pin`) y `createMcpHandler(({ era }) => ...)`
  para servir varias eras desde un mismo handler. Ahi se anaden revisiones nuevas cuando el SDK las
  soporte, sin reabrir la interfaz de proveedor.
- *Roots*, *sampling* y el *logging* del protocolo no se adoptan.

---

## Restricciones de la plataforma Alexa+

> Verificado el 14-09-2026 contra la documentacion oficial del **Alexa+ MCP Toolkit**
> (`developer.amazon.com/docs/alexaplus/add-ons/`). Varias de estas cifras **no estaban en el
> runbook** y algunas lo contradicen.

| Restriccion | Valor | Consecuencia |
|---|---|---|
| **Version de spec MCP** | **2025-11-25** | Alexa+ soporta esa, no la 2026-07-28. Ver ADR-009 |
| Transporte | Streamable HTTP obligatorio | HTTP+SSE quedo deprecado en 2025-11-25. Coincide con el plan |
| **Autenticacion** | **OAuth 2.1, authorization code + PKCE (S256)**, con parametro `resource` apuntando al URI canonico del servidor | **Obligatoria para conectar**, no opcional. El runbook la situaba en M4 |
| **Latencia** | **< 500 ms ida y vuelta** | Es el "presupuesto de latencia" de UC-01, ahora con numero |
| Accesibilidad | URL remota; en local hace falta tunel (p. ej. `cloudflared`) | Afecta al bucle de desarrollo desde M1 |
| UI visual | Opcional, via MCP Apps SDK | Coincide con el plan (tarjetas, M3) |

**Ruta oficial de conexion** (CLI `alexa-ai`): `alexa-ai configure` -> `alexa-ai new mcp --name ...
--locale ... --mcp-server-url ...` -> `alexa-ai deploy`. Existe ademas un **simulador web** oficial
para probar el add-on desplegado, y un "add-on Agent Skill" para hacerlo desde un agente de codigo.

> ⚠️ **Esa ruta oficial NO esta disponible para nosotros.** Verificado el 14-09-2026 en la pagina
> de Alexa+ for Builders: «currently available to **select partners working directly with our team**».
> El hackathon no abre excepcion — su guia para el track dice literalmente «simulate an Alexa+
> experience using your preferred agentic tools via a web app».
>
> Se documenta aqui porque es la forma de la integracion real (transporte, revision, OAuth, latencia)
> y contra ella se construye el orquestador propio: cuando el programa se abra, conectar debe ser
> cambiar de cliente, no reescribir el servidor.

---

## Integraciones externas

| Sistema | Protocolo | Usado por | Nota |
|---|---|---|---|
| Calendarios iCalendar | iCal / HTTP | `standards` | Horarios y calendario academico |
| Directorio LDAP | LDAP | `standards` | Identidad y pertenencia a grupos. **Primero en caer** (regla de corte 1) |
| Inventario de espacios | CSV / tabla | `standards` | Edificios, aulas, aforos, equipamiento |
| Gestor de incidencias | Segun institucion | `campus.report_issue`, `campus.issue_status` | Si no existe, esas herramientas no se publican |
| Amazon Bedrock | AWS SDK | Orquestador de demostracion | Nova 2 Lite, region `us-east-1` |
| Alexa+ | MCP **2025-11-25** + OAuth 2.1/PKCE | Cliente (simulado) | El programa oficial esta restringido a socios seleccionados (verificado 14-09-2026). Se construye contra su contrato, con orquestador propio como cliente |

Mapeo a Context7 para documentacion viva: `ESTADO_PROYECTO.json` → `dominiosExternos`.

---

## Matriz de impacto

| Si tocas… | Impacta a… | Cuidado |
|---|---|---|
| **Interfaz de proveedor** (02) | Los **dos** adaptadores y las **seis** herramientas a la vez | ⚠️ **Congelada al cerrar M1.** Despues de esa fecha solo se implementa contra ella. Es la pieza que vuelve reutilizable el proyecto |
| Una herramienta MCP | El caso de uso correspondiente y su test de contrato | El criterio de aceptacion esta en `docs/use-cases.md`; si cambia el comportamiento, cambia primero ahi |
| Declaracion de capacidades | El catalogo publicado en tiempo de ejecucion | El agente nunca debe ofrecer lo que el adaptador no soporta |
| Adaptador `synthetic` | Reproducibilidad de la demostracion y del video | Es determinista por contrato: quien clone el repositorio obtiene exactamente las respuestas del video |
| Adaptador `standards` | Adopcion por terceros | Es la prueba de que la costura es real |
| Version de protocolo | Compatibilidad con el cliente y con Alexa+ | 2025-11-25 es la revision objetivo (ADR-009). Cambiarla es cambiar de cliente: no se toca sin releer ese ADR |
| Datos de San Telmo | Video, demostracion y tests del adaptador sintetico | Cero datos reales: generados, no anonimizados |

---

## Fuera de alcance

Conectores para plataformas docentes concretas. Son el primer anadido natural **despues** del
hackathon, y meterlos antes es exactamente el riesgo "la abstraccion se come el calendario".

---

## Gestion de paquetes

- Gestor: **npm**. Lockfile commiteado.
- Comprobacion de secretos en CI desde M1: ninguna credencial institucional en el repositorio.
- Licencia del proyecto: **Apache-2.0** (concesion expresa de patentes, que es lo que miran los
  departamentos juridicos institucionales).
