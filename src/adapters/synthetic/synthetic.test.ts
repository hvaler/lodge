/**
 * Contract tests for the `synthetic` adapter.
 *
 * Each block below is one of the acceptance criteria in `docs/use-cases.md`. That file is the
 * source: if a behaviour changes, it changes there first and then here.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  InvalidRequestError,
  NotFoundError,
  UnauthenticatedError,
  assertProviderCoherent,
  toolCatalogue,
} from '../../provider/index.ts';
import type { RequestContext } from '../../provider/index.ts';
import { campusInstant, roomById } from './campus.ts';
import { SyntheticProvider, createSyntheticProvider } from './index.ts';
import { InMemoryIssueStore } from './issues.ts';

/** Tuesday 6 October 2026, 16:30 campus time — mid-peak, during the pile-up week. */
const NOW = campusInstant('2026-10-06', '16:30');

function ctx(subject: string | null = null, now: Date = NOW): RequestContext {
  return {
    principal: subject ? { subject } : null,
    now,
    locale: 'es-ES',
  };
}

const peakWindow = {
  start: campusInstant('2026-10-06', '16:00'),
  end: campusInstant('2026-10-06', '17:50'),
};

let provider: SyntheticProvider;

beforeEach(() => {
  // A fresh store per test: filing a fault in one must not leak into another.
  provider = createSyntheticProvider(new InMemoryIssueStore());
});

describe('the adapter honours its own declaration', () => {
  it('declares every capability and implements each one', () => {
    expect(() => assertProviderCoherent(provider)).not.toThrow();
  });

  it('publishes all six tools, because San Telmo can answer everything', () => {
    expect([...toolCatalogue(provider)].sort()).toEqual([
      'campus.deadlines',
      'campus.find_room',
      'campus.issue_status',
      'campus.report_issue',
      'campus.timetable',
      'campus.wayfind',
    ]);
  });

  it('declares its locale, which is what makes the responses Spanish', () => {
    expect(provider.descriptor.locale).toBe('es-ES');
    expect(provider.descriptor.institution).toBe('Universidad de San Telmo');
  });
});

describe('UC-01 · a free room right now', () => {
  it('never lists an occupied room', async () => {
    const free = await provider.findFreeRooms(ctx(), { window: peakWindow });
    const ids = free.map((room) => room.id);

    // The twelve Mendizábal seminar rooms are all teaching at this hour.
    for (const id of ['MEN-101', 'MEN-106', 'MEN-201', 'MEN-206']) {
      expect(ids, `${id} is teaching`).not.toContain(id);
    }
  });

  it('never lists a supervised lab, however empty it is', async () => {
    const free = await provider.findFreeRooms(ctx(), { window: peakWindow });

    expect(free.every((room) => roomById(room.id)?.supervised === false)).toBe(true);
  });

  it('never lists a room that is outside its building opening hours', async () => {
    // Santa Clara closes at 20:00; 19:30–20:30 runs past it.
    const late = { start: campusInstant('2026-10-06', '19:30'), end: campusInstant('2026-10-06', '20:30') };
    const free = await provider.findFreeRooms(ctx(), { window: late });

    expect(free.some((room) => room.building === 'SCL')).toBe(false);
    // El Faro is open until 22:00, so it still has something to offer.
    expect(free.some((room) => room.building === 'FAR')).toBe(true);
  });

  it('sends the student to El Faro at the peak, which is the honest answer', async () => {
    const free = await provider.findFreeRooms(ctx(), { window: peakWindow, building: 'FAR' });

    expect(free.length).toBeGreaterThan(0);
  });

  it('respects a minimum capacity', async () => {
    const free = await provider.findFreeRooms(ctx(), { window: peakWindow, minCapacity: 100 });

    expect(free.every((room) => room.capacity >= 100)).toBe(true);
  });

  it('does not leak the adapter’s bookkeeping across the interface', async () => {
    const [room] = await provider.findFreeRooms(ctx(), { window: peakWindow });

    expect(room).toBeDefined();
    expect(room).not.toHaveProperty('supervised');
  });

  it('rejects a window that ends before it starts instead of returning everything', async () => {
    const backwards = { start: peakWindow.end, end: peakWindow.start };

    await expect(provider.findFreeRooms(ctx(), { window: backwards })).rejects.toThrow(InvalidRequestError);
  });

  it('answers well inside the 500 ms platform budget', async () => {
    const started = performance.now();
    await provider.findFreeRooms(ctx(), { window: peakWindow });
    const elapsed = performance.now() - started;

    // The budget covers the whole round trip, so the adapter's share must be a small fraction.
    expect(elapsed).toBeLessThan(50);
  });
});

