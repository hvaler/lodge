/**
 * The `standards` adapter end to end.
 *
 * The heart of it is the first block: Carrigmore publishes a *different* set of tools from San
 * Telmo, because it has different things configured. That is the runbook's claim — "an institution
 * with no issue tracker does not publish those tools, and the agent never offers what does not
 * exist" — turned into something that fails if it stops being true.
 */

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  InvalidRequestError,
  UnauthenticatedError,
  assertProviderCoherent,
  toolCatalogue,
} from '../../provider/index.ts';
import type { Provider, RequestContext } from '../../provider/index.ts';
import { instantAt, localParts } from '../../shared/time.ts';
import { ConfigurationError } from './config.ts';
import { createStandardsProvider } from './index.ts';
import type { DirectoryLookup, StandardsConfig } from './index.ts';

const DUBLIN = 'Europe/Dublin';
const FIXTURES = join(process.cwd(), 'fixtures', 'carrigmore');

const CARRIGMORE: StandardsConfig = {
  institution: 'Carrigmore College',
  locale: 'en-IE',
  timeZone: DUBLIN,
  inventory: { location: join(FIXTURES, 'rooms.csv') },
  calendars: {
    timetable: join(FIXTURES, 'timetable.ics'),
    deadlines: join(FIXTURES, 'deadlines.ics'),
  },
};

/** Stands in for LDAP until it lands. The shape is all the adapter depends on. */
const directory: DirectoryLookup = {
  async modulesFor(subject) {
    const enrolments: Record<string, string[]> = {
      'u-1001': ['CS101', 'CS201'],
      'u-1002': ['LAW101', 'LAW201'],
      'u-1003': [],
    };
    return enrolments[subject] ?? null;
  },
};

/** Tuesday 6 October 2026, 11:00 Dublin — between classes. */
const NOW = instantAt('2026-10-06', '11:00', DUBLIN);

function ctx(subject: string | null = null): RequestContext {
  return { principal: subject ? { subject } : null, now: NOW, locale: 'en-IE' };
}

describe('the catalogue follows what the institution configured', () => {
  it('publishes four tools for Carrigmore with a directory, not six', async () => {
    // No issue tracker is connected, so the two fault tools do not exist here. A student asking
    // Carrigmore to report a broken projector is told the agent cannot, because it genuinely
    // cannot — not because it tried and failed.
    const provider = await createStandardsProvider(CARRIGMORE, directory);

    expect([...toolCatalogue(provider)].sort()).toEqual([
      'campus.deadlines',
      'campus.find_room',
      'campus.timetable',
      'campus.wayfind',
    ]);
  });

  it('drops the timetable tool when there is no directory', async () => {
    // A feed alone cannot say whose class it is, and UC-02 forbids taking a name as a parameter.
    const provider = await createStandardsProvider(CARRIGMORE);

    expect([...toolCatalogue(provider)].sort()).toEqual([
      'campus.deadlines',
      'campus.find_room',
      'campus.wayfind',
    ]);
  });

  it('drops room search when there is no timetable feed, keeping directions', async () => {
    // Without occupancy we would be guessing which rooms are free, and UC-01 accepts no occupied
    // room in the answer. Directions still work: they need only the table.
    const provider = await createStandardsProvider({
      ...CARRIGMORE,
      calendars: { deadlines: join(FIXTURES, 'deadlines.ics') },
    });

    expect([...toolCatalogue(provider)].sort()).toEqual(['campus.deadlines', 'campus.wayfind']);
  });

  it('publishes only deadlines for an institution that offers only a key-dates feed', async () => {
    const provider = await createStandardsProvider({
      institution: 'Minimal College',
      locale: 'en-IE',
      timeZone: DUBLIN,
      calendars: { deadlines: join(FIXTURES, 'deadlines.ics') },
    });

    expect(toolCatalogue(provider)).toEqual(['campus.deadlines']);
  });

  it('is coherent whatever it declares', async () => {
    for (const config of [
      CARRIGMORE,
      { ...CARRIGMORE, calendars: { deadlines: join(FIXTURES, 'deadlines.ics') } },
    ] satisfies StandardsConfig[]) {
      const provider = await createStandardsProvider(config, directory);
      expect(() => assertProviderCoherent(provider)).not.toThrow();
    }
  });

  it('refuses a configuration that would publish nothing, saying what to add', async () => {
    const empty: StandardsConfig = { institution: 'Nowhere', locale: 'en-IE', timeZone: DUBLIN };

    await expect(createStandardsProvider(empty)).rejects.toThrow(ConfigurationError);
    await expect(createStandardsProvider(empty)).rejects.toThrow(/would enable deadlines/);
  });

  it('says so if a directory is configured but not supplied', async () => {
    const withDirectory: StandardsConfig = {
      ...CARRIGMORE,
      directory: { url: 'ldap://x', bindDN: 'cn=x', bindPassword: 'x', baseDN: 'dc=x' },
    };

    await expect(createStandardsProvider(withDirectory)).rejects.toThrow(InvalidRequestError);
  });
});

