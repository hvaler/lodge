# ops/cicd/ — Integración y despliegue

Lo genera `/hv:cicd-init` a partir de las plantillas de `_patron/08_CICD/`, según la fase de adopción:

| Fichero | Fase | Qué es |
|---|---|---|
| `README.md` | ≥ 1 | índice de esta carpeta (este fichero se sustituye al generar) |
| `PIPELINE_BUILD.md`, `PIPELINE_DEV.md`, `PIPELINE_DEMO.md`, `PIPELINE_PROD.md` | según stages | documentación de cada stage del pipeline |
| `RUNBOOK.md` | 2 | runbook operativo del proyecto |
| `RUNBOOK_DEPLOY_MANUAL.md` | 0 | procedimiento de despliegue manual |
| `SECRETOS.md`, `SEGURIDAD_PIPELINE.md`, `PERMISOS_CICD.md` | ≥ 1 | inventario de secretos, seguridad y permisos |
| `scripts/security-scan.ps1`, `scripts/provision-quality-ci-key.ps1` | 2 | scripts que invoca el pipeline |

Consultar estado y operar: `/hv:cicd-status`, `/hv:cicd-deploy`, `/hv:cicd-release`. Los invariantes del pipeline
(G1-G19) los aplica la skill `cicd-runtime` al editar el YAML.
