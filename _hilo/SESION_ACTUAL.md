# Sesión Actual

> **Propósito**: Mantener contexto entre sesiones de trabajo y usuarios.
> **Actualizar**: Al final de cada sesión con Claude.

---

## Estado de la Última Sesión

| Campo | Valor |
|-------|-------|
| **Fecha** | 2026-09-16 |
| **Usuario** | Hugo Carlos Valer Rojas |
| **Evolutivo activo** | ninguno — M0 a M3 cerrados. Siguiente: **M4** |
| **Tests** | 300 en verde · CI verde · tsc limpio |

---

## Dónde estamos

```
M0  ██████████  repo ✅ · San Telmo ✅ · Bedrock ✅
M1  ██████████  núcleo · interfaz CONGELADA · generador · 6 herramientas · servidor
M2  ██████████  iCalendar · LDAP · inventario · contenedor · UC-07
M3  ██████████  localización · tarjetas · orquestador · demostrador web
M4  ░░░░░░░░░░  pila CDK · OAuth 2.1 · OpenTelemetry
```

M3 cerró el 16-09; el runbook lo situaba el 11 de octubre. **Veinticinco días de margen.**

---

## Lo que se hizo el 16-09

**Interfaz congelada** (ADR-006). `src/provider/frozen.ts` guarda una instantánea que el compilador
compara en cada `npm run build`. Dos comprobaciones por tipo: igualdad de claves y asignabilidad
mutua, porque ninguna basta sola — un campo *opcional* añadido deja los dos tipos mutuamente
asignables, que es la forma de tres de los cuatro hallazgos que ganó. Verificado rompiendo la
interfaz a propósito de las tres maneras.

**Prompt caching.** Entrada facturable de 57 324 a 8 044 tokens en 18 intercambios (−86 %). La
latencia **no se mueve**: 1 966 → 1 894 ms de mediana, dentro de una dispersión de 1 343 a 3 105.
Es una palanca de coste, no de velocidad, y conviene decirlo antes de que alguien la venda como lo
segundo.

**Demostrador web** (`npm run demo`). Lodge en `:3000` y la simulación de Alexa+ en `:8080`,
conectada al primero por HTTP como un cliente MCP cualquiera. Voz, traza de llamadas, tarjetas en
iframes sin permisos, cambio de institución y de identidad.

**Y con él, dos fallos que los tests no veían** — ver `LECCIONES.md` L-002:

- Las tarjetas **no se adjuntaban nunca** en ningún despliegue. `getClientCapabilities()` devuelve
  `null` en toda llamada a herramienta sobre Streamable HTTP, con estado y sin él. → ADR-012.
- La confirmación de UC-05 **era imposible**: `input_required` se entrega como petición
  servidor→cliente y ese canal no existe. No dependía de que Alexa+ declarase `elicitation`. →
  ADR-011: argumento `confirmed` y una segunda vuelta de conversación.

Los dos tests pasaban porque usaban `InMemoryTransport`, que es un servidor vivo con sesión
recordada. `src/cards/transport.test.ts` recorre ahora un socket real.

---

## Contexto para Próxima Sesión

### Lo tuyo
1. [ ] Formulario de créditos (150 $): https://forms.gle/GaHFxSbBQNG9Kti6A — pide la Devpost
       Profile URL. Se piden **por perfil**, no por proyecto: presupuesto compartido con la otra candidatura
2. [ ] Mirar en Billing si el consumo de Bedrock **sale de los $100** o va aparte

### Lo siguiente en código: M4
- **OAuth 2.1 con PKCE (S256)** está en la ruta crítica, no es un extra de M4: sin él no se conecta
  con Alexa+ (ADR-009). `src/server/identity.ts` ya es la costura — `principalFrom` lee el `sub` que
  un verificador de tokens haya establecido, y todo lo de arriba es trabajo del verificador
- **Pila CDK**: es lo que da al jurado una URL accesible y lo que cierra el mini-reto de AWS
- **OpenTelemetry**: contexto de traza en las cabeceras del protocolo

### Trampas conocidas
- Las credenciales de AWS **no están en el perfil `default`**, sino en uno con nombre propio.
  Cualquier script necesita `AWS_PROFILE=<el vuestro>` o falla con `CredentialsProviderError`
- **La interfaz está congelada.** Si M4 obliga a moverla: actualizar la instantánea a mano, anotarlo
  en ADR-006 y repasar los dos adaptadores y las seis herramientas. Se evaluó el riesgo antes de
  congelar y OAuth no debería tocarla, porque `RequestContext.principal` ya existe para eso
- Al añadir cualquier entregable nuevo, **al menos un test tiene que recorrer el transporte real**.
  Es la L-002 y ya ha costado dos fallos

### Decisiones vivas que conviene no olvidar
- **Nova 2 Sonic** (voz a voz) haría que el vídeo suene a voz de verdad en vez de a sintetizador del
  navegador. No es del plan; anotado por si M4 va holgado
- La guía de adopción de M5 debe documentar `LODGE_BEDROCK_MODEL` y `LODGE_BEDROCK_REGION`: la
  geografía es configuración, y el argumento de residencia de datos es medio argumento de venta

---

## Historial Reciente

| Fecha | Usuario | Trabajo principal |
|-------|---------|-------------------|
| 2026-09-16 | Hugo | Interfaz congelada; prompt caching medido; demostrador web; dos fallos de transporte (ADR-011, ADR-012, L-002). M0–M3 cerrados |
| 2026-09-15 | Hugo | M2 completo con UC-07; localización y tarjetas de M3; Bedrock verificado |
| 2026-09-14 | Hugo | `/hv:init`, `/hv:onboarding`, M0 y M1 |

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
