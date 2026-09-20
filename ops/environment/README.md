# `ops/environment/` — the self-hosted deployment

What an institution needs to run Lodge on its own infrastructure: a container, a configuration file
and its own credentials. No cloud.

| File | What for |
|---|---|
| `docker-compose.yml` | Lodge plus an OpenLDAP holding Carrigmore's directory, to exercise the `standards` adapter against a real directory |
| `carrigmore.json` | One institution: the ordinary case, served at `/mcp` |
| `demo.json` | Two institutions: UC-07, served at `/mcp/{slug}` |

```bash
docker compose up -d          # from this folder
curl localhost:3000/health    # what it is serving, and with how many tools
```

Carrigmore's files (`rooms.csv`, `timetable.ics`, `deadlines.ics`, `directory.ldif`) live in
`fixtures/carrigmore/` and are mounted **read-only**: Lodge answers questions, and has nothing to
write into an institution's data.

---

## The configuration file

Which adapter, where its sources are, and who vouches for its people. Read once at start-up and
validated loudly: a mistyped URL should make the container refuse to start, not make a student's
first question fail.

```json
{
  "adapter": "standards",
  "standards": {
    "institution": "Carrigmore College",
    "locale": "en-IE",
    "timeZone": "Europe/Dublin",
    "inventory": { "location": "/srv/carrigmore/rooms.csv" },
    "calendars": {
      "timetable": "/srv/carrigmore/timetable.ics",
      "deadlines": "/srv/carrigmore/deadlines.ics"
    },
    "directory": { "url": "ldap://directory:1389", "...": "..." }
  },
  "auth": {
    "issuer": "https://login.carrigmore.ie",
    "jwksUri": "https://login.carrigmore.ie/.well-known/jwks.json",
    "scopes": ["lodge.read"]
  }
}
```

### Rooms, without a CSV

`inventory` takes either form, and **exactly one**: a `location` pointing at a CSV, or the rooms
written out right here. A place with three hundred rooms wants the spreadsheet; one with twelve does
not want a second file for twelve lines.

```json
"inventory": {
  "rooms": [
    { "id": "QUA-G01", "building": "QUA", "buildingName": "Quadrangle",
      "floor": 0, "kind": "lecture", "capacity": 150,
      "equipment": ["projector", "lectern microphone"] },
    { "id": "MIL-004", "building": "MIL", "buildingName": "Mill House",
      "floor": 0, "kind": "study", "capacity": 8, "supervised": true }
  ],
  "buildings": [
    { "code": "QUA", "name": "Quadrangle", "weekdays": "08:00-21:00", "saturday": "09:00-13:00" }
  ]
}
```

They are the same rooms: every field is a column of the CSV, they go through the same validator and
they earn the same error messages. `kind` is one of `lecture`, `seminar`, `lab`, `computer-lab`,
`study`, `auditorium`; `equipment` is read back exactly as you write it, in your own words;
`supervised` marks the rooms that are never offered as free.

`buildings` stays optional even alongside `rooms`: a building with no hours is treated as **always
open**, because saying nothing about closing is not the same as closing always. A day with no window
(`sunday` absent) *is* a closed day.

**A timetable cannot be written here**, and that is deliberate: a room list is a fixed set written
once, while a timetable is thousands of dated sessions. Expressing recurrence by hand would be a
worse `RRULE` than the one iCalendar already has. No feed? Export an `.ics` from whatever calendar
you already keep and point `calendars.timetable` at the local file.

---

**The catalogue comes from what you configure.** Without `directory` there is no `campus.timetable`,
because without knowing who is asking there is no timetable to give. Without `inventory` nothing
about rooms is published at all. And with `inventory` but no timetable feed there is still no
`campus.find_room`, because calling a room free without occupancy would be guessing — though
directions and fault reports both survive. Nothing is offered by halves.

---

## OAuth 2.1

Lodge **verifies** tokens; it does not issue them (ADR-013). The `auth` block names the identity
provider the institution already has, and two more things are needed:

```bash
LODGE_PUBLIC_URL=https://lodge.carrigmore.ie   # the URL clients arrive on
```

Without it no token is checked, and the server says so at start-up. The reason is that a token is
bound to this server's **canonical URI** (RFC 8707): not knowing what that is leaves nothing to bind
to, and accepting a token issued for somebody else's server is worse than having no OAuth, because
it looks like having it.

With that, Lodge publishes where to look:

```
GET /.well-known/oauth-protected-resource/mcp
{
  "resource": "https://lodge.carrigmore.ie/mcp",
  "authorization_servers": ["https://login.carrigmore.ie"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["lodge.read"]
}
```

