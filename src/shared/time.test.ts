/**
 * Wall-clock arithmetic, tested directly rather than through the adapters that use it.
 *
 * Until now this module had no tests of its own: it was exercised sideways by three adapter suites,
 * which is the weakest kind of cover for the strongest kind of bug. Date arithmetic fails by a whole
 * day, silently, and only for people in the wrong month — a student told the wrong room for an exam
 * does not file a bug report, they just miss it.
 *
 * Both European transitions are in here on purpose. The academic year runs from September to June
 * and crosses both, so an institution using this hits them every single year.
 *
 * The expected instants were computed from the IANA database rather than worked out by hand.
 */

import { describe, expect, it } from 'vitest';

import { instantAt, isOpenThroughout, localParts, minutesOf, weekOf } from './time.ts';

const MADRID = 'Europe/Madrid';
const DUBLIN = 'Europe/Dublin';
// The zone CI runs the whole suite under, because an iCalendar all-day date once meant different
// days on either side of the date line.
const AUCKLAND = 'Pacific/Auckland';

describe('what the clock reads', () => {
  it('reads the zone it was given, not the one the process happens to run in', () => {
    // One instant, three clocks — and two different dates. This is the whole reason the zone is a
    // parameter instead of an assumption.
    const at = new Date('2026-01-15T23:30:00Z');

    expect(localParts(at, MADRID)).toEqual({ weekday: 5, minutes: 30, isoDate: '2026-01-16' });
    expect(localParts(at, DUBLIN)).toEqual({ weekday: 4, minutes: 1410, isoDate: '2026-01-15' });
    expect(localParts(at, AUCKLAND)).toEqual({ weekday: 5, minutes: 750, isoDate: '2026-01-16' });
  });

  it('calls local midnight zero minutes, not one thousand four hundred and forty', () => {
    // `en-GB` with hour12:false reports midnight as hour 24, and the modulo in localParts is what
    // turns that into 0. Without it every midnight is a full day late, and "is this room free from
    // midnight" answers backwards.
    const midnightInMadrid = new Date('2026-01-15T23:00:00Z');

    expect(localParts(midnightInMadrid, MADRID)).toEqual({
      weekday: 5,
      minutes: 0,
      isoDate: '2026-01-16',
    });
  });

  it('numbers the weekdays from Sunday, which is what the opening-hours array assumes', () => {
    const sunday = new Date('2026-03-29T12:00:00Z');
    const tuesday = new Date('2026-09-22T12:00:00Z');

    expect(localParts(sunday, MADRID).weekday).toBe(0);
    expect(localParts(tuesday, MADRID).weekday).toBe(2);
  });
});

