# `skill/` — the bridge to a real device

**This is a classic Alexa custom skill, and it is not Alexa+.** The Alexa+ add-on registry is
["available to select partners working directly with our team"](../docs/friction-log.md), verified
14 September 2026, so no hackathon entrant can register one. The hackathon's own guidance is to
simulate the experience in a web app, and [`src/web/`](../src/web) is that simulation.

This exists for the one thing a browser tab cannot be: **a speaker on a table answering out loud**,
against the very same MCP server everything else talks to. Say that plainly wherever it is shown.

| File | What it is |
| :-- | :-- |
| `skill.json` | The manifest. `PRIVATE`, never published, never certified |
| `interactionModels/custom/es-ES.json` | Spanish. Invocation name: **la conserjería** |
| `interactionModels/custom/en-GB.json` | English. Invocation name: **campus lodge** |
| [`src/lambda/skill.ts`](../src/lambda/skill.ts) | The endpoint. Thin: envelope in, the demonstration's own orchestrator answers, envelope out |

### One skill, two languages — and that is the point

**There is no second skill.** A skill carries several locales, and the language it is spoken to
decides which institution it reaches:

| Spoken in | Reaches | Publishes |
| :-- | :-- | --: |
| Spanish | Universidad de San Telmo | **8 tools** |
| English | Carrigmore College | **4 tools** |

That is the same thing the page demonstrates with its institution switcher, arriving at a device
for free: one server answering for more than one place, with the *client* saying which. Carrigmore
has no directory and no service desk, so it never offers to tell you your timetable — and the
device inherits that without a line of code, because the catalogue is derived either way.

`LODGE_SKILL_INSTITUTION` pins every language to one institution, for a deployment that serves only
its own.

---

## Setting it up

The skill id cannot be known before the skill exists, so this goes in two passes.

**1 · Create the skill.** In the [Alexa developer console](https://developer.amazon.com/alexa/console/ask):
custom model, provisioned yourself. Pick **one** primary locale to create it with, then add the
other from *Build → Language settings*. For each one, paste the matching file from
`interactionModels/custom/` into the JSON editor and build the model.

Which one is primary matters only for the name shown in the console, so pick the audience: **English
(UK)** for a jury that reads English, Spanish (ES) for an institution. Copy the skill id from the
endpoint page — it looks like `amzn1.ask.skill.xxxxxxxx-…`.

**2 · Deploy the bridge with that id.**

```bash
cd infra
AWS_PROFILE=… LODGE_REGION=eu-west-1 npx cdk deploy -c sandbox=true -c alexaSkillId=amzn1.ask.skill.…
```

Without `-c alexaSkillId` **nothing is deployed**: the bridge spends money per question and exists
only to record a video. The stack prints `AlexaEndpoint` — paste that ARN into the skill's endpoint
field, pick *AWS Lambda ARN*, and save.

**3 · Try it.** The console's Test tab, or any Echo signed in to the same developer account:

> «Alexa, abre la conserjería» · «Alexa, pregunta a la conserjería qué aula está libre ahora en
> Mendizábal»
>
> «Alexa, open campus lodge» · «Alexa, ask campus lodge which room is free right now»

---

## What it does and does not do

**Identity.** The bridge talks to the sandbox deployment, which runs `LODGE_DEV_IDENTITY` and takes
a subject from a header, so the device always speaks as the same student. That is an authentication
bypass, it is fine against two invented universities, and it means **the device demonstrates the
voice path, not the identity path**. Identity is demonstrated in the web app, where the sign-in is a
real authorization-code flow with PKCE ([`src/web/idp.ts`](../src/web/idp.ts)).

**Latency.** Measured 22 September 2026 against the deployed stack: the full turn is ~1.5 s warm and
~4.5 s cold, against Alexa's 8 s cut-off. The function's own timeout is 8 s — it gives up before
Alexa does, because a function still working after Alexa has hung up is burning money for an answer
nobody will hear. It also sends a **progressive response** before it starts, so a cold start is a
«un momento, lo miro» rather than silence.

**Two turns.** The conversation is carried in Alexa's session attributes, trimmed to six turns, so
filing a fault works out loud: the agent asks whether to open it, somebody says yes, and the second
call carries the first (ADR-011). A session attribute is not a database, which is why it is trimmed.

**Who may invoke it.** The function has no URL. Alexa invokes it directly, and the permission is
scoped to that one skill id — `eventSourceToken` is what turns «anybody's skill may invoke this»
into «ours may». The handler checks the id again on its way in.
