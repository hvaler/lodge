/**
 * The configuration file an institution writes.
 *
 * The runbook promises deployment is "one config file and your own credentials". This is that
 * file: which adapter, and where its sources are. No code, no build step.
 *
 * Read once at start-up and validated loudly. An institution should learn its feed URL is wrong
 * when the container refuses to start, not the first time a student asks a question.
 *
 * Two shapes are accepted. An institution deploying Lodge for itself writes the plain one and gets
 * a server at `/mcp`. The multi-institution shape exists for UC-07 — the exchange student asking
 * the same question of two places — and serves each at `/mcp/{slug}`.
 */

import { readFile } from 'node:fs/promises';

import * as z from 'zod/v4';

import { createLdapDirectory } from '../adapters/standards/directory.ts';
import { ROOM_KINDS } from '../adapters/standards/inventory.ts';
import { createStandardsProvider } from '../adapters/standards/index.ts';
import type { InventorySource } from '../adapters/standards/config.ts';
import type { StandardsConfig } from '../adapters/standards/index.ts';
import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import type { Provider } from '../provider/index.ts';

const directorySchema = z.object({
  url: z.string().describe('e.g. ldap://directory.example.ie:389'),
  bindDN: z.string(),
  bindPassword: z.string(),
  baseDN: z.string().describe('Where people live, e.g. ou=people,dc=example,dc=ie'),
  groupsDN: z.string().optional().describe('Where module groups live. Defaults to ou=modules alongside.'),
  subjectAttribute: z.string().optional().describe('Attribute matching the token subject. Defaults to uid.'),
});

/**
 * Where a reported fault goes. Exactly one destination.
 *
 * A webhook can receive a report and cannot answer "how is mine going", so an institution that
 * configures one publishes `campus.report_issue` and not `campus.issue_status` (ADR-017). Jira can
 * do both.
 */
const issuesSchema = z
  .object({
    email: z
      .object({
        to: z.string().describe('The service desk address, e.g. servicedesk@example.ie'),
        from: z.string().describe('Who the message comes from'),
        host: z.string().describe('SMTP host'),
        port: z.number().int().positive().optional().describe('Defaults to 587'),
        secure: z.boolean().optional().describe('True for implicit TLS on 465'),
        user: z.string().optional(),
        password: z.string().optional(),
      })
      .optional(),
    webhook: z
      .object({
        url: z.url(),
        headers: z.record(z.string(), z.string()).optional(),
        referenceField: z
          .string()
          .describe('Field of the JSON answer carrying the reference, dotted: key, data.id'),
      })
      .optional(),
    jira: z
      .object({
        url: z.url().describe('e.g. https://example.atlassian.net'),
        project: z.string().describe('Project key faults are filed under, e.g. FM'),
        email: z.string().describe('Account the API token belongs to'),
        token: z.string(),
        issueType: z.string().optional().describe('Defaults to Task'),
      })
      .optional(),
  })
  .refine((issues) => [issues.email, issues.webhook, issues.jira].filter(Boolean).length === 1, {
    message:
      'needs exactly one destination — two would file the same broken projector twice, and none ' +
      'would publish a reporting tool with nowhere to report to',
  });

/**
 * The room table: a CSV, or the rooms written out here.
 *
 * Exactly one. A few hundred rooms belong in a spreadsheet; twelve do not deserve a second file.
 * Either way they end up as the same rooms through the same validator, so the rules about capacity,
 * floors and equipment live in one place — see `InlineRoom`.
 */
const inventorySchema = z
  .object({
    location: z.string().optional().describe('Path or URL to a CSV of rooms'),
    rooms: z
      .array(
        z.object({
          id: z.string().describe('Qualified and unique, e.g. QUA-G01'),
          building: z.string().describe('Building code, e.g. QUA'),
          buildingName: z.string().optional().describe('Said aloud when giving directions'),
          floor: z.number(),
          kind: z.enum(ROOM_KINDS),
          capacity: z.number(),
          equipment: z.array(z.string()).optional().describe("In the institution's own words"),
          supervised: z.boolean().optional().describe('Never offered as free'),
        }),
      )
      .optional(),
    buildings: z
      .array(
        z.object({
          code: z.string(),
          name: z.string(),
          weekdays: z.string().optional().describe('Opening hours as 08:00-21:00'),
          saturday: z.string().optional(),
          sunday: z.string().optional(),
        }),
      )
      .optional()
      .describe('Only alongside `rooms`. Without it every building is treated as always open'),
  })
  .refine((inventory) => [inventory.location, inventory.rooms].filter(Boolean).length === 1, {
    message:
      "needs either a 'location' pointing at a CSV or the rooms written out under 'rooms' — one " +
      'of the two, not both and not neither',
  });

