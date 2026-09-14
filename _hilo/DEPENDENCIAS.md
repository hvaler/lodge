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
| 02 | Interfaz de proveedor | Nucleo del proyecto | Capacidades e idioma. **Se congela al cerrar M1** |
| 03 | Adaptadores | `synthetic` · `standards` | Mismo contrato, distinto origen |
| 04 | Tarjetas visuales | Extension MCP Apps | Parrilla, plano de planta, ficha de incidencia |
| 05 | Orquestador de demostracion | Amazon Bedrock · Nova 2 Lite | Simulacion propia de Alexa+; se publica |
| 06 | Identidad | OAuth 2.1 · Client ID Metadata Documents | Cada persona ve solo lo suyo |
| 07 | Despliegue autonomo | Contenedor · compose | Un fichero de configuracion y credenciales propias |
| 08 | Despliegue gestionado | AWS Lambda · DynamoDB · CDK v2 | El camino documentado para el mini-reto de AWS |
| 09 | Observabilidad | OpenTelemetry | Contexto de traza en las cabeceras del protocolo |

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
| Protocolo | MCP 2026-07-28 | Revision vigente, con degradacion a 2025-11-25 (minimo exigido) |
| Modelo del orquestador | Amazon Nova 2 Lite | Latencia en el turno hablado |
| Infraestructura | AWS CDK v2 (2.263+) | No existe una v3 |
| Contenedor | Imagen distroless | Superficie minima dentro de otra institucion |

### Que implica MCP 2026-07-28

El protocolo pasa a ser **sin estado**: desaparecen las sesiones y el saludo de `initialize`, y
`server/discover` es obligatorio. Aqui es ventaja directa — un servidor sin estado se replica sin
coordinacion, que es justo lo que necesita algo pensado para desplegarse en sitios ajenos.

- Las notificaciones de cambio van por **`subscriptions/listen`**.
- *Roots*, *sampling* y el *logging* del protocolo quedan **obsoletos y no se adoptan**.

---

## Integraciones externas

| Sistema | Protocolo | Usado por | Nota |
|---|---|---|---|
| Calendarios iCalendar | iCal / HTTP | `standards` | Horarios y calendario academico |
| Directorio LDAP | LDAP | `standards` | Identidad y pertenencia a grupos. **Primero en caer** (regla de corte 1) |
| Inventario de espacios | CSV / tabla | `standards` | Edificios, aulas, aforos, equipamiento |
| Gestor de incidencias | Segun institucion | `campus.report_issue`, `campus.issue_status` | Si no existe, esas herramientas no se publican |
| Amazon Bedrock | AWS SDK | Orquestador de demostracion | Nova 2 Lite, region `us-east-1` |
| Alexa+ | MCP | Cliente | El registro de complementos esta cerrado; se simula con orquestador propio |

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
| Version de protocolo | Compatibilidad con el cliente | Degradacion a 2025-11-25 es el minimo exigido por el hackathon |
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
