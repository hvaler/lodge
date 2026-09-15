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

const ROOM_KINDS: readonly RoomKind[] = [
  'lecture',
  'seminar',
  'lab',
  'computer-lab',
  'study',
  'auditorium',
];

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
export async function loadInventory(
  source: InventorySource,
  timeZone: string,
  buildingsLocation?: string,
): Promise<Inventory> {
  const roomsText = await readSource(source.location);
  const rooms = rows(roomsText, `The room table at '${source.location}'`).map(toRoom);

  if (rooms.length === 0) {
    throw new InventoryError(`The room table at '${source.location}' has no rows.`);
  }

  const seen = new Set<string>();
  for (const room of rooms) {
    if (seen.has(room.id)) throw new InventoryError(`Room '${room.id}' appears twice in the table.`);
    seen.add(room.id);
  }

  // Buildings are optional: without them every building is treated as always open, which is wrong
  // but honest, and beats refusing to start over a file an institution may not have.
  const buildings: StandardsBuilding[] = [];
  const location = buildingsLocation ?? source.location.replace(/rooms\.csv$/, 'buildings.csv');

  if (location !== source.location) {
    try {
      const text = await readSource(location);
      for (const row of rows(text, `The building table at '${location}'`)) {
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
    } catch (error) {
      // A malformed building table is an error; a missing one is a choice.
      if (error instanceof InventoryError) throw error;
    }
  }

  // Any building named by a room but absent from the table still needs a name to speak aloud.
  for (const room of rooms) {
    if (buildings.some((b) => b.code === room.building)) continue;
    const named = rows(roomsText, 'the room table').find((r) => r['building_code'] === room.building);
    buildings.push({
      code: room.building,
      name: named?.['building_name'] ?? room.building,
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
