/**
 * The `standards` adapter: an institution served from what it already runs.
 *
 * iCalendar feeds, a room table, an LDAP directory. No bespoke integration, which is what decides
 * whether something gets adopted or only admired.
 *
 * Every method below is present only when the configuration supports it — see
 * {@link capabilitiesFor}. The provider is assembled with exactly the methods its declared
 * capabilities oblige, so `assertProviderCoherent` passes by construction rather than by luck.
 */

import { InvalidRequestError, NotFoundError, UnauthenticatedError } from '../../provider/errors.ts';
import type {
  Deadline,
  DeadlineQuery,
  Busy,
  FreeRoomQuery,
  RoomScheduleQuery,
  Provider,
  ReportIssueQuery,
  RequestContext,
  Room,
  Route,
  Session,
  Ticket,
  TimetableQuery,
  WayfindQuery,
} from '../../provider/index.ts';
import { loadDeadlines, loadTimetable } from './calendars.ts';
import type { TimetableFeed } from './calendars.ts';
import { assertConfigUsable, capabilitiesFor, descriptorFor } from './config.ts';
import type { StandardsConfig } from './config.ts';
import { createEmailSink, createJiraTracker, createWebhookSink } from './issues.ts';
import type { Fetch, IssueSink, IssueTracker } from './issues.ts';
import { loadInventory } from './inventory.ts';
import type { Inventory, StandardsRoom } from './inventory.ts';

/** Strips the adapter's bookkeeping before a room crosses the interface. */
function toRoom(room: StandardsRoom): Room {
  const { supervised: _supervised, ...rest } = room;
  return rest;
}

/** Everything loaded once at start-up. Feeds are read here, not per request. */
interface Loaded {
  readonly config: StandardsConfig;
  readonly inventory: Inventory | null;
  readonly timetable: TimetableFeed | null;
  readonly deadlines: readonly Deadline[] | null;
  readonly directory: DirectoryLookup | null;
  readonly issues: (IssueSink & Partial<IssueTracker>) | null;
}

/** What a directory has to answer for the timetable to be attributable to anyone. */
export interface DirectoryLookup {
  /** Module codes the subject is enrolled in, or `null` if the subject is unknown. */
  modulesFor(subject: string): Promise<readonly string[] | null>;
}

/**
 * When one room is taken, from the same feed the timetable comes from.
 *
 * The mirror of {@link findFreeRooms}, and the reason both belong to `room-availability`: an
 * institution that publishes an iCalendar feed already knows when each room is busy, and can
 * therefore answer "when is it free again" without owning anything it can write to.
 *
 * What it cannot do is hold the room. That is `room-booking`, this adapter does not declare it,
 * and a feed it can only read is exactly why.
 */
