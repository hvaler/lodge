# What could come next

Lodge was built to a fixed date, and a lot of what is *not* in it was left out on purpose. This
document separates the three kinds of "next": what we deliberately refused, what the protocol will
unlock when it moves, and what we know is missing today.

Nothing here is a commitment. It is what we would look at first, and why.

---

## Deliberately out of scope

These are not oversights. Each one was a decision with a reason, and the reason is still good.

**A third adapter.** ADR-002 fixed the count at two: one adapter fakes the seam, three are craftwork
that eats the calendar. A connector for a specific student information system is the natural first
addition *after* the deadline, and [`writing-an-adapter.md`](writing-an-adapter.md) exists so that
somebody else can do it without asking us.

**Being an identity provider.** ADR-013. Lodge verifies tokens and will not issue them. Nobody
should have to deploy a second place where their students' passwords live.

**Roots, sampling and protocol logging.** Obsolete in the revision we target, and adopting them
would be work that ages immediately.

**Writing to institutional systems beyond a fault report.** Lodge answers questions. A server that
can also change a timetable is a different security conversation, and one an institution should have
deliberately rather than inherit.

---

## Waiting on the protocol

Three of our own decisions were forced by what the 2025-era SDK can carry, and would be worth
revisiting the day a client can negotiate revision 2026-07-28.

| Today | What changes | Why we would revisit |
|---|---|---|
| Cards attach unless the client says it has no screen (ADR-012) | The per-request `_meta` envelope carries client capabilities | The rule could go back to opt-in, which is the honest default when the answer is actually knowable |
| Confirmation is a tool argument and a second call (ADR-011) | `input_required` becomes deliverable per request | It lets the **client** draw a trusted confirmation dialog. Today the model decides that somebody said yes, and a dialog the model cannot forge is strictly better |
| A client re-asks to find out anything changed | `subscriptions/listen` | A room freeing up, a deadline moving. Today there is no way to tell anyone |

Worth being precise about the second one: the current design satisfies UC-05's acceptance criterion
— nothing is filed without a yes — and works on every transport. The protocol version would be an
improvement in *who* is trusted to observe the yes, not in whether it happens.

---

## What an adopter would ask for next

Ordered by how often we think it would come up.

**More ways to read a room list.** Today `standards` reads a CSV. An institution with a booking
system has a REST endpoint, and one on Microsoft 365 has room lists in Graph. Each is a small
addition to the same adapter rather than a new one.

**Occupancy without a timetable feed.** `standards` publishes `room-availability` only when it has
both an inventory *and* a timetable, because without occupancy it would be guessing. An institution
whose booking system answers "is this free" directly could support the capability without the feed —
and would keep everything `room-inventory` already buys it in the meantime.

**Filing into the tracker the institution already runs.** ✅ **Built, 17 September.** This was the
largest gap and it is worth recording what it cost, because the answer was not the obvious one.

An institution now names a destination in its config file and `campus.report_issue` writes there:

| | Can | Why in this order |
|---|---|---|
| **Email** | File | The only one that genuinely is a standard every institution already has. One dependency, `nodemailer`, which has none of its own |
| **Webhook** | File | No vendor, no library, no account. A documented payload the institution wires to whatever they run |
| **Jira** | File and chase | The worked example of a real tracker, because it can answer back and because it is the one people ask about |

Email mints its own reference and puts it in the subject line, which is the opposite of the webhook
rule and is not an inconsistency: a webhook belongs to a system that assigns references, an inbox
assigns nothing until a human reads it, and the reference Lodge writes into the subject is then the
only thing either side can search for.

Building it needed the frozen interface to move, which is the part worth reading: `issues` obliged
both filing *and* chasing, and a service desk reached by a webhook can do one and not the other. It
was split into `issue-reporting` and `issue-tracking` (ADR-017), through ADR-006's process — the
compiler failed, the snapshot was updated by hand, both adapters and all six tools were re-checked,
and six contract tests went red and had to be decided one at a time. The freeze date did not reset;
`frozen.ts` carries `AMENDED_ON` beside `FROZEN_ON`.

**What it left behind, and what was done about it.** `issue-reporting` first depended on `rooms`,
which needed an inventory *and* a timetable feed — so an institution that could not export its
timetable could not report a broken projector either. That connection is indefensible once you say
it out loud, so `rooms` was split too, the same day: `room-inventory` (the table, publishes no tool
of its own) and `room-availability` (the table plus occupancy, publishes `campus.find_room`).
ADR-019, and the second amendment to the freeze in one afternoon.

