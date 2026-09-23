# AGENTS.md

Este archivo guía a Codex (Codex.ai/code) cuando trabaja con código en este repositorio.

> **Documento vivo del proyecto**: [`RUNBOOK.md`](RUNBOOK.md) (EN, canónico) y [`RUNBOOK.es.md`](RUNBOOK.es.md).
> Los criterios de aceptación viven en [`docs/use-cases.md`](docs/use-cases.md) — en inglés, porque acompañan a los tests.

---

## @imports (Contexto Automático)

@_hilo/ESTADO_PROYECTO.json
@_hilo/SESION_ACTUAL.md

> **Dieta de contexto**: solo se importan el estado y la sesión. Lo demás se carga cuando hace falta:
> - **Estándares de la organización** (versiones .NET, nomenclatura, seguridad, SQL, tests, git):
>   `.Codex/CLAUDE_BASE.md`. La regla `estandares-base` lo recuerda al tocar código de `src/`.
> - `_hilo/DEPENDENCIAS.md` y `_hilo/FUNCIONALIDADES.md`: leer (Read) antes de modificar código con
>   dependencias documentadas o una funcionalidad ya descrita.
> - Reglas de capa (`api`, `domain`, `database`, `tests`…): se activan solas por la ruta del fichero.

---

## Ecosistema Ovillo

| Componente | Carpeta | Proposito |
|------------|---------|-----------|
| **Ovillo** | `/` | Ecosistema completo: skills, agents, hooks y reglas |
| **Hilo** | `_hilo/` | Memoria del proyecto: estado, sesiones, lecciones, historial |
| **Patrón** | `_patron/` | Base de conocimiento de la organización |

> La identidad de la organizacion (nombre, namespace, IdP, cloud, CI/CD, tema) vive en
> `ecosystem.config.json` (copiar de `ecosystem.config.example.json`; validar con
> `node .Codex/scripts/validate-config.js`). Sin ese archivo, defaults neutrales.
> Precedencia de configuración y claves: `.Codex/CONFIGURACION.md`.

> Codex consulta **Hilo** para el estado actual del proyecto y **Patrón** para documentacion de referencia.
> `/hv:sos` lista lo que se puede pedir.

---

> **Nota para quien clone este repositorio.** Lo de arriba describe el andamiaje de desarrollo con el
> que se construyó Lodge (el ecosistema Ovillo: `_patron/`, `.claude/`, sus esquemas y plantillas).
> **Ese andamiaje no se publica** — es la herramienta, no el proyecto —, así que las rutas que lo
> citan no existirán en tu copia, y no hacen falta para nada.
>
> Lo que sí se publica y sí es de Lodge: [`_hilo/DECISIONES.md`](_hilo/DECISIONES.md), las diecinueve
> decisiones de arquitectura que la documentación cita; [`_hilo/LECCIONES.md`](_hilo/LECCIONES.md);
> y [`_hilo/DEUDA_TECNICA.md`](_hilo/DEUDA_TECNICA.md) con los riesgos y cuáles se cumplieron.
>
> Para **usar** Lodge no necesitas nada de esto: [`docs/adopting.md`](docs/adopting.md).

---

## Información del Proyecto

| Campo | Valor |
|-------|-------|
| **Nombre** | Lodge — la conserjería que no cierra |
| **Versión** | 0.0.0 |
| **Tipo** | Servidor MCP (Streamable HTTP, sin estado) |
| **Runtime** | Node 24 LTS · TypeScript |
| **Protocolo** | MCP 2025-11-25 · Streamable HTTP · sin estado |
| **Destinos** | Contenedor distroless + compose · AWS Lambda · DynamoDB · CDK v2 |
| **Entrega** | Envío 21 oct 2026 · cierre 23 oct 21:00 CEST |

---

## Glosario del Dominio

> **Propósito**: definir los términos del proyecto para no redefinirlos en cada conversación.
> Rellenado en `/hv:onboarding` desde el runbook; ampliar a mano según aparezcan términos nuevos.

