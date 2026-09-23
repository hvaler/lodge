# Lodge from other clients

Lodge's claim is that **an institution publishes once and stops choosing clients**. That is easy to
say. This page is what it means in practice: which clients can talk to it today, what each one would
take, and what is blocked by somebody else's gate rather than by our code.

Everything below was checked against first-party documentation on **22–23 September 2026**, with the
source next to each claim. Where something is gated, the gate is quoted rather than paraphrased.

---

## Alexa, classic and Alexa+

Two different products with the same brand, and the difference matters more than the name suggests.

| | Classic custom skill | Alexa+ add-on |
|---|---|---|
| **How it is invoked** | Explicitly: *"Alexa, ask campus lodge…"* | Contextually, by the assistant deciding your tools are relevant |
| **Who understands the sentence** | An interaction model you write: intents, sample utterances, slots | The assistant's own model |
| **Who runs the conversation** | You. Reprompts, confirmations and disambiguation are your code | The assistant |
| **What your backend receives** | An Alexa envelope with slots already parsed | An MCP `tools/call`, with arguments filled from your JSON Schema |
| **What your backend returns** | The exact words to speak | Structured data; the assistant writes the sentence |
| **What you have to build** | An interaction model **and** an orchestrator **and** a model | The MCP server, and nothing else |
| **Where it runs** | Any Echo, today | Alexa+ devices |

### What we built, and why

A **classic custom skill**, and it is labelled as such everywhere it appears. Not a preference —
a gate:

> "Alexa+ for Builders is currently available to **select partners working directly with our
> team**."
> — [developer.amazon.com/alexaplus](https://developer.amazon.com/alexaplus), checked 14 September and
> again 23 September 2026. Unchanged.

> "The MCP Toolkit is **available in the United States**."
> — [MCP Toolkit overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html),
> page last updated 3 August 2026.

The tooling exists and is documented in detail — a CLI, an onboarding wizard, an add-on registry —
which is precisely what makes the restriction easy to miss. We checked one further way: the CLI the
documentation names, `@alexa/alexa-ai-cli`, **returns 404 from the npm registry**. It is real and it
is not publicly distributed, which is what "select partners" means in practice.

So the classic skill is not a lesser version of the thing we wanted. It is the only version an
entrant can build, and it costs an orchestrator and a model that an add-on would not need.

### What upgrading would take

Less than you would expect, because the hard part is the part that already exists.

**Already in place, unchanged:**

- **An MCP server over Streamable HTTP.** That is the transport, and the only one the current
  tooling accepts.
- **A tool catalogue derived from declared capabilities.** An add-on registry introspects the server
  for its tools; ours already answers `tools/list` with exactly what the institution can serve.
- **OAuth 2.1 with discovery.** Account linking for an add-on is an OAuth flow, and Lodge already
  publishes its protected-resource metadata and binds tokens to each institution's canonical URI.
- **Tool descriptions and schemas written for a model to read**, because ours already are — that is
  how the demonstration's own orchestrator chooses between them.

**What would be deleted:** the interaction model, the invocation name, the orchestrator, the Bedrock
dependency, and every line of `src/lambda/` and `src/orchestrator/`. The add-on path needs none of
it. The server does not change.

**What is not ours to do:** registration. Until the registry opens, this is a paragraph, not a task.

---

## Microsoft Copilot Studio and the Power Platform

**This one works today, with no change to Lodge.** That is not a projection; it follows from three
requirements the server already meets.

Copilot Studio can add an MCP server to an agent as a tool
([overview](https://learn.microsoft.com/microsoft-copilot-studio/agent-extend-action-mcp)). The
requirements, and where Lodge stands:

| Copilot Studio requires | Lodge |
|---|---|
| **Streamable HTTP.** "Copilot Studio supports the Streamable transport type… SSE is deprecated, Copilot Studio no longer supports SSE for MCP after August 2025" | The only transport it speaks |
| **Authentication: none, API key, or OAuth 2.0** — including "dynamic discovery" via a discovery endpoint | OAuth 2.1 with RFC 9728 protected-resource metadata |
| **Tools described well enough for an orchestrator to choose** | Six of them, written for exactly that |

And the property this project cares most about comes along for free:

> "When you update or remove tools and resources on the MCP server, Copilot Studio **dynamically
> reflects these changes**."
> — [Extend your agent with Model Context Protocol](https://learn.microsoft.com/microsoft-copilot-studio/agent-extend-action-mcp)

That is the same capability negotiation the demonstration shows in a browser. Point a Copilot Studio
agent at an institution that publishes no timetable and the timetable tool is not there to call —
for the same reason, on somebody else's platform.

### What it would take

Build → Tools → Add a tool → **Model Context Protocol**, then a name, a description, the server URL
and the authentication method
([wizard](https://learn.microsoft.com/microsoft-copilot-studio/mcp-add-existing-server-to-agent)).
Generative orchestration has to be on. The agent can then be published to Microsoft 365 Copilot,
Teams, or a Power Pages site.

### Two things a Microsoft-shop IT department will want to know

**Governance is not bypassed.** "Access to MCP servers in Copilot Studio relies on Power Platform
connectors… if a data policy regulates Power Platform connectors, it also regulates access to the
MCP server and its tools"
([source](https://learn.microsoft.com/microsoft-copilot-studio/mcp-add-components-to-agent)). Lodge
sits inside the tenant's DLP perimeter like any other connector, rather than beside it.

**There is a limit on concurrent servers per conversation.** Documented, unspecified as a number,
and worth knowing before attaching a dozen
([source](https://learn.microsoft.com/microsoft-copilot-studio/agents-experience/tools-add-mcp-server)).

---

## Sending a fault into a business system

This one needs no new integration either, because the seam already exists.

Since ADR-018 a fault report goes to exactly one destination the institution configures: **email, a
webhook, or Jira**. A webhook is a URL that receives a POST — and a Power Automate flow triggered by
**"When an HTTP request is received"** is exactly that.

So the chain is configuration rather than code:

```
campus.report_issue  →  issues.webhook  →  Power Automate HTTP trigger
                                             → "Add a new row" (Microsoft Dataverse)
                                             → Response: the case number
                                        ←  Lodge reads that number back to the student
```

Worth noting on each hop:

- **Dynamics 365 Customer Engagement stores its data in Dataverse**, so "create a case in the CRM" is
  the standard *Add a new row* action, not a bespoke API call. The same pattern is documented for
  Field Service work orders
  ([source](https://learn.microsoft.com/dynamics365/field-service/create-work-order-flow)).
- **The flow can return the created record's id.** Lodge's webhook destination deliberately does not
  invent a reference when the far end does not supply one — here it does, so the student hears a real
  case number and can chase it.
- **The trigger can be locked down.** "Any user in my tenant" requires an Entra ID bearer token;
  "Specific users in my tenant" narrows it to named users or service principals; "Anyone" makes the
  URL itself the credential
  ([source](https://learn.microsoft.com/power-automate/oauth-authentication)). For a server that
  files tickets on behalf of named students, the first two are the only defensible choices.

**Licensing is worth checking before promising anything.** Dynamics 365 licences include Power
Automate rights only for flows running *in the context of the Dynamics application*; a flow that
wanders outside it needs a standalone licence
([source](https://learn.microsoft.com/power-platform/admin/power-automate-licensing/faqs)). A flow
whose whole job is to create a case is inside that context, but this is a question for whoever owns
the tenant, not for us.

---

## Reading from a data platform instead of files

The two adapters that ship read iCalendar, LDAP and CSV, because those are what an institution
already has without building anything. They are not the only shapes.

A third adapter is one interface and eight optional methods
([writing an adapter](writing-an-adapter.md)), and nothing in it cares where the rows come from. A
**Fabric lakehouse or warehouse exposes a SQL analytics endpoint** that answers T-SQL over the Delta
tables in OneLake without copying them
([source](https://learn.microsoft.com/fabric/onelake/quickstart-consume-data)); **Dataverse answers
OData v4**. Either is an ordinary data source to an adapter.

The interesting part is what does *not* change: the adapter declares which capabilities it can serve,
and the tool catalogue follows. An institution whose room inventory is in Dataverse but whose
timetable is nowhere machine-readable publishes the room tools and not the timetable one, and the
agent cannot offer what is not there.

---

## Watching what it does

Lodge instruments with OpenTelemetry and continues the client's trace rather than starting its own.
Where those spans go is a configuration question — `OTEL_EXPORTER_OTLP_ENDPOINT` and nothing else.

For a Fabric shop the shape is:

- **Eventstream** ingests from a custom endpoint, Event Hubs, Kafka or a REST source, and fans out to
  several destinations at once ([overview](https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/overview)).
- **Eventhouse** is built for telemetry and time-series, queried in KQL, and also exposes a **SQL
  analytics endpoint** for T-SQL and BI tools
  ([source](https://learn.microsoft.com/fabric/fundamentals/track-visualize-data)).
- **Activator** watches the stream against rules and can **trigger a Power Automate flow** when one
  fires ([source](https://learn.microsoft.com/fabric/real-time-intelligence/event-streams/migrate-from-azure-event-hubs-stream-analytics)).

Which makes the questions worth asking answerable: how often does somebody ask for a free room and
find none, which building generates the most faults, and — the one that matters for a service — how
often the honest answer was *"that is not on record"*.

---

## Retrieval, and why it is not here

The question everyone asks. It is considered and deliberately not built, and the reasoning is in
[the roadmap](roadmap.md) rather than repeated here, but the short version belongs on this page too:

**Retrieval's failure mode is the opposite of this server's.** It always finds something and composes
a plausible answer from it, where the rule here is that a fact not on record is reported as not on
record. The moment this project is proudest of — asking an institution with no directory for a
timetable and getting a refusal with **zero tool calls** — is only demonstrable because there is
nothing to retrieve.

Where it would fit, when it fits: a `knowledge-base` capability over the **academic regulations** —
prose, public, and genuinely unanswerable today. Declared or not declared, like everything else. It
would have to cite the document and article rather than paraphrase, and return "not on record" on
weak retrieval, or it does not belong here.

Note what it is *not* for: rooms, timetables and deadlines are computed from records, not retrieved
from text. "MEN-203 is free from 16:00 to 18:00" is a calculation over occupancy and inventory. There
is no passage to find.

---

## What none of this changes

Whichever client is in front of it, the server behaves the same way, and that is the point:

- **The catalogue comes from what the institution declared it can answer**, so a client cannot be
  offered a tool the institution cannot serve.
- **Identity travels in the token, never in a parameter.** The timetable query has exactly one field —
  the time window — so there is nowhere for any client to put somebody else's name.
- **Nothing is written without a yes.** Filing a fault takes two calls; the first validates and
  writes nothing.
- **A fact not on record is reported as not on record**, in the institution's own language.

An institution that adopts Lodge is not betting on Alexa, on Microsoft, or on us. It is publishing a
protocol endpoint, and the clients are interchangeable by design.
