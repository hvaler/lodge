/**
 * Domain types shared by every adapter.
 *
 * These are deliberately small and institution-agnostic: a building code, a room, a teaching
 * session, a deadline, a route, a ticket. Anything that only one institution has does not belong
 * here — that is what pushed the project to two adapters instead of one (ADR-002).
 */

/**
 * The authenticated caller.
 *
 * `subject` is the opaque identifier carried by the access token. It is never a name typed by a
 * user: UC-02 requires that two identities get different timetables and that neither can obtain
 * the other's *even by asking explicitly*. That guarantee only holds if the identity travels in
 * the context rather than in a tool parameter, which is why no query type below has a name field.
 */
export interface Principal {
  readonly subject: string;
}

/**
 * Per-request context. Every provider method takes one.
 *
 * `now` is injected rather than read from the clock so the `synthetic` adapter stays
 * deterministic: same seed and same `now` must give the same answers as the demo video.
 * Production code must never call `new Date()` below this boundary.
 */
export interface RequestContext {
  /** `null` for an unauthenticated call. Capabilities that need an identity must reject it. */
  readonly principal: Principal | null;
  readonly now: Date;
  /** BCP 47 tag, taken from the adapter's declared locale. */
  readonly locale: string;
}

export interface TimeWindow {
  readonly start: Date;
  readonly end: Date;
}

// ── Rooms ────────────────────────────────────────────────────────────────────

export type RoomKind = 'lecture' | 'seminar' | 'lab' | 'computer-lab' | 'study' | 'auditorium';

/**
 * One site of an institution that has more than one.
 *
 * Added because a university with several campuses is the normal case, not the exception, and
 * "building" is the wrong level to hang it on: two sites can each have a building A, and a room
 * code is only unique within its site.
 *
 * Every field an institution might reasonably differ on lives here rather than being assumed from
 * the institution: a site can sit in another country, and a spoken "your class is at nine" is
 * wrong in the listener's zone unless somebody says which one it means.
 */
export interface Site {
  /** Stable id used in queries and on rooms, e.g. `cantoblanco`. */
  readonly id: string;
  /** What it is called out loud, e.g. `Cantoblanco`. */
  readonly name: string;
  /**
   * IANA zone, when this site does not keep the institution's own.
   *
   * Absent means "the same as the institution", which is the answer for every site of every
   * institution in one country — so nobody has to write it to get the common case right.
   */
  readonly timeZone?: string;
}

export interface Room {
  /** Qualified and unique across the institution, e.g. `MEN-203`. */
  readonly id: string;
  /**
   * Which site it is on, when the institution declared more than one.
   *
   * Optional on purpose: an institution with a single site should not have to invent an id for it,
   * and every adapter written before sites existed keeps working untouched.
   */
  readonly site?: string;
  /** Building code, e.g. `MEN`. */
  readonly building: string;
  readonly floor: number;
  readonly kind: RoomKind;
  readonly capacity: number;
  /** Free-form, adapter-supplied. A fault can only be reported against equipment listed here. */
  readonly equipment: readonly string[];
}

export interface FreeRoomQuery {
  /** Site id. Omitted means every site the institution serves. */
  readonly site?: string;
  /** Building code. Omitted means the whole campus. */
  readonly building?: string;
  readonly window: TimeWindow;
  readonly minCapacity?: number;
}

// ── One room's diary ──────────────────────────────────────────────────────────

/** When a particular room is taken, rather than which rooms are free. */
export interface RoomScheduleQuery {
  readonly roomId: string;
  readonly window: TimeWindow;
}

/**
 * A period a room is taken for.
 *
 * `label` is whatever the source says is using it and nothing more. An adapter that only knows a
 * room is busy says so and leaves this out, because "busy" and "busy with Discrete Mathematics"
 * are different claims and only one of them is on record.
 */
export interface Busy {
  readonly start: Date;
  readonly end: Date;
  readonly label?: string;
}

// ── Booking ───────────────────────────────────────────────────────────────────

/** A request to hold a room. The caller's identity comes from the context, never from here. */
export interface BookRoomQuery {
  readonly roomId: string;
  readonly start: Date;
  /** How long, in minutes. */
  readonly minutes: number;
  /** What it is for, if the person said. Shown to whoever else looks at the room's diary. */
  readonly purpose?: string;
}

// Note what is NOT here: `confirmed`. The two-turn confirmation is a conversation, and a
// conversation is the tool's business — `campus.report_issue` keeps it there too. A provider that
// knew about it would be an adapter author's problem for no gain: by the time this is called,
// somebody has already said yes.

/** A held room. `reference` is whatever the booking system calls it, never invented here. */
export interface Booking {
  readonly reference: string;
  readonly roomId: string;
  readonly start: Date;
  readonly end: Date;
  readonly purpose?: string;
}

// ── Timetable ────────────────────────────────────────────────────────────────

export interface Session {
  readonly start: Date;
  readonly end: Date;
  readonly roomId: string;
  readonly courseCode: string;
  /**
   * Teaching group, where the institution has them.
   *
   * Optional because not every institution splits a cohort: San Telmo runs groups A and B on its
   * larger programmes, Carrigmore runs none at all. Requiring it would have forced the second
   * adapter to invent a value — which is exactly the fake seam two adapters exist to prevent.
   */
  readonly group?: string;
}

/**
 * Note what is absent: there is no student or staff field. The timetable returned is always the
 * one belonging to `RequestContext.principal`.
 */
export interface TimetableQuery {
  readonly window: TimeWindow;
}

// ── Deadlines ────────────────────────────────────────────────────────────────

export interface Deadline {
  readonly id: string;
  readonly label: string;
  readonly closesOn: Date;
  readonly opensOn?: Date;
}

export interface DeadlineQuery {
  /**
   * Free-text hint, e.g. "enrolment". Matching is the adapter's business.
   *
   * An adapter that finds nothing returns an empty list. It must never approximate a date:
   * UC-03 requires the agent to say a deadline is not on record rather than guess one.
   */
  readonly topic?: string;
  readonly window?: TimeWindow;
}

// ── Wayfinding ───────────────────────────────────────────────────────────────

export interface Route {
  /**
   * Spoken directions, in order. These must be sufficient on their own to get there — UC-04 makes
   * the floor plan an improvement, not a requirement, because most of the surface has no screen.
   */
  readonly steps: readonly string[];
  /**
   * Estimated walk, where the institution can say.
   *
   * Optional because a distance between buildings is not one of the things institutions already
   * have: there are iCalendar feeds, a directory and a room table, but no distance matrix. San
   * Telmo knows its own campus and says "eleven minutes"; Carrigmore can only say which building
   * and floor. Requiring the number would have made the second adapter invent one.
   */
  readonly minutes?: number;
  /** Opaque reference an adapter may supply for a visual card. Optional by design. */
  readonly floorPlanRef?: string;
}

export interface WayfindQuery {
  /** Room id, or a building code when the caller only knows the building. */
  readonly from?: string;
  readonly to: string;
}

// ── Issues ───────────────────────────────────────────────────────────────────

export type IssueStatus = 'open' | 'in-progress' | 'resolved';

export interface Ticket {
  /** Adapter-allocated, e.g. `INC-2026-0031`. Spoken back to the reporter. */
  readonly number: string;
  readonly roomId: string;
  readonly equipment: string;
  readonly status: IssueStatus;
  readonly openedAt: Date;
}

export interface ReportIssueQuery {
  readonly roomId: string;
  /** Must match one of the entries in that room's {@link Room.equipment}. */
  readonly equipment: string;
  readonly note?: string;
}
