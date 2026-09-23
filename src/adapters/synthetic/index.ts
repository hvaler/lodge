/**
 * The `synthetic` adapter: the Universidad de San Telmo behind the provider interface.
 *
 * Reference, demo and reproducibility. Deterministic by contract — same seed and same injected
 * clock give the answers in the video, which is what lets a judge clone the repository and check
 * rather than take our word for it.
 */

import {
  InvalidRequestError,
  NotFoundError,
  UnauthenticatedError,
} from '../../provider/errors.ts';
import type {
  BookRoomQuery,
  Booking,
  Busy,
  Deadline,
  DeadlineQuery,
  FreeRoomQuery,
  RoomScheduleQuery,
  Provider,
  ProviderDescriptor,
  ReportIssueQuery,
  RequestContext,
  Room,
  Route,
  Session,
  Ticket,
  TimetableQuery,
  WayfindQuery,
} from '../../provider/index.ts';
import { CALENDAR, personBySubject } from './academic.ts';
import {
  CAMPUS_TIMEZONE,
  ROOMS,
  SITES,
  buildingByCode,
  isOpenThroughout,
  roomById,
  walkBetween,
} from './campus.ts';
import { InMemoryBookingStore } from './bookings.ts';
import type { BookingStore } from './bookings.ts';
import { InMemoryIssueStore } from './issues.ts';
import type { IssueStore } from './issues.ts';
import { busyPeriodsFor, busyRoomIds, sessionsForPerson } from './timetable.ts';

export const SYNTHETIC_DESCRIPTOR: ProviderDescriptor = {
  id: 'synthetic',
  institution: 'Universidad de San Telmo',
  locale: 'es-ES',
  timeZone: CAMPUS_TIMEZONE,
  // Two campuses. Both keep the institution's zone, so neither declares one of its own — which is
  // the common case and the reason `timeZone` is optional on a site.
  sites: SITES,
  // San Telmo runs its own maintenance queue, so it can both take a report and answer how it is
  // getting on. An institution whose service desk is an email address declares only the first.
  capabilities: [
    'room-inventory',
    'room-availability',
    'timetable',
    'deadlines',
    'wayfinding',
    'issue-reporting',
    'issue-tracking',
    // San Telmo owns its own room diary, so it can hold a room as well as say one is free. An
    // institution whose calendars are a published iCalendar feed can do the second and not the
    // first, and says so by leaving this out.
    'room-booking',
  ],
};

/** Strips the adapter's own bookkeeping before a room crosses the interface. */
function toRoom(room: (typeof ROOMS)[number]): Room {
  const { supervised: _supervised, ...rest } = room;
  return rest;
}

function requirePrincipal(ctx: RequestContext, what: string): string {
  if (!ctx.principal) throw new UnauthenticatedError(what);
  return ctx.principal.subject;
}

/** `MEN-203` and `MEN` both identify the Mendizábal building. */
function buildingOf(ref: string): string {
  return ref.includes('-') ? (ref.split('-')[0] as string) : ref;
}

export class SyntheticProvider implements Provider {
  readonly descriptor = SYNTHETIC_DESCRIPTOR;
  readonly #issues: IssueStore;
  readonly #bookings: BookingStore;

  constructor(
    issues: IssueStore = new InMemoryIssueStore(),
    bookings: BookingStore = new InMemoryBookingStore(),
  ) {
    this.#issues = issues;
    this.#bookings = bookings;
  }

  // ── rooms ──────────────────────────────────────────────────────────────────

