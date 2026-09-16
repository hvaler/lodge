/**
 * Reading iCalendar feeds.
 *
 * What an institution already publishes: a timetable feed from the scheduling system and a feed of
 * key dates from the registry. Recurrence is expanded, exceptions are honoured, and all-day dates
 * are re-anchored — see {@link writtenDateOf}, which is the subtle one.
 */

import ical from 'node-ical';

import type { Deadline, Session, TimeWindow } from '../../provider/index.ts';
import { instantAt, localParts } from '../../shared/time.ts';
import { traced } from '../../telemetry/index.ts';
import { readSource } from './source.ts';

export class CalendarError extends Error {
  constructor(location: string, cause: string) {
    super(`The calendar at '${location}' could not be used: ${cause}`);
    this.name = 'CalendarError';
  }
}

/** The zone this process happens to run in. Only used to undo node-ical's own assumption. */
const PROCESS_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Recovers the calendar date as *written in the file* from an all-day event.
 *
 * node-ical turns `DTSTART;VALUE=DATE:20261002` into local midnight **in the process time zone**,
 * so the same file yields a different instant on a container in Madrid than on one in Dublin. For a
 * deadline that is an off-by-one day, which is precisely the harm UC-03 exists to prevent: a
 * confidently wrong date is worse than no answer.
 *
 * Formatting the parsed instant back in the process zone inverts exactly that transformation and
 * recovers `2026-10-02`, whatever the container's clock is set to.
 */
function writtenDateOf(at: Date, processTimeZone = PROCESS_TIMEZONE): string {
  return localParts(at, processTimeZone).isoDate;
}

/** Shifts an ISO date by whole days, staying in calendar arithmetic. */
function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

interface ParsedEvent {
  readonly type?: string;
  readonly uid?: string;
  readonly summary?: string;
  readonly location?: string;
  readonly categories?: string[];
  readonly start: Date & { tz?: string };
  readonly end: Date;
  readonly datetype?: string;
  readonly rrule?: { between(after: Date, before: Date, inclusive?: boolean): Date[] };
  readonly exdate?: Record<string, Date>;
}

/**
 * Where a feed comes from, safe to put in a span.
 *
 * The host and not the URL: an iCalendar feed URL routinely carries the subscription token that
 * makes it work, and a trace is somewhere those get kept, searched and shared.
 */
function sourceLabel(location: string): string {
  try {
    return new URL(location).host || 'file';
  } catch {
    return 'file';
  }
}

async function parse(location: string): Promise<ParsedEvent[]> {
  return traced('icalendar.parse', { 'lodge.calendar.source': sourceLabel(location) }, async () =>
    parseUncached(location),
  );
}

async function parseUncached(location: string): Promise<ParsedEvent[]> {
  const text = await readSource(location);
  let parsed: Record<string, unknown>;
  try {
    parsed = ical.sync.parseICS(text) as Record<string, unknown>;
  } catch (error) {
    throw new CalendarError(location, error instanceof Error ? error.message : 'not valid iCalendar');
  }

  const events = Object.values(parsed).filter(
    (entry): entry is ParsedEvent =>
      typeof entry === 'object' && entry !== null && (entry as ParsedEvent).type === 'VEVENT',
  );

  if (events.length === 0) throw new CalendarError(location, 'it contains no events');
  return events;
}

// ── deadlines ────────────────────────────────────────────────────────────────

/**
 * Administrative dates.
 *
 * All-day events are the normal shape here, and RFC 5545 makes `DTEND` **exclusive** on them: a
 * date range ending `20270123` finishes on the 22nd. Getting that wrong would put every multi-day
 * entry a day long.
 */
export async function loadDeadlines(location: string, timeZone: string): Promise<Deadline[]> {
  const events = await parse(location);

  return events
    .map((event, index): Deadline => {
      const id = event.uid?.split('@')[0] ?? `deadline-${index}`;
      const label = event.summary?.trim() || 'Untitled date';

      if (event.datetype === 'date') {
        const startDate = writtenDateOf(event.start);
        const lastDay = shiftDate(writtenDateOf(event.end), -1);
        const closesOn = instantAt(lastDay, '23:59', timeZone);

        // A single-day entry has no meaningful opening date; a range does.
        return startDate === lastDay
          ? { id, label, closesOn }
          : { id, label, closesOn, opensOn: instantAt(startDate, '00:00', timeZone) };
      }

      // A timed entry means what it says: the instant already carries its zone.
      return event.start.getTime() === event.end.getTime()
        ? { id, label, closesOn: event.end }
        : { id, label, closesOn: event.end, opensOn: event.start };
    })
    .sort((a, b) => a.closesOn.getTime() - b.closesOn.getTime());
}

// ── timetable ────────────────────────────────────────────────────────────────

export interface TimetableFeed {
  /** The modules this feed knows about, for checking a directory against reality. */
  readonly modules: readonly string[];
  /** Concrete sessions for the given modules inside the window, chronological. */
  sessionsFor(modules: readonly string[], window: TimeWindow): Session[];
}

/**
 * Teaching sessions.
 *
 * The module code comes from `CATEGORIES`, which is where a scheduling system puts it and, more to
 * the point, the key the directory uses to say who is enrolled in what. That is why `timetable`
 * needs a feed *and* a directory: this file alone cannot say whose class it is, and UC-02 forbids
 * taking a name as a parameter.
 */
export async function loadTimetable(location: string, _timeZone: string): Promise<TimetableFeed> {
  const events = await parse(location);

  const entries = events.map((event) => ({
    module: (event.categories?.[0] ?? event.summary?.split(' ')[0] ?? '').trim(),
    roomId: event.location?.trim() ?? '',
    summary: event.summary?.trim() ?? '',
    start: event.start,
    durationMs: event.end.getTime() - event.start.getTime(),
    rrule: event.rrule,
    // A cancelled class is the failure that matters: telling someone to turn up to one is worse
    // than saying nothing. EXDATEs are compared on the instant, which is how node-ical gives them.
    excluded: new Set(Object.values(event.exdate ?? {}).map((d) => d.getTime())),
  }));

  const modules = [...new Set(entries.map((e) => e.module).filter(Boolean))];

  return {
    modules,
    sessionsFor(wanted, window) {
      const want = new Set(wanted);
      const sessions: Session[] = [];

      for (const entry of entries) {
        if (!want.has(entry.module)) continue;

        const starts = entry.rrule
          ? entry.rrule.between(window.start, window.end, true)
          : entry.start >= window.start && entry.start <= window.end
            ? [entry.start]
            : [];

        for (const start of starts) {
          if (entry.excluded.has(start.getTime())) continue;
          sessions.push({
            start,
            end: new Date(start.getTime() + entry.durationMs),
            roomId: entry.roomId,
            courseCode: entry.module,
          });
        }
      }

      return sessions.sort((a, b) => a.start.getTime() - b.start.getTime());
    },
  };
}
