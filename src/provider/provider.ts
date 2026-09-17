/**
 * The provider interface.
 *
 * This is the piece that makes Lodge reusable, and as of 16 September 2026 it is **frozen**
 * (ADR-006): implemented against, not edited. Touching it hits both adapters and all six tools at
 * once, which is why `frozen.ts` keeps a snapshot the compiler checks on every build. Read that
 * file before changing anything here.
 */

import type {
  Deadline,
  DeadlineQuery,
  FreeRoomQuery,
  ReportIssueQuery,
  RequestContext,
  Room,
  Route,
  Session,
  Ticket,
  TimetableQuery,
  WayfindQuery,
} from './types.ts';

/**
 * What an institution can answer. An adapter declares a subset; the tool catalogue is derived
 * from that declaration at runtime (ADR-004), so an institution with no issue tracker never sees
 * the agent offer to file a fault.
 */
export const CAPABILITIES = [
  'room-inventory',
  'room-availability',
  'timetable',
  'deadlines',
  'wayfinding',
  'issue-reporting',
  'issue-tracking',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface ProviderDescriptor {
  /** Stable adapter id, e.g. `synthetic`. */
  readonly id: string;
  /** Display name of the institution, e.g. `Universidad de San Telmo`. */
  readonly institution: string;
  /** BCP 47 tag. Responses and cards are localised to it: Spanish in Madrid, English in Dublin. */
  readonly locale: string;
  /**
   * IANA zone, e.g. `Europe/Madrid`.
   *
   * Separate from the locale because they are genuinely independent — a Dublin institution could
   * declare `es-ES` for its Spanish-speaking exchange students and still open at Irish hours. A
   * spoken "your class is at nine" is wrong in the reader's zone unless the institution says which
   * one it means.
   */
  readonly timeZone: string;
  readonly capabilities: readonly Capability[];
}

/**
 * Every method is optional and gated by a declared capability. {@link assertProviderCoherent}
 * enforces the pairing, so "declared" and "implemented" cannot drift apart silently.
 */
export interface Provider {
  readonly descriptor: ProviderDescriptor;

  /**
   * `room-availability` — rooms free for the whole window. Never returns booked, closed or
   * supervised rooms.
   */
  findFreeRooms?(ctx: RequestContext, query: FreeRoomQuery): Promise<readonly Room[]>;

  /** `room-inventory` — a single room by id, for validating a fault report against real equipment. */
  getRoom?(ctx: RequestContext, roomId: string): Promise<Room | null>;

  /**
   * `room-inventory` — every room the institution has.
   *
   * Needed because "free" is only half of occupancy. The spoken answer names two or three free
   * rooms; the visual card shows the grid, and a grid with no busy rooms in it is a list. Both
   * adapters already hold this — the synthetic one has its building stock, the standards one has
   * the table it read — so the cost is a method, not a new source of data.
   */
  listRooms?(ctx: RequestContext): Promise<readonly Room[]>;

  /** `timetable` — the sessions of `ctx.principal`. Requires an authenticated principal. */
  timetable?(ctx: RequestContext, query: TimetableQuery): Promise<readonly Session[]>;

  /** `deadlines` — what is on record. Returns empty rather than approximating (UC-03). */
  deadlines?(ctx: RequestContext, query: DeadlineQuery): Promise<readonly Deadline[]>;

  /** `wayfinding` — spoken directions, sufficient without a screen (UC-04). */
  wayfind?(ctx: RequestContext, query: WayfindQuery): Promise<Route | null>;

  /**
   * `issue-reporting` — files a fault. Requires an authenticated principal.
   *
   * Separate from {@link issueStatus} because plenty of institutions can do one and not the other.
   * A service desk reached by email can receive a report and cannot answer "how is mine going";
   * declaring a single `issues` capability would have forced such an institution to publish a
   * tool that cannot work, which is the exact failure capability negotiation exists to prevent.
   */
  reportIssue?(ctx: RequestContext, query: ReportIssueQuery): Promise<Ticket>;

  /** `issue-tracking` — only the tickets opened by `ctx.principal` (UC-06). */
  issueStatus?(ctx: RequestContext): Promise<readonly Ticket[]>;
}

/** Which methods each capability obliges an adapter to implement. */
export const CAPABILITY_METHODS = {
  'room-inventory': ['getRoom', 'listRooms'],
  'room-availability': ['findFreeRooms'],
  timetable: ['timetable'],
  deadlines: ['deadlines'],
  wayfinding: ['wayfind'],
  'issue-reporting': ['reportIssue'],
  'issue-tracking': ['issueStatus'],
} as const satisfies Record<Capability, readonly (keyof Provider)[]>;

/**
 * Capabilities that only make sense alongside another.
 *
 * `room-inventory` is the odd one here: it publishes **no tool of its own**. What it says is that
 * the institution knows what rooms it has, which two other things need and neither of which is
 * about listing rooms. Searching for a free one shows the occupancy grid on its card, and filing a
 * fault checks that the room exists and has the equipment somebody is reporting **before** asking
 * them to confirm — because confirming and only then hearing that 301 has no projector wastes the
 * person's turn.
 *
 * That last one is why `rooms` was split (ADR-019). A room list and a service desk are enough to
 * take a fault report; requiring occupancy as well meant an institution that could not export its
 * timetable could not report a broken projector either, which is a connection nobody would defend
 * out loud.
 *
 * Checked at load with everything else. The alternative — letting a tool degrade and file a report
 * against a room nobody can find — turns a configuration mistake into a maintenance ticket for a
 * room that does not exist.
 */
export const CAPABILITY_REQUIRES = {
  'room-availability': ['room-inventory'],
  'issue-reporting': ['room-inventory'],
} as const satisfies Partial<Record<Capability, readonly Capability[]>>;

/** Which MCP tools each capability publishes. The catalogue is the union over declared ones. */
export const CAPABILITY_TOOLS = {
  // Deliberately empty: knowing what rooms exist is what *other* capabilities are built on, and
  // "list every room out loud" is not a question anybody asks a speaker.
  'room-inventory': [],
  'room-availability': ['campus.find_room'],
  timetable: ['campus.timetable'],
  deadlines: ['campus.deadlines'],
  wayfinding: ['campus.wayfind'],
  'issue-reporting': ['campus.report_issue'],
  'issue-tracking': ['campus.issue_status'],
} as const satisfies Record<Capability, readonly string[]>;

export class ProviderContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderContractError';
  }
}