describe('finding a free room at Carrigmore', () => {
  let provider: Provider;

  it('excludes what the feed says is teaching', async () => {
    provider = await createStandardsProvider(CARRIGMORE, directory);

    // Tuesday 14:00–15:50 is CS201 in QUA-201.
    const during = {
      start: instantAt('2026-10-06', '14:00', DUBLIN),
      end: instantAt('2026-10-06', '15:00', DUBLIN),
    };
    const free = await provider.findFreeRooms!(ctx(), { window: during });

    expect(free.map((r) => r.id)).not.toContain('QUA-201');
  });

  it('never offers a supervised room', async () => {
    provider = await createStandardsProvider(CARRIGMORE, directory);
    const free = await provider.findFreeRooms!(ctx(), {
      window: { start: NOW, end: new Date(NOW.getTime() + 3_600_000) },
    });

    for (const supervised of ['QUA-201', 'QUA-202', 'MIL-201']) {
      expect(free.map((r) => r.id)).not.toContain(supervised);
    }
  });

  it('respects Carrigmore’s own opening hours', async () => {
    provider = await createStandardsProvider(CARRIGMORE, directory);

    // The Mill closes at 19:00, Quay House at 21:00.
    const evening = {
      start: instantAt('2026-10-06', '19:30', DUBLIN),
      end: instantAt('2026-10-06', '20:30', DUBLIN),
    };
    const free = await provider.findFreeRooms!(ctx(), { window: evening });

    expect(free.some((r) => r.building === 'MIL')).toBe(false);
    expect(free.some((r) => r.building === 'QUA')).toBe(true);
  });

  it('does not leak the adapter’s bookkeeping', async () => {
    provider = await createStandardsProvider(CARRIGMORE, directory);
    const [room] = await provider.findFreeRooms!(ctx(), {
      window: { start: NOW, end: new Date(NOW.getTime() + 3_600_000) },
    });

    expect(room).not.toHaveProperty('supervised');
  });
});

describe('timetables resolved through the directory', () => {
  it('gives two people two different timetables', async () => {
    const provider = await createStandardsProvider(CARRIGMORE, directory);
    const week = {
      start: instantAt('2026-10-05', '00:00', DUBLIN),
      end: instantAt('2026-10-09', '23:59', DUBLIN),
    };

    const cs = await provider.timetable!(ctx('u-1001'), { window: week });
    const law = await provider.timetable!(ctx('u-1002'), { window: week });

    expect(cs.every((s) => s.courseCode.startsWith('CS'))).toBe(true);
    expect(law.every((s) => s.courseCode.startsWith('LAW'))).toBe(true);
    expect(cs).not.toEqual(law);
  });

  it('gives nothing to someone enrolled in nothing, rather than everything', async () => {
    const provider = await createStandardsProvider(CARRIGMORE, directory);
    const week = {
      start: instantAt('2026-10-05', '00:00', DUBLIN),
      end: instantAt('2026-10-09', '23:59', DUBLIN),
    };

    expect(await provider.timetable!(ctx('u-1003'), { window: week })).toEqual([]);
  });

  it('refuses an unauthenticated caller', async () => {
    const provider = await createStandardsProvider(CARRIGMORE, directory);

    await expect(
      provider.timetable!(ctx(null), { window: { start: NOW, end: NOW } }),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it('reports someone the directory has never heard of as not on record', async () => {
    const provider = await createStandardsProvider(CARRIGMORE, directory);

    await expect(
      provider.timetable!(ctx('u-9999'), { window: { start: NOW, end: NOW } }),
    ).rejects.toThrow(/u-9999/);
  });
});

describe('deadlines and directions', () => {
  it('reports Carrigmore’s own dates on Carrigmore’s clock', async () => {
    const provider = await createStandardsProvider(CARRIGMORE, directory);
    const found = await provider.deadlines!(ctx(), { topic: 'module change' });

    expect(found).toHaveLength(1);
    expect(localParts(found[0]!.closesOn, DUBLIN).isoDate).toBe('2026-10-09');
  });

  it('says nothing is on record rather than offering the nearest date', async () => {
    const provider = await createStandardsProvider(CARRIGMORE, directory);

    expect(await provider.deadlines!(ctx(), { topic: 'graduation ball' })).toEqual([]);
  });

  it('gives directions without inventing a walking time', async () => {
    // A room table says which building and floor, not how far apart the buildings are. San Telmo
    // knows its own campus and says "eleven minutes"; Carrigmore honestly cannot.
    const provider = await createStandardsProvider(CARRIGMORE, directory);
    const route = await provider.wayfind!(ctx(), { to: 'MIL-101' });

    expect(route!.steps.join(' ')).toContain('The Mill');
    expect(route!.steps.join(' ')).toContain('floor 1');
    expect(route!.minutes).toBeUndefined();
  });

  it('returns null for a place it does not have', async () => {
    const provider = await createStandardsProvider(CARRIGMORE, directory);

    expect(await provider.wayfind!(ctx(), { to: 'ZZZ-1' })).toBeNull();
  });
});
