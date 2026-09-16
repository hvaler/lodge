# Lodge

> The porter's lodge that never closes.

A self-hosted **MCP server** that answers campus questions by voice —which room is free, where the
class moved to, when the deadline falls— running on the systems any institution already has.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24%20LTS-339933.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-2025--11--25-orange.svg)](https://modelcontextprotocol.io)

**Build, Ship, Shape: Amazon Developer Hackathon 2026** · Track Alexa+ · MCP · Mini-challenges: AWS
Builder and Open Source.

---

## The idea

What the porter knows lives in no system. It is scattered across a timetable pinned to a wall, an
email from the registry, the academic calendar and twenty years of memory. And it is only reachable
while the lodge is open.

Lodge exposes that knowledge as an MCP server so any agent can answer it at any hour. The decision
that defines the project: **it is not built for one university.** It is built against the standards
they all already use —iCalendar feeds, an LDAP directory, a room inventory in a table— so that an
institution deploys it in an afternoon instead of commissioning an integration.

**Why MCP and not one more chatbot.** Campus assistants live inside a widget, cannot be composed and
die with the contract. An MCP server is the opposite: any agent can consume it. Alexa+ on a speaker
today; the student's laptop assistant or the teaching platform tomorrow. The institution publishes
its capabilities once and stops picking a client.

## Tools

Published according to capabilities — nothing appears if the adapter does not support it. Write tools
confirm before acting: the first call validates and returns the question to ask, writing nothing;
the second carries `confirmed` and files it. Two calls, and the first one never writes.

| Tool | Question it answers | Level |
| :-- | :-- | :-- |
| `campus.find_room` | "Where can I study right now?" | read |
| `campus.timetable` | "What do I have first thing tomorrow?" | read |
| `campus.deadlines` | "When does enrolment close?" | read |
| `campus.wayfind` | "How do I get to the exam room?" | read |
| `campus.report_issue` | "The projector in room 203 won't start" | **write** |
| `campus.issue_status` | "Any news on the fault I reported?" | read |

Acceptance criteria for each: [`docs/use-cases.md`](docs/use-cases.md).

## Adapters

Generalising is the classic scope trap. The discipline is numerical: one adapter fakes the seam,
three are goldsmithing, **two force it to be real**.

| Adapter | Source | Purpose |
| :-- | :-- | :-- |
| `synthetic` | Deterministic generator | Reference, demo, reproducibility. It is the [University of San Telmo](docs/san-telmo.md) |
| `standards` | iCalendar · LDAP · CSV | What any institution already has, with nothing to build |

**Explicitly out of scope:** connectors for specific teaching platforms. They are the natural first
addition *after* the hackathon.

## Status

🚧 **Under construction.** Milestone M0 (foundations) — the code lands from M1 on.

| Milestone | Dates | Output |
| :-- | :-- | :-- |
| M0 | 15–17 Sep | Reference dataset closed |
| M1 | 18–27 Sep | Answers a generic MCP client |
| M2 | 28 Sep–4 Oct | The seam is real, not a promise |
| M3 | 5–11 Oct | Full end-to-end conversation |
| M4 | 12–16 Oct | Two deployment targets working |
| M5 | 17–20 Oct | Installable by a stranger |
| M6 | 21 Oct | Submitted |

Full plan, architecture, pinned versions and cut rules: **[`RUNBOOK.md`](RUNBOOK.md)**
([versión en español](RUNBOOK.es.md)).

## Architecture

```
MCP client (Alexa+ / our own orchestrator / any agent)
        │
        ▼
MCP server  ──  Streamable HTTP, stateless, server/discover
        │
        ▼
Provider interface  ──  capabilities + locale
        │
   ┌────┴────┐
   ▼         ▼
synthetic  standards
(San Telmo) (iCalendar · LDAP · CSV)
```

**The core runs anywhere; AWS is a destination, not a requirement.** A project that hopes to be
adopted by any institution cannot demand a cloud account. Two first-class deployment targets:

- **Self-hosted** — distroless container plus a compose file. One config file and your own credentials.
- **Managed** — AWS Lambda · DynamoDB · CDK v2. The documented path for the AWS mini-challenge.

## Requirements

- Node 24 LTS
- An MCP client speaking MCP revision 2025-11-25 over Streamable HTTP
- An OAuth 2.1 authorization server, if you want the endpoint protected. Lodge verifies tokens; it
  does not issue them, and it is not somewhere for your students' passwords to live. Name your own
  issuer in the config file (`ops/environment/README.md`)
- For the demonstration orchestrator only: an AWS account with Bedrock access. Defaults to Nova 2
  Lite in `eu-west-1`; `LODGE_BEDROCK_REGION` moves it

## Getting started

> Installation instructions land in **M5**, and they are validated against the clock on a clean
> machine by someone outside the project. Until then this section is deliberately empty rather than
> aspirational.

### Seeing it work

```bash
npm install
npm run demo      # needs AWS credentials for Bedrock
```

Two servers start. **Lodge itself** on `:3000`, serving `/mcp/san-telmo` and `/mcp/carrigmore` —
point the MCP Inspector or your own client at either. And the **demonstration** on `:8080`, a web
page that speaks, listens, and shows every tool call it made.

They are separate processes talking over HTTP on purpose: the demonstration is an ordinary MCP
client, so what you see it do, your own agent can do.

Worth trying, in this order:

1. Ask San Telmo for a free room. Note the card under the answer.
2. Say a projector is broken. It asks before filing anything; answer **sí** and it files it.
3. Switch to **Carrigmore** and say a projector is broken there. It cannot — no issue tracker is
   configured, so `campus.report_issue` was never in the catalogue it was handed.

Carrigmore runs from the CSV and iCalendar files in `fixtures/`, with no directory configured, so
it publishes no timetable either. Add LDAP (`ops/environment/docker-compose.yml`) and the tool
appears, without a rebuild.

### It is running

```
https://4joapeibeg357e7vyw2dj4pnwa0tmpay.lambda-url.eu-west-1.on.aws/mcp
```

Point an MCP client at it, or open `/health` in a browser to see what it is serving. It answers in
**214 ms** from Spain, network included, against the platform's 500 ms budget.

This is a **public sandbox over a fictional university**: the `x-lodge-dev-subject` header lets any
caller claim any identity, so you can ask for a timetable or file a fault without an identity
provider in the way. That is only defensible because the Lambda entrypoint builds the generated
campus and has no path to real institutional data. A real deployment configures an issuer instead
and the header does nothing.

### Deploying it

Two first-class targets, and the core does not know which it is running on.

**Your own infrastructure** — a container, a config file and your own credentials.
`ops/environment/` has both, and nothing in it reaches a cloud.

**AWS** — one function, one table and a URL:

```bash
cd infra
npx cdk deploy                    # protected by whatever issuer you configured
npx cdk deploy -c sandbox=true    # public demonstration over the generated campus
```

Defaults to `eu-west-1`; `CDK_DEFAULT_REGION` moves it. The table holds the fault queue and nothing
else — the campus itself is generated at start-up, so there is no dataset to seed and no migration
to run. `-c sandbox=true` switches on the development identity header, which lets any caller name
themselves; it is off otherwise, and it is only defensible here because the Lambda entrypoint builds
the fictional institution and has no path to a real one.

```
Lambda (nodejs24.x, arm64, 512 MB)   the same six tools, the same answers
DynamoDB (on demand)                 the fault queue, partitioned by who filed it
Function URL (no authorizer)         so a client needs an MCP client, not an AWS account
```

## Data and privacy

The **University of San Telmo** is fictional: three buildings, six degree programmes and an academic
calendar, all **generated, not anonymised**. This project contains no data, branding, systems or
naming from any real institution, and requires authorisation from none.

The server returns data belonging to whoever is asking, stores no student records and runs on the
institution's own infrastructure.

## Licence

[Apache-2.0](LICENSE) — see [`NOTICE`](NOTICE).
