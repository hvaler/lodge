/**
 * The provider interface.
 *
 * This is the piece that makes Lodge reusable, and the piece that freezes when M1 closes
 * (ADR-006). After that date it is implemented against, not edited: touching it hits both
 * adapters and all six tools at once.
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
export const CAPABILITIES = ['rooms', 'timetable', 'deadlines', 'wayfinding', 'issues'] as const;

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

  /** `rooms` — rooms free for the whole window. Never returns booked, closed or supervised rooms. */
  findFreeRooms?(ctx: RequestContext, query: FreeRoomQuery): Promise<readonly Room[]>;

  /** `rooms` — a single room by id, for validating a fault report against real equipment. */
  getRoom?(ctx: RequestContext, roomId: string): Promise<Room | null>;

  /** `timetable` — the sessions of `ctx.principal`. Requires an authenticated principal. */
  timetable?(ctx: RequestContext, query: TimetableQuery): Promise<readonly Session[]>;

  /** `deadlines` — what is on record. Returns empty rather than approximating (UC-03). */
  deadlines?(ctx: RequestContext, query: DeadlineQuery): Promise<readonly Deadline[]>;

  /** `wayfinding` — spoken directions, sufficient without a screen (UC-04). */
  wayfind?(ctx: RequestContext, query: WayfindQuery): Promise<Route | null>;

  /** `issues` — files a fault. Requires an authenticated principal. */
  reportIssue?(ctx: RequestContext, query: ReportIssueQuery): Promise<Ticket>;

  /** `issues` — only the tickets opened by `ctx.principal` (UC-06). */
  issueStatus?(ctx: RequestContext): Promise<readonly Ticket[]>;
}

/** Which methods each capability obliges an adapter to implement. */
export const CAPABILITY_METHODS = {
  rooms: ['findFreeRooms', 'getRoom'],
  timetable: ['timetable'],
  deadlines: ['deadlines'],
  wayfinding: ['wayfind'],
  issues: ['reportIssue', 'issueStatus'],
} as const satisfies Record<Capability, readonly (keyof Provider)[]>;

/** Which MCP tools each capability publishes. The catalogue is the union over declared ones. */
export const CAPABILITY_TOOLS = {
  rooms: ['campus.find_room'],
  timetable: ['campus.timetable'],
  deadlines: ['campus.deadlines'],
  wayfinding: ['campus.wayfind'],
  issues: ['campus.report_issue', 'campus.issue_status'],
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
 * a provider could declare `issues` and not implement `reportIssue`, and the agent would offer a
 * tool that throws.
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
