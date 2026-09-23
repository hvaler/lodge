/**
 * The deterministic timetable generator.
 *
 * This is the only genuinely *generated* part of San Telmo — the building stock, calendar, people
 * and seeded faults are fixed data. What is generated is a weekly pattern, laid over the semester
 * and skipping holidays.
 *
 * The pattern is built to contain the collisions `docs/san-telmo.md` §2 promises, because they are
 * what gives `campus.find_room` something real to solve. A campus where every room is free at every
 * hour demos beautifully and proves nothing.
 */

import type { Busy, Session, TimeWindow } from '../../provider/index.ts';
import { PROGRAMMES, SEMESTER_1, isHoliday } from './academic.ts';
import type { Person } from './academic.ts';
import { ROOMS, campusInstant, campusLocalParts } from './campus.ts';
import { SAN_TELMO_SEED, createRng } from './prng.ts';

/** Teaching hours. Each slot runs 50 minutes, leaving the 10-minute changeover. */
export const MORNING_HOURS = [9, 10, 11, 12, 13] as const;
export const AFTERNOON_HOURS = [15, 16, 17, 18, 19] as const;
export const SLOT_MINUTES = 50;

/** One recurring weekly class. The semester is this pattern repeated. */
export interface WeeklyClass {
  readonly programme: string;
  readonly year: number;
  readonly group: string;
  readonly courseCode: string;
  readonly roomId: string;
  /** 1 = Monday … 5 = Friday. Nothing is taught at the weekend. */
  readonly weekday: number;
  readonly hour: number;
}

/** Rooms that can host a class: teaching space, not study rooms. */
const TEACHING_ROOMS = ROOMS.filter((room) => room.kind !== 'study');

const roomsIn = (building: string, floors?: readonly number[]): readonly string[] =>
  TEACHING_ROOMS.filter(
    (room) => room.building === building && (floors === undefined || floors.includes(room.floor)),
  ).map((room) => room.id);

/** Every (programme, year, group) triple that has classes. */
function cohorts(): { programme: string; year: number; group: string }[] {
  return PROGRAMMES.flatMap((programme) =>
    Array.from({ length: programme.years }, (_, i) => i + 1).flatMap((year) =>
      programme.groups.map((group) => ({ programme: programme.code, year, group })),
    ),
  );
}

const courseCode = (programme: string, year: number, index: number): string =>
  `${programme}-${year}${String(index).padStart(2, '0')}`;

/**
 * Builds the weekly pattern.
 *
 * Fixed rules come first and own their slots; the filler is then drawn from the seeded stream into
 * whatever is left. That ordering is what makes the promised collisions guaranteed rather than
 * likely — a generator that only *tends* to produce a busy Tuesday would sometimes record a video
 * where the interesting answer never happens.
 */
export function buildWeeklyPattern(seed: string = SAN_TELMO_SEED): readonly WeeklyClass[] {
  const rng = createRng(`${seed}:timetable`);
  const pattern: WeeklyClass[] = [];
  /** `${weekday}:${hour}:${roomId}` already taken. */
  const taken = new Set<string>();

  const place = (entry: WeeklyClass): boolean => {
    const key = `${entry.weekday}:${entry.hour}:${entry.roomId}`;
    if (taken.has(key)) return false;
    taken.add(key);
    pattern.push(entry);
    return true;
  };

  // ── Rule 1: the Tuesday and Thursday afternoon peak ───────────────────────
  // DER's eight cohorts plus INF years 1–2 fill Mendizábal's twelve seminar rooms for two hours.
  const seminarRooms = roomsIn('MEN', [1, 2]);
  const peakCohorts = cohorts().filter(
    (c) => c.programme === 'DER' || (c.programme === 'INF' && c.year <= 2),
  );

  for (const weekday of [2, 4]) {
    for (const hour of [16, 17]) {
      peakCohorts.forEach((cohort, index) => {
        const roomId = seminarRooms[index];
        if (roomId === undefined) return;
        place({ ...cohort, courseCode: courseCode(cohort.programme, cohort.year, 1), roomId, weekday, hour });
      });
    }
  }

  // ── Rule 2: Wednesday morning in the wet labs ─────────────────────────────
  // Enfermería takes every Santa Clara wet lab, which is why nothing there is free before 11:00.
  const wetLabs = ROOMS.filter((room) => room.kind === 'lab').map((room) => room.id);
  const nursing = cohorts().filter((c) => c.programme === 'ENF');

  for (const hour of [9, 10]) {
    nursing.slice(0, wetLabs.length).forEach((cohort, index) => {
      const roomId = wetLabs[index];
      if (roomId === undefined) return;
      place({ ...cohort, courseCode: courseCode(cohort.programme, cohort.year, 2), roomId, weekday: 3, hour });
    });
  }

  // ── Filler ────────────────────────────────────────────────────────────────
  // Everything else, drawn from the seeded stream. Friday afternoons are left alone: the
  // near-empty campus is the easy case the demo contrasts the peak against.
  const weekdayHours: { weekday: number; hour: number }[] = [];
  for (const weekday of [1, 2, 3, 4, 5]) {
    for (const hour of [...MORNING_HOURS, ...AFTERNOON_HOURS]) {
      if (weekday === 5 && hour >= 15) continue;
      weekdayHours.push({ weekday, hour });
    }
  }

  for (const cohort of cohorts()) {
    const programme = PROGRAMMES.find((p) => p.code === cohort.programme);
    const home = roomsIn(programme?.home ?? 'MEN');
    const elsewhere = TEACHING_ROOMS.map((room) => room.id).filter((id) => !home.includes(id));
    // Four more classes a week each, preferring the programme's own building.
    const candidates = [...rng.shuffle(home), ...rng.shuffle(elsewhere)];

    let placed = 0;
    for (const { weekday, hour } of rng.shuffle(weekdayHours)) {
      if (placed >= 4) break;
      for (const roomId of candidates) {
        if (place({ ...cohort, courseCode: courseCode(cohort.programme, cohort.year, placed + 3), roomId, weekday, hour })) {
          placed++;
          break;
        }
      }
    }
  }

  return pattern;
}

