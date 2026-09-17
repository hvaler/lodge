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

**Occupancy without a timetable feed.** `standards` publishes `rooms` only when it has both an
inventory *and* a timetable, because without occupancy it would be guessing. An institution whose
booking system answers "is this free" directly could support the capability without the feed.

**Filing into the tracker the institution already runs.** This is the largest gap in Lodge and the
one worth explaining properly, because the shape of the answer is not obvious.

Today, `campus.report_issue` writes into a queue Lodge owns: in memory in the container, DynamoDB on
Lambda. That is fine for a demonstration and useless for a university, where a broken projector has
to reach the people who fix projectors — and they already have a system they watch. So the
`standards` adapter **never declares `issues` at all**, and the code says why:

> *"Reading a queue is one thing; writing into the one maintenance already watches is an integration
> per institution, and the runbook puts that after the hackathon."*

The interface was built for this: the `issues` capability, `reportIssue` and `issueStatus` are in
the frozen contract, and the queue sits behind `IssueStore` — two methods. Nothing has to be
redesigned. What is missing is a source.

**What we would build, in this order.** Note what is *not* first:

1. **Email.** Every service desk on earth has an address, and a structured message to it needs no
   API key, no firewall exception, no vendor and no procurement. It is the only option here that is
   genuinely a standard every institution already has, which is the whole argument of this project.
2. **A webhook.** POST a documented JSON payload and let the institution wire it to whatever they
   run. The escape hatch for everyone the first two options do not fit.
3. **Concrete connectors** — Jira Service Management, GLPI, OTRS, ServiceNow, Redmine. These come
   last, not because they are hard, but because each one is a vendor's API that somebody has to keep
   working, and the first two cover most institutions without that cost.

**And here is the honest obstacle.** The `issues` capability obliges *both* `reportIssue` and
`issueStatus`. Email can file a fault and cannot answer "how is my report going" — so an
email-only institution would have to declare a tool that cannot work, which is precisely what
capability negotiation exists to prevent. Supporting it properly means **splitting the capability**
into filing and chasing.

That would move the frozen interface. Which is allowed — ADR-006 is a doorbell, not a wall — but it
is exactly the kind of change that should be made deliberately, with the snapshot updated by hand
and both adapters re-checked, rather than slipped in. It is the first real candidate for breaking
the freeze, and it is a good argument that the freeze worked: the contract survived four milestones
and the first thing that genuinely strains it is a capability nobody had built yet.

**Why not before the deadline.** Two reasons, and the second is the real one. It needs the interface
to move. And Carrigmore not being able to file a fault is the single most convincing thing the
demonstration does — the agent does not decline, it *cannot*, because the tool was never in the
catalogue. Building this would mean deliberately leaving it unconfigured for the video anyway.

**Doing more with a fault once filed.** Separately and more cheaply: `issues` files and lists.
Updating, closing, or adding a note are the obvious next three, and UC-06 is already marked
`improvement` rather than essential.

**Accessible routes.** `Route.steps` currently says "go up to floor 1". An institution that knows
which lifts exist could answer "step-free route to FAR-104", which for some people is the difference
between the answer being useful and not. The interface already carries `Route.minutes` for the
institutions that can measure it.

**Questions about people, not rooms.** The directory is already configured and read. "Who teaches
this module" and "where is this lecturer's office" are the same data and no new source.

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

**The deployed page serves one institution.** Carrigmore's CSV and iCalendar files are not in that
function's bundle, so the institution switch — the single most convincing thing Lodge does — is only
visible in `npm run demo` and in the video. Bundling the fixtures would fix it.

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
