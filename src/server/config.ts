/**
 * The configuration file an institution writes.
 *
 * The runbook promises deployment is "one config file and your own credentials". This is that
 * file: which adapter, and where its sources are. No code, no build step.
 *
 * Read once at start-up and validated loudly. An institution should learn its feed URL is wrong
 * when the container refuses to start, not the first time a student asks a question.
 */

import { readFile } from 'node:fs/promises';

import * as z from 'zod/v4';

import { createStandardsProvider } from '../adapters/standards/index.ts';
import type { StandardsConfig } from '../adapters/standards/index.ts';
import { createLdapDirectory } from '../adapters/standards/directory.ts';
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

export const lodgeConfigSchema = z.object({
  adapter: z.enum(['synthetic', 'standards']),
  standards: standardsSchema.optional(),
});

export type LodgeConfig = z.infer<typeof lodgeConfigSchema>;

export class ConfigFileError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConfigFileError';
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

  if (result.data.adapter === 'standards' && !result.data.standards) {
    throw new ConfigFileError(
      `${where} selects the 'standards' adapter but has no 'standards' section describing where its sources are.`,
    );
  }

  return result.data;
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
 * Builds the provider a configuration asks for.
 *
 * Note the directory is only constructed when configured. The `standards` adapter derives its
 * capabilities from what it is given, so an institution that omits the directory gets a server
 * that never offers a timetable rather than one that offers it and fails.
 */
export async function createProviderFrom(config: LodgeConfig): Promise<Provider> {
  if (config.adapter === 'synthetic') return createSyntheticProvider();

  const standards = config.standards!;

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

/** Where the configuration lives. Absent means the synthetic reference institution. */
export function configPathFrom(env: NodeJS.ProcessEnv): string | null {
  return env['LODGE_CONFIG'] ?? null;
}
