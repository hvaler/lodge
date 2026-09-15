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
import { createStandardsProvider } from '../adapters/standards/index.ts';
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

const standardsSchema = z.object({
  institution: z.string(),
  locale: z.string().describe('BCP 47, e.g. en-IE'),
  timeZone: z.string().describe('IANA zone, e.g. Europe/Dublin'),
  inventory: z.object({ location: z.string() }).optional(),
  calendars: z
    .object({
      timetable: z.string().optional(),
      deadlines: z.string().optional(),
    })
    .optional(),
  directory: directorySchema.optional(),
});

/** One institution: which adapter, and where its sources live. */
const institutionSchema = z.object({
  adapter: z.enum(['synthetic', 'standards']),
  standards: standardsSchema.optional(),
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
    ...(standards.inventory ? { inventory: standards.inventory } : {}),
    ...(standards.calendars
      ? {
          calendars: {
            ...(standards.calendars.timetable ? { timetable: standards.calendars.timetable } : {}),
            ...(standards.calendars.deadlines ? { deadlines: standards.calendars.deadlines } : {}),
          },
        }
      : {}),
    ...(standards.directory ? { directory: standards.directory } : {}),
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
