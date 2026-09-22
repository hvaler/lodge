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

## Alexa.NET and the .NET Lambda tooling

A second implementation of the client side, in C#, to answer whether an institution whose stack is
.NET could work with this. Both entries below came from the same decision: use the ecosystem's
standard Alexa library rather than hand-typing the envelope.

### 🔴 `Alexa.NET` cannot be read by the serialiser every guide pairs it with

**What happened.** `Alexa.NET`'s `SkillRequest.Request` is an abstract type, and the polymorphic
reader that picks `LaunchRequest` or `IntentRequest` is a **Newtonsoft** converter. Paired with
`Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer` — which is what the modern
guides, the AWS templates and every summary we read reach for — the function refuses the envelope
at the door:

```
Error converting the Lambda event JSON payload to type Alexa.NET.Request.SkillRequest:
Deserialization of interface or abstract types is not supported.
Type 'Alexa.NET.Request.Type.Request'. Path: $.request
```

**What it cost.** Nothing visible until the first real invocation. It compiles, it packages, it
deploys, and every unit test passes, because the tests construct `SkillRequest` objects rather than
deserialise them. The failure lives exactly in the gap a unit test cannot see — the same shape as
our L-002, one ecosystem over.

**What would have prevented it.** A line in `Alexa.NET`'s readme naming the serialiser it requires.
Or, better, `Amazon.Lambda.Serialization.SystemTextJson` failing at *build* time on a handler whose
event type has abstract members, rather than at the first invocation.

**What we did instead.** `Amazon.Lambda.Serialization.Json` — the Newtonsoft one — and a comment in
the project file saying why, because the obvious future "modernisation" is to swap it back.

### 🟡 `Alexa.NET` brings a Newtonsoft.Json with a live advisory

**What happened.** `Alexa.NET` 1.22.0, the current release, depends on `Newtonsoft.Json` 12.0.2.
That version carries [GHSA-5crp-9r3c-p9vr](https://github.com/advisories/GHSA-5crp-9r3c-p9vr), a
high-severity advisory fixed in 13.0.1. NuGet reports it as `NU1903`, which our build treats as an
error, so the first build of the project failed on a package we had not chosen.

**What it cost.** Ten minutes, because the build caught it. It is 🟡 rather than 🔴 for exactly that
reason — a project without `TreatWarningsAsErrors` ships it and never knows.

**What would have prevented it.** A release of `Alexa.NET` that floats its Newtonsoft dependency.

**What we did instead.** A direct `PackageReference` to 13.0.4, which is how NuGet lets you lift a
transitive dependency, with the advisory id in a comment next to it.

### 🟢 What worked

**The MCP C# SDK is a peer of the TypeScript one.** `HttpClientTransport` with
`TransportMode = HttpTransportMode.StreamableHttp` and `AdditionalHeaders` covered everything the
client needed, including the identity header, first time. The catalogue came back and the tools
called, against the same deployment the TypeScript client talks to, with no adjustment on either
side. That is the whole claim of this project, tested rather than asserted.

**.NET 10 on Lambda costs nothing at start-up that Node does not.** We expected to publish a worse
cold start and wrote that intention down beforehand. Measured on `dotnet10`/arm64 at 1024 MB:
**324 ms and 357 ms** of init, against **373 ms** for the Node 24 function doing the same work.
Two samples against one, so the honest claim is "no penalty observed" rather than "faster" — but the
received wisdom that .NET must be pinned by Native AOT to be viable on Lambda did not survive
contact with a measurement.

## AWS CDK and Lambda

### 🟡 `logRetention` silently deploys a second function

**What happened.** `logRetention` on a Lambda is deprecated in favour of `logGroup`, which the
warning says. What it does not say is that using it deploys a **second Lambda** — a custom resource
whose only job is to set the retention on the first one's log group.

**What it cost.** Little, because we noticed in the synthesised template. But our stack's selling
point to an adopting institution is that you can read the whole bill in one screen, and it silently
had two functions in it.

**What would help.** Mentioning the custom resource in the deprecation warning.

### 🟡 `CDK_DEFAULT_REGION` cannot be used to give an app its own default

**What happened.** Our CDK app read `process.env.CDK_DEFAULT_REGION` and fell back to a region of
our choosing. It never took: the CLI **sets** that variable in the app's environment from the
resolved AWS config before running it, so whatever the shell exported is gone by the time the app
reads it.

**What it cost.** A wrong claim in two documents and a comment — "defaults to `eu-west-1`" — that
happened to be true only because the profile we used said so. Found by synthesising without the
profile and seeing a US region in an ARN that should have been European.

**What would have prevented it.** Saying in the `CDK_DEFAULT_*` documentation that the CLI owns
those variables and an app cannot use them to express a preference. We now read our own.

### 🟡 `this.region` is a string sometimes and a token the rest of the time

**What happened.** We added a guard comparing `this.region` against the model's geography, to stop
somebody deploying a European inference profile into a US region — a stack that synthesises,
deploys, and then fails on the first question. It broke every environment-agnostic stack, where the
region is an unresolved token and the comparison is against `${Token[AWS.Region.7]}`.

**What it cost.** Little — a test caught it immediately, which is the argument for testing the
synthesised template. But the failure mode is worth naming: a guard that reads a possibly-token
value as a string causes exactly the class of problem it was added to prevent.

**What would have prevented it.** `Token.isUnresolved` is the answer and it is easy to find once you
know it exists. A type that distinguished "string" from "string or token" would have made it
impossible to miss; today they are both `string`.

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
| Alexa.NET | Name the serialiser the library requires, and float the Newtonsoft dependency off a version with a live advisory |
