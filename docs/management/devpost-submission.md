# Devpost — texto de envío

Borrador para pegar en el formulario. **Revísalo antes de enviar**: lo escribí yo, y va con tu
nombre.

Al final está la lista de campos del formulario con qué marcar en cada uno, que es lo que de verdad
bloquea el envío.

---

## Project name

```
Lodge
```

## Tagline

```
The porter's lodge that never closes: a self-hosted MCP server that answers campus questions by
voice, over the standards every institution already has.
```

---

## Inspiration

A student needs somewhere to work between classes. The room list is in one system, the timetable in
another, and the answer is a phone call to a desk that closes at six.

Universities have spent a decade deploying conversational assistants into this gap, and almost all
of them are dead ends: they live inside a widget, they cannot be composed, and they die with the
contract that paid for them. Meanwhile the integration itself — the part that costs real money — is
commissioned from scratch every single time, for data the institution already exports.

Lodge starts from the opposite end. **It is not built for one university.** It is built against
iCalendar, LDAP and a room list as CSV, because an institution that has a campus already has those.
The result is something you configure in an afternoon instead of something you procure.

## What it does

Lodge is a Model Context Protocol server. It publishes six tools — find a free room, my timetable,
an administrative deadline, directions, report a fault, chase that fault — and any agent can speak
to it. Alexa+ today, somebody's laptop assistant tomorrow. The institution publishes once and stops
choosing clients.

Four things it does that a chatbot in a widget does not:

**It answers in the institution's own language.** San Telmo declares `es-ES` and answers in Spanish,
including its own words for equipment. Carrigmore declares `en-IE` and answers in English. Nothing
is translated that belongs to the institution.

**Each person sees only their own.** Identity travels in the token, never in a parameter. The
timetable query type has exactly one field — the time window — so there is nowhere for an agent to
put somebody else's name. The guarantee is structural, not a rule a model is asked to follow.

**It never writes without a yes.** Reporting a fault takes two tool calls. The first validates the
room and the equipment, returns the question to ask, and writes nothing.

**The catalogue comes from what the institution can actually answer.** This is the one to watch.
Point Lodge at an institution with no fault tracker and `campus.report_issue` is not published — so
the agent does not decline to file a fault, it *cannot*, because the tool was never in the list it
was handed. One server answers for several institutions, each with its own catalogue, its own
language, its own timezone and its own identity provider.

## How we built it

TypeScript on Node 24, no build step in development. Everything sits behind one frozen interface:

```
MCP client  →  server (Streamable HTTP, stateless)  →  provider interface  →  adapter
```

**Two adapters, deliberately not one and not three.** One adapter fakes the seam; three are
craftwork that eats the calendar. `synthetic` generates the Universidad de San Telmo — three
buildings, 36 rooms, 2 066 seats, six programmes, a full academic year — deterministically from a
seed, so anyone who clones the repository gets the answers in the video. `standards` reads
iCalendar, LDAP and CSV.

Having two is what forced the seam to be real. The interface gained four fields before we froze it,
and **two of them came from the second adapter** — an optional teaching group, because not every
institution splits a cohort, and an optional walking time, because a room list is not a distance
matrix. With one adapter we would have required both and made the second one invent values, which
is exactly the fake seam two adapters exist to prevent.

**Stateless by transport**, so it replicates without coordination. That single property is what
makes the Lambda deployment thirty lines rather than a project.

**Lodge verifies OAuth 2.1 tokens; it does not issue them.** An institution names its own identity
provider in two lines of config. Tokens are bound to each institution's canonical URI (RFC 8707), so
one institution's token does not work at another's endpoint even though the same process serves
both. Nobody should have to deploy a second place where their students' passwords live.

**Two first-class deployment targets.** A distroless container with a config file and your own
credentials, reaching no cloud at all. And AWS — one Lambda, one DynamoDB table, one URL — because
the managed path should be documented, not required.

Because the Alexa+ add-on registry is limited to selected partners, we followed the hackathon's own
guidance and built the voice experience as a web app. It ships as open source rather than as a
throwaway, and it is an ordinary MCP client: it reads the tool catalogue from the live server over
HTTP, which is exactly why switching institution changes what it can do.

## Challenges we ran into

**Two features shipped broken behind a green test suite.** The visual cards and the confirmation
step both worked in 287 tests and in no deployment. Every test used an in-memory transport, which
keeps a session; Streamable HTTP builds a fresh server per request and does not. So
`getClientCapabilities()` was `null` on every real tool call, and `input_required` turned out to be
undeliverable on a 2025-era connection served per request — the error says it plainly:
*"per-request legacy serving cannot receive server-to-client requests"*.