/** The pattern for the reference seed, built once. */
let cached: readonly WeeklyClass[] | null = null;

export function weeklyPattern(): readonly WeeklyClass[] {
  cached ??= buildWeeklyPattern();
  return cached;
}

/** Whether `isoDate` is a teaching day: inside semester 1, a weekday, and not a holiday. */
export function isTeachingDay(isoDate: string): boolean {
  if (isoDate < SEMESTER_1.from || isoDate > SEMESTER_1.to) return false;
  if (isHoliday(isoDate)) return false;
  const weekday = campusLocalParts(campusInstant(isoDate, '12:00')).weekday;
  return weekday >= 1 && weekday <= 5;
}

/** Every ISO date in `window`, in order. Bounded so a silly window cannot spin. */
function datesIn(window: TimeWindow): string[] {
  const dates: string[] = [];
  const oneDay = 24 * 60 * 60 * 1000;
  for (let t = window.start.getTime(); t <= window.end.getTime() && dates.length < 400; t += oneDay) {
    const iso = campusLocalParts(new Date(t)).isoDate;
    if (dates.at(-1) !== iso) dates.push(iso);
  }
  const lastIso = campusLocalParts(window.end).isoDate;
  if (dates.at(-1) !== lastIso) dates.push(lastIso);
  return dates;
}

function toSession(entry: WeeklyClass, isoDate: string): Session {
  const start = campusInstant(isoDate, `${String(entry.hour).padStart(2, '0')}:00`);
  return {
    start,
    end: new Date(start.getTime() + SLOT_MINUTES * 60 * 1000),
    roomId: entry.roomId,
    courseCode: entry.courseCode,
    group: entry.group,
  };
}

/** Concrete sessions inside `window` for one cohort, in chronological order. */
export function sessionsForCohort(
  cohort: { programme: string; year: number; group: string },
  window: TimeWindow,
): Session[] {
  const classes = weeklyPattern().filter(
    (c) => c.programme === cohort.programme && c.year === cohort.year && c.group === cohort.group,
  );

  const sessions: Session[] = [];
  for (const isoDate of datesIn(window)) {
    if (!isTeachingDay(isoDate)) continue;
    const weekday = campusLocalParts(campusInstant(isoDate, '12:00')).weekday;
    for (const entry of classes.filter((c) => c.weekday === weekday)) {
      const session = toSession(entry, isoDate);
      if (session.start >= window.start && session.start <= window.end) sessions.push(session);
    }
  }
  return sessions.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Sessions for a person.
 *
 * A student gets their cohort's classes; a lecturer gets the classes of the programme they teach.
 * Anyone with no enrolment — the porter's desk — gets nothing, rather than everything.
 */
export function sessionsForPerson(person: Person, window: TimeWindow): Session[] {
  if (person.role === 'student' && person.programme && person.year && person.group) {
    return sessionsForCohort(
      { programme: person.programme, year: person.year, group: person.group },
      window,
    );
  }

  if (person.role === 'lecturer' && person.programme) {
    const taught = weeklyPattern().filter((c) => c.programme === person.programme);
    const sessions: Session[] = [];
    for (const isoDate of datesIn(window)) {
      if (!isTeachingDay(isoDate)) continue;
      const weekday = campusLocalParts(campusInstant(isoDate, '12:00')).weekday;
      for (const entry of taught.filter((c) => c.weekday === weekday)) {
        const session = toSession(entry, isoDate);
        if (session.start >= window.start && session.start <= window.end) sessions.push(session);
      }
    }
    return sessions.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return [];
}

/** Ids of rooms with a class overlapping `window`. Anything here is not free. */
/**
 * When one room is taken by teaching, over a window.
 *
 * The same walk as {@link busyRoomIds} from the other end: that one asks "which rooms are busy at
 * all", this one asks "when is this room busy". Kept as two functions rather than one general
 * shape because the callers want different things and a single function returning both would make
 * every caller filter.
 */
export function busyPeriodsFor(roomId: string, window: TimeWindow): Busy[] {
  const busy: Busy[] = [];

  for (const isoDate of datesIn(window)) {
    if (!isTeachingDay(isoDate)) continue;
    const weekday = campusLocalParts(campusInstant(isoDate, '12:00')).weekday;
    for (const entry of weeklyPattern()) {
      if (entry.weekday !== weekday || entry.roomId !== roomId) continue;
      const session = toSession(entry, isoDate);
      if (session.start < window.end && session.end > window.start) {
        busy.push({ start: session.start, end: session.end, label: session.courseCode });
      }
    }
  }

  return busy.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function busyRoomIds(window: TimeWindow): Set<string> {
  const busy = new Set<string>();

  for (const isoDate of datesIn(window)) {
    if (!isTeachingDay(isoDate)) continue;
    const weekday = campusLocalParts(campusInstant(isoDate, '12:00')).weekday;
    for (const entry of weeklyPattern()) {
      if (entry.weekday !== weekday) continue;
      const session = toSession(entry, isoDate);
      const overlaps = session.start < window.end && session.end > window.start;
      if (overlaps) busy.add(entry.roomId);
    }
  }
  return busy;
}
