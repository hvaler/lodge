# Sesión Actual

> **Propósito**: Mantener contexto entre sesiones de trabajo y usuarios.
> **Actualizar**: Al final de cada sesión con Claude.

---

## Estado de la Última Sesión

| Campo | Valor |
|-------|-------|
| **Fecha** | 2026-09-14 |
| **Usuario** | Hugo Carlos Valer Rojas |
| **Evolutivo activo** | ninguno (M0 arranca el 15-09-2026) |
| **Trabajo** | `/hv:init` + `/hv:onboarding` |

---

## Resumen de lo Trabajado

### Objetivos cumplidos
- [x] Scaffold del ecosistema con `/hv:init` (`git init` incluido: no era repositorio)
- [x] Runbook incorporado al repo: `RUNBOOK.md`, `RUNBOOK.es.md`, `docs/use-cases.md`
- [x] `ecosystem.config.json` creado y validado
- [x] Hilo contextualizado entero desde el runbook
- [x] `CLAUDE.md` y `CONTEXTO_TECNICO.md` adaptados de .NET a TypeScript/Node
- [x] Hitos M0-M6 registrados como evolutivos; reglas de corte como alertas de sesión

### Archivos modificados
- `ecosystem.config.json` — nuevo; sin bloque `database` (su enum solo admite motores SQL)
- `_hilo/ESTADO_PROYECTO.json` — proyecto, equipo, branching, stack, criticidad, calendario,
  infraestructura, evolutivos M0-M6, alertas, `dominiosExternos`
- `_hilo/ESTADO_PROYECTO.schema.md` — documentada la sección `stack`, nueva
- `_hilo/FUNCIONALIDADES.md`, `DEPENDENCIAS.md`, `CONTEXTO_TECNICO.md`, `DECISIONES.md` — reescritos
- `_hilo/DEUDA_TECNICA.md` — nuevo: riesgos y reglas de corte
- `_hilo/FEEDBACK_ECOSISTEMA.md` — FB-001 a FB-005
- `CLAUDE.md` — info del proyecto, glosario, estándares TS, arquitectura, reglas
- `RUNBOOK.md`, `RUNBOOK.es.md`, `docs/use-cases.md` — copiados al repo

### Decisiones tomadas
- **D1**: Adaptación completa a TypeScript — dejar los estándares C# haría que `CLAUDE.md`
  contradijese al proyecto.
- **D2**: Los hitos M0-M6 del runbook **son** los evolutivos del Hilo, no una lista paralela.
- **D3**: Licencia **Apache-2.0** — su concesión expresa de patentes es lo que miran los
  departamentos jurídicos institucionales, que son el público del proyecto.
- **D4**: Los criterios de aceptación viven solo en `docs/use-cases.md` (en inglés, junto a los
  tests). `FUNCIONALIDADES.md` enlaza, no duplica.

---

## Contexto para Próxima Sesión

### Estado
```
Modo: desarrollo · Fase: diseño · Versión: 0.0.0
Evolutivo activo: ninguno
Próximo hito: M0 — Cimientos (15-17 sep)
Bloqueadores: ninguno
```

### Tareas pendientes prioritarias
1. [ ] **M0**: crear el repositorio público en GitHub con `LICENSE` Apache-2.0 **en el primer commit**
2. [ ] **M0**: rellenar `proyecto.repositorio` en `ESTADO_PROYECTO.json` (hoy `null` a propósito)
3. [ ] **M0**: verificar cuenta AWS con acceso a Bedrock en `us-east-1`
4. [ ] **M0**: generar el dataset de la Universidad de San Telmo
5. [ ] Abrir M0 con `/hv:continuar M0`

### Notas importantes
- **Fecha inmóvil**: envío 21 oct, cierre oficial 23 oct 21:00 CEST.
- **Las tres reglas de corte están en `alertas.activas`** y se aplican sin convocar reunión.
  El 14 de octubre es el punto de no retorno frente a LREA.
- **La interfaz de proveedor se congela al cerrar M1** (27 sep). Después solo se implementa.
- El ecosistema hv asume .NET; este proyecto es TypeScript/Node. Lo adaptado está en
  `_hilo/DECISIONES.md` y lo que rozó, en `FEEDBACK_ECOSISTEMA.md`.
- Falta el MCP **context7** en scope user y el **MCP Roslyn** (este último es de análisis C#: aquí
  no aporta).

---

## Historial Reciente

| Fecha | Usuario | Trabajo principal |
|-------|---------|-------------------|
| 2026-09-14 | Hugo | `/hv:init` y `/hv:onboarding`: repo inicializado y Hilo contextualizado desde el runbook |

---

## Cómo Usar Este Archivo

### Al iniciar sesión
1. Claude lee automáticamente este archivo (importado en CLAUDE.md)
2. Revisar "Contexto para Próxima Sesión" para entender estado actual
3. Continuar con tareas pendientes o iniciar nueva solicitud

### Al finalizar sesión
1. Ejecutar `/hv:pausar` para documentar en detalle (si la sesión fue significativa)
2. Actualizar este archivo con resumen breve:
   - Qué se hizo
   - Qué quedó pendiente
   - Notas para quien continúe
3. Actualizar el historial reciente

### Trabajo en equipo
- Este archivo sirve como "handoff" entre sesiones y usuarios
- Cada persona actualiza al terminar su sesión
- El historial muestra quién trabajó en qué

### Comandos relacionados
- `/hv:estado` - Ver estado completo del proyecto
- `/hv:pausar` - Guardar el estado detallado de la sesión (`--rapido` para el resumen corto)
- `/hv:pausar` - Pausar evolutivo actual (guarda contexto)
- `/hv:continuar` - Retomar evolutivo pausado

---

*Archivo de contexto de sesion - Ovillo*
