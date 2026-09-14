# ops/ — Operación y entrega

Todo lo que se **ejecuta** para levantar el entorno, integrar y desplegar. Se organiza por naturaleza,
no por fase.

| Carpeta | Qué contiene | Quién escribe |
|---|---|---|
| `environment/` | `docker-compose.yml` del entorno local y `.env.example` | el equipo (plantillas incluidas) |
| `cicd/` | runbooks, documentación de pipelines, secretos, `scripts/` | `/hv:cicd-init` y la familia `cicd-*` |
| `testing/` | configuración que consume el pipeline: `coverlet.runsettings`, `.security-exceptions.yml` | `/hv:cicd-init` |

El fichero de pipeline (`azure-pipelines.yml` u otro) sigue en la raíz del repositorio, donde lo busca
la plataforma de CI. Dispara con cambios bajo `src/**` y `ops/testing/**`.