  /**
   * Rooms free for the whole window.
   *
   * UC-01 accepts no occupied, booked or out-of-hours room in the answer. A supervised lab is the
   * same class of wrong answer — empty, but not somewhere a student can go and sit down — so it is
   * excluded too.
   */
  async findFreeRooms(ctx: RequestContext, query: FreeRoomQuery): Promise<readonly Room[]> {
    if (query.window.end <= query.window.start) {
      throw new InvalidRequestError('The time window ends before it starts.');
    }

    const busy = busyRoomIds(query.window);
    // A room somebody has booked is not free, and forgetting that is how two groups end up in it.
    for (const booking of await this.#bookings.overlapping(query.window)) {
      busy.add(booking.roomId);
    }

    return ROOMS.filter((room) => {
      if (query.site && room.site !== query.site) return false;
      if (query.building && room.building !== query.building) return false;
      if (room.supervised) return false;
      if (busy.has(room.id)) return false;
      if (query.minCapacity !== undefined && room.capacity < query.minCapacity) return false;

      const building = buildingByCode(room.building);
      return building ? isOpenThroughout(building, query.window.start, query.window.end) : false;
    })
      .map(toRoom)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * When one room is taken, teaching and bookings together.
   *
   * Both, because the person asking does not care which system said no. A room held for a
   * departmental meeting is exactly as unavailable as one with a lecture in it, and an answer that
   * only knew about one of them would send somebody to a door that does not open.
   */
  async roomSchedule(ctx: RequestContext, query: RoomScheduleQuery): Promise<readonly Busy[]> {
    if (query.window.end <= query.window.start) {
      throw new InvalidRequestError('The time window ends before it starts.');
    }
    if (!roomById(query.roomId)) throw new NotFoundError('room', query.roomId);

    const booked = (await this.#bookings.overlapping(query.window))
      .filter((b) => b.roomId === query.roomId)
      .map((b) => ({
        start: b.start,
        end: b.end,
        // The purpose only to whoever booked it. It is free text somebody typed, and "tutoring
        // with <a student's name>" read aloud to a stranger in a corridor is a leak. To anybody
        // else the room is just taken — which is all they asked.
        ...(b.purpose && ctx.principal?.subject === b.bookedBy ? { label: b.purpose } : {}),
      }));

    return [...busyPeriodsFor(query.roomId, query.window), ...booked].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
  }

  async getRoom(_ctx: RequestContext, roomId: string): Promise<Room | null> {
    const room = roomById(roomId);
    return room ? toRoom(room) : null;
  }

  async listRooms(): Promise<readonly Room[]> {
    return ROOMS.map(toRoom);
  }

  // ── timetable ──────────────────────────────────────────────────────────────

  /**
   * The caller's own timetable.
   *
   * Resolved from `ctx.principal` and nothing else. {@link TimetableQuery} has no name field, so
   * there is no parameter an agent could fill in with someone else's name — which is how UC-02's
   * "neither can obtain the other's, even by asking explicitly" is met structurally.
   */
  async timetable(ctx: RequestContext, query: TimetableQuery): Promise<readonly Session[]> {
    const subject = requirePrincipal(ctx, 'Looking up a timetable');
    const person = personBySubject(subject);
    if (!person) throw new NotFoundError('person', subject);

    return sessionsForPerson(person, query.window);
  }

  // ── deadlines ──────────────────────────────────────────────────────────────

  /**
   * What is on record, and only that.
   *
   * An unmatched topic returns an empty list. UC-03 requires the agent to say a deadline is not on
   * record rather than infer one, so there is deliberately no fuzzy fallback here: a near-miss
   * would be worse than nothing, because a confidently wrong enrolment date makes someone miss it.
   */
  async deadlines(_ctx: RequestContext, query: DeadlineQuery): Promise<readonly Deadline[]> {
    const topic = query.topic?.trim().toLowerCase();

    return CALENDAR.filter((entry) => {
      if (topic && !entry.label.toLowerCase().includes(topic) && !entry.id.includes(topic)) return false;
      if (query.window) {
        if (entry.closesOn < query.window.start || entry.closesOn > query.window.end) return false;
      }
      return true;
    }).sort((a, b) => a.closesOn.getTime() - b.closesOn.getTime());
  }

  // ── wayfinding ─────────────────────────────────────────────────────────────

  /**
   * Spoken directions.
   *
   * The steps have to be enough on their own: most of the surface is a speaker with no screen, and
   * UC-04 makes the floor plan an improvement rather than a requirement.
   *
   * Written in Spanish because that is what San Telmo declares. Route steps cross the interface
   * already in the institution's language — the adapter is the only layer that knows both the
   * locale and the building names, and half of every step is a building name.
   */
  async wayfind(_ctx: RequestContext, query: WayfindQuery): Promise<Route | null> {
    const destination = roomById(query.to);
    const toBuilding = buildingByCode(buildingOf(query.to));
    if (!destination && !toBuilding) return null;

    const target = toBuilding ?? buildingByCode(destination!.building)!;
    const steps: string[] = [];
    let minutes = 0;

    const from = query.from ? buildingOf(query.from) : null;
    if (from && from !== target.code) {
      const walk = walkBetween(from, target.code);
      const origin = buildingByCode(from);
      if (walk && origin) {
        steps.push(`Sal de ${origin.name} y ${walk.hint}: unos ${walk.minutes} minutos a pie.`);
        minutes += walk.minutes;
      }
    }

    steps.push(`Vas a ${target.name}.`);

    if (destination) {
      steps.push(
        destination.floor === 0
          ? `${destination.id} está en la planta baja.`
          : `Sube a la planta ${destination.floor}; ${destination.id} está señalizado desde el rellano.`,
      );
      // Santa Clara's west wing has no lift, and someone told to "take the lift" there is stuck.
      if (target.code === 'SCL' && destination.floor > 0) {
        steps.push('En el ala oeste no hay ascensor, así que calcula un poco más.');
      }
      minutes += destination.floor;
    }

    // The key is omitted rather than set to undefined: with `exactOptionalPropertyTypes`, an
    // absent floor plan and a floor plan that is undefined are different things, and only the
    // first one is true here.
    return destination
      ? { steps, minutes, floorPlanRef: `${target.code}-floor-${destination.floor}` }
      : { steps, minutes };
  }

  // ── issues ─────────────────────────────────────────────────────────────────

  /**
   * Files a fault.
   *
   * The equipment has to be something the room actually has. That check is what makes the
   * multi-turn confirmation meaningful instead of ceremonial: confirming "the projector in 203"
   * means something only if a room without a projector would have been refused.
   */
  async reportIssue(ctx: RequestContext, query: ReportIssueQuery): Promise<Ticket> {
    const subject = requirePrincipal(ctx, 'Reporting a fault');

    const room = roomById(query.roomId);
    if (!room) throw new NotFoundError('room', query.roomId);

    const wanted = query.equipment.trim().toLowerCase();
    const equipment = room.equipment.find((item) => item.toLowerCase() === wanted);
    if (!equipment) {
      throw new InvalidRequestError(
        `${room.id} no tiene ${query.equipment}. Tiene: ${room.equipment.join(', ')}.`,
      );
    }

    return this.#issues.add({
      roomId: room.id,
      equipment,
      status: 'open',
      openedAt: ctx.now,
      openedBy: subject,
    });
  }

