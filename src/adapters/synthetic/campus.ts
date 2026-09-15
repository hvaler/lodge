/**
 * The physical campus of the Universidad de San Telmo.
 *
 * Transcribed from `docs/san-telmo.md`, the specification M0 closed. That file is the source of
 * truth: if a number has to change it changes there first, and the tests in this folder assert the
 * two agree. Nothing here is random — the building stock is fixed, and only the timetable laid over
 * it is generated.
 */

import type { Room, RoomKind } from '../../provider/index.ts';
import { instantAt, isOpenThroughout as isOpenIn, localParts, weekOf } from '../../shared/time.ts';
import type { DayHours, OpeningHours } from '../../shared/time.ts';

/**
 * San Telmo is on the Spanish coast; opening hours below are wall-clock in this zone.
 *
 * Equipment names are in Spanish, and deliberately so: they are the institution's own words,
 * which the message catalogue never translates. A Spanish university whose rooms have a
 * `projector` would answer half in each language. What Lodge owns — room kinds, statuses, the
 * sentences around the data — is translated; what the institution owns is not.
 */
export const CAMPUS_TIMEZONE = 'Europe/Madrid';

export type { DayHours, OpeningHours } from '../../shared/time.ts';

const week = weekOf;

/** A run of consecutive rooms on one floor sharing kind, capacity and equipment. */
interface RoomBlock {
  readonly floor: number;
  /** First room index on the floor; `MEN` floor 2 starting at 1 gives 201. */
  readonly from: number;
  readonly count: number;
  readonly kind: RoomKind;
  /** One value for the whole block, or one per room. */
  readonly capacity: number | readonly number[];
  readonly equipment: readonly string[];
  /**
   * A room that needs a member of staff present is never offered as free by `campus.find_room`,
   * however empty it is. UC-01 accepts no occupied, booked or out-of-hours room in the answer, and
   * an unsupervised lab is the same class of wrong answer.
   */
  readonly supervised?: boolean;
  /** Extra kit on individual rooms, keyed by room number. */
  readonly extras?: Readonly<Record<number, readonly string[]>>;
}

export interface BuildingSpec {
  readonly code: string;
  readonly name: string;
  readonly blurb: string;
  readonly openingHours: OpeningHours;
  readonly blocks: readonly RoomBlock[];
}

export const BUILDINGS: readonly BuildingSpec[] = [
  {
    code: 'MEN',
    name: 'Mendizábal',
    blurb: 'Nineteenth-century block on the main square.',
    openingHours: week({ open: '07:30', close: '21:30' }, { open: '09:00', close: '14:00' }, null),
    blocks: [
      {
        floor: 0,
        from: 1,
        count: 4,
        kind: 'lecture',
        capacity: [120, 120, 90, 90],
        equipment: ['proyector', 'pantalla', 'megafonía', 'ordenador de atril'],
      },
      { floor: 1, from: 1, count: 6, kind: 'seminar', capacity: 40, equipment: ['proyector', 'pizarra'] },
      {
        floor: 2,
        from: 1,
        count: 6,
        kind: 'seminar',
        capacity: 35,
        equipment: ['proyector', 'pizarra'],
        // 203 is the room whose projector fails in UC-05, so it is the one worth over-equipping.
        extras: { 203: ['cámara de documentos'] },
      },
      {
        floor: 3,
        from: 1,
        count: 2,
        kind: 'study',
        capacity: 60,
        equipment: ['pizarra', 'enchufe en cada puesto'],
      },
    ],
  },
  {
    code: 'SCL',
    name: 'Santa Clara',
    blurb: 'Former convent, two cloisters. Thick walls, and no lift in the west wing.',
    openingHours: week({ open: '08:00', close: '20:00' }, null, null),
    blocks: [
      { floor: 0, from: 1, count: 2, kind: 'lecture', capacity: 80, equipment: ['proyector', 'pantalla'] },
      {
        floor: 1,
        from: 1,
        count: 4,
        kind: 'lab',
        capacity: 24,
        equipment: ['campana extractora', 'microscopios', 'ducha de emergencia'],
        supervised: true,
      },
      {
        floor: 2,
        from: 1,
        count: 3,
        kind: 'computer-lab',
        capacity: 30,
        equipment: ['puestos de ordenador', 'proyector'],
        supervised: true,
      },
    ],
  },
  {
    code: 'FAR',
    name: 'El Faro',
    blurb: 'Built 2019 next to the old lighthouse. Fully accessible.',
    openingHours: week({ open: '07:00', close: '22:00' }, { open: '09:00', close: '18:00' }, { open: '10:00', close: '14:00' }),
    blocks: [
      {
        floor: 0,
        from: 1,
        count: 1,
        kind: 'auditorium',
        capacity: 300,
        equipment: ['proyector', 'segundo proyector', 'megafonía', 'equipo de retransmisión', 'bucle magnético'],
      },
      { floor: 0, from: 2, count: 2, kind: 'lecture', capacity: 100, equipment: ['proyector', 'pantalla', 'megafonía'] },
      {
        floor: 1,
        from: 1,
        count: 5,
        kind: 'seminar',
        capacity: 30,
        equipment: ['pantalla táctil', 'pizarra'],
      },
      {
        floor: 1,
        from: 6,
        count: 1,
        kind: 'study',
        capacity: 80,
        equipment: ['enchufe en cada puesto', 'zona de silencio'],
      },
    ],
  },
];