function roomSchedule(loaded: Loaded) {
  return async (_ctx: RequestContext, query: RoomScheduleQuery): Promise<readonly Busy[]> => {
    if (query.window.end <= query.window.start) {
      throw new InvalidRequestError('The time window ends before it starts.');
    }

    const inventory = loaded.inventory!;
    if (!inventory.rooms.some((room) => room.id === query.roomId)) {
      throw new NotFoundError('room', query.roomId);
    }

    const feed = loaded.timetable!;
    return feed
      .sessionsFor(feed.modules, query.window)
      .filter((session) => session.roomId === query.roomId)
      .map((session) => ({
        start: session.start,
        end: session.end,
        // The module code, because that is what the feed says. Not a name for it: the calendar was
        // not asked what the class is called and this adapter does not get to decide.
        label: session.courseCode,
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  };
}

function findFreeRooms(loaded: Loaded) {
  return async (_ctx: RequestContext, query: FreeRoomQuery): Promise<readonly Room[]> => {
    if (query.window.end <= query.window.start) {
      throw new InvalidRequestError('The time window ends before it starts.');
    }

    const inventory = loaded.inventory!;
    const feed = loaded.timetable!;

    // Occupancy comes from the same feed the timetable uses. Every module, not just one person's:
    // a room is busy whoever is in it.
    const busy = new Set(
      feed.sessionsFor(feed.modules, query.window).map((session) => session.roomId),
    );

    return inventory.rooms
      .filter((room) => {
        if (query.site && room.site !== query.site) return false;
        if (query.building && room.building !== query.building) return false;
        if (room.supervised) return false;
        if (busy.has(room.id)) return false;
        if (query.minCapacity !== undefined && room.capacity < query.minCapacity) return false;
        return inventory.isOpen(room.building, query.window.start, query.window.end);
      })
      .map(toRoom)
      .sort((a, b) => a.id.localeCompare(b.id));
  };
}

function getRoom(loaded: Loaded) {
  return async (_ctx: RequestContext, roomId: string): Promise<Room | null> => {
    const room = loaded.inventory!.roomById(roomId);
    return room ? toRoom(room) : null;
  };
}

function listRooms(loaded: Loaded) {
  return async (): Promise<readonly Room[]> => loaded.inventory!.rooms.map(toRoom);
}

function timetable(loaded: Loaded) {
  return async (ctx: RequestContext, query: TimetableQuery): Promise<readonly Session[]> => {
    if (!ctx.principal) throw new UnauthenticatedError('Looking up a timetable');

    // The directory is what turns "these classes exist" into "these are yours". Without it the
    // feed cannot be attributed to anyone, which is why the tool is not published at all when no
    // directory is configured.
    const modules = await loaded.directory!.modulesFor(ctx.principal.subject);
    if (modules === null) throw new NotFoundError('person', ctx.principal.subject);

    return loaded.timetable!.sessionsFor(modules, query.window);
  };
}

function deadlines(loaded: Loaded) {
  return async (_ctx: RequestContext, query: DeadlineQuery): Promise<readonly Deadline[]> => {
    const topic = query.topic?.trim().toLowerCase();

    return loaded.deadlines!.filter((entry) => {
      if (topic && !entry.label.toLowerCase().includes(topic) && !entry.id.includes(topic)) return false;
      if (query.window) {
        if (entry.closesOn < query.window.start || entry.closesOn > query.window.end) return false;
      }
      return true;
    });
  };
}

function wayfind(loaded: Loaded) {
  return async (_ctx: RequestContext, query: WayfindQuery): Promise<Route | null> => {
    const inventory = loaded.inventory!;
    const room = inventory.roomById(query.to);
    const building = inventory.buildingByCode(room?.building ?? query.to);
    if (!building) return null;

    const steps = [`You want ${building.name}.`];

    if (room) {
      steps.push(
        room.floor === 0
          ? `${room.id} is on the ground floor.`
          : `${room.id} is on floor ${room.floor}.`,
      );
    }

    // No `minutes`: a room table says which building and floor, not how far apart the buildings
    // are. Inventing a walking time would be the sort of confident guess this project exists to
    // avoid — and the interface makes the field optional precisely so we do not have to.
    return room ? { steps, floorPlanRef: `${building.code}-floor-${room.floor}` } : { steps };
  };
}

/**
 * Builds the provider for a configuration, reading every source once.
 *
 * Failing here, loudly and with the offending file named, is the point: an institution finds out
 * its feed URL is wrong at start-up rather than the first time a student asks a question.
 */
/**
 * Files a fault into wherever the institution said.
 *
 * The room and its equipment are checked here as well as in the tool, because a provider is a
 * public interface and somebody will call it directly. The check is what makes the confirmation
 * mean something: confirming "the projector in 203" only matters if a room without a projector
 * would have been refused.
 */
function reportIssue(loaded: Loaded) {
  return async (ctx: RequestContext, query: ReportIssueQuery): Promise<Ticket> => {
    const subject = ctx.principal?.subject;
    if (!subject) throw new UnauthenticatedError('Reporting a fault');

    const room = loaded.inventory!.roomById(query.roomId);
    if (!room) throw new NotFoundError('room', query.roomId);

    const wanted = query.equipment.trim().toLowerCase();
    const equipment = room.equipment.find((item) => item.toLowerCase() === wanted);
    if (!equipment) {
      throw new InvalidRequestError(
        `${room.id} has no '${query.equipment}'. It has: ${room.equipment.join(', ')}.`,
      );
    }

    const reference = await loaded.issues!.file({
      roomId: room.id,
      equipment,
      ...(query.note ? { note: query.note } : {}),
      reportedBy: subject,
      reportedAt: ctx.now,
      institution: loaded.config.institution,
    });

    // `open` because that is what it is the instant it is filed, whatever the institution's own
    // workflow calls the first column. Asking the tracker back for the status of something created
    // a millisecond ago would be a round trip to learn what we already know.
    return {
      number: reference,
      roomId: room.id,
      equipment,
      status: 'open',
      openedAt: ctx.now,
    };
  };
}

/** Only what this caller filed. UC-06 is a privacy boundary, not a convenience filter. */
function issueStatus(loaded: Loaded) {
  return async (ctx: RequestContext): Promise<readonly Ticket[]> => {
    const subject = ctx.principal?.subject;
    if (!subject) throw new UnauthenticatedError('Checking a fault report');

    return loaded.issues!.openedBy!(subject);
  };
}

export async function createStandardsProvider(
  config: StandardsConfig,
  directory?: DirectoryLookup,
  /** Injected so a test can answer a webhook or a Jira without a network. */
  fetchImpl?: Fetch,
): Promise<Provider> {
  assertConfigUsable(config);

  const available = { directory: Boolean(directory) };
  const capabilities = capabilitiesFor(config, available);
  const needsInventory =
    capabilities.includes('room-inventory') || capabilities.includes('wayfinding');

  const loaded: Loaded = {
    config,
    inventory: needsInventory ? await loadInventory(config.inventory!, config.timeZone) : null,
    timetable: config.calendars?.timetable
      ? await loadTimetable(config.calendars.timetable, config.timeZone)
      : null,
    deadlines: config.calendars?.deadlines
      ? await loadDeadlines(config.calendars.deadlines, config.timeZone)
      : null,
    directory: directory ?? null,
    // Exactly one is configured — `assertConfigUsable` refused anything else — so the order here
    // only decides which branch is read first, not which one wins.
    issues: config.issues?.jira
      ? createJiraTracker(config.issues.jira, fetchImpl ?? fetch)
      : config.issues?.webhook
        ? createWebhookSink(config.issues.webhook, fetchImpl ?? fetch)
        : config.issues?.email
          ? createEmailSink(config.issues.email)
          : null,
  };

  // A configured directory with no lookup supplied is a wiring mistake, and it would silently
  // drop the timetable tool. Say so instead.
  if (config.directory && !directory) {
    throw new InvalidRequestError(
      `'${config.institution}' configures a directory but none was supplied to createStandardsProvider().`,
    );
  }

  // Assembled from the capabilities, so what is declared and what exists cannot diverge.
  const provider: Record<string, unknown> = { descriptor: descriptorFor(config, available) };

  // Wayfinding reads the inventory directly rather than through `getRoom`, because a method the
  // catalogue never calls is the drift assertProviderCoherent rejects.
  if (capabilities.includes('room-inventory')) {
    provider['getRoom'] = getRoom(loaded);
    provider['listRooms'] = listRooms(loaded);
  }
  if (capabilities.includes('room-availability')) {
    provider['findFreeRooms'] = findFreeRooms(loaded);
    provider['roomSchedule'] = roomSchedule(loaded);
  }
  if (capabilities.includes('wayfinding')) provider['wayfind'] = wayfind(loaded);
  if (capabilities.includes('deadlines')) provider['deadlines'] = deadlines(loaded);
  if (capabilities.includes('timetable')) provider['timetable'] = timetable(loaded);
  if (capabilities.includes('issue-reporting')) provider['reportIssue'] = reportIssue(loaded);
  if (capabilities.includes('issue-tracking')) provider['issueStatus'] = issueStatus(loaded);

  return provider as unknown as Provider;
}

export type { StandardsConfig } from './config.ts';