We found both within an hour of each other, by wiring a real HTTP client for the first time. Cards
now attach unless the client says it has no screen; confirmation became a tool argument and a second
call, which works on every transport and is what a voice assistant does anyway.

**A latency number we believed for a day was wrong.** The Bedrock console playground enables
extended thinking by default, so a one-line question took 5 293 ms and we spent a day worrying the
demonstration was not viable. Through the API, off by default, the same question takes about 700 ms.

**Prompt caching turned out to be the opposite of what we enabled it for.** Measured across eighteen
exchanges, interleaved so network drift hit both configurations equally: billed input tokens fell
86 %, from 57 324 to 8 044. Median latency moved 1 966 ms → 1 894 ms, which is noise. We kept it,
and wrote down that it is a cost lever and not a speed one.

All of it is in the friction log, with the error messages.

## Accomplishments that we're proud of

**The interface was frozen and never had to move.** Eleven days early, with a snapshot the compiler
checks on every build. OAuth, the managed deployment, tracing and the web app all landed afterwards
and not one of them needed the contract to change.

**214 ms** end to end from Spain against the platform's 500 ms budget, network included, measured
against the deployed server rather than a laptop.

**Every acceptance criterion is a test.** Seven use cases, 352 tests over the source plus 15 over the
CloudFormation, run on every build — including under a distant timezone, because an iCalendar
all-day date used to mean different things in Dublin and Auckland.

**Least privilege we actually checked.** The function may run three DynamoDB operations, not the ten
`grantReadWriteData` hands out, and invoke exactly one model. The stack tests assert it.

## What we learned

**The transport is part of the system, not a connection detail.** At least one test per deliverable
has to go over the transport production uses, however slow and awkward. A suite that exercises a
shape no container runs will be green while the product is broken — it cost us two features in one
afternoon, and it is now the first thing the adapter guide tells anybody writing a third one.

Second: a check that cannot fail is not a check. We verified every safety net in this project by
deliberately breaking what it guards — the frozen interface, the token audience binding, the trace
continuation — and watching the right test go red before believing it.

## What's next for Lodge

Connectors for specific student information systems, which is the natural first addition and was
deliberately out of scope. A third adapter is one interface and eight optional methods, documented.

And the honest one: an institution walking the adoption guide on a clean machine with a stopwatch.
The guide claims five minutes to see it work and thirty to point it at your own campus. Those
numbers are ours until somebody else checks them.

The full list — including what we refused on purpose and what we know is missing — is in [`docs/roadmap.md`](https://github.com/hvaler/lodge/blob/main/docs/roadmap.md).

---

## Built with

```
typescript · node.js · model-context-protocol · amazon-bedrock · amazon-nova ·
aws-lambda · amazon-dynamodb · aws-cdk · opentelemetry · oauth2 · icalendar ·
ldap · docker · alexa
```

## Try it out

| | |
|---|---|
| Talk to it | https://5fugfo2nx7ajeymmf62fjqssou0bgdvq.lambda-url.eu-west-1.on.aws/ |
| MCP endpoint | https://4joapeibeg357e7vyw2dj4pnwa0tmpay.lambda-url.eu-west-1.on.aws/mcp |
| Source | https://github.com/hvaler/lodge |
| Friction log | https://github.com/hvaler/lodge/blob/main/docs/friction-log.md |
| Adoption guide | https://github.com/hvaler/lodge/blob/main/docs/adopting.md |

> The page serves the generated campus and answers a bounded number of questions a day, because each
> one calls a model. `npm run demo` runs the same thing locally with no limit — and with the second
> institution, which is the part worth seeing.

---

## Lista del formulario

Esto es lo que bloquea el envío. Nada de aquí lo puedo hacer yo.

- [ ] **Track**: Alexa+ / MCP
- [ ] **Mini-reto 1**: AWS Builder
- [ ] **Mini-reto 2**: Open Source
- [ ] **Vídeo**: enlace público de YouTube o Vimeo, **menos de 3:00** — guion en `video-script.md`
- [ ] **Repositorio**: https://github.com/hvaler/lodge (público, Apache-2.0)
- [ ] **Demostración accesible**: las dos URL de arriba
- [ ] **Feedback de producto / registro de fricción**: enlazar `docs/friction-log.md`, o pegarlo si
      el formulario pide texto
- [ ] Enviar el **21 de octubre**. El cierre oficial es el 23 a las 21:00 CEST; esas 48 h cubren una
      regrabación o una caída de Devpost, no son holgura

> **Antes de darle a enviar**: comprueba que las dos URL responden. Están vivas hoy, y una
> demostración caída el día que la mira un jurado es peor que no tenerla.
