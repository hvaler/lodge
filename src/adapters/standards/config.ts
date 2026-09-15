/**
 * How an institution configures the `standards` adapter.
 *
 * This is the file the runbook promises an IT lead writes: a few paths and credentials, no code.
 * Everything here maps onto something institutions already run — iCalendar feeds, an LDAP
 * directory, a room inventory in a table.
 *
 * The important part is {@link capabilitiesFor}: the declared capabilities are *derived from what
 * was configured*, not from a list in the source. An institution that gives us calendars and a room
 * table but no directory genuinely cannot answer "what do I have tomorrow", and the tool simply is
 * not published. That is what makes ADR-004 mean something at runtime rather than in a README.
 */

import type { Capability, ProviderDescriptor } from '../../provider/index.ts';

export interface InventorySource {
  /** Path or URL to a CSV of rooms. Columns are described in `fixtures/README.md`. */
  readonly location: string;
}

export interface CalendarSource {
  /** Path or URL to an `.ics` feed of teaching sessions. Recurrence is expanded. */
  readonly timetable?: string;
  /** Path or URL to an `.ics` feed of administrative dates. */
  readonly deadlines?: string;
}

export interface DirectorySource {
  /** e.g. `ldap://localhost:389`. */
  readonly url: string;
  readonly bindDN: string;
  readonly bindPassword: string;
  /** Where people live, e.g. `ou=people,dc=carrigmore,dc=ie`. */
  readonly baseDN: string;
}

export interface StandardsConfig {
  readonly institution: string;
  /** BCP 47, e.g. `en-IE`. Drives how dates and times are spoken. */
  readonly locale: string;
  /** IANA zone, e.g. `Europe/Dublin`. */
  readonly timeZone: string;

  readonly inventory?: InventorySource;
  readonly calendars?: CalendarSource;
  readonly directory?: DirectorySource;
}

/**
 * What this configuration can actually answer.
 *
 * Note what is missing and why:
 *
 * - `timetable` needs both a feed **and** a directory. A timetable feed alone cannot tell us which
 *   sessions belong to the person asking, and UC-02 forbids taking a name as a parameter — so
 *   without a directory the honest answer is that the tool does not exist here.
 * - `issues` never appears. Reading a queue is one thing; writing into the one maintenance already
 *   watches is an integration per institution, and the runbook puts that after the hackathon.
 *   An institution with no issue tracker must never see the agent offer to file a fault.
 */
export interface Available {
  /**
   * Whether people can actually be looked up.
   *
   * Separate from `config.directory` because a configuration block is a statement of intent and
   * this is the fact: what enables attributing a timetable to someone is a working lookup, not a
   * line in a file. They coincide in a real deployment, and keeping them distinct is what lets a
   * caller supply a lookup some other way.
   */
  readonly directory?: boolean;
}

export function capabilitiesFor(config: StandardsConfig, available: Available = {}): Capability[] {
  const capabilities: Capability[] = [];
  const hasDirectory = available.directory ?? Boolean(config.directory);

  // Directions need only the table: a room knows its building and its floor.
  if (config.inventory) capabilities.push('wayfinding');

  // Finding a *free* room needs occupancy too. With the table alone we would know what rooms
  // exist and when the building opens, but not what is teaching in them — and UC-01 accepts no
  // occupied room in the answer. Publishing the tool anyway would mean confidently sending someone
  // to a room with a class in it, which is worse than not offering the tool at all.
  if (config.inventory && config.calendars?.timetable) capabilities.push('rooms');
  if (config.calendars?.deadlines) capabilities.push('deadlines');
  if (config.calendars?.timetable && hasDirectory) capabilities.push('timetable');

  return capabilities;
}

export function descriptorFor(config: StandardsConfig, available: Available = {}): ProviderDescriptor {
  return {
    id: 'standards',
    institution: config.institution,
    locale: config.locale,
    timeZone: config.timeZone,
    capabilities: capabilitiesFor(config, available),
  };
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Rejects a configuration that would publish nothing, with an error that says what to add.
 *
 * Failing at start-up with a useful message is the difference between an institution adopting this
 * in an afternoon and giving up on it — which is the whole bet of the project.
 */
export function assertConfigUsable(config: StandardsConfig): void {
  if (capabilitiesFor(config).length > 0) return;

  const missing: string[] = [];
  if (!config.inventory) missing.push('an `inventory` CSV would enable directions');
  if (!config.inventory || !config.calendars?.timetable) {
    missing.push('an `inventory` CSV *and* a `calendars.timetable` feed would enable room search');
  }
  if (!config.calendars?.deadlines) missing.push('a `calendars.deadlines` feed would enable deadlines');
  if (!config.calendars?.timetable || !config.directory) {
    missing.push('a `calendars.timetable` feed *and* a `directory` would enable timetables');
  }

  throw new ConfigurationError(
    `Nothing is configured for '${config.institution}', so no tools would be published. ${missing.join('; ')}.`,
  );
}
