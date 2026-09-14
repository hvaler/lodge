# docs/management/ — Gestión del proyecto

| Fichero | Para qué |
|---|---|
| `config_proyecto.json` | datos básicos del proyecto; rellenarlo al arrancar. Una actualización del ecosistema no lo pisa |
| `CHECKLIST_INICIO.md` | lista de comprobación para arrancar un proyecto con desarrollo asistido |
| `requirements/PLANTILLA_REQUERIMIENTOS.md` | plantilla del documento de requisitos |
| `meetings/PLANTILLA_ACTA_REUNION.md` | plantilla de acta de reunión |

Lo escribe el equipo. Ningún workflow del ecosistema genera ficheros aquí; `/hv:onboarding` solo lee
`config_proyecto.json`. La memoria viva del proyecto (estado, decisiones, lecciones) no está aquí sino
en `_hilo/`.