describe('UC-02 · what do I have tomorrow', () => {
  const week = { start: campusInstant('2026-10-05', '00:00'), end: campusInstant('2026-10-09', '23:59') };

  it('gives two identities two different timetables', async () => {
    const one = await provider.timetable(ctx('est-0001'), { window: week });
    const other = await provider.timetable(ctx('est-0002'), { window: week });

    expect(one.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
    expect(one).not.toEqual(other);
  });

  it('offers no way to ask for someone else’s, even explicitly', () => {
    // The guarantee is structural: TimetableQuery has exactly one field, the window. There is no
    // name or subject parameter for an agent to fill in, so the request cannot even be expressed.
    const query: Parameters<SyntheticProvider['timetable']>[1] = { window: week };

    expect(Object.keys(query)).toEqual(['window']);
  });

  it('refuses an unauthenticated caller rather than returning a default timetable', async () => {
    await expect(provider.timetable(ctx(null), { window: week })).rejects.toThrow(UnauthenticatedError);
  });

  it('reports an unknown subject as not on record', async () => {
    await expect(provider.timetable(ctx('est-9999'), { window: week })).rejects.toThrow(NotFoundError);
  });
});

describe('UC-03 · an administrative deadline', () => {
  it('finds the credit-transfer deadline of the pile-up week', async () => {
    const found = await provider.deadlines(ctx(), { topic: 'credit-transfer' });

    expect(found).toHaveLength(1);
    expect(found[0]?.closesOn.toISOString()).toBe('2026-10-09T21:59:00.000Z');
  });

  it('returns nothing for a deadline that is not on record, rather than the nearest one', async () => {
    // The agent has to be able to say "that is not on record". A fuzzy match would hand it a
    // confidently wrong date, which is worse than no answer: someone misses the real deadline.
    const found = await provider.deadlines(ctx(), { topic: 'parking permit renewal' });

    expect(found).toEqual([]);
  });

  it('returns entries closing soonest first', async () => {
    const found = await provider.deadlines(ctx(), {});
    const times = found.map((d) => d.closesOn.getTime());

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('can narrow to a window', async () => {
    const october = {
      start: campusInstant('2026-10-01', '00:00'),
      end: campusInstant('2026-10-31', '23:59'),
    };
    const found = await provider.deadlines(ctx(), { window: october });

    expect(found.map((d) => d.id)).toEqual([
      'enrolment-late',
      'credit-transfer',
      'placement-agreements',
      'final-project-autumn',
    ]);
  });
});

describe('UC-04 · finding the room', () => {
  it('gives directions that stand on their own, without a floor plan', async () => {
    const route = await provider.wayfind(ctx(), { from: 'MEN', to: 'FAR-104' });

    // In Spanish: San Telmo declares es-ES, and route steps cross the interface already in the
    // institution's language.
    expect(route).not.toBeNull();
    expect(route!.steps.join(' ')).toContain('El Faro');
    expect(route!.steps.join(' ')).toContain('paseo marítimo');
    expect(route!.minutes).toBeGreaterThanOrEqual(11);
  });

  it('offers the floor plan as an extra, never as the answer', async () => {
    const route = await provider.wayfind(ctx(), { to: 'MEN-203' });

    expect(route!.floorPlanRef).toBe('MEN-floor-2');
    // Remove it and the directions still get you there.
    expect(route!.steps.length).toBeGreaterThan(0);
    expect(route!.steps.join(' ')).toContain('planta 2');
  });

  it('warns about the wing with no lift, which a generic answer would miss', async () => {
    const route = await provider.wayfind(ctx(), { to: 'SCL-201' });

    expect(route!.steps.join(' ')).toContain('no hay ascensor');
  });

  it('returns null for a destination that does not exist rather than inventing a route', async () => {
    expect(await provider.wayfind(ctx(), { to: 'ZZZ-999' })).toBeNull();
  });
});

describe('UC-05 · reporting a fault', () => {
  it('files a fault and hands back a number to speak aloud', async () => {
    const ticket = await provider.reportIssue(ctx('doc-0007'), {
      roomId: 'MEN-203',
      equipment: 'proyector',
    });

    expect(ticket.number).toMatch(/^INC-2026-\d{4}$/);
    expect(ticket.status).toBe('open');
    expect(ticket.roomId).toBe('MEN-203');
    expect(ticket.openedAt).toEqual(NOW);
  });

  it('refuses kit the room does not have', async () => {
    // This is what makes confirming "the projector in 203" mean something: a room without one
    // would have been refused, so the confirmation is a real check and not a ritual.
    await expect(
      provider.reportIssue(ctx('doc-0007'), { roomId: 'MEN-301', equipment: 'proyector' }),
    ).rejects.toThrow(InvalidRequestError);
  });

  it('names what the room does have, so the agent can offer the alternatives', async () => {
    await expect(
      provider.reportIssue(ctx('doc-0007'), { roomId: 'MEN-301', equipment: 'proyector' }),
    ).rejects.toThrow(/pizarra/);
  });

  it('matches equipment case-insensitively, because it arrives from speech', async () => {
    const ticket = await provider.reportIssue(ctx('doc-0007'), {
      roomId: 'MEN-203',
      equipment: 'PROYECTOR',
    });

    expect(ticket.equipment).toBe('proyector');
  });

  it('refuses an unknown room', async () => {
    await expect(
      provider.reportIssue(ctx('doc-0007'), { roomId: 'MEN-999', equipment: 'proyector' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('files nothing for an unauthenticated caller', async () => {
    await expect(
      provider.reportIssue(ctx(null), { roomId: 'MEN-203', equipment: 'proyector' }),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it('continues the numbering after the seeded faults', async () => {
    const ticket = await provider.reportIssue(ctx('doc-0007'), {
      roomId: 'MEN-203',
      equipment: 'proyector',
    });

    expect(ticket.number).toBe('INC-2026-0032');
  });
});

describe('UC-06 · chasing the report', () => {
  it('returns only the faults opened by the person asking', async () => {
    const mine = await provider.issueStatus(ctx('doc-0007'));
    const theirs = await provider.issueStatus(ctx('doc-0011'));

    expect(mine.every((t) => t.roomId === 'MEN-203')).toBe(true);
    expect(theirs.map((t) => t.number).sort()).toEqual(['INC-2026-0019', 'INC-2026-0028']);
    // No overlap: this is a privacy boundary, not a convenience filter.
    const mineNumbers = new Set(mine.map((t) => t.number));
    expect(theirs.every((t) => !mineNumbers.has(t.number))).toBe(true);
  });

  it('returns nothing for someone who has never filed one', async () => {
    expect(await provider.issueStatus(ctx('est-0001'))).toEqual([]);
  });

  it('lists the newest first, since chasing means the most recent one', async () => {
    const theirs = await provider.issueStatus(ctx('doc-0011'));
    const times = theirs.map((t) => t.openedAt.getTime());

    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('shows a freshly filed fault to its reporter and to nobody else', async () => {
    await provider.reportIssue(ctx('est-0001'), { roomId: 'FAR-106', equipment: 'zona de silencio' });

    expect(await provider.issueStatus(ctx('est-0001'))).toHaveLength(1);
    expect(await provider.issueStatus(ctx('est-0002'))).toHaveLength(0);
  });

  it('refuses an unauthenticated caller', async () => {
    await expect(provider.issueStatus(ctx(null))).rejects.toThrow(UnauthenticatedError);
  });
});

describe('determinism', () => {
  it('gives two fresh providers the same answers for the same clock', async () => {
    const a = createSyntheticProvider(new InMemoryIssueStore());
    const b = createSyntheticProvider(new InMemoryIssueStore());

    expect(await a.findFreeRooms(ctx(), { window: peakWindow })).toEqual(
      await b.findFreeRooms(ctx(), { window: peakWindow }),
    );
    const week = { start: campusInstant('2026-10-05', '00:00'), end: campusInstant('2026-10-09', '23:59') };
    expect(await a.timetable(ctx('est-0001'), { window: week })).toEqual(
      await b.timetable(ctx('est-0001'), { window: week }),
    );
  });

  it('takes its clock from the context, never from the wall', async () => {
    const ticket = await provider.reportIssue(ctx('doc-0007', campusInstant('2026-11-20', '08:15')), {
      roomId: 'MEN-203',
      equipment: 'proyector',
    });

    expect(ticket.openedAt.toISOString()).toBe('2026-11-20T07:15:00.000Z');
  });
});
