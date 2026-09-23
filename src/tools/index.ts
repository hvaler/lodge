/**
 * The six MCP tools.
 *
 * Registered from the provider's *declared* capabilities, not from this file's imports (ADR-004):
 * an institution with no issue tracker never sees the agent offer to file a fault, because the
 * tools were never published.
 *
 * Everything here answers for a speaker first. The spoken text has to stand on its own — visual
 * cards arrive in M3 and are an improvement, not the answer.
 */

import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import {
  CAPABILITY_TOOLS,
  InvalidRequestError,
  NotFoundError,
  UnauthenticatedError,
} from '../provider/index.ts';
import type { Capability, Deadline, Provider, RequestContext, Room, Session } from '../provider/index.ts';
import { asCard, clientShowsCards, floorPlanCard, issueCard, occupancyCard } from '../cards/index.ts';
import { instantAt, localParts } from '../shared/time.ts';
import { messagesFor } from './messages.ts';
import type { Messages } from './messages.ts';

/** Builds the per-request context. The server supplies the real one; tests supply a stub. */
export type ResolveContext = (toolCtx: { mcpReq?: unknown }) => RequestContext;

const say = (text: string): CallToolResult => ({ content: [{ type: 'text', text }] });

// ── formatting ───────────────────────────────────────────────────────────────