describe('turning a wall-clock time into an instant', () => {
  it('knows that the same wall-clock time is a different instant in winter and in summer', () => {
    // Madrid is UTC+1 in January and UTC+2 in June. A server that ignored this would put every
    // summer class an hour out — for nine months of the year it would look fine.
    expect(instantAt('2026-01-15', '09:30', MADRID).toISOString()).toBe('2026-01-15T08:30:00.000Z');
    expect(instantAt('2026-06-15', '09:30', MADRID).toISOString()).toBe('2026-06-15T07:30:00.000Z');
  });

  it('knows that two institutions an hour apart are an hour apart', () => {
    expect(instantAt('2026-01-15', '09:30', DUBLIN).toISOString()).toBe('2026-01-15T09:30:00.000Z');
  });

  it('survives the morning the clocks go forward', () => {
    // 29 March 2026: Madrid jumps 02:00 to 03:00. The half hour before and the hour after both
    // exist, and they are only ninety minutes apart on the clock but sixty in real time.
    expect(instantAt('2026-03-29', '01:30', MADRID).toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(instantAt('2026-03-29', '03:00', MADRID).toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('survives the morning the clocks go back', () => {
    // 25 October 2026: Madrid repeats 02:00 to 03:00. By 04:00 the ambiguity is over.
    expect(instantAt('2026-10-25', '04:00', MADRID).toISOString()).toBe('2026-10-25T03:00:00.000Z');
  });

  it('round-trips every half hour of both transition days, in both zones', () => {
    // The property that matters, asserted where it is most likely to fail. A time the clock
    // genuinely skips cannot round-trip — nothing can — so those hours are excluded.
    //
    // And the skipped hour is PER ZONE, which is the point. Madrid goes 02:00 to 03:00; Dublin goes
    // 01:00 to 02:00, an hour earlier on the clock and at the same instant. The first version of
    // this test assumed the continent changed together, and this loop caught it on its first run —
    // which is the assumption the whole module exists to stop anyone making in real code.
    const skipped: Readonly<Record<string, readonly string[]>> = {
      [MADRID]: ['02:00', '02:30'],
      [DUBLIN]: ['01:00', '01:30'],
    };

    for (const zone of [MADRID, DUBLIN]) {
      for (const day of ['2026-03-29', '2026-10-25']) {
        for (let m = 0; m < 24 * 60; m += 30) {
          const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          if (day === '2026-03-29' && skipped[zone]?.includes(hhmm)) continue;

          const back = localParts(instantAt(day, hhmm, zone), zone);
          expect(`${back.isoDate} ${back.minutes}`, `${zone} ${day} ${hhmm}`).toBe(`${day} ${m}`);
        }
      }
    }
  });

  it('round-trips an ordinary day on the other side of the date line', () => {
    const back = localParts(instantAt('2026-09-22', '09:30', AUCKLAND), AUCKLAND);

    expect(back.isoDate).toBe('2026-09-22');
    expect(back.minutes).toBe(570);
  });
});

describe('minutes since midnight', () => {
  it('reads an HH:MM string', () => {
    expect(minutesOf('00:00')).toBe(0);
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('23:59')).toBe(1439);
  });
});

describe('a week of opening hours', () => {
  it('puts Sunday first, because that is what localParts reports', () => {
    // Off by one here would close a building on the wrong day, which is the kind of bug that is
    // only noticed by whoever turns up.
    const weekday = { open: '08:00', close: '21:00' };
    const saturday = { open: '09:00', close: '14:00' };

    expect(weekOf(weekday, saturday, null)).toEqual([
      null,
      weekday,
      weekday,
      weekday,
      weekday,
      weekday,
      saturday,
    ]);
  });
});

describe('whether a building is open for a whole window', () => {
  const HOURS = weekOf({ open: '08:00', close: '21:00' }, { open: '09:00', close: '14:00' }, null);
  const on = (date: string, hhmm: string): Date => instantAt(date, hhmm, MADRID);

  it('says yes when the window sits inside the day', () =>
    expect(isOpenThroughout(HOURS, on('2026-09-22', '10:00'), on('2026-09-22', '12:00'), MADRID))
      .toBe(true));

  it('counts the opening and closing minutes as open', () =>
    // A slot that starts exactly at opening is a slot, and a booking that ends exactly at closing
    // is not an overrun.
    expect(isOpenThroughout(HOURS, on('2026-09-22', '08:00'), on('2026-09-22', '21:00'), MADRID))
      .toBe(true));

  it('says no a minute before opening', () =>
    expect(isOpenThroughout(HOURS, on('2026-09-22', '07:59'), on('2026-09-22', '12:00'), MADRID))
      .toBe(false));

  it('says no on a day with no hours at all', () =>
    // Sunday. Not "closed for now" — there is no entry, so there is nothing to be inside of.
    expect(isOpenThroughout(HOURS, on('2026-09-27', '10:00'), on('2026-09-27', '12:00'), MADRID))
      .toBe(false));

  it('refuses a window that crosses local midnight rather than guessing', () =>
    // Opening hours are per day. Something running past midnight needs an answer this function has
    // no business inventing, so it declines — which is the same rule the whole server follows.
    expect(isOpenThroughout(HOURS, on('2026-09-22', '23:00'), on('2026-09-23', '01:00'), MADRID))
      .toBe(false));

  it('lets the zone decide, not the server', () => {
    // The same two instants: inside Saturday hours in Madrid, and already Sunday in Auckland, where
    // this week has no hours at all.
    const from = new Date('2026-09-26T08:00:00Z');
    const to = new Date('2026-09-26T10:00:00Z');

    expect(isOpenThroughout(HOURS, from, to, MADRID)).toBe(true);
    expect(isOpenThroughout(HOURS, from, to, AUCKLAND)).toBe(false);
  });
});