const standardsSchema = z.object({
  institution: z.string(),
  locale: z.string().describe('BCP 47, e.g. en-IE'),
  timeZone: z.string().describe('IANA zone, e.g. Europe/Dublin'),
  inventory: inventorySchema.optional(),
  calendars: z
    .object({
      timetable: z.string().optional(),
      deadlines: z.string().optional(),
    })
    .optional(),
  directory: directorySchema.optional(),
  issues: issuesSchema.optional(),
});

/**
 * Who signs this institution's tokens.
 *
 * Optional, and its absence means the endpoint is unauthenticated — which several tools then
 * refuse on their own, because they ask `ctx.principal` rather than trusting the caller. That is a
 * legitimate way to run Lodge behind something else that authenticates, and it is announced loudly
 * at start-up rather than assumed.
 */
const authSchema = z.object({
  issuer: z.url().describe('The `iss` its tokens carry, e.g. https://login.example.ie'),
  jwksUri: z.url().describe('Where its signing keys are published'),
  scopes: z.array(z.string()).optional().describe('Scopes a token must carry to be accepted'),
  subjectClaim: z
    .string()
    .optional()
    .describe('Claim naming the person. Defaults to sub; set it when the directory keys on another'),
});

/** One institution: which adapter, where its sources live, and who vouches for its people. */
const institutionSchema = z.object({
  adapter: z.enum(['synthetic', 'standards']),
  standards: standardsSchema.optional(),
  auth: authSchema.optional(),
});

export type InstitutionConfig = z.infer<typeof institutionSchema>;

/** Slugs appear in URLs, so they are kept to what reads well and needs no escaping. */
const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase words joined by single hyphens');

const multiSchema = z.object({
  institutions: z.record(slugSchema, institutionSchema),
  /** Which one answers at bare `/mcp`. Defaults to the only one, when there is only one. */
  default: z.string().optional(),
});

export const lodgeConfigSchema = z.union([multiSchema, institutionSchema]);

export type LodgeConfig = {
  /** Slug → configuration. A single-institution file yields one entry under `default`. */
  readonly institutions: ReadonlyMap<string, InstitutionConfig>;
  /** Slug served at bare `/mcp`, or `null` when several are configured and none was named. */
  readonly defaultSlug: string | null;
};

export class ConfigFileError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConfigFileError';
  }
}

function assertUsable(slug: string, institution: InstitutionConfig, where: string): void {
  if (institution.adapter === 'standards' && !institution.standards) {
    throw new ConfigFileError(
      `${where}: '${slug}' selects the 'standards' adapter but has no 'standards' section describing where its sources are.`,
    );
  }
}

/** Parses and validates configuration, naming the field at fault. */
export function parseLodgeConfig(raw: unknown, where = 'the configuration'): LodgeConfig {
  const result = lodgeConfigSchema.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigFileError(`${where} is not valid: ${problems}`);
  }

  // The plain shape: one institution, served at `/mcp`.
  if (!('institutions' in result.data)) {
    assertUsable('default', result.data, where);
    return { institutions: new Map([['default', result.data]]), defaultSlug: 'default' };
  }

  const entries = Object.entries(result.data.institutions);
  if (entries.length === 0) {
    throw new ConfigFileError(`${where} configures no institutions, so the server would answer nothing.`);
  }

  for (const [slug, institution] of entries) assertUsable(slug, institution, where);

  const named = result.data.default;
  if (named !== undefined && !result.data.institutions[named]) {
    throw new ConfigFileError(
      `${where}: 'default' names '${named}', which is not one of ${entries.map(([s]) => `'${s}'`).join(', ')}.`,
    );
  }

  return {
    institutions: new Map(entries),
    // With one institution, bare `/mcp` obviously means it. With several and no choice made,
    // there is no honest default — answering as one of them would be a coin toss, so `/mcp`
    // simply says which paths exist.
    defaultSlug: named ?? (entries.length === 1 ? entries[0]![0] : null),
  };
}

export async function loadLodgeConfig(path: string): Promise<LodgeConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new ConfigFileError(`Could not read the configuration at '${path}'.`, { cause: error });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigFileError(`The configuration at '${path}' is not valid JSON.`, { cause: error });
  }

  return parseLodgeConfig(raw, `The configuration at '${path}'`);
}

/**
 * The same omit-rather-than-undefined dance as everywhere else in this file, applied per room.
 *
 * Nothing is validated here — that is `loadInventory`'s job, and doing it twice would mean two sets
 * of error messages for one mistake. This only turns what zod parsed into what the adapter's types
 * say, which under `exactOptionalPropertyTypes` is not the same object.
 */
