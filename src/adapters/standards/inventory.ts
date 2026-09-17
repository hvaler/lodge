/**
 * The room inventory, read from a table.
 *
 * "A table" because that is what institutions already have: a spreadsheet of rooms maintained by
 * whoever books them. Two CSVs — rooms and buildings — and nothing to develop.
 *
 * Nothing here assumes San Telmo's shape. Room ids are opaque strings (Carrigmore numbers its
 * ground floor `QUA-G01`, San Telmo `MEN-001`), and the building code is a column rather than a
 * prefix to be parsed out of the id.
 */

import { parse } from 'csv-parse/sync';

import type { Room, RoomKind } from '../../provider/index.ts';
import { isOpenThroughout, weekOf } from '../../shared/time.ts';
import type { DayHours, OpeningHours } from '../../shared/time.ts';
import type { InventorySource } from './config.ts';
import { readSource } from './source.ts';

/**
 * The kinds a room may be. Exported because the configuration schema validates against this same
 * list: two copies would drift the first time somebody adds one.
 */
export const ROOM_KINDS = [
  'lecture',
  'seminar',
  'lab',
  'computer-lab',
  'study',
  'auditorium',
] as const satisfies readonly RoomKind[];

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

/** A room plus what the provider interface deliberately leaves out. */
export interface StandardsRoom extends Room {
  readonly supervised: boolean;
}

export interface StandardsBuilding {
  readonly code: string;
  readonly name: string;
  readonly openingHours: OpeningHours;
}

export interface Inventory {
  readonly rooms: readonly StandardsRoom[];
  readonly buildings: readonly StandardsBuilding[];
  roomById(id: string): StandardsRoom | null;
  buildingByCode(code: string): StandardsBuilding | null;
  isOpen(buildingCode: string, from: Date, to: Date): boolean;
}

type CsvRow = Record<string, string>;

function rows(text: string, what: string): CsvRow[] {
  try {
    return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as CsvRow[];
  } catch (error) {
    throw new InventoryError(`${what} is not readable CSV: ${error instanceof Error ? error.message : error}`);
  }
}

function required(row: CsvRow, column: string, what: string): string {
  const value = row[column];
  if (!value) throw new InventoryError(`${what} is missing a value in column '${column}'.`);
  return value;
}

/** `true`/`yes`/`1` are true; blank is false. Anything else is a typo worth reporting. */
function bool(value: string | undefined, column: string): boolean {
  const normalised = (value ?? '').trim().toLowerCase();
  if (normalised === '' || normalised === 'false' || normalised === 'no' || normalised === '0') return false;
  if (normalised === 'true' || normalised === 'yes' || normalised === '1') return true;
  throw new InventoryError(`Column '${column}' should be true or false, got '${value}'.`);
}

function hours(row: CsvRow, opensColumn: string, closesColumn: string): DayHours | null {
  const open = (row[opensColumn] ?? '').trim();
  const close = (row[closesColumn] ?? '').trim();
  // Both blank means closed that day, which is a normal thing for a building to be.
  if (!open && !close) return null;
  if (!open || !close) {
    throw new InventoryError(
      `Building '${row['building_code']}' has only one of '${opensColumn}'/'${closesColumn}'. Give both, or neither for closed.`,
    );
  }
  return { open, close };
}

function toRoom(row: CsvRow): StandardsRoom {
  const id = required(row, 'room_id', 'A room');
  const kind = required(row, 'kind', `Room '${id}'`) as RoomKind;

  if (!ROOM_KINDS.includes(kind)) {
    throw new InventoryError(
      `Room '${id}' has kind '${kind}'. Use one of: ${ROOM_KINDS.join(', ')}.`,
    );
  }

  const capacity = Number(required(row, 'capacity', `Room '${id}'`));
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new InventoryError(`Room '${id}' has capacity '${row['capacity']}', which is not a whole number of seats.`);
  }

  const floor = Number(required(row, 'floor', `Room '${id}'`));
  if (!Number.isInteger(floor)) {
    throw new InventoryError(`Room '${id}' has floor '${row['floor']}', which is not a whole number.`);
  }

  return {
    id,
    building: required(row, 'building_code', `Room '${id}'`),
    floor,
    kind,
    capacity,
    // Semicolons, not commas: a comma would need quoting in every row and institutions edit these
    // by hand in a spreadsheet.
    equipment: (row['equipment'] ?? '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean),
    supervised: bool(row['supervised'], 'supervised'),
  };
}

/**
 * Loads the inventory, or explains what is wrong with it.
 *
 * Every rejection names the room or building at fault. The adoption guide is timed against the
 * clock on a clean machine by someone outside the project (M5), and an error that says only
 * "invalid CSV" is how that stops being twenty minutes.
 */
/**
 * A room written straight into the configuration file.
 *
 * For an institution that has twelve rooms and would rather not keep a CSV for them. It is the same
 * data the table holds — every field below is one of its columns — and it becomes a row and goes
 * through the same validator, so a capacity of zero is refused with the same sentence either way.
 * There is one room model here, written two ways, not two models. (A bad `kind` is the exception:
 * written here it is caught earlier still, by the configuration schema, against the same list.)
 */
