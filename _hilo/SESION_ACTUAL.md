# Sesión Actual

> **Propósito**: Mantener contexto entre sesiones de trabajo y usuarios.
> **Actualizar**: Al final de cada sesión con Claude.

---

## Estado de la Última Sesión

| Campo | Valor |
|-------|-------|
| **Fecha** | 2026-09-15 |
| **Usuario** | Hugo Carlos Valer Rojas |
| **Evolutivo activo** | M2 (completo salvo congelar) · M3 en curso |
| **Tests** | 264 en verde · CI verde · tsc limpio |

---

## Dónde estamos

```
M0  ████████░░  repo ✅ · San Telmo ✅ · Bedrock ⬜ BLOQUEADO
M1  ██████████  núcleo · interfaz · generador · 6 herramientas · servidor
M2  ██████████  iCalendar · LDAP · inventario · contenedor · UC-07
M3  ███████░░░  localización ✅ · tarjetas ✅ · orquestador ⬜
```

Vamos ~19 días por delante del runbook. M3 no arrancaba hasta el 5 de octubre.

---

## Lo único bloqueado

**Bedrock devuelve `AccessDeniedException` por verificación de cuenta.** La cuenta se creó el
14-09 y el mensaje dice que la verificación tarda «menos de 2 horas», así que ya está fuera de
plazo. **Acción: escribir a aws-verification@amazon.com** con el ID de cuenta y el error.

No es plan, ni región, ni perfil de inferencia: Nova 2 Lite con el perfil **US Amazon Nova 2 Lite**
(`us.amazon.nova-2-lite-v1:0`) estaba correctamente seleccionado.

**Sigue sin respuesta la pregunta de fondo**: si Bedrock funciona en plan Free. La verificación
corta antes de llegar ahí, y es lo que condiciona el orquestador de M3.

---

## Contexto para Próxima Sesión

### Lo tuyo
1. [ ] Correo a `aws-verification@amazon.com` (cuanto antes: el reloj corre)
2. [ ] Cuando se verifique: playground → **Ejecutar** sin cambiar nada → decir **si responde**
3. [ ] Mirar en Billing si el consumo de Bedrock **sale de los $100** o va aparte
4. [ ] Formulario de créditos ($150) con la Devpost Profile URL

### Lo que puede hacer Claude sin AWS
- **Congelar la interfaz de proveedor** (ADR-006, previsto el 27-09). Ha ganado cuatro campos
  —`timeZone`, `Session.group` opcional, `Route.minutes` opcional, `listRooms`— todos encontrados
  por el segundo adaptador y por las tarjetas. Dos hitos sin una sola vuelta atrás.
- **Empezar el orquestador contra una abstracción**, con un doble en los tests, para que enchufar
  Bedrock sea el último paso y no el primero. Recomendado: saca el bloqueo de la ruta crítica.

### Decisiones vivas que conviene no olvidar
- **UC-05 depende de que Alexa+ declare `elicitation`.** Si no la declara, `report_issue` no puede
  confirmar. Verificar en el simulador antes de M3; hay dos salidas pensadas en `DEUDA_TECNICA.md`.
- **El perfil EU** (`eu.amazon.nova-2-lite-v1:0`) merece medirse frente al US: el presupuesto es
  500 ms y el vídeo se graba desde España. Va a la guía de adopción de M5.
- **Nova 2 Sonic** (voz a voz) podría hacer que la simulación de Alexa+ suene a voz de verdad en
  el vídeo. No es del plan; anotado por si M3 va holgado.

---

## Historial Reciente

| Fecha | Usuario | Trabajo principal |
|-------|---------|-------------------|
| 2026-09-15 | Hugo | M2 completo con UC-07; localización y tarjetas visuales de M3; Bedrock bloqueado por verificación |
| 2026-09-14 | Hugo | `/hv:init`, `/hv:onboarding`, M0 y M1 completos |

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
