import { describe, expect, it } from 'vitest';

import {
  BUILDINGS,
  ROOMS,
  buildingByCode,
  campusLocalParts,
  isOpenThroughout,
  roomById,
  walkBetween,
} from './campus.ts';

/**
 * These numbers are the ones written down in `docs/san-telmo.md`. The point of asserting them is
 * that the specification and the generator cannot drift apart quietly: if someone adds a floor,
 * this fails and the doc gets updated too.
 */
describe('the room inventory matches docs/san-telmo.md', () => {
  it('has three buildings and 36 rooms totalling 2 066 seats', () => {
    expect(BUILDINGS).toHaveLength(3);
    expect(ROOMS).toHaveLength(36);
    expect(ROOMS.reduce((sum, room) => sum + room.capacity, 0)).toBe(2066);
  });

  it.each([
    ['MEN', 18, 990],
    ['SCL', 9, 346],
    ['FAR', 9, 730],
  ])('%s has %i rooms and %i seats', (code, rooms, seats) => {
    const inBuilding = ROOMS.filter((room) => room.building === code);

    expect(inBuilding).toHaveLength(rooms);
    expect(inBuilding.reduce((sum, room) => sum + room.capacity, 0)).toBe(seats);
  });

  it('numbers rooms as {floor}{nn}, so Mendizábal floor 2 room 3 is MEN-203', () => {
    const room = roomById('MEN-203');

    expect(room).not.toBeNull();
    expect(room?.floor).toBe(2);
    expect(room?.kind).toBe('seminar');
  });

  it('gives every room a unique id', () => {
    expect(new Set(ROOMS.map((room) => room.id)).size).toBe(ROOMS.length);
  });

  it('returns null for a room that does not exist rather than inventing one', () => {
    expect(roomById('MEN-999')).toBeNull();
    expect(buildingByCode('XXX')).toBeNull();
  });
});

describe('equipment', () => {
  it('gives MEN-203 the projector that UC-05 reports broken', () => {
    expect(roomById('MEN-203')?.equipment).toContain('projector');
  });

  it('gives MEN-203 the document camera the other rooms on its floor lack', () => {
    expect(roomById('MEN-203')?.equipment).toContain('document camera');
    expect(roomById('MEN-204')?.equipment).not.toContain('document camera');
  });

  it('equips FAR-104 with the touchscreen display of the seeded fault INC-2026-0028', () => {
    expect(roomById('FAR-104')?.equipment).toContain('touchscreen display');
  });

  it('equips SCL-201 with the workstations of the seeded fault INC-2026-0019', () => {
    expect(roomById('SCL-201')?.equipment).toContain('workstations');
  });
});

describe('supervised rooms', () => {
  it('marks every Santa Clara lab as supervised, so find_room never offers one', () => {
    const labs = ROOMS.filter((room) => room.kind === 'lab' || room.kind === 'computer-lab');

    expect(labs).toHaveLength(7);
    expect(labs.every((room) => room.supervised)).toBe(true);
  });

  it('leaves study and seminar rooms unsupervised', () => {
    const open = ROOMS.filter((room) => room.kind === 'study' || room.kind === 'seminar');

    expect(open.every((room) => !room.supervised)).toBe(true);
  });
});

describe('walking between buildings', () => {
  it('is symmetric', () => {
    expect(walkBetween('MEN', 'FAR')?.minutes).toBe(11);
    expect(walkBetween('FAR', 'MEN')?.minutes).toBe(11);
  });

  it('carries a hint, because the spoken answer has to work without a floor plan', () => {
    expect(walkBetween('MEN', 'SCL')).toEqual({ minutes: 4, hint: 'cross the cloister courtyard' });
  });

  it('costs nothing to stay put', () => {
    expect(walkBetween('FAR', 'FAR')?.minutes).toBe(0);
  });

  it('returns null for an unknown building instead of guessing a distance', () => {
    expect(walkBetween('MEN', 'XXX')).toBeNull();
  });
});

describe('opening hours', () => {
  // Monday 5 October 2026, the week when everything piles up. 10:00 Madrid = 08:00 UTC (CEST).
  const mondayMorning = new Date('2026-10-05T08:00:00Z');
  const mondayMidMorning = new Date('2026-10-05T09:00:00Z');

  it('reads the campus wall clock, not the server clock', () => {
    const parts = campusLocalParts(mondayMorning);

    expect(parts.weekday).toBe(1);
    expect(parts.minutes).toBe(10 * 60);
    expect(parts.isoDate).toBe('2026-10-05');
  });

  it('has all three buildings open on a Monday morning', () => {
    for (const building of BUILDINGS) {
      expect(isOpenThroughout(building, mondayMorning, mondayMidMorning)).toBe(true);
    }
  });

  it('closes Santa Clara at the weekend but keeps El Faro open on Saturday', () => {
    // Saturday 10 October 2026, 11:00–12:00 Madrid.
    const from = new Date('2026-10-10T09:00:00Z');
    const to = new Date('2026-10-10T10:00:00Z');

    expect(isOpenThroughout(buildingByCode('SCL')!, from, to)).toBe(false);
    expect(isOpenThroughout(buildingByCode('FAR')!, from, to)).toBe(true);
    expect(isOpenThroughout(buildingByCode('MEN')!, from, to)).toBe(true);
  });

  it('rejects a window that runs past closing time', () => {
    // Santa Clara closes at 20:00. 19:30–20:30 Madrid on the Monday.
    const from = new Date('2026-10-05T17:30:00Z');
    const to = new Date('2026-10-05T18:30:00Z');

    expect(isOpenThroughout(buildingByCode('SCL')!, from, to)).toBe(false);
    // El Faro closes at 22:00, so the same window is fine there.
    expect(isOpenThroughout(buildingByCode('FAR')!, from, to)).toBe(true);
  });

  it('rejects a window that spans two days', () => {
    const from = new Date('2026-10-05T20:00:00Z');
    const to = new Date('2026-10-06T06:00:00Z');

    expect(isOpenThroughout(buildingByCode('FAR')!, from, to)).toBe(false);
  });
});