function inventoryFrom(inventory: z.infer<typeof inventorySchema>): InventorySource {
  return {
    ...(inventory.location ? { location: inventory.location } : {}),
    ...(inventory.rooms
      ? {
          rooms: inventory.rooms.map((room) => ({
            id: room.id,
            building: room.building,
            floor: room.floor,
            kind: room.kind,
            capacity: room.capacity,
            ...(room.buildingName ? { buildingName: room.buildingName } : {}),
            ...(room.equipment ? { equipment: room.equipment } : {}),
            ...(room.supervised === undefined ? {} : { supervised: room.supervised }),
          })),
        }
      : {}),
    ...(inventory.buildings
      ? {
          buildings: inventory.buildings.map((building) => ({
            code: building.code,
            name: building.name,
            ...(building.weekdays ? { weekdays: building.weekdays } : {}),
            ...(building.saturday ? { saturday: building.saturday } : {}),
            ...(building.sunday ? { sunday: building.sunday } : {}),
          })),
        }
      : {}),
  };
}

/**
 * Builds the provider one institution asks for.
 *
 * The directory is only constructed when configured. The `standards` adapter derives its
 * capabilities from what it is given, so an institution that omits the directory gets a server
 * that never offers a timetable rather than one that offers it and fails.
 */
export async function createProviderFor(institution: InstitutionConfig): Promise<Provider> {
  if (institution.adapter === 'synthetic') return createSyntheticProvider();

  const standards = institution.standards!;

  const directory = standards.directory
    ? createLdapDirectory(standards.directory, {
        ...(standards.directory.groupsDN ? { groupsDN: standards.directory.groupsDN } : {}),
        ...(standards.directory.subjectAttribute
          ? { subjectAttribute: standards.directory.subjectAttribute }
          : {}),
      })
    : undefined;

  // Keys are omitted rather than set to undefined. Zod infers `inventory?: X | undefined`, and
  // with `exactOptionalPropertyTypes` that is a different type from `inventory?: X` — an absent
  // source and a source explicitly set to nothing are not the same statement about the world.
  const sources: StandardsConfig = {
    institution: standards.institution,
    locale: standards.locale,
    timeZone: standards.timeZone,
    ...(standards.inventory ? { inventory: inventoryFrom(standards.inventory) } : {}),
    ...(standards.calendars
      ? {
          calendars: {
            ...(standards.calendars.timetable ? { timetable: standards.calendars.timetable } : {}),
            ...(standards.calendars.deadlines ? { deadlines: standards.calendars.deadlines } : {}),
          },
        }
      : {}),
    ...(standards.directory ? { directory: standards.directory } : {}),
    // Same omit-rather-than-undefined dance as above, one level deeper: the destination is a
    // union of two optional shapes and only one of them is ever present.
    ...(standards.issues
      ? {
          issues: {
            ...(standards.issues.email
              ? {
                  email: {
                    to: standards.issues.email.to,
                    from: standards.issues.email.from,
                    host: standards.issues.email.host,
                    ...(standards.issues.email.port !== undefined
                      ? { port: standards.issues.email.port }
                      : {}),
                    ...(standards.issues.email.secure !== undefined
                      ? { secure: standards.issues.email.secure }
                      : {}),
                    ...(standards.issues.email.user ? { user: standards.issues.email.user } : {}),
                    ...(standards.issues.email.password
                      ? { password: standards.issues.email.password }
                      : {}),
                  },
                }
              : {}),
            ...(standards.issues.webhook
              ? {
                  webhook: {
                    url: standards.issues.webhook.url,
                    referenceField: standards.issues.webhook.referenceField,
                    ...(standards.issues.webhook.headers
                      ? { headers: standards.issues.webhook.headers }
                      : {}),
                  },
                }
              : {}),
            ...(standards.issues.jira
              ? {
                  jira: {
                    url: standards.issues.jira.url,
                    project: standards.issues.jira.project,
                    email: standards.issues.jira.email,
                    token: standards.issues.jira.token,
                    ...(standards.issues.jira.issueType
                      ? { issueType: standards.issues.jira.issueType }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  };

  return createStandardsProvider(sources, directory);
}

/** Builds every configured provider, in parallel. Slug → provider. */
export async function createProvidersFrom(config: LodgeConfig): Promise<Map<string, Provider>> {
  const built = await Promise.all(
    [...config.institutions].map(
      async ([slug, institution]) => [slug, await createProviderFor(institution)] as const,
    ),
  );
  return new Map(built);
}

/** Where the configuration lives. Absent means the synthetic reference institution. */
export function configPathFrom(env: NodeJS.ProcessEnv): string | null {
  return env['LODGE_CONFIG'] ?? null;
}
