# Writing an adapter

An adapter is how Lodge learns about *your* campus. There are two in this repository and the
interface between them and everything else has been frozen since 16 September 2026, so what follows
will not move under you.

This is a short document because it is a small interface: one descriptor, eight optional methods,
and one rule about which of them you have to implement.

---

## First: do you need one?

Probably not. The `standards` adapter reads a room list as CSV, timetables and deadlines as
iCalendar, and people from LDAP — and it publishes only the tools its sources can support. If you
can export those, configure it and stop reading. See [adopting.md](adopting.md).

Write an adapter when your data lives somewhere that does not export any of that: a student
information system with its own API, a room booking product with a REST interface, a timetabling
system nobody has touched since 2011 but which does have a database.

---

## The shape of it

```ts
import type { Provider, RequestContext, Room, FreeRoomQuery } from '../provider/index.ts';

export function createExampleProvider(): Provider {
  return {
    descriptor: {
      id: 'example',
      institution: 'Example University',
      locale: 'en-GB',
      timeZone: 'Europe/London',
      capabilities: ['rooms', 'deadlines'],
    },

    async findFreeRooms(ctx: RequestContext, query: FreeRoomQuery): Promise<readonly Room[]> { … },
    async getRoom(ctx, roomId) { … },
    async listRooms(ctx) { … },
    async deadlines(ctx, query) { … },
  };
}
```

That is the whole contract. Eight methods exist; you implement the ones your sources can answer.

### The rule

**Declare a capability only if you implement every method it obliges, and implement a method only if
you declared its capability.** Both directions are checked when the adapter loads:

| Capability | Obliges |
|---|---|
| `rooms` | `findFreeRooms`, `getRoom`, `listRooms` |
| `timetable` | `timetable` |
| `deadlines` | `deadlines` |
| `wayfinding` | `wayfind` |
| `issues` | `reportIssue`, `issueStatus` |

Get it wrong and the process refuses to start, naming what is missing:

```
Adapter 'example' declares capability 'issues' but does not implement 'reportIssue'.
```

That check is the whole reason the catalogue is trustworthy. The six MCP tools are derived from what
you declare, so an institution with no fault tracker never sees the agent offer to file one — and
the agent genuinely cannot, because the tool was never in the list it was given. It is not a rule
the model is asked to follow.

### Half a capability is worth declaring

If you can list rooms but have no occupancy data, do not declare `rooms` and return guesses.
Declare nothing, publish nothing, and the agent will say this institution cannot answer that. A
confidently wrong answer about whether a room is free is worse than no answer, because somebody
walks to it.

---

## The types you will return

Small and institution-agnostic on purpose. Anything only one institution has does not belong here.

```ts
interface Room {
  id: string;          // qualified and unique, e.g. "MEN-203"
  building: string;    // "MEN"
  floor: number;
  kind: 'lecture' | 'seminar' | 'lab' | 'computer-lab' | 'study' | 'auditorium';
  capacity: number;
  equipment: readonly string[];   // your own words — they are read back verbatim
}

interface Session  { start: Date; end: Date; roomId: string; courseCode: string; group?: string }
interface Deadline { id: string; label: string; closesOn: Date; opensOn?: Date }
interface Route    { steps: readonly string[]; minutes?: number; floorPlanRef?: string }
interface Ticket   { number: string; roomId: string; equipment: string; status: IssueStatus; openedAt: Date }
```

The optional fields are optional because a real second adapter could not fill them. `Session.group`
because not every institution splits a cohort. `Route.minutes` because a room list is not a distance
matrix. Requiring either would have forced the second adapter to invent a value, which is the fake
seam that having two adapters exists to prevent.

`equipment` deserves a note: those strings reach a person's ears unchanged. Write what your staff
call things — `proyector`, `pizarra`, `PA system`. Lodge translates what it owns and never what the
institution owns.

---

## Five things not to break

**1 · Identity comes from the context, never from a parameter.**

```ts
interface TimetableQuery { window: TimeWindow }   // and nothing else
```

There is no name field, so a model cannot ask for somebody else's timetable — the request cannot be
expressed. Resolve against `ctx.principal` and throw `UnauthenticatedError` when it is `null`.

**2 · `now` is injected, not read.** Use `ctx.now`. Never call `new Date()` below this boundary —
it is what keeps the generated adapter reproducible and what lets every test pin an instant.

**3 · Never approximate.** A deadline you cannot find is an empty list, not the nearest one. The
agent has to be able to say "that is not on record"; a confidently wrong date is how somebody misses
the real one.

**4 · Return nothing you would not say out loud.** Most of the surface Lodge is built for is a
speaker with no screen. Do not return a room that is booked, closed or supervised.

**5 · Throw the errors the tools know how to speak.**

```ts
import { UnauthenticatedError, NotFoundError, InvalidRequestError } from '../provider/index.ts';
```

Anything else surfaces as a generic failure. These become sentences in the institution's language.

---

## Plugging it in

One case in `src/server/config.ts`:

```ts
const institutionSchema = z.object({
  adapter: z.enum(['synthetic', 'standards', 'example']),
  example: exampleSchema.optional(),
  auth: authSchema.optional(),
});

export async function createProviderFor(institution: InstitutionConfig): Promise<Provider> {
  if (institution.adapter === 'example') return createExampleProvider(institution.example!);
  …
}
```

Validate the configuration in the schema, loudly. An institution should learn its credentials are
wrong when the container refuses to start.

---

## Testing it

Copy the shape of `src/adapters/synthetic/synthetic.test.ts`. Each block there is one acceptance
criterion from [use-cases.md](use-cases.md), which is the single source of them — if a behaviour
changes, it changes there first.

Three tests earn their keep more than the rest:

```ts
it('declares every capability and implements each one', () => {
  expect(() => assertProviderCoherent(provider)).not.toThrow();
});

it('refuses an unauthenticated caller rather than returning a default', async () => {
  await expect(provider.timetable(ctx(null), { window })).rejects.toThrow(UnauthenticatedError);
});

it('returns nothing for a deadline that is not on record', async () => {
  expect(await provider.deadlines(ctx(), { topic: 'parking permit' })).toEqual([]);
});
```

**And one that goes over a real socket.** We learned this the expensive way: our card and
confirmation features passed 287 tests and worked in no deployment, because every test used an
in-memory transport that keeps a session and the real one does not. `src/cards/transport.test.ts` is
the pattern — start an HTTP server, connect a real client, assert on what comes back.

---

## What you cannot change

`src/provider/provider.ts` and `src/provider/types.ts` are frozen. `src/provider/frozen.ts` holds a
snapshot the compiler checks on every build, so a change fails loudly rather than quietly.

If your source genuinely needs the contract to move, that is worth knowing and the build will make
sure somebody looks: update the snapshot by hand, record what moved and why in `_hilo/DECISIONES.md`
under ADR-006, and re-check both existing adapters and all six tools. That blast radius is exactly
what the freeze exists to make visible — it is not a wall, it is a doorbell.
