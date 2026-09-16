# Vídeo de entrega — guion

**Límite duro: 3:00.** Presupuestado a **2:55** para dejar margen de montaje. Si algo se sale, cae
la sección 7 antes que cualquier otra.

Público: un jurado que ha visto veinte asistentes conversacionales esta semana. Lo que tiene que
quedarle es **que esto no es un chatbot más**, y eso se demuestra en la sección 6, no diciéndolo.

| Ajuste | Valor |
|---|---|
| Publicación | YouTube o Vimeo, **público**, menos de 3 min |
| Grabación | 1920×1080, navegador a pantalla completa, sin barra de marcadores |
| Narración | En inglés. Lo que se ve está en español, y eso es parte del argumento |
| Audio | La voz del agente se oye de verdad — es el track de voz, no lo silencies |
| Preparar antes | `npm run demo`, pestaña en `localhost:8080`, identidad en *Sin identificar* |

---

## 1 · El problema · 0:00 – 0:12

**En pantalla** — La página, quieta. Solo la cabecera.

> A student needs a room, right now. The timetable is in one system, the room list in another, and
> the answer is a phone call to a desk that closes at six.

---

## 2 · Responde, en voz alta · 0:12 – 0:38

**En pantalla** — Clic en la sugerencia *«¿Qué aula está libre ahora en Mendizábal?»*. Se oye la
respuesta. Aparece la tarjeta de ocupación.

> Lodge is the porter's lodge that never closes. It answers by voice.

*(Silencio mientras habla el agente — tres segundos. No narres encima.)*

> Spanish, because this institution declares Spanish. The card underneath is an improvement, never
> the answer: most of what this is built for is a speaker with no screen at all.

---

## 3 · No es un chatbot: es un servidor MCP · 0:38 – 1:03

**En pantalla** — Señalar la traza de llamada bajo la respuesta: `campus.find_room {"building":"MEN"}`
y sus milisegundos.

> That is a real tool call, over the Model Context Protocol. Not a prompt that was told about rooms
> — a server any agent can speak to.

**En pantalla** — Cambiar a una terminal con el Inspector MCP apuntando a la misma URL, o al
`curl` crudo. Dos segundos, sin detenerse.

> Alexa+ today, somebody's laptop assistant tomorrow. The institution publishes once and stops
> choosing clients.

---

## 4 · Cada uno ve lo suyo · 1:03 – 1:23

**En pantalla** — Seleccionar *Estudiante de Derecho*, preguntar *«¿Qué tengo mañana?»*. Luego
*Estudiante de Informática*, la misma pregunta. Respuestas distintas.

> Same question, two people, two answers. The identity travels in the token, never in a parameter —
> there is nowhere to put a name, so no agent can ask for somebody else's timetable.

---

## 5 · No escribe nada sin un sí · 1:23 – 1:48

**En pantalla** — *Profesor con avisos abiertos*. Sugerencia *«El proyector de MEN-203 no funciona»*.
El agente pregunta. Escribir **sí**. Se abre el parte y aparece la tarjeta con la referencia.

> It asks first, and files nothing while it is asking.

*(Pausa. Que se oiga la confirmación.)*

> Two tool calls, and the first one never writes.

---

## 6 · El momento · 1:48 – 2:28

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

## 7 · Por qué encaja en una tarde · 2:28 – 2:45

*(Primera sección en caer si hay que recortar.)*

**En pantalla** — El editor con `rooms.csv`, un `.ics` y el bloque LDAP del fichero de configuración,
tres segundos cada uno.

> Carrigmore is not an integration anybody commissioned. It is a room list as CSV, two iCalendar
> feeds, and an LDAP directory — things every institution already has. One config file, no code.

---

## 8 · Está funcionando · 2:45 – 2:55

**En pantalla** — El navegador en la URL de AWS, `/health` respondiendo.

> It is deployed, it is open source, and the link is in the description. Two hundred and fourteen
> milliseconds from Spain.

**Último fotograma** — La URL y el repositorio, fijos dos segundos.

---

## Lista de comprobación antes de subir

- [ ] Menos de 3:00 **cronometrado**, no estimado
- [ ] Se oye la voz del agente al menos dos veces
- [ ] La traza de llamada se lee en pantalla completa (el tamaño de fuente aguanta a 1080p)
- [ ] La barra lateral con las herramientas tachadas se ve **quieta** al menos dos segundos
- [ ] Ningún dato real de ninguna institución: San Telmo y Carrigmore son ficticias
- [ ] Ninguna credencial visible — revisar la terminal antes de grabar
- [ ] Vídeo **público**, no «no listado» si las bases piden público
- [ ] Descripción con: repositorio, URL desplegada, licencia Apache-2.0
