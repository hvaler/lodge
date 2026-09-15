# Feedback del Ecosistema Ovillo

> **INSTRUCCIONES PARA CLAUDE**: Este archivo registra gaps, bugs y fricciones del **ECOSISTEMA Ovillo**
> (comandos, skills, hooks, reglas, templates, agents, docs, hub) detectados mientras se trabaja en ESTE proyecto.
> NO es para bugs del proyecto: eso va a `_hilo/DEUDA_TECNICA.md` o a un evolutivo.
> `/hub-client` sube estos items al hub central (categoria `feedbackEcosistema`, `POST /v2/sync/ecosystem-feedback`)
> donde el equipo constructor del ecosistema los prioriza para las siguientes releases.

---

## Cuando registrar un item

Registra un FB-XXX cuando detectes (tu o el usuario) algo del ecosistema que:

- **Falla**: un comando/hook/skill se rompe o se comporta distinto a lo documentado (ej. un hook bloquea trabajo legitimo).
- **Falta**: un caso real del proyecto que la plantilla no cubre (ej. un stack o modelo de deploy no soportado por `/hv:cicd-init`).
- **Fricciona**: funciona pero obliga a un workaround manual recurrente (documenta el workaround en la descripcion).

NO registres: dudas de uso (consultar docs o `/hv:sos`), bugs del codigo del proyecto, peticiones de features del negocio.

## Como registrar

1. Asigna el siguiente codigo secuencial `FB-NNN` (mira el ultimo de este archivo).
2. Anade un bloque con el formato de abajo (los campos `**Campo**:` son los que parsea `/hub-client` — respetar nombres).
3. En la siguiente ejecucion de `/hub-client` el item sube al hub. Para subir UN item sin esperar: tool MCP `register_ecosystem_feedback`.
4. El estado lo actualiza el equipo constructor (en el hub) y tu puedes reflejarlo aqui cuando se resuelva (`VersionResolucion`).

**Valores permitidos**:

| Campo | Valores |
|---|---|
| `Categoria` | `comando`, `skill`, `hook`, `regla`, `template`, `agent`, `docs`, `hub`, `otro` |
| `Severidad` | `alta` (bloquea trabajo), `media` (hay workaround), `baja` (mejora) |
| `Estado` | `abierto`, `en_analisis`, `resuelto`, `descartado`, `diferido` |

---

## Items registrados

<!-- Formato de cada item (parseado por .claude/scripts/mcp-sync.ps1 — no cambiar los nombres de campo):

### FB-001: Titulo breve del gap/bug/friccion

- **Categoria**: hook
- **Severidad**: media
- **Estado**: abierto
- **VersionEcosistema**: 1.0.0
- **FechaDeteccion**: 2026-06-15
- **Descripcion**: Que falla/falta, como reproducirlo y workaround aplicado si lo hay.

-->

### FB-001: `ESTADO_PROYECTO.json` no trae la seccion `stack` que el propio onboarding rellena

- **Categoria**: template
- **Severidad**: baja
- **Estado**: abierto
- **VersionEcosistema**: 1.0.2
- **FechaDeteccion**: 2026-09-14
- **Descripcion**: La Fase 2 de `/hv:onboarding` dice "GUARDAR en `_hilo/ESTADO_PROYECTO.json` -> seccion `stack`", pero el JSON scaffolded por `/hv:init` no incluye esa clave. Workaround: se anade a mano y se documenta en `ESTADO_PROYECTO.schema.md` siguiendo la regla de mantenimiento del propio schema. Sugerencia: incluirla vacia en la plantilla, con los campos como `null`.

### FB-002: `database.engine` no admite motores no relacionales ni la ausencia de BD

- **Categoria**: template
- **Severidad**: baja
- **Estado**: abierto
- **VersionEcosistema**: 1.0.2
- **FechaDeteccion**: 2026-09-14
- **Descripcion**: El enum de `ecosystem.config.schema.json` es `sqlserver|postgres|mysql|sqlite`. Un proyecto sobre DynamoDB, Cosmos DB o sin base de datos no tiene valor honesto que poner. Workaround: omitir el bloque `database` entero (valido, porque solo `configVersion` es obligatorio) y describir el almacenamiento en la seccion `stack` del Hilo. Sugerencia: anadir `other` y `none` al enum.

### FB-003: La referencia del onboarding apunta a una ruta que no existe para `integracion-vs.ps1`

- **Categoria**: docs
- **Severidad**: baja
- **Estado**: abierto
- **VersionEcosistema**: 1.0.2
- **FechaDeteccion**: 2026-09-14
- **Descripcion**: `skills/onboarding/references/fases-6-9-y-visual-studio.md` manda ejecutar `.\.claude\commands\integracion-vs.ps1`, pero `/hv:init` lo instala en `.claude/scripts/`. El paso se salta en este proyecto (no hay `.sln` ni `ide = visual-studio`), asi que no llego a bloquear. Sugerencia: corregir la ruta en la referencia.

### FB-004: El ecosistema asume .NET de punta a punta; un proyecto Node/TypeScript obliga a adaptar a mano

- **Categoria**: template
- **Severidad**: media
- **Estado**: abierto
- **VersionEcosistema**: 1.0.2
- **FechaDeteccion**: 2026-09-14
- **Descripcion**: `CLAUDE.md` (estandares C#, `dotnet build`), `CONTEXTO_TECNICO.md` (placeholders `.csproj`/EF Core), la deteccion de stack de la Fase 2 y el modelo R25 de pipelines por entrypoint asumen .NET. En Lodge (servidor MCP en TypeScript sobre Node 24) hubo que reescribir esas secciones durante el onboarding. Workaround aplicado y documentado en `_hilo/DECISIONES.md`. Sugerencia: parametrizar las plantillas por `stack.lenguaje`, o publicar una variante no-.NET.

### FB-006: La ficha de Nova 2 Lite se contradice sobre la region

- **Categoria**: docs
- **Severidad**: baja
- **Estado**: abierto
- **VersionEcosistema**: n/a (documentacion de AWS, no del ecosistema Ovillo)
- **FechaDeteccion**: 2026-09-15
- **Descripcion**: En `model-card-amazon-nova-2-lite`, la tabla de disponibilidad regional marca
  In-Region como NO para todas las regiones, incluida us-east-1, y solo ofrece inferencia geografica
  (`us.amazon.nova-2-lite-v1:0`) o global. Pero el codigo de ejemplo de la MISMA pagina usa
  `modelId='amazon.nova-2-lite-v1:0'` con `region_name='us-east-1'`. Quien siga el ejemplo recibira
  un error de modelo no disponible. Candidato para el registro de friccion del hackathon.

### FB-005: `validate-config.js` marca todo el stack AWS como no soportado

- **Categoria**: docs
- **Severidad**: baja
- **Estado**: abierto
- **VersionEcosistema**: 1.0.2
- **FechaDeteccion**: 2026-09-14
- **Descripcion**: Con `cloud.provider=aws` el validador reporta `aws`, `secrets-manager` y `s3` como `unsupported`, y `otlp` y `oidc-generic` como `experimental`. El mensaje aclara que no es un error y que las skills degradan a generico, lo cual esta bien resuelto; queda anotado como cobertura pendiente del Patron para proyectos en AWS.

---

## Historial de resoluciones

> Cuando el constructor resuelva un item (release notes / `claude plugin update hv@ovillo`), mover aqui una linea de resumen.

| Codigo | Titulo | Resuelto en | Notas |
|---|---|---|---|
| — | — | — | — |

---

*Canal de feedback del ecosistema Ovillo — per-PROYECTO, atribucion per-dev.*