| Término | Definición | Ejemplo de uso |
|---------|------------|----------------|
| **Lodge** | La *porter's lodge*: la conserjería que no cierra. El servidor MCP del proyecto | "Lodge responde a cualquier hora" |
| **Adaptador** | Implementación de la interfaz de proveedor contra una fuente de datos institucional | "El adaptador `standards` lee iCalendar" |
| **Interfaz de proveedor** | El contrato que todo adaptador implementa: capacidades e idioma. **Congelada el 16-09-2026** (ADR-006): `src/provider/frozen.ts` la sujeta en cada `npm run build` | "Eso toca la interfaz: ya está congelada" |
| **Negociación de capacidades** | El catálogo de herramientas se deriva de lo que el adaptador declara soportar | "Sin gestor de incidencias, esas dos herramientas no se publican" |
| **`synthetic` / `standards`** | Los dos únicos adaptadores del alcance. Ni uno ni tres | — |
| **Universidad de San Telmo** | Institución **ficticia** del adaptador sintético. Datos generados, no anonimizados | "San Telmo tiene tres edificios" |
| **Regla de corte** | Recorte de alcance con fecha fija, aplicable sin convocar reunión | "La regla 2 dice que el 11 de octubre caen las tarjetas" |
| **`essential` / `improvement`** | Prioridad de cada caso en `docs/use-cases.md`. Los `essential` sobreviven a cualquier recorte | "UC-06 es `improvement`: cae primero" |
| **Confirmación en dos vueltas** | Las herramientas de escritura confirman antes de actuar: la primera llamada pregunta y no escribe, la segunda lleva `confirmed` (ADR-011). No usa `input_required`: sobre HTTP sin estado no hay canal del servidor al cliente | "Sin confirmación no se crea ningún ticket" |
| **Tarjetas visuales** | Extensión MCP Apps: parrilla de ocupación, plano de planta, ficha de incidencia | "Donde hay pantalla, además la tarjeta" |
| **Registro de fricción** | Bitácora de fricción con las APIs usadas. Se escribe mientras duele, no al final | "Eso va al registro de fricción" |
| **La segunda candidatura** | El equipo lleva otra entrega en paralelo. Lodge tiene prioridad | "Regla de corte 3: el 14 de octubre se abandona la otra" |

---

## Orquestacion del Trabajo

**Planificar**

- Proponer antes de implementar: en cambios no triviales, plan breve (ficheros y enfoque) y esperar confirmacion.
- Descomponer lo grande en pasos y verificar cada uno antes de seguir.
- Revisar `_hilo/DEPENDENCIAS.md` y la matriz de impacto antes de empezar.
- Si un enfoque falla dos veces, parar y replantear en vez de insistir.

**Verificar**

- `npm run build` y `npm test` como checkpoint tras cada cambio significativo; no acumular cambios sin compilar.
- Releer el codigo generado con ojo critico antes de presentarlo.
- Ejecutar los tests existentes tras modificar codigo; si no hay, proponer crearlos.
- En refactors, comparar el diff contra `main` para no perder comportamiento.
- Todo criterio de `docs/use-cases.md` es un test de contrato: si cambia el comportamiento, cambia primero ahí.

**Corregir**

- Arreglar sin preguntar lo evidente (typo, import, parentesis) y el CI roto por el propio cambio.
  Preguntar solo cuando la correccion implique una decision de diseno.
- Documentar lo inesperado en `_hilo/LECCIONES.md`, y consultarlo al empezar para no repetir errores.

**Simplificar**

- Implementar lo que se pide: sin abstracciones prematuras ni features no solicitados.
- Claridad antes que ingenio.
- Buscar como se resolvio algo parecido en el proyecto y mantener la consistencia.

---

## Estándares de Código

### TypeScript / Node

- **Indentación:** 2 espacios
- **Tipos, clases e interfaces:** `PascalCase` — **sin prefijo `I`**
- **Funciones y variables:** `camelCase`
- **Constantes de módulo:** `UPPER_SNAKE_CASE`
- **Ficheros:** `kebab-case.ts`
- **Herramientas MCP:** `campus.snake_case` — es contrato público, no se renombra a la ligera
- **`strict: true`** en `tsconfig.json`. Nada de `any` sin un comentario que lo justifique
- **Comentarios:** TSDoc en la API pública (interfaz de proveedor y herramientas)
- **Async:** `async`/`await`, sin sufijo en el nombre

### Tests

- **Fichero:** `<modulo>.test.ts`, junto al código o bajo `tests/`
- **Nombre:** `describe` por unidad, `it` con escenario y resultado esperado
- **Patrón:** Arrange, Act, Assert
- **Contrato:** cada caso `essential` de `docs/use-cases.md` tiene su test. La medición de latencia
  corre en cada compilación desde M1

### Commits

- **Formato:** Conventional Commits
- **Tipos:** `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- **Scope:** Nombre del módulo afectado

> `.Codex/CLAUDE_BASE.md` recoge el estándar de la organización, que es **.NET/SQL Server**: aplica
> su criterio de seguridad, no su stack. Lodge es TypeScript sobre Node, y lo que manda aquí es esta
> sección más `_hilo/CONTEXTO_TECNICO.md`.

---

## Arquitectura

```
Lodge/
├── RUNBOOK.md       ← documento vivo        ├── src/     ← CÓDIGO FUENTE (TypeScript)
├── AGENTS.md        ← este archivo          ├── docs/    ← lo que se lee (use-cases.md, integrating.md…)
├── _hilo/           ← memoria del proyecto  └── ops/     ← lo que se ejecuta (environment/, cicd/, testing/)
├── _patron/         ← base de conocimiento
└── .Codex/         ← skills, agents, hooks y reglas
```

```
Cliente MCP (Alexa+ / orquestador propio / cualquier agente)
        ↓