/**
 * Checks that what the adapter declares and what it implements are the same thing, in both
 * directions. Without this, "the catalogue is derived from capabilities" is a promise in a README:
 * a provider could declare `issue-reporting` and not implement `reportIssue`, and the agent would
 * offer a tool that throws.
 *
 * Call it once when the adapter is loaded — failing at start-up beats failing mid-conversation.
 */
export function assertProviderCoherent(provider: Provider): void {
  const declared = new Set<Capability>(provider.descriptor.capabilities);

  for (const capability of declared) {
    for (const method of CAPABILITY_METHODS[capability]) {
      if (typeof provider[method] !== 'function') {
        throw new ProviderContractError(
          `Adapter '${provider.descriptor.id}' declares capability '${capability}' but does not implement '${method}'.`,
        );
      }
    }
  }

  for (const capability of CAPABILITIES) {
    if (declared.has(capability)) continue;
    for (const method of CAPABILITY_METHODS[capability]) {
      if (typeof provider[method] === 'function') {
        throw new ProviderContractError(
          `Adapter '${provider.descriptor.id}' implements '${method}' but does not declare capability '${capability}'. ` +
            `An undeclared method is unreachable: the tool that would call it is never published.`,
        );
      }
    }
  }

  for (const [capability, needs] of Object.entries(CAPABILITY_REQUIRES)) {
    if (!declared.has(capability as Capability)) continue;
    for (const required of needs) {
      if (!declared.has(required)) {
        throw new ProviderContractError(
          `Adapter '${provider.descriptor.id}' declares '${capability}', which needs '${required}' ` +
            `as well: filing a fault checks the room and its equipment before asking anyone to ` +
            `confirm, and without '${required}' there is nothing to check against.`,
        );
      }
    }
  }

  if (declared.size === 0) {
    throw new ProviderContractError(
      `Adapter '${provider.descriptor.id}' declares no capabilities, so it would publish no tools.`,
    );
  }
}

/** The tool catalogue for a provider: the union of the tools its declared capabilities publish. */
export function toolCatalogue(provider: Provider): readonly string[] {
  return provider.descriptor.capabilities.flatMap((capability) => [...CAPABILITY_TOOLS[capability]]);
}
