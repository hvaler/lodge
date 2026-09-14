# Lodge

> The porter's lodge that never closes.

A self-hosted MCP server that answers campus questions by voice — which room is free, where the class moved, when the deadline falls — running on the systems any institution already has.

| | |
| :-- | :-- |
| **Event** | Build, Ship, Shape: Amazon Developer Hackathon 2026 |
| **Primary track** | Alexa+ · MCP |
| **Mini-challenges** | AWS Builder · Open Source |
| **Priority** | First submission |
| **Internal submission** | October 21, 2026 |
| **Hard deadline** | October 23, 2026 · 12:00 PT |

> **Status:** living document. The frozen decision record dated 2026-09-14 explains *why* this shape was chosen; this file is what changes as we build.

---

## 1. The idea

What the porter knows is in no system. It is spread across a timetable pinned to a wall, an email from the registry, the academic calendar, and twenty years of memory — and it is only reachable while the lodge is open.

Lodge exposes that knowledge as an MCP server so Alexa+ can answer it at any hour. The defining decision: **it is not built for one university.** It is built against the standards every institution already runs — iCalendar feeds, an LDAP directory, a room inventory in a table — so an institution deploys it in an afternoon instead of commissioning an integration.

**Why MCP rather than another chatbot.** Campus assistants live inside a widget, cannot be composed, and die with the contract. An MCP server is the opposite: any agent can consume it. Alexa+ on a speaker today; the student's laptop assistant or the VLE's agent tomorrow. The institution publishes its capabilities once and stops having to pick a client.

## 2. Actors

| Actor | What they do | What they need |
| :-- | :-- | :-- |
| Student | Bulk of the volume: free rooms, timetable, deadlines, directions | An answer in seconds, no session, no prior context |
| Lecturer | Assigned room, office hours, reporting broken equipment | Reliability — failing five minutes before a class is a real problem |
| Porters / facilities | Never speak to the agent: they *receive* the tickets | Reports in the queue they already watch, not a second inbox |
| IT lead | Deploys, integrates, maintains | Directory, container, upgrades. The install guide is for this person |
| Data protection officer | Uses nothing. Can veto everything | Minimisation by design, deployment on own infrastructure |
| Third-party developer | Writes the adapter for their institution | Stable interface, extension docs |
| Systems | Calendars, directory, room inventory, ticketing | — |

Two consequences govern the project:

1. **The video speaks to the student; the documentation speaks to the IT lead.** Conflating them loses one of the two.
2. **A tool that opens tickets only makes sense if it writes into the queue facilities already review.** Generating reports nobody processes is failing with immaculate code.

## 3. Scope — the seam

Generalising is the classic scope trap. The discipline is numeric: one adapter fakes the seam, three are gold-plating, **two force it to be real**.

| Adapter | Source | Purpose |
| :-- | :-- | :-- |
| `synthetic` | Deterministic generator | Reference, demo, reproducibility. This is the University of San Telmo |
| `standards` | iCalendar · LDAP · CSV | What every institution already has, with nothing to build |

**Out of scope, explicitly:** connectors for specific learning platforms. The natural first addition *after* the hackathon.

**Capability negotiation.** Each adapter declares what it can do and which locale it works in, and the tool catalogue is derived from that declaration. An institution with no ticketing system does not publish those tools, and the agent never offers what does not exist. This is what makes "generic" mean something at runtime instead of being a promise in the README.

## 4. The demo institution

**University of San Telmo** — fictional, complete, generated (not anonymised).

- Three buildings: Mendizábal, Santa Clara, El Faro — floors, rooms, capacities, per-room equipment
- Six degree programmes with years, groups and realistic clashes
- An academic calendar: enrolment, exams, holidays
- Zero real data: no real person, no existing institution, no production system

## 5. Architecture

| # | Layer | Stack | Note |
| :-- | :-- | :-- | :-- |
| 01 | MCP server | TypeScript · Node 24 LTS · official SDK | Streamable HTTP, `server/discover`, stateless |
| 02 | Provider interface | Project core | Capability + locale declaration. **Frozen when M1 closes** |
| 03 | Adapters | `synthetic` · `standards` | Same contract, different origin |
| 04 | Visual cards | MCP Apps extension | Occupancy grid, floor plan, ticket detail |
| 05 | Demo orchestrator | Amazon Bedrock · Nova 2 Lite | Our own Alexa+ simulation; ships as open source |
| 06 | Identity | OAuth 2.1 · Client ID Metadata Documents | Each person sees only their own data |
| 07 | Self-hosted target | Container · compose | One config file, the institution's own credentials |
| 08 | Managed target | AWS Lambda · DynamoDB · CDK v2 | The path documented for the AWS mini-challenge |
| 09 | Observability | OpenTelemetry | Trace context in the protocol's own headers |

**The core runs anywhere; AWS is a target, not a requirement.** A project that hopes any institution adopts it cannot demand a cloud account.

## 6. MCP tools

Published according to capability. Write tools confirm through a multi round-trip request: the tool returns `input_required` and the client retries carrying the answer.

