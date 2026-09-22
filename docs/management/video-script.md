# Vídeo de entrega — guion

**Límite duro: 3:00.** Presupuestado a **2:47** para dejar margen de montaje. Si algo se sale, cae
la sección 6 antes que cualquier otra — son diecisiete segundos de reserva de emergencia.

Público: un jurado que ha visto veinte asistentes conversacionales esta semana. Lo que tiene que
quedarle es **que esto no es un chatbot más**, y eso se demuestra en la sección 5, no diciéndolo.

| Ajuste | Valor |
|---|---|
| Publicación | YouTube o Vimeo, **público**, menos de 3 min |
| Grabación | 1920×1080, navegador a pantalla completa, sin barra de marcadores |
| Narración | En inglés, igual que la interfaz. Lo que sale **en español son las respuestas**, porque el idioma lo declara la institución y no la página: eso es el argumento |
| Audio | La voz se oye de verdad, del altavoz y del navegador. No lo silencies |
| Preparar antes | `npm run demo` (levanta también el proveedor de identidad en `:9000`), pestaña en `localhost:8080`, **sesión cerrada**, y el Echo emparejado con la skill desplegada |

> **Lo que hay que decir en pantalla, sin excusas.** El plano del altavoz es una **skill clásica**,
> no Alexa+. El registro de complementos de Alexa+ está limitado a socios seleccionados y nadie que
> se presente puede registrar uno. Se rotula en el propio plano y se repite en la descripción.
> Presentarlo de otra forma sería deshonesto, y además innecesario: lo que prueba el altavoz es que
> el servidor es real, no que tengamos un acuerdo con Amazon.

---

## 1 · Un altavoz, en una mesa · 0:00 – 0:20

**En pantalla** — Un Echo sobre una mesa. Nada de navegador todavía.

> «Alexa, pregunta a la conserjería qué aula está libre ahora en Mendizábal.»

*(Silencio. Que se oiga el «un momento, lo miro» y luego la respuesta entera. No narres encima.)*

**Rótulo, fijo mientras dura el plano** — *Classic Alexa skill. The Alexa+ add-on registry is limited
to selected partners.*

> A student needs a room, right now. The timetable is in one system, the room list in another, and
> the answer used to be a phone call to a desk that closes at six.

---

## 2 · No es un chatbot: es un servidor MCP · 0:20 – 0:45

**En pantalla** — Corte al navegador. La misma pregunta, la misma respuesta, y debajo la traza:
`campus.find_room {"building":"MEN"}` con sus milisegundos.

> That speaker and this page are two different clients of the same thing, and neither of them knows
> anything about rooms. That is a real tool call, over the Model Context Protocol.

**En pantalla** — Dos segundos de Inspector MCP, o del `curl` crudo, contra la misma URL.

> Alexa today, somebody's laptop assistant tomorrow. The institution publishes once and stops
> choosing clients.

---

## 3 · Quién pregunta, y cómo se sabe · 0:45 – 1:14

**En pantalla** — Clic en **Iniciar sesión**. Aparece la pantalla del proveedor. Elegir *Estudiante
de Derecho*. Vuelta a la página, ya con sesión. Preguntar *«¿Qué tengo mañana?»*.

> That was an authorization code with PKCE, and what came back is a signed token. Lodge verifies it;
> it never issues one — an institution already has an identity provider, and nobody wants a second
> place where student passwords live.

**En pantalla** — Cerrar sesión, entrar como *Estudiante de Informática*, **la misma pregunta**.
Respuesta distinta. Corte rápido: lo que importa es el contraste, no repetir el trámite.

> Same question, two people, two answers. The identity is in the token, never in a parameter —
> there is nowhere to put a name, so no agent can ask for somebody else's timetable.

---

## 4 · No escribe nada sin un sí · 1:14 – 1:37

**En pantalla** — Entrar como *Profesor con avisos abiertos*. Sugerencia *«El proyector de MEN-203
no funciona»*. El agente pregunta. Escribir **sí**. Se abre el parte y aparece la tarjeta con la
referencia.

> It asks first, and files nothing while it is asking.

*(Pausa. Que se oiga la confirmación.)*

> Two tool calls, and the first one never writes.

---

## 5 · El momento · 1:37 – 2:17

> Here is the part that matters.

**En pantalla** — Clic en **Carrigmore College**. **Detenerse en la barra lateral**: tres
herramientas se tachan. Dos segundos de silencio sobre eso.

> A different institution. Same server, same process. Three of the tools just disappeared — and
> nothing in that page decided that. It read the catalogue from the server.

**En pantalla** — Sugerencia *«The projector in QUA-G01 is broken»*. El agente responde en inglés y
**la traza queda vacía**.

> Watch the call trace. Empty. It did not decline — it *cannot*. Carrigmore has no fault tracker
> configured, so the tool was never in the list it was handed.

**En pantalla** — Señalar que la respuesta está en inglés.

> And it answered in English, because that is what this institution declares.

---

## 6 · Por qué encaja en una tarde · 2:17 – 2:34

*(Primera sección en caer si hay que recortar. Diecisiete segundos de reserva.)*

**En pantalla** — El editor con `rooms.csv`, un `.ics` y el bloque LDAP del fichero de configuración,
tres segundos cada uno.

> Carrigmore is not an integration anybody commissioned. It is a room list as CSV, two iCalendar
> feeds, and an LDAP directory — things every institution already has. One config file, no code.

---

## 7 · Está funcionando · 2:34 – 2:47

**En pantalla** — El navegador en la URL de AWS, `/health` respondiendo con las dos instituciones.

> It is deployed, it is open source, and the link is in the description. Two hundred and fourteen
> milliseconds from Spain.

**Último fotograma** — La URL y el repositorio, fijos dos segundos.

---

## El presupuesto, por si hay que recortar en el montaje

| § | Qué | Duración | Acumulado |
|---|---|---:|---:|
| 1 | Un altavoz, en una mesa | 20 s | 0:20 |
| 2 | Es un servidor MCP | 25 s | 0:45 |
| 3 | Quién pregunta | 29 s | 1:14 |
| 4 | No escribe sin un sí | 23 s | 1:37 |
| 5 | **El momento** | 40 s | 2:17 |
| 6 | Encaja en una tarde | 17 s | 2:34 |
| 7 | Está funcionando | 13 s | 2:47 |

Trece segundos por debajo del límite. Si se pasa: cae la 6 entera (quedan 2:30), y después se
recorta la 3 dejando un solo inicio de sesión.

---

## Lista de comprobación antes de subir

- [ ] Menos de 3:00 **cronometrado**, no estimado
- [ ] El rótulo de «classic Alexa skill, not Alexa+» **se lee** en el primer plano
- [ ] Se oye la voz al menos dos veces: la del altavoz y la del navegador
- [ ] La traza de llamada se lee a pantalla completa (el tamaño de fuente aguanta a 1080p)
- [ ] La barra lateral con las herramientas tachadas se ve **quieta** al menos dos segundos
- [ ] En el inicio de sesión se ve la URL del proveedor, y que **no** es la de Lodge
- [ ] Ningún dato real de ninguna institución: San Telmo y Carrigmore son ficticias
- [ ] Ninguna credencial visible — revisar la terminal y la barra de direcciones antes de grabar
- [ ] Vídeo **público**, no «no listado» si las bases piden público
- [ ] Descripción con: repositorio, URL desplegada, licencia Apache-2.0, y que el altavoz es una
      skill clásica porque el registro de Alexa+ está cerrado
