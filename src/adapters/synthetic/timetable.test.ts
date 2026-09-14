import { describe, expect, it } from 'vitest';

import { PEOPLE, personBySubject } from './academic.ts';
import { ROOMS, campusInstant } from './campus.ts';
import {
  buildWeeklyPattern,
  busyRoomIds,
  isTeachingDay,
  sessionsForPerson,
  weeklyPattern,
} from './timetable.ts';

/** Tuesday 6 October 2026, 16:00–17:50 campus time — the peak slot. */
const peak = { start: campusInstant('2026-10-06', '16:00'), end: campusInstant('2026-10-06', '17:50') };

describe('determinism', () => {
  it('builds the same pattern every time for the reference seed', () => {
    expect(buildWeeklyPattern()).toEqual(buildWeeklyPattern());
  });

  it('builds a different pattern for a different seed', () => {
    expect(buildWeeklyPattern('other-seed')).not.toEqual(buildWeeklyPattern());
  });

  it('never double-books a room', () => {
    const seen = new Set<string>();

    for (const entry of weeklyPattern()) {
      const key = `${entry.weekday}:${entry.hour}:${entry.roomId}`;
      expect(seen.has(key), `${entry.roomId} booked twice at ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('teaches only on weekdays, in teaching rooms, during teaching hours', () => {
    const teachingRoomIds = new Set(ROOMS.filter((r) => r.kind !== 'study').map((r) => r.id));

    for (const entry of weeklyPattern()) {
      expect(entry.weekday).toBeGreaterThanOrEqual(1);
      expect(entry.weekday).toBeLessThanOrEqual(5);
      expect(teachingRoomIds).toContain(entry.roomId);
      expect([9, 10, 11, 12, 13, 15, 16, 17, 18, 19]).toContain(entry.hour);
    }
  });
});

describe('the collisions docs/san-telmo.md promises', () => {
  it('fills both Mendizábal seminar floors at the Tuesday 16:00 peak', () => {
    const seminarRooms = ROOMS.filter((r) => r.building === 'MEN' && (r.floor === 1 || r.floor === 2));
    const busy = busyRoomIds(peak);

    expect(seminarRooms).toHaveLength(12);
    for (const room of seminarRooms) {
      expect(busy, `${room.id} should be busy at the peak`).toContain(room.id);
    }
  });

  it('does the same on Thursday', () => {
    const thursday = {
      start: campusInstant('2026-10-08', '16:00'),
      end: campusInstant('2026-10-08', '17:50'),
    };
    const busy = busyRoomIds(thursday);
    const seminarRooms = ROOMS.filter((r) => r.building === 'MEN' && (r.floor === 1 || r.floor === 2));

    expect(seminarRooms.every((room) => busy.has(room.id))).toBe(true);
  });

  it('leaves spare capacity in El Faro at the peak, so find_room has an honest answer', () => {
    const busy = busyRoomIds(peak);
    const freeInElFaro = ROOMS.filter((r) => r.building === 'FAR' && !r.supervised && !busy.has(r.id));

    expect(freeInElFaro.length).toBeGreaterThan(0);
  });

  it('occupies every Santa Clara wet lab on Wednesday morning', () => {
    // Wednesday 7 October 2026, 09:00–10:50.
    const window = { start: campusInstant('2026-10-07', '09:00'), end: campusInstant('2026-10-07', '10:50') };
    const wetLabs = ROOMS.filter((r) => r.kind === 'lab');
    const busy = busyRoomIds(window);

    expect(wetLabs).toHaveLength(4);
    expect(wetLabs.every((room) => busy.has(room.id))).toBe(true);
  });

  it('leaves Friday afternoon empty, which is the easy case', () => {
    // Friday 9 October 2026, 16:00–17:50.
    const window = { start: campusInstant('2026-10-09', '16:00'), end: campusInstant('2026-10-09', '17:50') };

    expect(busyRoomIds(window).size).toBe(0);
  });
});

describe('teaching days', () => {
  it('teaches on an ordinary Tuesday in term', () => {
    expect(isTeachingDay('2026-10-06')).toBe(true);
  });

  it('does not teach on the national day or the local patron the day after', () => {
    expect(isTeachingDay('2026-10-12')).toBe(false);
    expect(isTeachingDay('2026-10-13')).toBe(false);
  });

  it('does not teach at the weekend', () => {
    expect(isTeachingDay('2026-10-10')).toBe(false);
    expect(isTeachingDay('2026-10-11')).toBe(false);
  });

  it('does not teach before the semester starts or after it ends', () => {
    expect(isTeachingDay('2026-09-11')).toBe(false);
    expect(isTeachingDay('2027-01-25')).toBe(false);
  });
});

describe('sessionsForPerson', () => {
  const week = { start: campusInstant('2026-10-05', '00:00'), end: campusInstant('2026-10-09', '23:59') };

  it('gives two different students two different timetables — the heart of UC-02', () => {
    const one = sessionsForPerson(personBySubject('est-0001')!, week);
    const other = sessionsForPerson(personBySubject('est-0002')!, week);

    expect(one.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
    expect(one).not.toEqual(other);
    // Different cohorts never share a class, so the course codes must not overlap either.
    const courses = new Set(one.map((s) => s.courseCode));
    expect(other.every((s) => !courses.has(s.courseCode))).toBe(true);
  });

  it('returns sessions in chronological order', () => {
    const sessions = sessionsForPerson(personBySubject('est-0001')!, week);
    const times = sessions.map((s) => s.start.getTime());

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('gives the porter nothing, rather than everything', () => {
    expect(sessionsForPerson(personBySubject('con-0001')!, week)).toEqual([]);
  });

  it('gives a lecturer the classes of the programme they teach', () => {
    const sessions = sessionsForPerson(personBySubject('doc-0007')!, week);

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => s.courseCode.startsWith('DER-'))).toBe(true);
  });

  it('skips the holiday week, so nobody is told to attend on the 12th', () => {
    const holidayWeek = {
      start: campusInstant('2026-10-12', '00:00'),
      end: campusInstant('2026-10-13', '23:59'),
    };

    for (const person of PEOPLE) {
      expect(sessionsForPerson(person, holidayWeek)).toEqual([]);
    }
  });

  it('gives every student at least one class a week', () => {
    for (const person of PEOPLE.filter((p) => p.role === 'student')) {
      expect(sessionsForPerson(person, week).length, person.subject).toBeGreaterThan(0);
    }
  });

  it('lasts 50 minutes a session, leaving the changeover', () => {
    const [first] = sessionsForPerson(personBySubject('est-0001')!, week);

    expect((first!.end.getTime() - first!.start.getTime()) / 60000).toBe(50);
  });
});