| Tool | Question it answers | Level |
| :-- | :-- | :-- |
| `campus.find_room` | "Where can I study right now?" | read |
| `campus.timetable` | "What do I have first thing tomorrow?" | read |
| `campus.deadlines` | "When does enrolment close?" | read |
| `campus.wayfind` | "How do I get to the exam room?" | read |
| `campus.report_issue` | "The projector in room 203 won't turn on" | **write** |
| `campus.issue_status` | "What happened to the report I filed yesterday?" | read |

Acceptance criteria for each: [`docs/use-cases.md`](docs/use-cases.md).

## 7. Pinned versions

Pinned at M1, revalidated once at M3, frozen after M4. Nothing in preview.

| Component | Version | Rationale |
| :-- | :-- | :-- |
| Runtime | Node 24 LTS | Active LTS. Node 26 is not in long-term support yet |
| MCP SDK | TypeScript SDK | Most mature ecosystem; only one with the visual-cards extension |
| Protocol | MCP 2026-07-28 | Current revision, degrading to 2025-11-25 (the required minimum) |
| Orchestrator model | Amazon Nova 2 Lite | Latency in the spoken turn |
| Infrastructure | AWS CDK v2 (2.263+) | There is no v3 |
| Container | Distroless image | Minimal surface inside someone else's institution |

**What 2026-07-28 implies.** The protocol is **stateless**: sessions and the `initialize` handshake are gone, `server/discover` is mandatory. A direct advantage here — a stateless server replicates without coordination, which is what something deployed on other people's infrastructure needs. Roots, sampling and protocol logging are deprecated and not adopted. Change notifications go through `subscriptions/listen`.

## 8. Milestones

| ID | Dates | Goal | Exit |
| :-- | :-- | :-- | :-- |
| M0 | Sep 15–17 | Foundations | Reference dataset frozen |
| M1 | Sep 18–27 | Core + provider interface + synthetic adapter + six tools | Answers a generic MCP client |
| M2 | Sep 28–Oct 4 | Standards adapter, capability-derived catalogue, container | The seam is real, not a promise |
| M3 | Oct 5–11 | Demo orchestrator, visual cards, localisation, MRTR confirmation | Complete end-to-end conversation |
| M4 | Oct 12–16 | CDK stack, OAuth 2.1, OpenTelemetry traces | Both deployment targets working |
| M5 | Oct 17–20 | Adoption guide, third-adapter docs, video, product feedback | Installable by a stranger |
| M6 | Oct 21 | Devpost submission | 48h before close |

Detail per milestone:

- **M0** — public repo with an open licence from the first commit; project AWS account with Bedrock access in `us-east-1`; San Telmo defined (buildings, programmes, calendar).
- **M1** — contract tests and latency measurement on every build. **The provider interface freezes when this milestone closes.**
- **M2** — iCalendar feeds, LDAP directory, tabular inventory; container image and compose file.
- **M3** — visible call trace in the demo app; localised answers and cards.
- **M4** — the friction log is written while it hurts, not afterwards.
- **M5** — the adoption guide is timed on a clean machine by someone outside the project.

## 9. Cut rules

This team is also carrying a second submission (LREA). Lodge takes priority. The rules apply without calling a meeting:

1. **If M2 slips past October 4** — the standards adapter is trimmed to calendars and inventory, dropping the directory.
2. **If M3 slips past October 11** — visual cards are cut. Voice alone satisfies the track.
3. **If there is no end-to-end demo by October 14** — the second project is abandoned and the whole team moves to Lodge.

Cases marked *essential* in `docs/use-cases.md` survive every cut; cases marked *improvement* are the first to go.

## 10. Deliverables

- [ ] Project created or substantially updated after August 31, 2026
- [ ] Public repository, open licence, verified setup instructions
- [ ] Self-hosted MCP server, Streamable HTTP, spec 2026-07-28
- [ ] Track technology imported and actually invoked at runtime
- [ ] Working demo reachable by the judges
- [ ] Public video under 3 minutes
- [ ] Product feedback on every API and tool used
- [ ] Track declared and both mini-challenges selected
- [ ] Friction log (up to a 10% scoring bonus)
- [ ] Adoption guide validated by someone outside the project

## 11. Risks

| Severity | Risk | Mitigation |
| :-- | :-- | :-- |
| High | Two submissions, one team | The cut rules above. October 14 is the point of no return |
| High | The abstraction eats the calendar | Two adapters, no more. Interface frozen at M1 |
| Medium | Generic demos badly | San Telmo in detail; the exchange student as the spectacular moment |
| Medium | Alexa+ add-on registry is closed (US + select partners) | Rules accept a self-hosted MCP server with our own simulation; that orchestrator ships as open source |
| Low | Data and privacy | Generated data, secret scanning in CI, no institutional credential in the repo |

## 12. Scope note

This project contains no data, branding, systems or naming from any specific institution, and requires authorisation from none. The University of San Telmo is fictional and its data is generated. Should an institution want to deploy it later, it would be adopting an already-published open-source project — a different and considerably simpler conversation.