export interface InlineRoom {
  /** Qualified and unique across the institution, e.g. `QUA-G01`. */
  readonly id: string;
  /** Building code, e.g. `QUA`. */
  readonly building: string;
  /** Said aloud when giving directions. Defaults to the code. */
  readonly buildingName?: string;
  readonly floor: number;
  readonly kind: RoomKind;
  readonly capacity: number;
  /** In the institution's own words: they are read back verbatim. */
  readonly equipment?: readonly string[];
  /** Supervised rooms are never offered as free. Defaults to false. */
  readonly supervised?: boolean;
}

/** Opening hours as `"08:00-21:00"`, or omitted for a day the building does not open. */
export interface InlineBuilding {
  readonly code: string;
  readonly name: string;
  readonly weekdays?: string;
  readonly saturday?: string;
  readonly sunday?: string;
}

/** Inline data becomes a row, so there is one validator and one set of error messages. */
function roomRow(room: InlineRoom): CsvRow {
  return {
    room_id: room.id,
    building_code: room.building,
    building_name: room.buildingName ?? '',
    floor: String(room.floor),
    kind: room.kind,
    capacity: String(room.capacity),
    equipment: (room.equipment ?? []).join(';'),
    supervised: room.supervised ? 'true' : 'false',
  };
}

function buildingRow(building: InlineBuilding): CsvRow {
  const [opensWeek = '', closesWeek = ''] = (building.weekdays ?? '').split('-');
  const [opensSat = '', closesSat = ''] = (building.saturday ?? '').split('-');
  const [opensSun = '', closesSun = ''] = (building.sunday ?? '').split('-');

  return {
    building_code: building.code,
    building_name: building.name,
    opens_mon_fri: opensWeek,
    closes_mon_fri: closesWeek,
    opens_sat: opensSat,
    closes_sat: closesSat,
    opens_sun: opensSun,
    closes_sun: closesSun,
  };
}

export async function loadInventory(
  source: InventorySource,
  timeZone: string,
  buildingsLocation?: string,
): Promise<Inventory> {
  // Written in the configuration, or read from a table. `assertConfigUsable` has already refused
  // both at once and neither, so exactly one of these is present.
  const where = source.rooms ? 'the configuration file' : `'${source.location!}'`;
  const roomRows = source.rooms
    ? source.rooms.map(roomRow)
    : rows(await readSource(source.location!), `The room table at ${where}`);

  const rooms = roomRows.map(toRoom);

  if (rooms.length === 0) {
    throw new InventoryError(`The room table at ${where} has no rows.`);
  }

  const seen = new Set<string>();
  for (const room of rooms) {
    if (seen.has(room.id)) throw new InventoryError(`Room '${room.id}' appears twice in the table.`);
    seen.add(room.id);
  }

  // Buildings are optional: without them every building is treated as always open, which is wrong
  // but honest, and beats refusing to start over a file an institution may not have.
  const buildings: StandardsBuilding[] = [];

  const buildingRows = await (async (): Promise<CsvRow[]> => {
    if (source.buildings) return source.buildings.map(buildingRow);
    if (source.rooms) return [];

    const location = buildingsLocation ?? source.location!.replace(/rooms\.csv$/, 'buildings.csv');
    if (location === source.location) return [];

    try {
      return rows(await readSource(location), `The building table at '${location}'`);
    } catch (error) {
      // A malformed building table is an error; a missing one is a choice.
      if (error instanceof InventoryError) throw error;
      return [];
    }
  })();

  for (const row of buildingRows) {
    buildings.push({
      code: required(row, 'building_code', 'A building'),
      name: required(row, 'building_name', 'A building'),
      openingHours: weekOf(
        hours(row, 'opens_mon_fri', 'closes_mon_fri'),
        hours(row, 'opens_sat', 'closes_sat'),
        hours(row, 'opens_sun', 'closes_sun'),
      ),
    });
  }

  // Any building named by a room but absent from the table still needs a name to speak aloud.
  for (const room of rooms) {
    if (buildings.some((b) => b.code === room.building)) continue;
    const named = roomRows.find((r) => r['building_code'] === room.building);
    buildings.push({
      code: room.building,
      // A blank name means the institution did not give one, whether the row came from a table or
      // from the configuration file. Say the code aloud rather than nothing at all.
      name: named?.['building_name'] || room.building,
      openingHours: weekOf({ open: '00:00', close: '23:59' }, { open: '00:00', close: '23:59' }, {
        open: '00:00',
        close: '23:59',
      }),
    });
  }

  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const buildingsByCode = new Map(buildings.map((building) => [building.code, building]));

  return {
    rooms,
    buildings,
    roomById: (id) => roomsById.get(id) ?? null,
    buildingByCode: (code) => buildingsByCode.get(code) ?? null,
    isOpen: (buildingCode, from, to) => {
      const building = buildingsByCode.get(buildingCode);
      // The zone is closed over per inventory, never module state: one process may serve two
      // institutions, and a shared mutable zone would have the second silently answer on the
      // first one's clock.
      return building ? isOpenThroughout(building.openingHours, from, to, timeZone) : false;
    },
  };
}
