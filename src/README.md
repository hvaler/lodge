# src/ — Código fuente

Aquí viven las soluciones .NET del proyecto (`*.sln` / `*.slnx`) y sus proyectos, incluidos los de
test (`*.Tests`, `*.Integration.Tests`). Es la única carpeta de la raíz que contiene código.

| Quién escribe | Qué |
|---|---|
| El equipo | todo el código |
| `/hv:nuevo-proyecto` | el andamiaje inicial de una solución nueva |
| `/generador-crud`, `/testing-patterns`, `/observability-patterns`, `/resilience-patterns` … | código generado según los estándares de `_patron/` |

Convenciones: las de `.claude/CLAUDE_BASE.md` y las skills por capa (`api`, `application`, `domain`,
`infrastructure`, `database`, `tests`, `webapp`, `blazor`, `console`), que se activan solas al tocar
ficheros que casan con sus rutas.

El pipeline de CI dispara con cambios bajo `src/**` (ver `ops/cicd/`).
