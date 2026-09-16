# Friction log

Written while it hurt, not afterwards. Every entry below cost real time during the build of Lodge
between 14 and 16 September 2026, and each one names what happened, what it cost, and what would
have prevented it.

It is organised by API rather than chronologically, because the useful question for whoever owns
one of these is "what does *my* thing do to people", not "what did these people do on Tuesday".

Two notes on how to read it. First, **the things that worked are here too** — a log that is only
complaints tells you nothing about where the bar is. Second, every claim is something we hit and
can reproduce; where we were wrong and found out, that is recorded as well.

Versions: MCP TypeScript SDK 2.0.0 · `@aws-sdk/client-bedrock-runtime` 3.1133.0 · aws-cdk-lib 2.269.0
· Node 24.16.0 · TypeScript 7.0.2.

---

## Model Context Protocol — TypeScript SDK

### 🔴 Client capabilities are unreachable from a tool call over Streamable HTTP

**What happened.** `server.server.getClientCapabilities()` returns `null` on every tool call served
over Streamable HTTP, stateless *or* stateful. `createMcpHandler` builds a fresh `McpServer` per
request, and the capabilities were negotiated by an `initialize` that happened on a different
request and a different instance.

**What it cost.** The MCP Apps cards — a whole milestone deliverable — were attached in every test
and in no deployment. The tests used `InMemoryTransport`, which is one long-lived server with a
remembered handshake; that is the single shape where the pattern works. We found it by wiring a real
HTTP client to the server, four days after writing the feature.

**What would have prevented it.** Either surfacing the negotiated capabilities on the per-request
tool context, or a line in the `createMcpHandler` documentation saying that
`getClientCapabilities()` is not meaningful there. The API reads as though it is.

**What we did instead.** Inverted the rule: attach a card unless the client positively said it has
no screen. The full reasoning is in our ADR-012.

### 🔴 `input_required` cannot be delivered on a 2025-era connection served per request

**What happened.** The SDK offers `inputRequired()` as the non-blocking way for a tool to ask the
caller something, which is exactly right for a stateless server. On a 2025-11-25 connection it is
delivered as an `elicitation/create` **request from server to client**, and per-request HTTP serving
has no channel to send one on:

```
Cannot request input 'confirm' (elicitation/create): the client on this 2025-era connection
did not declare the required capability (no client capabilities are available on this
connection — per-request legacy serving cannot receive server-to-client requests)
```

**What it cost.** Our confirmation-before-writing use case — marked essential — did not work in any
deployment, for the same reason and on the same day as the cards. We had previously recorded the
risk as "the client might not declare `elicitation`". That was too optimistic: it cannot be
delivered *even if the client does declare it*.

**What would have prevented it.** `inputRequired` is presented as the stateless-friendly choice
against the blocking `elicitInput`. It is, on a 2026-07-28 connection. On a 2025 one served per
request it is undeliverable, and nothing in the type or its documentation says so — the failure is
at runtime and the message, while admirably precise, arrives very late.

**What we did instead.** Made confirmation an ordinary tool argument and a second call. It works on
every era and every transport, and it is what a voice assistant does anyway.

### 🟡 The `_meta` envelope exists but cannot be switched on

**What happened.** The SDK documents a per-request `_meta` envelope carrying protocol version,
client info and **client capabilities** — precisely the seam that would fix the first entry above.
It is auto-emitted only on a connection that negotiated protocol revision 2026-07-28. In this build,
`SUPPORTED_PROTOCOL_VERSIONS` is `['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05',
'2024-10-07']`, and `LATEST_PROTOCOL_VERSION` is `2025-11-25`.

**What it cost.** An hour of building on a documented mechanism before discovering the client cannot
negotiate the era that emits it. The server side reads the envelope correctly and finds it empty.

**What would have prevented it.** The documentation for `_outboundMetaEnvelope` describes behaviour
no client in this release can produce. Marking it as forthcoming, or gating the docs on the
supported versions, would have saved the detour.

### 🟡 `InMemoryTransport` is not a stand-in for Streamable HTTP

