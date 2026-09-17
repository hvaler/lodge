# Adopting Lodge

This guide is written for somebody who has never seen this repository, and it is meant to be timed.
If any step takes materially longer than it says, or leaves you unsure whether it worked, that is a
defect in this document and we would like to know.

**The claim it is testing:** an institution can have Lodge answering questions about its own campus
in an afternoon, because it is built against standards you already have rather than against an
integration somebody has to commission.

| Path | What you get | Target |
|---|---|---|
| [A](#a--see-it-work) | It answering questions about a generated campus | **5 min** |
| [B](#b--point-it-at-your-institution) | It answering questions about **yours** | **30 min** |
| [C](#c--deploy-it) | It running somewhere permanent | **20 min** |

You do not need to do them in order, but A is how you find out whether the rest is worth your time.

---

## Before you start

| You need | Check it with | If it is missing |
|---|---|---|
| Node 24 or newer | `node --version` | [nodejs.org](https://nodejs.org) — the pinned version is in `.nvmrc` |
| git | `git --version` | |
| Docker, for path B only | `docker --version` | |
| An AWS account, for path C only | | |

Nothing else. No database to install, no message broker, no account to create for paths A and B.

---

## A · See it work

```bash
git clone https://github.com/hvaler/lodge
cd lodge
npm install
```

> **Expected:** finishes in under a minute, no errors. 211 packages, of which **63 reach a
> deployment** — the other 148 are the compiler, the test runner and CDK, and none of them ship.
> Most of the 63 are the AWS SDK and OpenTelemetry, neither of which runs unless you configure it.

```bash
npm start
```

> **Expected**, on one line:
>
> ```
> Lodge :3000/mcp — Universidad de San Telmo, 6 tools: campus.find_room, campus.timetable, ...
>   OAuth: NOT CONFIGURED — this endpoint answers without a token
> ```
>
> The second line is not a warning you can ignore for a deployment. It is correct for this one.

You now have an MCP server. Ask it something — this is a raw protocol call, so you can see there is
no magic in the middle:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-protocol-version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"campus.find_room","arguments":{"building":"MEN"}}}'
```

> **Expected:** a room, in Spanish, with a time and a capacity. Something like
> *"Libres de aquí a las 20:53: MEN-001, aula magna, 120 plazas…"*
>
> Spanish because the adapter declares `es-ES`. Yours will answer in whatever locale you declare.

**Or point a real client at it.** `http://localhost:3000/mcp` works with the MCP Inspector, Claude
Desktop, or anything else speaking Streamable HTTP. That is the point of the exercise: it is not our
client, it is anybody's.

### The demonstration, if you want to see it talk

```bash
npm run demo          # needs AWS credentials with Bedrock access
```

Opens a page on `:8080` that speaks and listens, shows every tool call it made, and lets you switch
institution. Lodge itself stays on `:3000` — the page is an ordinary MCP client talking to it over
HTTP, which is why switching institution changes what the agent can do.

There is also one running that needs nothing at all — **[open it](https://5fugfo2nx7ajeymmf62fjqssou0bgdvq.lambda-url.eu-west-1.on.aws/)**. It serves
San Telmo only and answers a bounded number of questions a day; the local one has neither limit.

---

## B · Point it at your institution

This is the part that decides whether Lodge is useful to you. It needs three things you almost
certainly already have, and it needs **none of them to be perfect** — configure what you have, and
the tools you cannot support simply are not published.

| Source | Format | Gets you |
|---|---|---|
| Room list | CSV | `campus.find_room`, `campus.wayfind` |
| Timetable feed | iCalendar | occupancy, and `campus.timetable` with a directory |
| Deadlines feed | iCalendar | `campus.deadlines` |
| Directory | LDAP | whose timetable it is |
| Service desk | a webhook, or Jira | `campus.report_issue`, and `campus.issue_status` if it can be read back |

### 1 · The room list

A CSV with a header row. `fixtures/carrigmore/rooms.csv` is a working example:

```csv
room_id,building_code,building_name,floor,kind,capacity,equipment,supervised
QUA-G01,QUA,Quay House,0,lecture,150,"projector;screen;PA system",false
```

`kind` is one of `lecture`, `seminar`, `lab`, `computer-lab`, `study`, `auditorium`. `equipment` is
semicolon-separated and **in your own words** — they are read back to people verbatim, so write
what your staff call things. `supervised` rooms are never offered as free.

### 2 · Your feeds

Any iCalendar URL or file. Room bookings for the timetable, administrative dates for the deadlines.
If your timetable system can export an `.ics` per room or per programme, that is what this wants.

### 3 · The configuration file

```json
{
  "adapter": "standards",
  "standards": {
    "institution": "Your College",
    "locale": "en-IE",
    "timeZone": "Europe/Dublin",
    "inventory": { "location": "/srv/rooms.csv" },
    "calendars": {
      "timetable": "https://timetable.example.ie/feed.ics",
      "deadlines": "https://registry.example.ie/dates.ics"
    },
    "directory": {
      "url": "ldap://directory.example.ie:389",
      "bindDN": "cn=lodge,ou=services,dc=example,dc=ie",
      "bindPassword": "…",
      "baseDN": "ou=people,dc=example,dc=ie",
      "groupsDN": "ou=modules,dc=example,dc=ie",
      "subjectAttribute": "uid"
    }
  }
}
```

Add an `issues` block naming **one** destination and the agent can file faults into the system you
already watch — a webhook you wire to anything, or Jira. A webhook can receive a report and cannot
answer "how is mine going", so that institution publishes one tool and not two; the catalogue tells
the truth either way.

Omit any block you cannot fill. `ops/environment/README.md` has the full reference.

```bash
LODGE_CONFIG=/path/to/yours.json npm start
```

> **Expected:** the same startup line, with **your** institution's name and however many tools your
> sources support. If a feed URL is wrong the server refuses to start and says which one — you
> should find out now, not the first time a student asks.

### 4 · Try it against a directory

`ops/environment/` has a compose file that runs Lodge next to an OpenLDAP seeded with a fictional
college, so you can see the directory path working before pointing it at yours:

```bash
cd ops/environment
docker compose up -d
curl -s localhost:3000/health
```

> **Expected:** JSON naming two institutions and their tool counts.

---

## C · Deploy it

**Your own infrastructure.** The compose file above is the deployment. One container, one config
file, your credentials. Nothing reaches a cloud.

**AWS**, if you want it managed:

```bash
cd infra
npx cdk bootstrap     # once per account and region
npx cdk deploy
```

> **Expected:** about a minute, ending in a function URL. One Lambda, one DynamoDB table for the
> fault queue, one log group.

It goes where your AWS profile points, `eu-west-1` if it says nothing, and `LODGE_REGION`
overrides both. The model profile has to match the region's geography — the stack refuses to
synthesise otherwise rather than deploying something that fails on the first question.

### Protecting it

Lodge verifies tokens; it does not issue them, and it is not somewhere for your students'
passwords to live. Name your own identity provider:

```json
"auth": {
  "issuer": "https://login.example.ie",
  "jwksUri": "https://login.example.ie/.well-known/jwks.json",
  "scopes": ["lodge.read"]
}
```

and tell Lodge the URL clients reach it on, because tokens are bound to it:

```bash
LODGE_PUBLIC_URL=https://lodge.example.ie
```

> **Expected:** a request with no token now gets `401` and a `WWW-Authenticate` header pointing at
> `/.well-known/oauth-protected-resource/mcp`, which is where a client goes to find out who issues
> tokens for you.

Without `LODGE_PUBLIC_URL` **no token is checked at all**, and the server says so loudly at
start-up. That is deliberate: accepting a token minted for somebody else's server is worse than
having no OAuth, because it looks like having some.

---

## When something goes wrong

| What you see | What it is |
|---|---|
| `campus.timetable` missing from the catalogue | No directory configured. Without knowing who is asking there is no timetable to give, so the tool is not published rather than published and failing |
| `Para eso tienes que identificarte` | The tool needs an identity and the request carried none. Expected without OAuth configured |
| The container exits immediately | A source it cannot read. The message names the file or URL |
| Deadlines land a day out | Almost always a timezone. Check `timeZone` is the IANA name for the campus, not the server |
| `CredentialsProviderError` on `npm run demo` | Bedrock needs AWS credentials. Only the demonstration does; the server itself never calls a model |

---

## Writing an adapter

If your sources are not a CSV, an iCalendar feed and LDAP — a student information system with its
own API, say — you write an adapter. It is one interface, eight optional methods, and you implement
only what you can answer. See **[writing-an-adapter.md](writing-an-adapter.md)**.

---

## The stopwatch

This guide claims three numbers. Somebody who did not build Lodge should check them on a clean
machine and write down what actually happened.

| Path | Target | Actual | Validated by | Date | Where it snagged |
|---|---|---|---|---|---|
| A · See it work | 5 min | | | | |
| B · Your institution | 30 min | | | | |
| C · Deploy | 20 min | | | | |

> **Not yet validated.** The table is empty on purpose. Filling it in from the inside would defeat
> the point, and a guide that claims to be verified when it is not is worse than one that admits it.
