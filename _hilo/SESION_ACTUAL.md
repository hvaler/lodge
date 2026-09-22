# Sesión actual

> Contexto entre sesiones de trabajo. Se actualiza al terminar cada una.

| Campo | Valor |
|-------|-------|
| **Fecha** | 2026-09-22 |
| **Hito activo** | M5 — el código está hecho; falta lo humano |
| **Tests** | 459 en TypeScript · 33 en .NET · los dos CI verdes |
| **Desplegado** | 22-09, eu-west-1: servidor, página pública y **dos puentes a Alexa** (TS y .NET) |

---

## Dónde estamos

```
M0  ██████████  repositorio · San Telmo · Bedrock
M1  ██████████  núcleo · interfaz CONGELADA · adaptador sintético · 6 herramientas · servidor
M2  ██████████  iCalendar · LDAP · inventario · contenedor · UC-07
M3  ██████████  localización · tarjetas · orquestador · demostrador web
M4  ██████████  pila CDK · OAuth 2.1 · OpenTelemetry · desplegado y medido
M5  █████████░  guía de adopción · tercer adaptador · registro de fricción · guion (falta grabar)
M6  ░░░░░░░░░░  envío en Devpost — 21 de octubre
```

---

## Lo que se hizo el 22-09

**Un altavoz de verdad responde.** El registro de complementos de Alexa+ **sigue cerrado** —riesgo
*Medio* del runbook, confirmado el 14-09 (L-001)—, y su mitigación declarada sigue siendo el servidor
autoalojado con simulación propia. **El altavoz no cierra ese riesgo**: añade evidencia que una
pestaña de navegador no da. Una *custom skill* clásica, privada y sin certificar, hablando con el
mismo servidor MCP.

- **Skill** `Campus Lodge`, `amzn1.ask.skill.fe3d98fd-7b9c-4421-9e4a-912e467c593b`, locale `en-GB`.
- **Tercera Lambda** del stack (`#addAlexaBridge`), 8 s de tope, que **sólo existe** si se despliega
  con `-c sandbox=true -c alexaSkillId=<id>`. Permiso acotado por `eventSourceToken`: esa skill y
  ninguna otra.
- **Verificado en el simulador**: saludo en 4,58 ms; pregunta de aula completa en 2 829 ms dentro de
  la Lambda, contra el corte de 8 s; y **UC-03 por voz** — pedirle el horario a Carrigmore contesta
  que no puede, sin inventárselo.
- El **idioma elige institución**: inglés → Carrigmore (3 herramientas), español → San Telmo (6).

**Dos tropiezos, los dos instructivos:**

1. El despliegue cayó con *«The provided principal was invalid»*. El permiso decía
   `alexa-appkit.`**`smapi`**`.amazon.com`; el bueno es `alexa-appkit.amazon.com`. Los veinte tests
   de la pila estaban en verde porque uno afirmaba **la misma cadena que el código**. Es la
   **L-003**. Vuelta atrás limpia: no se perdió nada de lo ya desplegado.
2. La skill respondía *«I'm not quite sure how to help you with that»* sin llegar a la Lambda: el
   modelo de interacción estaba **guardado pero no construido**.

**Y algo que no estaba planificado: `dotnet/`.** Una segunda implementación de la mitad cliente, en
C# sobre .NET 10 — cliente MCP con el SDK oficial, bucle de herramientas sobre Bedrock Converse, y
un **segundo backend de la misma skill** desplegado como `Lodge-AlexaSkill-dotnet`. Se cambia un ARN
en la consola y el altavoz lo contesta C#.

Existe por una razón concreta: se va a presentar en Comillas, cuyo stack es .NET. La pregunta
*«¿pueden los nuestros trabajar con esto?»* deja de ser un párrafo y pasa a ser `dotnet test`. **No
es parte del servidor**: `src/` no importa nada de ahí, y Lodge no lo necesita.

El arranque en frío salió **al revés de lo que predije**: 324 y 357 ms contra los 373 ms de Node.
Dos muestras contra una, así que lo defendible es «sin penalización observada», no «más rápido».

Dos fricciones nuevas, las dos de usar `Alexa.NET`: no se puede deserializar con el serializador que
todas las guías le emparejan, y arrastra un `Newtonsoft.Json` con *advisory* vivo. Ambas en
[`docs/friction-log.md`](../docs/friction-log.md), que es entregable.

