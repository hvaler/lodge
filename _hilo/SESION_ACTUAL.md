# Sesión actual

> Contexto entre sesiones de trabajo. Se actualiza al terminar cada una.

| Campo | Valor |
|-------|-------|
| **Fecha** | 2026-09-17 |
| **Hito activo** | M5 — lo escrito está hecho; falta lo humano |
| **Tests** | 425 en `src` + 15 de la pila CDK · CI verde · `tsc` limpio |
| **Desplegado** | 16-09, eu-west-1, con la página pública |

---

## Dónde estamos

```
M0  ██████████  repositorio · San Telmo · Bedrock
M1  ██████████  núcleo · interfaz CONGELADA · adaptador sintético · 6 herramientas · servidor
M2  ██████████  iCalendar · LDAP · inventario · contenedor · UC-07
M3  ██████████  localización · tarjetas · orquestador · demostrador web
M4  ██████████  pila CDK · OAuth 2.1 · OpenTelemetry · desplegado y medido
M5  ████████░░  guía de adopción · tercer adaptador · registro de fricción · guion (falta grabar)
M6  ░░░░░░░░░░  envío en Devpost — 21 de octubre
```

El runbook situaba M5 el 20 de octubre. **Treinta y tres días de margen**, y las tres reglas de
corte han vencido o vencerán sin llegar a aplicarse.

---

## Lo que se hizo el 17-09

**Los partes van a donde la institución ya mira** (ADR-018). Tres destinos, exactamente uno
configurado: correo, *webhook* o Jira. El correo es el que toda institución ya tiene; el *webhook*
no se inventa una referencia si el sistema de destino no la devuelve; Jira es el único que además
puede responder «cómo va el mío».

**Y con ellos, la interfaz congelada se movió dos veces en una tarde**, las dos por el
procedimiento de ADR-006:

- `issues` → `issue-reporting` + `issue-tracking` (ADR-017). Un buzón puede recibir un parte y no
  puede contestar sobre él; la capacidad única obligaba a publicar una herramienta que no funciona.
- `rooms` → `room-inventory` + `room-availability` (ADR-019). Dar un parte necesita saber que el
  aula existe, no cuándo está libre. Atar las dos cosas dejaba a una institución sin horario sin
  poder avisar de un proyector roto.

`room-inventory` **no publica ninguna herramienta**: es la primera capacidad así, y describe un
hecho —«sé qué aulas tengo»— sobre el que se apoyan otras dos.

**Las aulas se pueden escribir en el propio fichero de configuración.** Mismos campos que el CSV,
mismo validador, mismos mensajes de error: una fila, dos formas de escribirla. Un centro con doce
aulas ya no mantiene un segundo fichero para doce líneas. El **horario no**, y es deliberado: son
miles de sesiones con fecha, y escribir la recurrencia a mano sería un `RRULE` peor que el de
iCalendar.

**Barrido de documentación.** Se retiró del repositorio público todo el andamiaje del ecosistema que
seguía publicado (plantillas de acta y requisitos, un `config_proyecto.json` que describía un
proyecto .NET 8 sin nombre, cinco carpetas cuyo único contenido era un README de ficheros
inexistentes, y un `src/README.md` que decía que ahí vivían las soluciones `.sln`).

---

## Lo que queda

### Lo tuyo, y no es código
1. [ ] **Grabar el vídeo.** Guion en [`docs/management/video-script.md`](../docs/management/video-script.md), presupuestado a 2:55 contra un límite duro de 3:00
2. [ ] **Que alguien AJENO recorra [`docs/adopting.md`](../docs/adopting.md)** y rellene la tabla del cronómetro del final. Validarla desde dentro no vale, y el entregable lo pide explícitamente
3. [ ] **Revisar [`docs/management/devpost-submission.md`](../docs/management/devpost-submission.md)** antes de enviar: lo redactó Claude y va con tu nombre
4. [ ] Formulario de créditos (150 $): pide la Devpost Profile URL. Se piden **por perfil**, no por proyecto
5. [ ] Mirar en Billing si el consumo de Bedrock sale de los 100 $ o va aparte

### En código
Nada pendiente. Lo que se ha considerado y no se hace está en
[`docs/roadmap.md`](../docs/roadmap.md), con el porqué.

---

## Trampas conocidas

- **La interfaz está congelada.** Se implementa, no se edita. Si algo obliga a moverla: actualizar
  `src/provider/frozen.ts` a mano, anotarlo en ADR-006 y repasar los dos adaptadores y las seis
  herramientas. Se ha hecho dos veces (ADR-017, ADR-019) y las dos veces el compilador avisó primero
- **Al añadir cualquier entregable, al menos un test tiene que recorrer el transporte real.** Es la
  L-002 y ya ha costado dos funcionalidades entregadas rotas
- Las credenciales de AWS **no están en el perfil `default`**, sino en uno con nombre propio.
  Cualquier script necesita `AWS_PROFILE=<el vuestro>` o falla con `CredentialsProviderError`
- La página pública **gasta dinero por pregunta** (Bedrock) y tiene tope de 500 al día contado en
  DynamoDB antes de responder. Para tirarlo todo: `cd infra && npx cdk destroy`

---

## Historial reciente

| Fecha | Trabajo principal |
|-------|-------------------|
| 2026-09-17 | Destinos de un parte (ADR-018); dos enmiendas a la interfaz congelada (ADR-017, ADR-019); aulas en línea; barrido del repositorio público |
| 2026-09-16 | Interfaz congelada; *prompt caching* medido; demostrador web; dos fallos de transporte (ADR-011, ADR-012, L-002); M4 completo y desplegado |
| 2026-09-15 | M2 con UC-07; localización y tarjetas de M3; Bedrock verificado |
| 2026-09-14 | Arranque, M0 y M1 |
