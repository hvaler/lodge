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
  Deadline,
  DeadlineQuery,
  FreeRoomQuery,
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
import { CAMPUS_TIMEZONE, ROOMS, buildingByCode, isOpenThroughout, roomById, walkBetween } from './campus.ts';
import { InMemoryIssueStore } from './issues.ts';
import type { IssueStore } from './issues.ts';
import { busyRoomIds, sessionsForPerson } from './timetable.ts';

export const SYNTHETIC_DESCRIPTOR: ProviderDescriptor = {
  id: 'synthetic',
  institution: 'Universidad de San Telmo',
  locale: 'es-ES',
  timeZone: CAMPUS_TIMEZONE,
  capabilities: ['rooms', 'timetable', 'deadlines', 'wayfinding', 'issues'],
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

  constructor(issues: IssueStore = new InMemoryIssueStore()) {
    this.#issues = issues;
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

    return ROOMS.filter((room) => {
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

  async getRoom(_ctx: RequestContext, roomId: string): Promise<Room | null> {
    const room = roomById(roomId);
    return room ? toRoom(room) : null;
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
        steps.push(`Leave ${origin.name} and ${walk.hint} — about ${walk.minutes} minutes on foot.`);
        minutes += walk.minutes;
      }
    }

    steps.push(`You want ${target.name}.`);

    if (destination) {
      steps.push(
        destination.floor === 0
          ? `${destination.id} is on the ground floor.`
          : `Take the stairs to floor ${destination.floor}; ${destination.id} is signposted from the landing.`,
      );
      // Santa Clara's west wing has no lift, and someone told to "take the lift" there is stuck.
      if (target.code === 'SCL' && destination.floor > 0) {
        steps.push('There is no lift in the west wing, so allow a little longer.');
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
        `${room.id} has no '${query.equipment}'. It has: ${room.equipment.join(', ')}.`,
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

  /** Only what this caller filed. UC-06 is a privacy boundary, not a convenience filter. */
  async issueStatus(ctx: RequestContext): Promise<readonly Ticket[]> {
    const subject = requirePrincipal(ctx, 'Checking a fault report');
    return this.#issues.openedBy(subject);
  }
}

/** Convenience for the server and the tests. */
export function createSyntheticProvider(issues?: IssueStore): SyntheticProvider {
  return new SyntheticProvider(issues);
}