**Y se volvió a mirar si Alexa+ se había abierto.** No: la página de programa sigue diciendo *select
partners*, y `@alexa/alexa-ai-cli` da **404 en npm** — la CLI existe pero no se distribuye, que es
exactamente lo que significa el aviso. Al comprobarlo apareció la fuente de la restricción de país
que yo había retirado de la deuda técnica por no encontrársela: estaba en lo cierto quien la escribió.

---

## Lo que queda

### Pendiente de decidir
- **Reiniciar Claude Code**: `hv@ovillo` pasó de 1.2.5 a **1.18.0** y pide reinicio
- **¿Entra `dotnet/` en el texto de envío?** Se acordó que no. Ahora existe y funciona, y callarlo
  también es una decisión
- **Con qué backend se graba el vídeo**, una vez probado en un Echo físico

### En código
Nada obligatorio. Lo considerado y descartado está en [`docs/roadmap.md`](../docs/roadmap.md).

**Una rugosidad encontrada el 22-09, sin decidir:** `campus.timetable` sólo acepta
`when: 'today' | 'tomorrow'` (`src/tools/index.ts:220`), lo cual es deliberado. Pero al preguntarle
«qué tengo el jueves» el modelo improvisa «la agenda del jueves no está disponible **en este
momento**» y remite a la intranet — es decir, **se inventa una caída temporal que no existe**. No
llega a violar UC-03 (no inventó ningún horario), pero la excusa sí es inventada. La causa probable
es que el límite vive sólo en el `enum` del esquema y no en la descripción de la herramienta.
Arreglo candidato: una línea en esa descripción. Obliga a redesplegar y a volver a probar contra el
modelo, porque lo único que demuestra que cambia de respuesta es verlo.

### Lo tuyo, y no es código
1. [ ] **Grabar el vídeo.** Guion en [`docs/management/video-script.md`](../docs/management/video-script.md), a 2:47 contra un límite duro de 3:00. **Rotular en pantalla que el altavoz es una skill CLÁSICA, no Alexa+**
2. [ ] **Que alguien AJENO recorra [`docs/adopting.md`](../docs/adopting.md)** y rellene la tabla del cronómetro. Validarla desde dentro no vale
3. [ ] **Revisar [`docs/management/devpost-submission.md`](../docs/management/devpost-submission.md)** antes de enviar: lo redactó Claude y va con tu nombre
4. [ ] Reenviar el formulario de créditos nombrando **Alexa+** (el rechazo fue por no nombrar track); ojo, es **uno por persona**
5. [ ] Mirar en Billing si el consumo de Bedrock sale de los 160 $

---

## Trampas conocidas

- **Guardado no es construido.** Tras tocar el modelo de interacción hay que pulsar **Build skill**.
  Mientras tanto Alexa contesta que no sabe ayudarte y **no invoca la Lambda** — cero logs, y es la
  pista que lo delata
- **No pruebes con el micrófono del portátil.** Coge a Alexa por los altavoces y la transcribe como
  si fuese tu siguiente frase. Escribe la pregunta
- **Hay valores que sólo el proveedor puede validar** (nombres de servicio, ARN de modelos, runtimes).
  Para esos el único test es el despliegue: es la **L-003**
- **La interfaz está congelada.** Se implementa, no se edita. Si algo obliga a moverla: actualizar
  `src/provider/frozen.ts` a mano, anotarlo en ADR-006 y repasar los dos adaptadores y las
  herramientas. Se ha hecho dos veces (ADR-017, ADR-019)
- **Al añadir cualquier entregable, al menos un test tiene que recorrer el transporte real** (L-002)
- Las credenciales de AWS **no están en el perfil `default`**: `AWS_PROFILE=lrea`
- La página pública **gasta dinero por pregunta** (Bedrock), con tope de 500 al día en DynamoDB.
  Para tirarlo todo: `cd infra && npx cdk destroy`

---

## Historial reciente

| Fecha | Trabajo principal |
|-------|-------------------|
| 2026-09-22 | Puente a un Echo real desplegado y verificado; IdP de demostración con PKCE; el principal de Alexa (L-003); guion re-presupuestado a 2:47 |
| 2026-09-20 | Carrigmore servido también en la nube (`/mcp/carrigmore`); los README de carpeta y la página, a inglés |
| 2026-09-17 | Destinos de un parte (ADR-018); dos enmiendas a la interfaz congelada (ADR-017, ADR-019); aulas en línea; barrido del repositorio público |
| 2026-09-16 | Interfaz congelada; demostrador web; dos fallos de transporte (ADR-011, ADR-012, L-002); M4 completo y desplegado |
| 2026-09-15 | M2 con UC-07; localización y tarjetas de M3; Bedrock verificado |
| 2026-09-14 | Arranque, M0 y M1 |
