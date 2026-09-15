import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { instantAt, localParts } from '../../shared/time.ts';
import { CalendarError, loadDeadlines, loadTimetable } from './calendars.ts';

const DUBLIN = 'Europe/Dublin';
const FIXTURES = join(process.cwd(), 'fixtures', 'carrigmore');
const deadlinesFeed = join(FIXTURES, 'deadlines.ics');
const timetableFeed = join(FIXTURES, 'timetable.ics');

describe('deadlines from an iCalendar feed', () => {
  it('reads the registry’s key dates', async () => {
    const deadlines = await loadDeadlines(deadlinesFeed, DUBLIN);

    expect(deadlines.map((d) => d.label)).toContain('Registration closes');
    expect(deadlines.map((d) => d.label)).toContain('Module change deadline');
  });

  it('anchors an all-day date on the institution’s clock, not the container’s', async () => {
    // The bug this test exists for: node-ical turns `DTSTART;VALUE=DATE:20261002` into local
    // midnight *in the process time zone*, so the same file gave a different instant on a machine
    // in Madrid than on one in Dublin — an off-by-one day on a deadline. Whatever this test runs
    // on, the date a student is told must be the 2nd.
    const deadlines = await loadDeadlines(deadlinesFeed, DUBLIN);
    const registration = deadlines.find((d) => d.label === 'Registration closes');

    expect(localParts(registration!.closesOn, DUBLIN).isoDate).toBe('2026-10-02');
  });

  it('closes an all-day deadline at the end of its day, not the start', async () => {
    const deadlines = await loadDeadlines(deadlinesFeed, DUBLIN);
    const registration = deadlines.find((d) => d.label === 'Registration closes');

    // Someone submitting at 6pm on the 2nd is inside the deadline.
    expect(registration!.closesOn.getTime()).toBeGreaterThan(
      instantAt('2026-10-02', '18:00', DUBLIN).getTime(),
    );
  });

  it('treats DTEND as exclusive on a date range, as RFC 5545 requires', async () => {
    // `Semester one teaching` runs 20260914 to 20270123 exclusive, so it ends on the 22nd.
    // Reading DTEND literally would make every multi-day entry a day too long.
    const semester = (await loadDeadlines(deadlinesFeed, DUBLIN)).find(
      (d) => d.label === 'Semester one teaching',
    );

    expect(localParts(semester!.closesOn, DUBLIN).isoDate).toBe('2027-01-22');
    expect(localParts(semester!.opensOn!, DUBLIN).isoDate).toBe('2026-09-14');
  });

  it('gives a single-day entry no opening date to speak', async () => {
    const registration = (await loadDeadlines(deadlinesFeed, DUBLIN)).find(
      (d) => d.label === 'Registration closes',
    );

    expect(registration).not.toHaveProperty('opensOn');
  });

  it('returns them soonest first', async () => {
    const times = (await loadDeadlines(deadlinesFeed, DUBLIN)).map((d) => d.closesOn.getTime());

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('reads a feed whatever its line endings are', async () => {
    // RFC 5545 mandates CRLF and real feeds emit it — the fixture is checked out that way on
    // purpose. But plenty of systems emit bare LF, and refusing those would fail an institution
    // over something invisible in a text editor.
    const CR = String.fromCharCode(13);
    const LF = String.fromCharCode(10);

    const crlf = await readFile(deadlinesFeed, 'utf8');
    expect(crlf).toContain(CR + LF);

    const dir = await mkdtemp(join(tmpdir(), 'lodge-ics-'));
    const lfPath = join(dir, 'deadlines-lf.ics');
    await writeFile(lfPath, crlf.split(CR + LF).join(LF), 'utf8');

    const fromCrlf = await loadDeadlines(deadlinesFeed, DUBLIN);
    const fromLf = await loadDeadlines(lfPath, DUBLIN);

    expect(fromLf.map((d) => [d.label, d.closesOn.toISOString()])).toEqual(
      fromCrlf.map((d) => [d.label, d.closesOn.toISOString()]),
    );
  });

  it('says which feed it could not read', async () => {
    await expect(loadDeadlines('/no/such/feed.ics', DUBLIN)).rejects.toThrow(/\/no\/such\/feed\.ics/);
  });

  it('rejects a feed with no events rather than answering nothing forever', async () => {
    const empty = join(FIXTURES, 'rooms.csv'); // valid file, not a calendar

    await expect(loadDeadlines(empty, DUBLIN)).rejects.toThrow(CalendarError);
  });
});

describe('timetable from an iCalendar feed', () => {
  /** Monday 5 to Friday 9 October 2026, Dublin. */
  const week = {
    start: instantAt('2026-10-05', '00:00', DUBLIN),
    end: instantAt('2026-10-09', '23:59', DUBLIN),
  };

  it('lists the modules it knows about, taken from CATEGORIES', async () => {
    const feed = await loadTimetable(timetableFeed, DUBLIN);

    expect([...feed.modules].sort()).toEqual(['CS101', 'CS201', 'LAW101', 'LAW201']);
  });

  it('expands a weekly recurrence into concrete sessions', async () => {
    const feed = await loadTimetable(timetableFeed, DUBLIN);
    const sessions = feed.sessionsFor(['CS101'], week);

    // CS101 runs Monday and Thursday, so one week gives two.
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => localParts(s.start, DUBLIN).isoDate)).toEqual(['2026-10-05', '2026-10-08']);
  });

  it('places each session at the right wall-clock time in Dublin', async () => {
    const feed = await loadTimetable(timetableFeed, DUBLIN);
    const [monday] = feed.sessionsFor(['CS101'], week);

    expect(localParts(monday!.start, DUBLIN).minutes).toBe(10 * 60);
    expect((monday!.end.getTime() - monday!.start.getTime()) / 60_000).toBe(110);
  });

  it('carries the room from LOCATION', async () => {
    const feed = await loadTimetable(timetableFeed, DUBLIN);
    const [monday, thursday] = feed.sessionsFor(['CS101'], week);

    expect(monday!.roomId).toBe('QUA-101');
    expect(thursday!.roomId).toBe('QUA-202');
  });

  it('leaves group unset, because Carrigmore does not have any', async () => {
    // Requiring a group would have forced this adapter to invent one. The interface made it
    // optional instead, which is what the second adapter is for.
    const feed = await loadTimetable(timetableFeed, DUBLIN);
    const [session] = feed.sessionsFor(['CS101'], week);

    expect(session!.group).toBeUndefined();
  });

  it('returns only the modules asked for, which is how a person gets their own timetable', async () => {
    const feed = await loadTimetable(timetableFeed, DUBLIN);

    const lawStudent = feed.sessionsFor(['LAW101', 'LAW201'], week);
    const csStudent = feed.sessionsFor(['CS101', 'CS201'], week);

    expect(lawStudent.every((s) => s.courseCode.startsWith('LAW'))).toBe(true);
    expect(csStudent.every((s) => s.courseCode.startsWith('CS'))).toBe(true);
    expect(lawStudent).not.toEqual(csStudent);
  });

  it('returns nothing for a module nobody teaches', async () => {
    const feed = await loadTimetable(timetableFeed, DUBLIN);

    expect(feed.sessionsFor(['PHYS999'], week)).toEqual([]);
  });

  it('returns nothing outside the teaching period', async () => {
    const feed = await loadTimetable(timetableFeed, DUBLIN);
    const summer = {
      start: instantAt('2027-07-05', '00:00', DUBLIN),
      end: instantAt('2027-07-09', '23:59', DUBLIN),
    };

    expect(feed.sessionsFor(['CS101'], summer)).toEqual([]);
  });

  it('returns sessions chronologically across modules', async () => {
    const feed = await loadTimetable(timetableFeed, DUBLIN);
    const times = feed.sessionsFor(['CS101', 'CS201', 'LAW101', 'LAW201'], week).map((s) => s.start.getTime());

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
