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
  FreeRoomQuery,
  Provider,
  RequestContext,
  Room,
  Route,
  Session,
  TimetableQuery,
  WayfindQuery,
} from '../../provider/index.ts';
import { loadDeadlines, loadTimetable } from './calendars.ts';
import type { TimetableFeed } from './calendars.ts';
import { assertConfigUsable, capabilitiesFor, descriptorFor } from './config.ts';
import type { StandardsConfig } from './config.ts';
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
}

/** What a directory has to answer for the timetable to be attributable to anyone. */
export interface DirectoryLookup {
  /** Module codes the subject is enrolled in, or `null` if the subject is unknown. */
  modulesFor(subject: string): Promise<readonly string[] | null>;
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
export async function createStandardsProvider(
  config: StandardsConfig,
  directory?: DirectoryLookup,
): Promise<Provider> {
  assertConfigUsable(config);

  const available = { directory: Boolean(directory) };
  const capabilities = capabilitiesFor(config, available);
  const needsInventory = capabilities.includes('rooms') || capabilities.includes('wayfinding');

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

  // `rooms` obliges both methods; wayfinding reads the inventory directly rather than through
  // `getRoom`, because a method the catalogue never calls is the drift assertProviderCoherent
  // rejects.
  if (capabilities.includes('rooms')) {
    provider['findFreeRooms'] = findFreeRooms(loaded);
    provider['getRoom'] = getRoom(loaded);
    provider['listRooms'] = listRooms(loaded);
  }
  if (capabilities.includes('wayfinding')) provider['wayfind'] = wayfind(loaded);
  if (capabilities.includes('deadlines')) provider['deadlines'] = deadlines(loaded);
  if (capabilities.includes('timetable')) provider['timetable'] = timetable(loaded);

  return provider as unknown as Provider;
}

export type { StandardsConfig } from './config.ts';
