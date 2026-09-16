/**
 * The provider interface, frozen.
 *
 * ADR-006 puts a date on this contract because the runbook's highest risk is "the abstraction eats
 * the calendar": designing for *any* institution is where a week disappears without anyone
 * noticing, and there is always one more field that would be a little more elegant. From the date
 * below the interface is implemented against, not edited.
 *
 * This file is that date made enforceable — a snapshot of `provider.ts` and `types.ts` as they
 * stood, checked against the live definitions by the compiler. It does not *prevent* a change;
 * nothing sensibly could. It makes one fail loudly and forces whoever makes it to update the
 * snapshot on purpose. The risk was never the change. It was the silent change discovered three
 * days later, from the other adapter.
 *
 * **If the build sent you here:** decide whether the interface genuinely has to move. If it does,
 * update the snapshot, record what moved and why in ADR-006, and re-check both adapters and all
 * six tools — that blast radius is precisely what the freeze exists to make visible.
 */

import type { Capability, Provider, ProviderDescriptor } from './provider.ts';
import type {
  Deadline,
  DeadlineQuery,
  FreeRoomQuery,
  Principal,
  ReportIssueQuery,
  RequestContext,
  Room,
  RoomKind,
  Route,
  Session,
  Ticket,
  TimeWindow,
  TimetableQuery,
  WayfindQuery,
} from './types.ts';

/** The date the contract stopped being designed. ADR-006. */
export const FROZEN_ON = '2026-09-16';

// ── The checks ───────────────────────────────────────────────────────────────

/** True only when `A` and `B` are the same type. The tuples stop unions distributing. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Fails compilation when its argument is not `true`. */
type Unchanged<Check extends true> = Check;

/**
 * Two checks, because they catch different drift.
 *
 * Key equality catches a field added, removed or renamed — which is what every real change to this
 * interface was. Mutual assignability catches a field changing type, or moving between required and
 * optional, which key equality cannot see. Neither alone is enough: an added *optional* field
 * leaves both types mutually assignable, and `Session.group` was exactly that.
 *
 * Written as a nested condition rather than an intersection because `true & false` collapses to
 * `never`, and `never` satisfies every constraint — the check would pass by disappearing. `Unchanged`
 * is applied at each use below, where the types are concrete and the compiler can decide.
 */
type Locked<Live, Snapshot> = Same<keyof Live, keyof Snapshot> extends true
  ? Same<Live, Snapshot>
  : false;

// ── The snapshot ─────────────────────────────────────────────────────────────
// Deliberately stripped of commentary: the reasoning lives in the live definitions, and a snapshot
// that explains itself invites being edited as documentation rather than as a record.

interface FrozenPrincipal {
  readonly subject: string;
}

interface FrozenRequestContext {
  readonly principal: FrozenPrincipal | null;
  readonly now: Date;
  readonly locale: string;
}

interface FrozenTimeWindow {
  readonly start: Date;
  readonly end: Date;
}

type FrozenRoomKind = 'lecture' | 'seminar' | 'lab' | 'computer-lab' | 'study' | 'auditorium';

interface FrozenRoom {
  readonly id: string;
  readonly building: string;
  readonly floor: number;
  readonly kind: FrozenRoomKind;
  readonly capacity: number;
  readonly equipment: readonly string[];
}

interface FrozenFreeRoomQuery {
  readonly building?: string;
  readonly window: FrozenTimeWindow;
  readonly minCapacity?: number;
}

interface FrozenSession {
  readonly start: Date;
  readonly end: Date;
  readonly roomId: string;
  readonly courseCode: string;
  readonly group?: string;
}

/** No field for whose timetable it is. That absence is the guarantee, not an omission. */
interface FrozenTimetableQuery {
  readonly window: FrozenTimeWindow;
}

interface FrozenDeadline {
  readonly id: string;
  readonly label: string;
  readonly closesOn: Date;
  readonly opensOn?: Date;
}

interface FrozenDeadlineQuery {
  readonly topic?: string;
  readonly window?: FrozenTimeWindow;
}

interface FrozenRoute {
  readonly steps: readonly string[];
  readonly minutes?: number;
  readonly floorPlanRef?: string;
}

interface FrozenWayfindQuery {
  readonly from?: string;
  readonly to: string;
}

type FrozenIssueStatus = 'open' | 'in-progress' | 'resolved';

interface FrozenTicket {
  readonly number: string;
  readonly roomId: string;
  readonly equipment: string;
  readonly status: FrozenIssueStatus;
  readonly openedAt: Date;
}

interface FrozenReportIssueQuery {
  readonly roomId: string;
  readonly equipment: string;
  readonly note?: string;
}

type FrozenCapability = 'rooms' | 'timetable' | 'deadlines' | 'wayfinding' | 'issues';

interface FrozenProviderDescriptor {
  readonly id: string;
  readonly institution: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly capabilities: readonly FrozenCapability[];
}

interface FrozenProvider {
  readonly descriptor: FrozenProviderDescriptor;
  findFreeRooms?(
    ctx: FrozenRequestContext,
    query: FrozenFreeRoomQuery,
  ): Promise<readonly FrozenRoom[]>;
  getRoom?(ctx: FrozenRequestContext, roomId: string): Promise<FrozenRoom | null>;
  listRooms?(ctx: FrozenRequestContext): Promise<readonly FrozenRoom[]>;
  timetable?(
    ctx: FrozenRequestContext,
    query: FrozenTimetableQuery,
  ): Promise<readonly FrozenSession[]>;
  deadlines?(
    ctx: FrozenRequestContext,
    query: FrozenDeadlineQuery,
  ): Promise<readonly FrozenDeadline[]>;
  wayfind?(ctx: FrozenRequestContext, query: FrozenWayfindQuery): Promise<FrozenRoute | null>;
  reportIssue?(ctx: FrozenRequestContext, query: FrozenReportIssueQuery): Promise<FrozenTicket>;
  issueStatus?(ctx: FrozenRequestContext): Promise<readonly FrozenTicket[]>;
}

// ── Live against snapshot ────────────────────────────────────────────────────

type _Principal = Unchanged<Locked<Principal, FrozenPrincipal>>;
type _RequestContext = Unchanged<Locked<RequestContext, FrozenRequestContext>>;
type _TimeWindow = Unchanged<Locked<TimeWindow, FrozenTimeWindow>>;

type _RoomKind = Unchanged<Same<RoomKind, FrozenRoomKind>>;
type _Room = Unchanged<Locked<Room, FrozenRoom>>;
type _FreeRoomQuery = Unchanged<Locked<FreeRoomQuery, FrozenFreeRoomQuery>>;

type _Session = Unchanged<Locked<Session, FrozenSession>>;
type _TimetableQuery = Unchanged<Locked<TimetableQuery, FrozenTimetableQuery>>;

type _Deadline = Unchanged<Locked<Deadline, FrozenDeadline>>;
type _DeadlineQuery = Unchanged<Locked<DeadlineQuery, FrozenDeadlineQuery>>;

type _Route = Unchanged<Locked<Route, FrozenRoute>>;
type _WayfindQuery = Unchanged<Locked<WayfindQuery, FrozenWayfindQuery>>;

type _Ticket = Unchanged<Locked<Ticket, FrozenTicket>>;
type _ReportIssueQuery = Unchanged<Locked<ReportIssueQuery, FrozenReportIssueQuery>>;

type _Capability = Unchanged<Same<Capability, FrozenCapability>>;
type _ProviderDescriptor = Unchanged<Locked<ProviderDescriptor, FrozenProviderDescriptor>>;
type _Provider = Unchanged<Locked<Provider, FrozenProvider>>;