/** A room plus the campus facts the provider interface deliberately leaves out. */
export interface CampusRoom extends Room {
  readonly supervised: boolean;
}

function expand(building: BuildingSpec): CampusRoom[] {
  const rooms: CampusRoom[] = [];
  for (const block of building.blocks) {
    for (let i = 0; i < block.count; i++) {
      const index = block.from + i;
      const number = block.floor * 100 + index;
      const capacity = Array.isArray(block.capacity) ? (block.capacity[i] as number) : (block.capacity as number);
      const extras = block.extras?.[number] ?? [];
      rooms.push({
        id: `${building.code}-${String(number).padStart(3, '0')}`,
        building: building.code,
        floor: block.floor,
        kind: block.kind,
        capacity,
        equipment: [...block.equipment, ...extras],
        supervised: block.supervised ?? false,
      });
    }
  }
  return rooms;
}

/** Every room on campus, in building then number order. Built once: the stock never changes. */
export const ROOMS: readonly CampusRoom[] = BUILDINGS.flatMap(expand);

const ROOMS_BY_ID = new Map(ROOMS.map((room) => [room.id, room]));

export function roomById(id: string): CampusRoom | null {
  return ROOMS_BY_ID.get(id) ?? null;
}

export function buildingByCode(code: string): BuildingSpec | null {
  return BUILDINGS.find((b) => b.code === code) ?? null;
}

/**
 * Walking time between buildings, with the hint that makes the spoken answer usable.
 *
 * In Spanish, because San Telmo declares `es-ES` and a route step is half the
 * institution's own vocabulary. An adapter speaks its own institution's language.
 */
export interface Walk {
  readonly minutes: number;
  readonly hint: string;
}

const WALKS: ReadonlyMap<string, Walk> = new Map([
  ['MEN>SCL', { minutes: 4, hint: 'cruza el patio del claustro' }],
  ['MEN>FAR', { minutes: 11, hint: 'sigue el paseo marítimo' }],
  ['SCL>FAR', { minutes: 9, hint: 'baja hacia el faro' }],
]);

/** Symmetric: the walk back takes as long as the walk there. */
export function walkBetween(from: string, to: string): Walk | null {
  if (from === to) return { minutes: 0, hint: 'ya estás en el edificio' };
  return WALKS.get(`${from}>${to}`) ?? WALKS.get(`${to}>${from}`) ?? null;
}

/** Wall-clock parts of `at` on the campus clock. */
export function campusLocalParts(at: Date): { weekday: number; minutes: number; isoDate: string } {
  return localParts(at, CAMPUS_TIMEZONE);
}

/**
 * The instant at which the campus wall clock reads `isoDate` at `hhmm`.
 *
 * Matters because the academic calendar straddles the change of season: 9 October 2026 is CEST
 * (UTC+2) and 30 October is CET (UTC+1), and `campus.deadlines` reports days remaining off this.
 */
export function campusInstant(isoDate: string, hhmm = '23:59'): Date {
  return instantAt(isoDate, hhmm, CAMPUS_TIMEZONE);
}

/** Whether `building` is open for the whole of [from, to]. */
export function isOpenThroughout(building: BuildingSpec, from: Date, to: Date): boolean {
  return isOpenIn(building.openingHours, from, to, CAMPUS_TIMEZONE);
}
