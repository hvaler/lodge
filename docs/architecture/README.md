# docs/architecture/ — Arquitectura del proyecto

Un solo sitio para la arquitectura, generado y regenerable:

| Quién escribe | Qué |
|---|---|
| `/hv:analizar` | los diagramas (`DIAGRAMA_COMPONENTES.md`, `DIAGRAMA_DEPENDENCIAS.md`, `DIAGRAMA_ENTIDADES.md`, `DIAGRAMA_SECUENCIAS.md`, `DIAGRAMA_CLASES.md`, `DIAGRAMA_FLUJO.md`, `DIAGRAMA_DESPLIEGUE.md`, `DIAGRAMA_OBSERVABILIDAD.md`) e `INFORME_ANALISIS.md` con `--report` |
| `/analisis-arquitectura` | la auditoría formal versionada: `ANALISIS_ARQUITECTURA_v<versión>_<fecha>.md` y `.html` |
| `/hv:revision` | `IMPACTO_CAMBIOS.md` cuando un cambio es significativo |

Los nombres de fichero no colisionan entre sí, por eso conviven en una sola carpeta. No editar a mano
lo generado: se regenera en el siguiente análisis.