A room list and an email address are now enough to file faults, which is what the runbook promised:
deploy with what the institution already has, and what it does not have simply is not published.

**Doing more with a fault once filed.** Separately and more cheaply: `issues` files and lists.
Updating, closing, or adding a note are the obvious next three, and UC-06 is already marked
`improvement` rather than essential.

**Accessible routes.** `Route.steps` currently says "go up to floor 1". An institution that knows
which lifts exist could answer "step-free route to FAR-104", which for some people is the difference
between the answer being useful and not. The interface already carries `Route.minutes` for the
institutions that can measure it.

**Questions about people, not rooms.** The directory is already configured and read. "Who teaches
this module" and "where is this lecturer's office" are the same data and no new source.

**The questions that live in prose, not in a system.** "How many exam sittings do I get", "how do
I apply for credit transfer", "what happens if I fail three modules" — students ask these constantly
and Lodge cannot answer any of them, because the answers are in the academic regulations rather than
in a calendar or a room table. A `knowledge-base` capability reading a corpus of institutional
documents would fit the existing shape exactly: declare it or do not, and the tool appears or does
not.

It is deliberately *not* built, and the reason is the interesting part. Retrieval's failure mode is
the opposite of this server's: it always finds something and composes a plausible answer from it,
where the rule here is that a fact not on record is reported as not on record (UC-03). The moment
this demonstration is proudest of — asking an institution with no directory for a timetable and
getting a refusal with **zero tool calls** — is only provable because there is nothing to retrieve.
Any such tool would have to cite the document and article rather than paraphrase, and return "not on
record" on weak retrieval, or it does not belong here.

Two further reasons it waits: the corpus is prose and public, so it would not disturb the
data-protection story, but an index over anything personal would be a *copy* of personal data with
its own retention and breach surface; and adding a capability means amending a frozen interface
(ADR-006), which is a deliberate act, not a convenience.

**Scopes per tool.** Today an institution declares one scope list and a token either opens
everything or nothing. Separating read from write — the fault report is the only write — is the
first thing a security review would ask for.

**Speech that sounds like speech.** The demonstration uses the browser's speech synthesis. A
speech-to-speech model would make the voice experience sound like the product it is simulating. Out
of scope for the deadline, and the first thing we would add for a real pilot.

---

## Known limitations

Things that are true today and that we would rather say ourselves.

**A self-hosted container forgets filed faults when it restarts.** The fault queue is in memory
there; only the managed deployment persists it, in DynamoDB. For a single-node demonstration this is
invisible, and for an institution actually taking reports it is not good enough. The store is behind
an interface — `IssueStore`, two methods — so pointing the container at Postgres or the
institution's own ticketing system is a small piece of work, and the right one.

**~~The deployed page serves one institution.~~** ✅ **Fixed, 20 September.** Carrigmore's files
were not in the managed function's bundle, so the institution switch — the single most convincing
thing Lodge does — was only visible locally. A Lambda layer now mounts them read-only and the
handler serves Carrigmore at `/mcp/carrigmore`, deliberately unequal: no LDAP inside a Lambda and no
service desk to mail, so it publishes **four tools against San Telmo's eight**. The switch is live.

**The managed deployment has a generated URL.** It changes if the stack is recreated, which is
survivable for a demonstration and not for OAuth: tokens are bound to a canonical URI. A real
managed deployment needs a custom domain first.

**Latency is measured serially.** 214 ms end to end from Spain, one request at a time. We have not
measured it under concurrency, and the answer to "what happens at nine in the morning when four
hundred people ask at once" is currently an argument about statelessness rather than a number.

**Traces, but no metrics.** OpenTelemetry spans are emitted and continue the caller's trace. There
are no counters or histograms, so an institution can see one slow request but not that Tuesdays are
slow.

**Two locales.** `es-ES` and `en-IE`. The messages are functions rather than templates precisely so
that agreement and plurals work, so a third is one file — but it is one file written by somebody who
speaks the language.

---

## One thing we would like somebody else to do

Both of the worst bugs in this project were found the same afternoon, by the same cause: every test
used an in-memory transport, which keeps a session, while the deployment builds a server per
request. A green suite, two broken features. It is in [the friction log](friction-log.md) and it is
the first thing [the adapter guide](writing-an-adapter.md) warns about.

The fix that would help everyone is not in Lodge: it is a test helper in the MCP SDK that runs the
same suite over both transports. We would rather it existed there than reimplement it here, and we
will say so upstream.
