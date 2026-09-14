/**
 * Wall-clock arithmetic in an institution's own time zone.
 *
 * Extracted when the second adapter needed it: this logic was written for San Telmo and
 * `Europe/Madrid`, and Carrigmore runs on `Europe/Dublin`. Parameterising the zone rather than
 * copying the functions is the difference between a seam and two implementations that drift.
 *
 * No dependency: `Intl` already knows every zone and every transition, and a date library would be
 * a lot of surface inside a distroless image for arithmetic this small.
 */

export interface LocalParts {
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekday: number;
  /** Minutes since local midnight. */
  readonly minutes: number;
  /** `YYYY-MM-DD` as read on the local clock. */
  readonly isoDate: string;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** What the clock in `timeZone` reads at the instant `at`. */
export function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour')) % 24;

  return {
    weekday: WEEKDAYS[get('weekday')] ?? 0,
    minutes: hour * 60 + Number(get('minute')),
    isoDate: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/**
 * The instant at which the clock in `timeZone` reads `isoDate` at `hhmm`.
 *
 * Converges in two passes. One is not enough: the first correction can itself cross a daylight
 * saving transition, which is exactly the case that bites an academic calendar running from
 * September to June.
 */
export function instantAt(isoDate: string, hhmm: string, timeZone: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const [hour, minute] = hhmm.split(':').map(Number) as [number, number];
  const target = Date.UTC(year, month - 1, day, hour, minute);

  let guess = target;
  for (let pass = 0; pass < 2; pass++) {
    const local = localParts(new Date(guess), timeZone);
    const actual = Date.UTC(
      Number(local.isoDate.slice(0, 4)),
      Number(local.isoDate.slice(5, 7)) - 1,
      Number(local.isoDate.slice(8, 10)),
      Math.floor(local.minutes / 60),
      local.minutes % 60,
    );
    guess += target - actual;
  }
  return new Date(guess);
}

/** Minutes since midnight for an `HH:MM` string. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** `HH:MM` opening and closing times, or `null` when closed that day. */
export interface DayHours {
  readonly open: string;
  readonly close: string;
}

/** Seven entries, index 0 = Sunday … 6 = Saturday. */
export type OpeningHours = readonly (DayHours | null)[];

/** Builds a week from the common shape: same hours Monday to Friday, then each weekend day. */
export function weekOf(
  weekday: DayHours | null,
  saturday: DayHours | null,
  sunday: DayHours | null,
): OpeningHours {
  return [sunday, weekday, weekday, weekday, weekday, weekday, saturday];
}

/**
 * Whether `hours` cover the whole of [from, to] in `timeZone`.
 *
 * A window spanning two local days is never covered: opening hours are per-day, and something that
 * runs past midnight needs an answer this function has no business inventing.
 */
export function isOpenThroughout(
  hours: OpeningHours,
  from: Date,
  to: Date,
  timeZone: string,
): boolean {
  const start = localParts(from, timeZone);
  const end = localParts(to, timeZone);

  if (start.isoDate !== end.isoDate) return false;

  const today = hours[start.weekday];
  if (!today) return false;

  return start.minutes >= minutesOf(today.open) && end.minutes <= minutesOf(today.close);
}
