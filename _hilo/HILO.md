# Hilo - Memoria del proyecto

> **Hilo** es la memoria dinamica de **este** proyecto dentro del ecosistema **Ovillo**: el estado actual, el
> historial y el contexto que sobreviven entre sesiones, personas y sprints. El codigo cambia con cada commit; el
> Hilo conserva que se decidio, que se aprendio, quien trabajo en que y que queda por hacer.

---

## Que hay en esta carpeta

| Archivo | Que guarda |
|---|---|
| `ESTADO_PROYECTO.json` | Estado estructurado: equipo, configuracion (ramas, tipos de tarea), soluciones, infraestructura, evolutivos, `mcpSync`. Es contrato con las skills, los hooks y el Hub: no cambiar sus claves a mano. Esquema en `ESTADO_PROYECTO.schema.md`. |
| `SESION_ACTUAL.md` | Contexto de la sesion en curso (se carga siempre via `@import`). |
| `LECCIONES.md` | Patrones, errores y particularidades aprendidas. |
| `DECISIONES.md` | Decisiones tecnicas del proyecto (ADR ligeros). |
| `HISTORIAL_CAMBIOS.md` | Cronologia de cambios. |
| `FUNCIONALIDADES.md` | Catalogo funcional del proyecto. |
| `DEPENDENCIAS.md` | Mapa de dependencias y stack tecnologico. |
| `CONTEXTO_TECNICO.md` | Contexto tecnico estable, auto-detectado. |
| `FEEDBACK_ECOSISTEMA.md` | Feedback hacia Ovillo (FB-XXX). |
| `AUDITORIA_NUGET.json`, `HISTORIAL_ANALISIS.json` | Resultados de la ultima auditoria de paquetes y de los analisis profundos. |
| `specs/` | Especificaciones de evolutivos (una por codigo). |
| `reuniones/` | Actas de reuniones. |

Quien lee y escribe cada archivo se deriva de las propias skills y hooks: la referencia del Hilo del portal de
documentacion lo muestra actualizado en cada version. Cada skill workflow (`/hv:<skill>`) declara en su ficha los
ficheros del Hilo que toca.

---

## Como encaja en Ovillo

- **Hilo** (`_hilo/`): memoria dinamica del proyecto (esta carpeta).
- **Patron** (`_patron/`): base de conocimiento de la organizacion; estandares y guias que no cambian de un proyecto a otro.
- **Skills, agents y hooks** (plugin `hv`): quienes leen y escriben el Hilo. La configuracion de la organizacion vive en
  `ecosystem.config.json`; la precedencia entre ambos ficheros la fija `.claude/CONFIGURACION.md`.

---

## Que NO va en el Hilo

El Hilo se versiona con el proyecto y viaja a todo el equipo (y, si el proyecto se registra en el Hub, parte de el se
sincroniza). Por eso **nunca** debe contener:

- Secretos: contrasenas, tokens, API keys, cadenas de conexion completas. En `acceso_bd` se guarda el **nombre** del
  secreto (`connection_string_key`), nunca su valor.
- Datos personales mas alla de lo imprescindible para el trabajo: alias, nombre y correo corporativo de los miembros del
  equipo. Nada de identificadores personales, telefonos ni datos de terceros.
- Prompts ni conversaciones con el asistente. La telemetria de agents (`agent-telemetry.jsonl`) es local, esta
  excluida por `.gitignore` y al Hub solo viaja un hash.
- Credenciales del propio Hub: `.mcp-credentials.json` es por desarrollador y esta excluido por `.gitignore`.

El hook `secret-scanner` avisa (o bloquea, segun `hooks.policy`) si algo de esto se escribe. La politica completa de
datos del ecosistema esta en el portal de documentacion (pagina «Datos y privacidad»).

---

## Importante

- **No borrar** archivos de esta carpeta.
- **No ignorar** la carpeta en `.gitignore` (debe estar versionada); las dos excepciones anteriores ya estan en el
  `.gitignore` que escribe `/hv:init`.
- **Mantener actualizado**: `SESION_ACTUAL.md` y `ESTADO_PROYECTO.json` se cargan en cada sesion via `@imports` en
  `CLAUDE.md`; el hook `hilo-json-guard` impide commitear un JSON del Hilo vacio o invalido.

---

*Hilo - Ovillo*
