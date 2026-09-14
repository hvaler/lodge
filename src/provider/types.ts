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

export interface Room {
  /** Qualified and unique across the institution, e.g. `MEN-203`. */
  readonly id: string;
  /** Building code, e.g. `MEN`. */
  readonly building: string;
  readonly floor: number;
  readonly kind: RoomKind;
  readonly capacity: number;
  /** Free-form, adapter-supplied. A fault can only be reported against equipment listed here. */
  readonly equipment: readonly string[];
}

export interface FreeRoomQuery {
  /** Building code. Omitted means the whole campus. */
  readonly building?: string;
  readonly window: TimeWindow;
  readonly minCapacity?: number;
}

// ── Timetable ────────────────────────────────────────────────────────────────

export interface Session {
  readonly start: Date;
  readonly end: Date;
  readonly roomId: string;
  readonly courseCode: string;
  readonly group: string;
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
  readonly minutes: number;
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