A client with no token gets a `401` whose `WWW-Authenticate` header points at that document, goes
and fetches one, and comes back. PKCE happens between the client and the identity provider; Lodge
never sees it.

If your IdP's `sub` is an opaque identifier and the directory indexes by something else — the same
LDAP `uid`, say — then `"subjectClaim": "uid"` says which of the two to follow.

> **`LODGE_DEV_IDENTITY=1`** lets anyone say who they are through a header. It is an authentication
> bypass, it exists for the demonstration and for development, and it has no use in a deployment.
> The server warns when it is on.

---

## Where fault reports go

Without this block, `campus.report_issue` is not published and the agent **cannot** file anything.
With it, faults land in the system you already watch. **Exactly one destination**: two would open two
tickets for one projector.

The simplest, and the one you genuinely already have: **an email address**.

```json
"issues": {
  "email": {
    "to": "servicedesk@example.ie",
    "from": "lodge@example.ie",
    "host": "smtp.example.ie",
    "port": 587,
    "user": "...", "password": "..."
  }
}
```

A plain-text message arrives with labelled lines — reference, room, equipment, who and when — and a
subject led by the reference: `[LDG-7K2MPQ] projector in QUA-G01 — …`.

Here **Lodge does mint the reference**, unlike the webhook, and that is not an inconsistency: a
webhook belongs to a system that assigns its own, whereas a mailbox assigns nothing until somebody
triages the message. Until then no identifier exists, and the one Lodge writes **into the subject**
is the only thing both sides can search for. The alphabet avoids `O`, `0`, `I`, `1` and `L`, because
that reference gets spoken by a synthesiser, repeated by a person, and typed by somebody at the desk.

Or a webhook, if you would rather wire it to something yourself:

```json
"issues": {
  "webhook": {
    "url": "https://servicedesk.example.ie/faults",
    "referenceField": "id",
    "headers": { "x-api-key": "..." }
  }
}
```

Lodge `POST`s this body, which is stable and which you can map onto anything:

```json
{
  "room": "QUA-G01", "equipment": "projector", "note": "",
  "reportedBy": "u-1001", "reportedAt": "2026-10-06T15:30:00.000Z",
  "institution": "Carrigmore College", "source": "lodge"
}
```

`referenceField` says which field of *your* answer the reference comes from (nesting is fine:
`data.ticket.id`). It is **required**: it is what the person quotes back to you later, and handing
them a number of ours would be handing them one that means nothing to whoever they say it to. If you
do not return one, filing fails and says so out loud.

Or Jira, which can also answer "how is mine going":

```json
"issues": {
  "jira": {
    "url": "https://example.atlassian.net",
    "project": "FM",
    "email": "lodge@example.ie",
    "token": "...",
    "issueType": "Task"
  }
}
```

It attributes with a **label** (`lodge-<subject>`) rather than the `reporter` field, because that
would require a Jira account per student. Status comes from the status *category* and not its name,
which every project renames to taste.

| You configure | You get |
|---|---|
| nothing | neither of them |
| `email` | `campus.report_issue` |
| `webhook` | `campus.report_issue` |
| `jira` | `campus.report_issue` and `campus.issue_status` |

Email and a webhook receive and cannot be asked back, so they do not publish `campus.issue_status`.
That is not a gap to paper over: it is the catalogue telling the truth.

Filing a fault checks the room and its equipment before asking anyone to confirm, so it needs the
**inventory** — and only that. No timetable feed is required: if you cannot export one, you can
still report faults. Without the inventory the server refuses to start and says why.

---

## Traces

Off until you say where to send them:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318
```

Without that variable Lodge does not load the SDK, does not open a connection and exports nothing.
With it, every MCP request produces a span, and under it appear the ones that really go somewhere: a
directory lookup, or reading a calendar.

What makes this useful rather than mere hygiene is that **the trace continues the client's**. If
your agent propagates W3C context — through the `traceparent` header or the request's `_meta` — you
see one picture from the student's question down to the LDAP lookup it caused, instead of two
disconnected ones.

One detail about the directory: the span wraps the real lookup, not the cache. A trace with no
directory span means that answer came out of memory.

If you prefer the standard OpenTelemetry path — starting Node with `--import` and your own SDK
bootstrap — that works too: the spans find your provider and this variable is unnecessary.

## Several institutions

`demo.json` serves two at once, each on its own path and with its own catalogue, language and time
zone. Each carries its own `auth` too: the identity provider belongs to the institution, not to the
deployment, and a token issued for one **is not valid for the other** even though the same process
serves both.

That is UC-07, and it is what justifies the provider interface existing at all.
