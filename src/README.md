# `src/` — the server

TypeScript on Node 24, with no build step needed to read it. Each folder is a layer of the diagram
in the [README](../README.md), in the order a question passes through them.

| Folder | What is in it | Start at |
|---|---|---|
| `server/` | the MCP server over Streamable HTTP, stateless; the configuration file; OAuth 2.1 | `main.ts`, `config.ts` |
| `provider/` | **the provider interface, frozen** (ADR-006): capabilities, methods, and which tool each one publishes | `provider.ts`, `frozen.ts` |
| `adapters/synthetic/` | the Universidad de San Telmo, generated and deterministic | `index.ts` |
| `adapters/standards/` | iCalendar, LDAP, a room table, and the three places a fault report can go | `config.ts`, `inventory.ts` |
| `tools/` | the six `campus.*` tools, registered from what the adapter declares | `index.ts` |
| `cards/` | the visual cards (MCP Apps extension) that ride along with a spoken answer | `index.ts` |
| `orchestrator/` | the client: Bedrock, the tool-call loop, and prompt caching | `index.ts`, `model.ts` |
| `web/` | the voice demonstration and the public page, which talk to the server over HTTP like any client | `main.ts` |
| `lambda/` | the AWS entry points — the server, the page, and the bridge to a real device | `handler.ts` |
| `shared/`, `telemetry/` | time zones and language; OpenTelemetry continuing the client's trace | `time.ts` |

Tests live **next to the code** they cover, as `<module>.test.ts`; there is no test folder. Every
acceptance criterion in [`docs/use-cases.md`](../docs/use-cases.md) has one.

```bash
npm test          # the whole suite
npm run build     # includes the frozen-interface check
npm start         # the server, against LODGE_CONFIG
npm run demo      # the demonstration: Lodge on :3000, the Alexa+ simulation on :8080
```

> **The interface in `provider/` is frozen.** It gets implemented, not edited. If something forces
> it to move, the compiler says so on every `npm run build`: the procedure is in ADR-006, and
> ADR-017 and ADR-019 are two worked examples of following it.