  // ── booking ───────────────────────────────────────────────────────────────

  /**
   * Holds a room for the caller.
   *
   * Every refusal here is a refusal somebody can act on: the room does not exist, it is supervised,
   * the building is shut, or it is already taken. None of them is "that did not work" — a booking
   * tool that cannot say *why* it said no is a tool people stop using.
   *
   * By the time this runs, somebody has already confirmed. The two-turn conversation is the tool's
   * business, the same way it is for filing a fault.
   */
  async bookRoom(ctx: RequestContext, query: BookRoomQuery): Promise<Booking> {
    const subject = requirePrincipal(ctx, 'Booking a room');

    const room = roomById(query.roomId);
    if (!room) throw new NotFoundError('room', query.roomId);
    if (room.supervised) {
      throw new InvalidRequestError(`${room.id} es un aula supervisada y no se reserva.`);
    }
    if (query.minutes < 15 || query.minutes > 480) {
      throw new InvalidRequestError('Una reserva dura de quince minutos a ocho horas.');
    }

    const window = {
      start: query.start,
      end: new Date(query.start.getTime() + query.minutes * 60_000),
    };

    const building = buildingByCode(room.building);
    if (!building || !isOpenThroughout(building, window.start, window.end)) {
      throw new InvalidRequestError(`${building?.name ?? room.building} no está abierto todo ese tiempo.`);
    }

    // Checked here and not only in the tool: a provider that trusts its caller to have checked is
    // one double booking away from being wrong, and this is the only place that sees both the
    // timetable and the diary.
    const taken = await this.roomSchedule(ctx, { roomId: room.id, window });
    if (taken.length > 0) {
      throw new InvalidRequestError(`${room.id} ya está ocupada a esa hora.`);
    }

    return this.#bookings.add({
      roomId: room.id,
      start: window.start,
      end: window.end,
      ...(query.purpose ? { purpose: query.purpose } : {}),
      bookedBy: subject,
    });
  }


  /** Only what this caller filed. UC-06 is a privacy boundary, not a convenience filter. */
  async issueStatus(ctx: RequestContext): Promise<readonly Ticket[]> {
    const subject = requirePrincipal(ctx, 'Checking a fault report');
    return this.#issues.openedBy(subject);
  }
}

/** Convenience for the server and the tests. */
export function createSyntheticProvider(
  issues?: IssueStore,
  bookings?: BookingStore,
): SyntheticProvider {
  return new SyntheticProvider(issues, bookings);
}