**What happened.** Both bugs above passed a 287-test suite because every test used
`InMemoryTransport`. It keeps a session; the deployment does not.

**What would help.** A test helper that runs the same suite over both transports, or a documented
warning that in-memory tests do not exercise per-request serving. This is the single highest-value
thing the SDK could ship for people writing servers: the failure mode is a green suite and a broken
container, and it caught us twice in one afternoon.

### 🟢 What worked

Tool registration with a Zod schema is genuinely pleasant, and `createMcpHandler`'s multi-era
serving meant we never wrote a version branch. The `legacy: 'stateless'` option is one line for a
property — replicating without coordination — that is usually a project. `toNodeHandler` forwarding
`req.auth` as the handler's `authInfo` made OAuth a twenty-line integration.

---

## Amazon Bedrock

### 🔴 Nova 2 Lite has no in-region availability, and the model card's sample says it does

**What happened.** `amazon.nova-2-lite-v1:0` fails in every region, including `us-east-1`. The model
requires a geographic inference profile — `us.amazon.nova-2-lite-v1:0` or
`eu.amazon.nova-2-lite-v1:0`. The sample code on the model's own card uses the bare identifier.

**What it cost.** A debugging cycle spent looking for a permissions problem that was a naming
problem.

**What would have prevented it.** Sample code that works, or an error naming the profile to use.

### 🔴 `cachePoint` inside `toolConfig.tools` is typed as valid and rejected at runtime

**What happened.** The SDK's `Tool` union includes `Tool.CachePointMember`, so this compiles:

```ts
toolConfig: { tools: [...tools, { cachePoint: { type: 'default' } }] }
```

Nova 2 Lite answers:

```
ValidationException: Malformed input request: #/toolConfig/tools/5:
extraneous key [cachePoint] is not permitted, please reformat your input
```

**What it cost.** One probe cycle, and it is the reason our prompt caching has a configuration
switch rather than being unconditional: support turns out to be per-model and not discoverable.

**What would have prevented it.** Per-model documentation of where cache points are accepted. The
types describe the Converse API's superset; no model implements all of it.

*(A cache point at the end of `system` works and covers the tool schemas too: a 1 550-token request
drops to ~50 billed input tokens.)*

### 🟡 The console playground misrepresents the model's latency

**What happened.** The playground enables extended thinking by default. A one-line question took
**5 293 ms**, which we recorded as the model's latency and used to worry about the 500 ms budget.
Through the API, with the default configuration, the same class of question takes **~700 ms**.

**What it cost.** A day of believing the demonstration might not be viable, and a decision recorded
in an ADR to never enable `reasoningConfig`.

**What would have prevented it.** Showing in the playground that reasoning is on, and that it is off
by default in the API.

### 🟡 Prompt caching is a cost feature, not a latency feature

**What happened.** We enabled it expecting a faster demonstration. Measured with eighteen exchanges
per configuration, interleaved A/B so network drift hit both equally:

| | median | min | max | billed input |
|---|---|---|---|---|
| without | 1 966 ms | 1 343 | 3 105 | 57 324 |
| with | 1 894 ms | 1 363 | 2 701 | **8 044** |

Input tokens fell 86 %. The 72 ms is noise against that spread.

**This is not a complaint** — 86 % is a large, real saving and we kept it. But the framing around
caching emphasises speed, and for a small model with a ~1 500-token prefix the latency is elsewhere.
Saying so would set expectations correctly.

### 🟡 A new account is blocked from all model access with no way to check progress

**What happened.** An account created on 14 September could not invoke any model:
`AccessDeniedException`, with a message saying verification "usually takes less than 2 hours". It
took considerably longer, with no status page, no estimate and no way to ask.

**What it cost.** A day of the milestone, mitigated only because the orchestrator had been written
against an interface with a test double, so Bedrock was the last wire to connect rather than the
first.

**What would have prevented it.** A status indicator in the console. The eventual outcome was fine;
the absence of any signal was the problem.

### 🟢 What worked

