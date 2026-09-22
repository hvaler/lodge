# A .NET client for Lodge

A second implementation, in C# on .NET 10, of the client half of Lodge: an MCP client, the tool
loop over Amazon Bedrock, and the language routing that picks one institution over another.

**It is not part of the server and Lodge does not need it.** You can run, adopt and deploy Lodge
without ever opening this folder. Nothing under `src/` imports anything from here, and nothing here
is imported by the container, the CDK stack or the demonstration.

## Why it exists

Lodge's claim is that **the contract is the protocol** — that an institution publishes once and
stops choosing clients. That claim is easy to make and easy to believe wrongly. This folder is the
claim executed: a client in a different language, on a different runtime, with a different SDK,
talking to the same running server and getting the same answers.

It exists in particular for institutions whose stack is .NET, whose first question is not "what does
it do" but "can our people work with this". The answer used to be a paragraph. Now it is
`dotnet test`.

## What it proves, and how you can watch it

Seven of the thirty-three tests talk to real services rather than to doubles. That is deliberate and
it is the project's L-002: an MCP client with a stubbed transport proves nothing whatsoever. The
other twenty-six are the envelope handling, which needs no network and should not have one.

| The test says | Which matters because |
|---|---|
| San Telmo publishes exactly six tools | The catalogue is written nowhere in this client. It is discovered. |
| Carrigmore publishes exactly three, with no `campus.timetable` | Same server, same code, different institution — UC-07 from C# |
| A room question calls `campus.find_room` and comes back speakable | The loop closes: discover, decide, call, speak |
| **A timetable question to Carrigmore is declined with an empty trace** | UC-03. Not good behaviour — *impossibility*. The tool was never in the list the model was handed |

That last row is the one to read twice. The model is not resisting temptation; there is nothing to
resist. Carrigmore does not declare the timetable capability, so the server does not publish the
tool, so the catalogue the model receives does not contain it.

## Running it

```bash
cd dotnet
dotnet test
```

That runs everything except the Bedrock tests, which need credentials:

```bash
AWS_PROFILE=<yours> dotnet test
```

The tests point at the public demonstration deployment by default. To run them against a local
server instead — `npm run demo` from the repository root — set:

```bash
LODGE_DEPLOYMENT=http://localhost:3000 dotnet test
```

**The Bedrock tests cost money.** Each one is a Nova 2 Lite invocation. There are three, and they
are three on purpose.

### Requirements

- .NET 10 SDK
- For the Bedrock tests only: AWS credentials with `bedrock:InvokeModel` on
  `eu.amazon.nova-2-lite-v1:0`

## What is here

| | |
|---|---|
| `LodgeClient` | The MCP client. Streamable HTTP, catalogue, tool calls. Knows nothing about campuses |
| `Orchestrator` | The tool loop over Bedrock Converse. Returns a trace, always |
| `SystemPrompt` | A literal translation of the TypeScript one. Those rules *are* the use cases |
| `Institutions` | Language → institution → endpoint |
| `Documents` | MCP's JSON ↔ Bedrock's `Document` |
| `Skill` | Alexa's envelope in, speech out. No network, so it is driven by hand-built envelopes |
| `Speech` | Everything the device says that the model did not write, in both languages |
| `ProgressiveResponse` | The filler, which is never allowed to fail the turn |
| `SkillFunction` | The Lambda entry point that wires the four together |

## Honest differences from the TypeScript side

This is a second implementation, not a port, and it is smaller on purpose:

- **No prompt caching.** The TypeScript orchestrator marks the system prompt cacheable, which
  measured an 86 % fall in billed input tokens and no useful change in latency. Worth adding; not
  needed to prove anything.
- **No visual cards.** Cards are an MCP Apps extension for clients with a screen, and they travel
  around the model rather than through it. A voice client has no use for them.
- **Tool calls run one after another**, where the TypeScript side runs them concurrently. Campus
  questions call one tool; the difference has never been observable.

None of these are hidden by the tests. If one starts to matter, it will be because a measurement
said so.

## On a physical device

`Lodge.Alexa` is a Lambda handler that puts this behind a real Echo, as a **second backend for the
same skill**. Swap one ARN in the Alexa developer console and the device is answered by C# instead
of TypeScript, with nothing else changing — same server, same institutions, same words.

```bash
AWS_PROFILE=<yours> dotnet lambda deploy-function --project-location src/Lodge.Alexa
```

`aws-lambda-tools-defaults.json` carries the rest, including the IAM role: deliberately the same one
the TypeScript bridge uses, because it already grants basic execution and `bedrock:InvokeModel` on
exactly one model.

### What it measured

We said we would publish the cold start next to Node's whichever way it fell. It fell the other way
from the one we expected:

| | .NET 10 | Node 24 |
|---|---|---|
| Init | **324 ms · 357 ms** | 373 ms |
| Greeting, warm | 9.9 ms | 4.6 ms |
| A full question | 1 080 ms · 1 795 ms | 2 829 ms |
| Peak memory | 125 MB | 155 MB |

`dotnet10` on arm64 at 1024 MB, no Native AOT. Read it carefully: **two samples against one**, and
the full question is dominated by Bedrock, which varies more between calls than the runtimes differ
from each other. The defensible claim is *no start-up penalty was observed*, not that either is
faster. Alexa's cut-off is 8 s, and neither comes close.

## Licence

Apache-2.0, like the rest of the repository.
