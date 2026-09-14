# Contexto Tecnico del Proyecto

> **INSTRUCCIONES PARA CLAUDE**: stack tecnologico del proyecto. Consultalo para entender las
> tecnologias y versiones en uso antes de generar codigo.
>
> Rellenado en `/hv:onboarding` (14-09-2026) **desde el runbook, no por deteccion**: el codigo aun no
> existe (M0 arranca el 15-09-2026). Fuente: [`RUNBOOK.md`](../RUNBOOK.md) §5 y §7.
>
> ⚠️ Este no es un proyecto .NET. Las plantillas del ecosistema asumen C#/EF Core/SQL Server; aqui no
> aplican.

---

## Stack Tecnologico

| Aspecto | Valor |
|---------|-------|
| **Runtime** | Node 24 LTS (LTS activa; Node 26 aun no esta en soporte a largo plazo) |
| **Lenguaje** | TypeScript, `strict: true` |
| **Tipo de proyecto** | Servidor MCP — Streamable HTTP, **sin estado** |
| **SDK** | MCP TypeScript SDK (oficial; el unico con extension de tarjetas visuales) |
| **Protocolo** | **MCP 2025-11-25** — la que habla Alexa+ y el `LATEST` del SDK (ADR-009) |
| **Gestor de paquetes** | npm (lockfile commiteado) |
| **IDE** | Sin fijar (`organization.ide = none`) |

**Politica de versiones**: se fijan en M1, se revalidan **una vez** en M3 y se congelan tras M4.
**Nada en preview.**

---

## Almacenamiento

| Aspecto | Valor |
|---------|-------|
| **Motor** | Amazon DynamoDB — **solo en el despliegue gestionado** |
| **ORM** | Ninguno |
| **Migraciones** | No aplica (tabla de estado creada por CDK) |
| **Despliegue autonomo** | Sin base de datos: el servidor es sin estado por opcion del transporte |

> El bloque `database` de `ecosystem.config.json` se omite a proposito: su enum solo admite motores
> SQL (`sqlserver|postgres|mysql|sqlite`).

---

## Autenticacion y Seguridad

| Aspecto | Valor |
|---------|-------|
| **Proveedor** | OAuth 2.1 genérico (`identity.idp = oidc-generic`) |
| **Flujo** | Authorization code + **PKCE (S256)**, con parametro `resource` al URI canonico del servidor |
| **Registro de cliente** | Por confirmar en M4: la documentacion de Alexa+ especifica PKCE y `resource`, pero no si admite Client ID Metadata Documents o exige registro previo |
| **Estado** | Sin implementar. **Sube a la ruta critica**: es obligatorio para conectar con Alexa+, no solo identidad de usuario (ADR-009) |

Regla de identidad: el horario y las incidencias se resuelven **contra el token autenticado, nunca
contra un parametro de nombre** (UC-02, UC-06). Minimizacion de datos por diseno: el servidor
devuelve datos de quien pregunta y no almacena expedientes.

---

## Integraciones

| Integracion | Tipo | Usada por |
|---|---|---|
| Calendarios iCalendar | iCal / HTTP | adaptador `standards` |
| Directorio LDAP | LDAP | adaptador `standards` (primero en caer, regla de corte 1) |
| Inventario de espacios | CSV / tabla | adaptador `standards` |
| Gestor de incidencias | Segun institucion | `campus.report_issue`, `campus.issue_status` |
| Amazon Bedrock — Nova 2 Lite | AWS SDK | orquestador de demostracion (`us-east-1`) |
| Alexa+ | MCP 2025-11-25 + OAuth 2.1/PKCE | cliente **simulado**: el programa oficial esta restringido a socios seleccionados (verificado 14-09-2026) |

---

## Dependencias principales

Sin `package.json` todavia. Previstas por el runbook:

| Libreria | Para que | Hito |
|---|---|---|
| MCP TypeScript SDK | Servidor, herramientas, extension MCP Apps | M1 |
| AWS SDK v3 (Bedrock Runtime) | Orquestador de demostracion | M3 |
| AWS CDK v2 (2.263+) | Pila de despliegue gestionado. **No existe una v3** | M4 |
| OpenTelemetry (SDK Node) | Trazas de extremo a extremo | M4 |
| Cliente LDAP · parser iCalendar · parser CSV | Adaptador `standards` | M2 |

Auditoria de vulnerabilidades y licencias: `AUDITORIA_NUGET.json` (vacio; el equivalente aqui es
`npm audit`).

---

## Infraestructura

| Destino | Como |
|---|---|
| **Local / autonomo** | Imagen **distroless** + fichero de composicion. Un fichero de configuracion y credenciales propias. Sin dependencia de nube |
| **Demo / gestionado** | AWS Lambda (URL de funcion) · DynamoDB · CDK v2. Es la demostracion accesible para el jurado y el camino del mini-reto AWS |

**Observabilidad**: OpenTelemetry. El contexto de traza viaja en las cabeceras del protocolo, asi que
cada conversacion se sigue de extremo a extremo con el recolector que la institucion ya tenga.

**CI**: GitHub Actions desde M1 — tests de contrato, medicion de latencia y comprobacion de secretos
en cada compilacion.

---

## Estructura del Proyecto

`src/` esta vacio (solo su README). La estructura se crea en M1. Forma prevista:

```
src/
├── server/      ← servidor MCP (Streamable HTTP, server/discover)
├── provider/    ← interfaz de proveedor  [CONGELADA TRAS M1]
├── adapters/
│   ├── synthetic/   ← Universidad de San Telmo (determinista)
│   └── standards/   ← iCalendar · LDAP · CSV
├── tools/       ← las seis herramientas campus.*
└── cards/       ← tarjetas visuales (MCP Apps)
infra/           ← pila AWS CDK v2
docs/use-cases.md ← criterios de aceptacion = tests de contrato
```

---

## Observaciones

- **La interfaz de proveedor se congela al cerrar M1** (27 sep). Despues solo se implementa contra
  ella: tocarla impacta a los dos adaptadores y a las seis herramientas a la vez.
- El servidor es **sin estado** por opcion del transporte, no por la revision: no introducir sesiones.
  Se deja montado `createMcpHandler(({ era }) => ...)` para servir revisiones posteriores sin reabrir
  la interfaz de proveedor (ADR-009).
- **Latencia: < 500 ms ida y vuelta.** Limite de la plataforma Alexa+, medido en cada compilacion.
- En local hace falta tunel (`cloudflared` o similar): Alexa+ exige una URL remota.
- El adaptador `synthetic` es **determinista**: quien clone el repositorio obtiene exactamente las
  respuestas del video.
- **Cero datos reales**: San Telmo es ficticia y sus datos se generan, no se anonimizan.