The Converse API's shape — one request, messages, `toolConfig`, `toolUse`/`toolResult` blocks — made
a provider-agnostic orchestrator straightforward: our model interface is 60 lines and Bedrock lives
entirely behind it. Geographic inference profiles are a genuinely good answer to data residency, and
being able to say "Ireland, Frankfurt, Milan, Madrid, Paris or Stockholm" is a shorter conversation
with a European data-protection office than the alternative. Measured from Spain: EU 1 437 ms median
against US 1 669 ms.

---

## Alexa+

### 🔴 The track's headline integration is closed to solo entrants

**What happened.** The Alexa+ add-on registry is "currently available to select partners working
directly with our team". A hackathon entrant building for the Alexa+ track therefore cannot connect
their MCP server to Alexa+.

**What it cost.** The track's own integration is the one thing we cannot demonstrate. The
hackathon's guidance — simulate the experience with a web app using your preferred agentic tools —
is a reasonable answer and we followed it, publishing the simulator as open source rather than
treating it as a throwaway.

**What would help.** Saying it plainly on the track page. We initially concluded the restriction did
not exist because the page we read did not mention it; it is stated on a different page. That
misreading is ours, and it is also the shape of the problem: a restriction that changes what you can
build should be where you choose the track.

### 🟢 What worked

The published constraints are specific and testable, which is rarer than it should be: MCP revision
2025-11-25, Streamable HTTP, OAuth 2.1 with PKCE (S256), a `resource` parameter pointing at the
server's canonical URI, and a 500 ms round-trip budget. Every one of those is something we could
build against and verify. Our deployed server answers in **214 ms** from Spain with the network
included.

---

## AWS CDK and Lambda

### 🟡 `logRetention` silently deploys a second function

**What happened.** `logRetention` on a Lambda is deprecated in favour of `logGroup`, which the
warning says. What it does not say is that using it deploys a **second Lambda** — a custom resource
whose only job is to set the retention on the first one's log group.

**What it cost.** Little, because we noticed in the synthesised template. But our stack's selling
point to an adopting institution is that you can read the whole bill in one screen, and it silently
had two functions in it.

**What would help.** Mentioning the custom resource in the deprecation warning.

### 🟡 Function URL response streaming needs a non-standard global

**What happened.** Streaming responses from a Function URL requires wrapping the handler in
`awslambda.streamifyResponse`, a global that exists only in the Lambda runtime and is invisible to
local tooling and types.

**What it cost.** Nothing in the end — a stateless MCP server answers each tool call with a single
message, so buffered responses are correct and we skipped it. Worth knowing before designing around
streaming.

### 🟢 What worked

`NodejsFunction` bundling with esbuild took **271 ms** for an 889 kB artefact, locally, with no
Docker. `Template.fromStack` assertions let us test the CloudFormation rather than the constructs,
which is what caught that `grantReadWriteData` hands out ten DynamoDB actions when we needed three.
The whole stack — function, table, URL, log group, roles — deployed in **47 seconds**, first try.

---

## Node.js 24

### 🟢 Native TypeScript changed how the project is laid out

Type stripping meant `node src/server/main.ts` and `node infra/bin/lodge.ts` run directly, with no
build step in development and no `ts-node` in the CDK app. Combined with
`rewriteRelativeImportExtensions`, the same source runs from `src/` and compiles to `dist/`.

The one constraint worth knowing: strip-only mode forbids anything that emits code — enums,
namespaces, and constructor parameter properties. We hit the last one and converted to explicit
fields. The error message says exactly that, which is how it should go.

---

## Summary for whoever owns one of these

| Owner | The one thing to fix |
|---|---|
| MCP TypeScript SDK | Make client capabilities reachable from a per-request tool call, or say loudly that they are not — two features shipped broken behind a green suite |
| Amazon Bedrock | Sample code that runs, and per-model documentation of which Converse features are accepted |
| Alexa+ | State the registry restriction on the page where people choose the track |
| AWS CDK | Say that `logRetention` deploys a second function |