Servidor MCP  ──  Streamable HTTP, sin estado (opción de transporte)
        ↓
Interfaz de proveedor  ──  capacidades + idioma   [CONGELADA 16-09-2026]
        ↓
   synthetic (San Telmo)  |  standards (iCalendar · LDAP · CSV)
```

> El núcleo corre en cualquier sitio; **AWS es un destino, no un requisito**.

---

## Reglas del Proyecto

### Seguridad (CRÍTICO)

- ❌ NUNCA hardcodear passwords, API keys o secrets
- ❌ NUNCA exponer connection strings con credenciales
- ✅ SIEMPRE usar el servicio de secretos configurado (`cloud.secrets`) en producción
- ✅ SIEMPRE usar `customErrors mode="On"` en producción

### Protocolo e infraestructura

- ❌ NUNCA introducir estado de sesión en el servidor: el modo sin estado se activa por opción del
  transporte y es lo que permite replicarlo sin coordinación (ADR-009)
- ❌ NUNCA adoptar *roots*, *sampling* ni el *logging* del protocolo: están obsoletos
- ✅ SIEMPRE resolver la identidad contra el token autenticado, nunca contra un parámetro de nombre
- ✅ SIEMPRE derivar el catálogo de herramientas de las capacidades declaradas por el adaptador

### Datos

- ❌ NUNCA introducir datos, marcas ni nomenclatura de una institución real
- ✅ San Telmo es ficticia: sus datos se **generan**, no se anonimizan
- ✅ El adaptador `synthetic` es determinista: quien clone el repositorio obtiene las respuestas del vídeo

### Código

- ❌ NUNCA dejar `catch` vacíos o genéricos sin registrar el error
- ❌ NUNCA inferir ni aproximar un dato que no consta: el agente dice que no lo sabe (UC-03)
- ✅ SIEMPRE manejar errores específicos
- ✅ SIEMPRE incluir tests para código nuevo

---

## Contexto Adicional

**Hilo** (`_hilo/`): `ESTADO_PROYECTO.json` estado y configuración (campos en `ESTADO_PROYECTO.schema.md`) ·
`DEPENDENCIAS.md` stack y NuGets con matriz de impacto · `FUNCIONALIDADES.md` módulos y features ·
`DECISIONES.md` · `LECCIONES.md` · `DEUDA_TECNICA.md` · `HISTORIAL_CAMBIOS.md` ·
`FEEDBACK_ECOSISTEMA.md` (gaps del ecosistema, se suben al Hub) · `specs/` por evolutivo.

**Patrón** (`_patron/`): estructura técnica, diseño y usabilidad, RGPD y normativa, plantillas SQL,
observabilidad, resiliencia y CI/CD. Son los documentos mismos, sin índice.

**Runbook**: [`RUNBOOK.md`](RUNBOOK.md) es el documento vivo — alcance, arquitectura, versiones
fijadas, hitos, reglas de corte y riesgos. El *porqué* de cada decisión, en `_hilo/DECISIONES.md`.

**Documentación de librerías**: usar **Context7** (`resolve-library-id` + `get-library-docs`) por iniciativa
propia al implementar contra librerías de terceros, configurar Azure o escribir tests, en vez de citar de memoria.

**Hub del equipo**: opcional y opt-in (`ecosystem.config.json → hub.enabled`, por defecto `false`). El alta es
siempre explícita con `/hv:mcp-register`; qué datos salen y cuánto duran, en el aviso de privacidad que ese
comando enseña. Sin Hub, los comandos que lo usan degradan con un mensaje claro.

---

## Notas para Codex

1. **Leer el contexto primero**: `_hilo/` antes de modificar nada.
2. **Seguir los patrones existentes**: analizar código parecido antes de crear algo nuevo.
3. **Tests obligatorios** para todo código nuevo.
4. **Preguntar** ante dudas de integraciones y dependencias.
5. **Mantener `_hilo/` al día** con los cambios.
6. **JSON del Hilo**: un script Node que escriba `_hilo/*.json` usa `writeHiloJson` de
   `.Codex/hooks/lib/helpers.js`; en PowerShell, `[System.IO.File]::WriteAllText` con UTF-8 sin BOM
   (nunca `Out-File` ni `Set-Content -Encoding UTF8`: PS 5.1 mete BOM).

---

*Generado por Ovillo y adaptado en `/hv:onboarding` (14-09-2026) al stack real del proyecto.*
