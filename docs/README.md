# docs/ — Documentación del proyecto

Todo lo que se **lee**: lo que el equipo documenta y lo que los workflows del ecosistema generan como
documento. Se organiza por naturaleza, no por fase.

| Carpeta | Qué contiene | Quién escribe |
|---|---|---|
| `management/` | configuración del proyecto, requisitos, actas | el equipo (plantillas incluidas) |
| `architecture/` | diagramas y auditorías de arquitectura | `/hv:analizar`, `/analisis-arquitectura`, `/hv:revision` |
| `api/` | referencia de la API | `/documentacion-tecnica` |
| `code/` | documentación técnica por proyecto de código | `/documentacion-tecnica` |
| `manuals/` | manuales de usuario y guías funcionales | `/user-documentation` |
| `postman/` | colecciones y entornos Postman | `/postman-collection` |
| `migration/` | informes de migración entre versiones de plataforma | `/hv:migrar` |
| `testing/` | informes de ejecución de tests y cobertura | `/testing-patterns` |
| `support/` | soporte en producción: incidencias, escalado, runbooks de operación | el equipo |

Las subcarpetas que no aparecen aún se crean cuando el workflow correspondiente genera su primer
fichero. Los entregables de release (`CHANGELOG_<v>.md`, `RELEASE_NOTES_<v>.md`) van en esta raíz,
los escribe `/hv:prepara-entrega`.

Las plantillas de partida están en `_patron/04_Plantillas_Documentacion/`.