function timeOf(at: Date, provider: Provider): string {
  return new Intl.DateTimeFormat(provider.descriptor.locale, {
    timeZone: provider.descriptor.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

function dayOf(at: Date, provider: Provider): string {
  return new Intl.DateTimeFormat(provider.descriptor.locale, {
    timeZone: provider.descriptor.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(at);
}

/** Messages in the institution's own language. */
function wordsFor(provider: Provider): Messages {
  return messagesFor(provider.descriptor.locale);
}

function describeRoom(room: Room, m: Messages): string {
  return m.describeRoom(room.id, m.roomKind[room.kind], room.capacity);
}

/**
 * Whole calendar days from `now` to `at`, in the institution's own zone.
 *
 * Deliberately not `ceil` over elapsed milliseconds. On Tuesday afternoon, a deadline at
 * Friday 23:59 is 3.3 elapsed days, which rounds up to "4 days left" — and nobody says that.
 * Counting dates rather than durations gives the answer a person would: Tuesday to Friday is
 * three days, and a deadline later today is zero.
 */
function daysUntil(at: Date, now: Date, timeZone: string): number {
  const dayOnly = (d: Date): number =>
    Date.parse(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d),
    );

  return Math.round((dayOnly(at) - dayOnly(now)) / 86_400_000);
}

/**
 * Turns an adapter error into something the agent can say.
 *
 * Rethrows anything unrecognised: a bug should surface as a protocol error rather than be read
 * aloud as though it were an answer about the campus.
 */
function spoken(error: unknown, m: Messages): CallToolResult {
  if (error instanceof UnauthenticatedError) return say(m.mustSignIn());
  if (error instanceof NotFoundError) return say(m.notOnRecord(error.kind, error.ref));
  // InvalidRequestError carries an adapter-composed message, which is already in the
  // institution's language: it names its own rooms and its own equipment.
  if (error instanceof InvalidRequestError) return say(error.message);
  throw error;
}

// ── registration ─────────────────────────────────────────────────────────────

/**
 * Registers the tools the provider's capabilities publish, and returns their names.
 *
 * The switch is exhaustive over {@link Capability}: adding a capability without adding its tools
 * fails to compile, which is the same drift `assertProviderCoherent` catches at runtime.
 */
export function registerTools(
  server: McpServer,
  provider: Provider,
  resolveContext: ResolveContext,
): readonly string[] {
  const registered: string[] = [];

  for (const capability of provider.descriptor.capabilities) {
    switch (capability) {
      // `room-inventory` registers nothing: it is what the other two are built on. The occupancy
      // card and the fault check read `listRooms` and `getRoom` through the provider they are
      // given, and neither is a question anybody asks a speaker on its own.
      case 'room-inventory':
        break;
      case 'room-availability':
        registerFindRoom(server, provider, resolveContext);
        registerRoomSchedule(server, provider, resolveContext);
        break;
      case 'room-booking':
        registerBookRoom(server, provider, resolveContext);
        break;
      case 'timetable':
        registerTimetable(server, provider, resolveContext);
        break;
      case 'deadlines':
        registerDeadlines(server, provider, resolveContext);
        break;
      case 'wayfinding':
        registerWayfind(server, provider, resolveContext);
        break;
      case 'issue-reporting':
        registerReportIssue(server, provider, resolveContext);
        break;
      case 'issue-tracking':
        registerIssueStatus(server, provider, resolveContext);
        break;
    }
    registered.push(...CAPABILITY_TOOLS[capability]);
  }

  return registered;
}

// ── campus.find_room ─────────────────────────────────────────────────────────

function registerFindRoom(server: McpServer, provider: Provider, resolve: ResolveContext): void {
  server.registerTool(
    'campus.find_room',
    {
      description: 'Find a room that is free right now, or for the next while.',
      inputSchema: z.object({
        building: z.string().optional().describe('Building code, e.g. MEN. Omit to search the whole campus.'),
        forMinutes: z.number().int().min(15).max(480).optional().describe('How long it is needed for. Defaults to an hour.'),
        minCapacity: z.number().int().min(1).optional().describe('Minimum seats.'),
      }),
    },
    async ({ building, forMinutes, minCapacity }, toolCtx): Promise<CallToolResult> => {
      const ctx = resolve(toolCtx);
      const m = wordsFor(provider);
      const window = {
        start: ctx.now,
        end: new Date(ctx.now.getTime() + (forMinutes ?? 60) * 60_000),
      };

      try {
        const rooms = await provider.findFreeRooms!(ctx, {
          window,
          ...(building ? { building } : {}),
          ...(minCapacity !== undefined ? { minCapacity } : {}),
        });

        if (rooms.length === 0) {
          return say(m.noFreeRooms(building ?? null, timeOf(window.end, provider)));
        }

        // Two or three options, not a list of twenty: this is being read out loud.
        const shortlist = rooms.slice(0, 3).map((room) => describeRoom(room, m));
        const spokenAnswer = say(
          m.freeRooms(timeOf(window.end, provider), shortlist, rooms.length - shortlist.length),
        );

        // The card is strictly extra: it shows the rooms that were *not* offered and why. Where
        // there is no screen the spoken answer above is the whole answer, unchanged.
        if (!clientShowsCards(server, toolCtx)) return spokenAnswer;

        const all = await provider.listRooms!(ctx);
        const inScope = building ? all.filter((room) => room.building === building) : all;
        const freeIds = new Set(rooms.map((room) => room.id));
        const until = timeOf(window.end, provider);

        return {
          content: [
            ...spokenAnswer.content,
            asCard(
              `card://rooms/${building ?? 'campus'}`,
              occupancyCard(inScope, freeIds, m, provider.descriptor.locale, {
                title: m.card.occupancyTitle(building ?? null),
                subtitle: m.card.occupancySubtitle(rooms.length, inScope.length, until),
              }),
            ),
          ],
        };
      } catch (error) {
        return spoken(error, m);
      }
    },
  );
}

// ── campus.room_schedule ─────────────────────────────────────────────────────

function registerRoomSchedule(server: McpServer, provider: Provider, resolve: ResolveContext): void {
  server.registerTool(
    'campus.room_schedule',
    {
      description:
        'Whether one particular room is free now, and when it is next free. Use this when '
        + 'somebody names a room; use campus.find_room when they just want any free room.',
      inputSchema: z.object({
        room: z.string().describe('Room id, e.g. MEN-203.'),
      }),
    },
    async ({ room }, toolCtx): Promise<CallToolResult> => {
      const ctx = resolve(toolCtx);
      const m = wordsFor(provider);

      // The rest of today, in the institution's own clock. Not the next twenty-four hours: "free
      // until nine tomorrow morning" is true and useless to somebody standing in a corridor.
      const endOfDay = new Date(ctx.now);
      endOfDay.setUTCHours(endOfDay.getUTCHours() + 24);

      try {
        const busy = await provider.roomSchedule!(ctx, {
          roomId: room,
          window: { start: ctx.now, end: endOfDay },
        });

        if (busy.length === 0) return say(m.roomFreeAllDay(room));

        const current = busy.find((slot) => slot.start <= ctx.now && slot.end > ctx.now);
        if (!current) {
          // Free now, and the first booking is when that ends.
          return say(m.roomFreeUntil(room, timeOf(busy[0]!.start, provider)));
        }

        // Taken now. What matters next is when it frees up, and back-to-back slots have to be
        // walked through rather than reporting the first gap that is really no gap at all.
        let freeFrom = current.end;
        for (const slot of busy) {
          if (slot.start <= freeFrom && slot.end > freeFrom) freeFrom = slot.end;
        }

        const taken = m.roomTakenUntil(room, timeOf(current.end, provider), current.label);
        return say(
          freeFrom >= endOfDay
            ? m.roomTakenAllDay(room)
            : taken + m.roomFreeUntil(room, timeOf(freeFrom, provider)),
        );
      } catch (error) {
        return spoken(error, m);
      }
    },
  );
}

// ── campus.book_room ─────────────────────────────────────────────────────────

function registerBookRoom(server: McpServer, provider: Provider, resolve: ResolveContext): void {
  server.registerTool(
    'campus.book_room',
    {
      description:
        'Hold a room. Call once WITHOUT confirmed to get the question to ask, then again '
        + 'with confirmed=true once the person has said yes. Nothing is held until then.',
      inputSchema: z.object({
        room: z.string().describe('Room id, e.g. MEN-203.'),
        at: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional()
          .describe('Start time today as HH:MM on the institution\'s clock. Defaults to now.'),
        forMinutes: z
          .number()
          .int()
          .min(15)
          .max(480)
          .optional()
          .describe('How long for. Defaults to an hour.'),
        purpose: z.string().optional().describe('What it is for, if they said.'),
        confirmed: z
          .boolean()
          .optional()
          .describe('Omit on the first call. Pass true only after the person has agreed.'),
      }),
    },
    async ({ room, at, forMinutes, purpose, confirmed }, toolCtx): Promise<CallToolResult> => {
      const ctx = resolve(toolCtx);
      const m = wordsFor(provider);
      const minutes = forMinutes ?? 60;

      try {
        const start = at ? atToday(at, ctx.now, provider) : ctx.now;

        // The first call validates and holds nothing. The room has to exist and be free before
        // anybody is asked to confirm — being asked "shall I?" and only then told the room is
        // taken wastes the person's turn, which is why the fault tool checks first too.
        const target = await provider.getRoom!(ctx, room);
        if (!target) return say(m.noSuchRoom(room));

        if (confirmed !== true) {
          const busy = await provider.roomSchedule!(ctx, {
            roomId: room,
            window: { start, end: new Date(start.getTime() + minutes * 60_000) },
          });
          if (busy.length > 0) {
            return say(m.roomTakenUntil(room, timeOf(busy[busy.length - 1]!.end, provider)).trim());
          }
          return say(m.confirmBooking(room, timeOf(start, provider), minutes));
        }

        const booking = await provider.bookRoom!(ctx, {
          roomId: room,
          start,
          minutes,
          ...(purpose ? { purpose } : {}),
        });

        return say(m.booked(room, timeOf(booking.start, provider), booking.reference));
      } catch (error) {
        return spoken(error, m);
      }
    },
  );
}

/** `16:00` today, on the institution's clock rather than the server's. */
function atToday(hhmm: string, now: Date, provider: Provider): Date {
  const today = localParts(now, provider.descriptor.timeZone).isoDate;
  return instantAt(today, hhmm, provider.descriptor.timeZone);
}

// ── campus.timetable ─────────────────────────────────────────────────────────

function registerTimetable(server: McpServer, provider: Provider, resolve: ResolveContext): void {
  server.registerTool(
    'campus.timetable',
    {
      // No name or student parameter, deliberately: the timetable returned is always the caller's
      // own. UC-02 requires that nobody can obtain another person's even by asking explicitly.
      //
      // The two-day reach is said in prose as well as in the schema, and that repetition is the
      // point. Asked "what have I got on Thursday", a model that sees the limit only in the `when`
      // enum does not conclude "I can answer today and tomorrow" — it improvises a reason, and the
      // one it improvised was "the Thursday timetable is not available at the moment", which
      // invents an outage that is not happening. Declining is correct; inventing why is not.
      description:
        'Your own timetable, for today or tomorrow only — it cannot look further ahead than that. '
        + 'Resolves against who you are signed in as, not a name.',
      inputSchema: z.object({
        when: z.enum(['today', 'tomorrow']).optional().describe('Defaults to today.'),
      }),
    },
    async ({ when }, toolCtx): Promise<CallToolResult> => {
      const ctx = resolve(toolCtx);
      const m = wordsFor(provider);
      const offset = when === 'tomorrow' ? 86_400_000 : 0;
      const dayStart = new Date(ctx.now.getTime() + offset);
      dayStart.setUTCHours(0, 0, 0, 0);
      const window = { start: dayStart, end: new Date(dayStart.getTime() + 86_400_000 - 1) };

      try {
        const sessions = await provider.timetable!(ctx, { window });
        const day = dayOf(window.start, provider);
        if (sessions.length === 0) return say(m.timetableEmpty(day));

        // Only institutions that actually have groups get one read out.
        const lines = sessions.map((s: Session) =>
          m.session(timeOf(s.start, provider), s.courseCode, s.roomId, s.group),
        );
        return say(m.timetable(day, lines));
      } catch (error) {
        return spoken(error, m);
      }
    },
  );
}

// ── campus.deadlines ─────────────────────────────────────────────────────────

function registerDeadlines(server: McpServer, provider: Provider, resolve: ResolveContext): void {
  server.registerTool(
    'campus.deadlines',
    {
      description: 'When an administrative deadline falls, and how long is left.',
      inputSchema: z.object({
        topic: z.string().optional().describe('What it is about, e.g. enrolment. Omit for everything upcoming.'),
      }),
    },
    async ({ topic }, toolCtx): Promise<CallToolResult> => {
      const ctx = resolve(toolCtx);
      const m = wordsFor(provider);

      try {
        const found = await provider.deadlines!(ctx, { ...(topic ? { topic } : {}) });

        // Saying so is the answer. Never approximate a date that is not on record (UC-03): a
        // confidently wrong enrolment deadline is how somebody misses the real one.
        if (found.length === 0) {
          return say(topic ? m.noDeadlineAbout(topic) : m.noDeadlinesAtAll());
        }

        const upcoming = found.filter((d: Deadline) => d.closesOn > ctx.now);
        const list = (upcoming.length > 0 ? upcoming : found).slice(0, 3);

        const lines = list.map((d: Deadline) => {
          const when = dayOf(d.closesOn, provider);

          // The label is the institution's own prose, read straight from its feed, so the sentence
          // around it cannot assume its grammar — and for the same reason it is never translated.
          // San Telmo writes noun phrases and Carrigmore writes clauses; a dash takes either.
          if (d.closesOn <= ctx.now) return m.deadlineClosed(d.label, when);

          const days = daysUntil(d.closesOn, ctx.now, provider.descriptor.timeZone);
          // "0 days left" is the most urgent case and the worst phrasing for it.
          if (days <= 0) return m.deadlineToday(d.label);
          return m.deadlineLeft(d.label, when, days);
        });

        return say(`${lines.join('. ')}.`);
      } catch (error) {
        return spoken(error, m);
      }
    },
  );
}

// ── campus.wayfind ───────────────────────────────────────────────────────────

function registerWayfind(server: McpServer, provider: Provider, resolve: ResolveContext): void {
  server.registerTool(
    'campus.wayfind',
    {
      description: 'Spoken directions to a room or building.',
      inputSchema: z.object({
        to: z.string().describe('Room id or building code, e.g. FAR-104 or FAR.'),
        from: z.string().optional().describe('Where you are now, if known.'),
      }),
    },
    async ({ to, from }, toolCtx): Promise<CallToolResult> => {
      const ctx = resolve(toolCtx);
      const m = wordsFor(provider);

      try {
        const route = await provider.wayfind!(ctx, { to, ...(from ? { from } : {}) });
        if (!route) return say(m.unknownPlace(to));

        // The steps alone have to get you there; the floor plan reference is for surfaces that
        // happen to have a screen, and is not mentioned in the spoken answer.
        // The steps arrive already in the institution's language: the adapter knows its own
        // locale, and half of each step is the institution's own building names.
        const spokenAnswer = say(route.steps.join(' '));

        // UC-04 is explicit that the spoken directions must get you there on their own, so the
        // floor plan is attached only when someone can see it, and never mentioned aloud.
        if (!clientShowsCards(server, toolCtx) || !provider.listRooms) return spokenAnswer;

        const all = await provider.listRooms(ctx);
        const destination = all.find((room) => room.id === to);
        if (!destination) return spokenAnswer;

        return {
          content: [
            ...spokenAnswer.content,
            asCard(
              `card://floor/${destination.building}/${destination.floor}`,
              floorPlanCard(all, destination, m, provider.descriptor.locale, {
                title: m.card.floorTitle(destination.building, destination.floor),
                subtitle: m.card.floorSubtitle(destination.id),
              }),
            ),
          ],
        };
      } catch (error) {
        return spoken(error, m);
      }
    },
  );
}

// ── campus.report_issue ──────────────────────────────────────────────────────

function registerReportIssue(server: McpServer, provider: Provider, resolve: ResolveContext): void {
  server.registerTool(
    'campus.report_issue',
    {
      description:
        'Report faulty equipment in a room. Call it once to get the question to ask, then again ' +
        'with confirmed=true once the person has said yes. Nothing is filed until then.',
      inputSchema: z.object({
        room: z.string().describe('Room id, e.g. MEN-203.'),
        equipment: z.string().describe('What is broken, e.g. projector.'),
        note: z.string().optional().describe('Anything else worth passing on.'),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            'Only true once the person has answered yes to the question this tool returned. ' +
              'Never set it on the first call, and never to act on an assumption.',
          ),
      }),
    },
    async ({ room, equipment, note, confirmed }, toolCtx): Promise<CallToolResult> => {
      const ctx = resolve(toolCtx);
      const m = wordsFor(provider);

      try {
        // Everything that can refuse comes BEFORE the question. Confirming "the projector in 301"
        // and only then hearing that 301 has no projector — or that you were never signed in —
        // wastes the person's turn and makes the confirmation look like a formality.
        if (!ctx.principal) return say(m.mustSignIn());

        const target = await provider.getRoom!(ctx, room);
        if (!target) return say(m.noSuchRoom(room));

        const wanted = equipment.trim().toLowerCase();
        if (!target.equipment.some((item) => item.toLowerCase() === wanted)) {
          return say(m.roomHasNoSuch(target.id, equipment, target.equipment));
        }

        // The confirmation is an argument and a second call, not a server-to-client request
        // (ADR-011). Nothing is filed on this branch, which is the whole of UC-05's guarantee.
        if (confirmed !== true) return say(m.confirmFault(equipment, target.id));

        const ticket = await provider.reportIssue!(ctx, {
          roomId: target.id,
          equipment,
          ...(note ? { note } : {}),
        });

        // The number is spoken back so the reporter can chase it later (UC-06) — a reference
        // that only exists on a screen is useless to someone holding a phone to their ear.
        const spokenAnswer = say(m.faultFiled(ticket.number, ticket.equipment, ticket.roomId));
        if (!clientShowsCards(server, toolCtx)) return spokenAnswer;

        return {
          content: [
            ...spokenAnswer.content,
            asCard(
              `card://issue/${ticket.number}`,
              issueCard(ticket, m, provider.descriptor.locale, provider.descriptor.timeZone, {
                title: m.card.issueTitle(),
                room: m.card.room,
                equipment: m.card.equipment,
                status: m.card.status,
                reported: m.card.reported,
              }),
            ),
          ],
        };
      } catch (error) {
        return spoken(error, m);
      }
    },
  );
}

// ── campus.issue_status ──────────────────────────────────────────────────────

function registerIssueStatus(server: McpServer, provider: Provider, resolve: ResolveContext): void {
  server.registerTool(
    'campus.issue_status',
    {
      // Again no parameter for whose reports to list: only the caller's own come back.
      description: 'How the faults you reported are getting on.',
      inputSchema: z.object({}),
    },
    async (_args, toolCtx): Promise<CallToolResult> => {
      const ctx = resolve(toolCtx);
      const m = wordsFor(provider);

      try {
        const tickets = await provider.issueStatus!(ctx);
        if (tickets.length === 0) return say(m.noReports());

        const lines = tickets
          .slice(0, 3)
          .map((t) => m.report(t.number, t.equipment, t.roomId, m.issueStatus[t.status]));
        return say(lines.join('. ') + '.');
      } catch (error) {
        return spoken(error, m);
      }
    },
  );
}
