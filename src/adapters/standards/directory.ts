/**
 * The LDAP directory.
 *
 * What it answers is narrow on purpose: which modules a subject is enrolled in. That is the one
 * fact the timetable feed cannot supply, and it is what turns "these classes exist" into "these
 * are yours" without ever taking a name as a parameter (UC-02).
 *
 * Enrolment is read as **group membership**, which is how directories actually model it: a
 * `groupOfNames` per module, with the person's DN in `member`. No custom schema, nothing to
 * install — the runbook's whole bet is that an institution configures this rather than builds it.
 *
 * This is also the first thing to go if M2 runs past 4 October (cut rule 1), which is why it was
 * built last and why nothing else depends on it: dropping it costs the timetable tool and leaves
 * the other three standing.
 */

import { Client } from 'ldapts';

import type { DirectorySource } from './config.ts';
import type { DirectoryLookup } from './index.ts';

export class DirectoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DirectoryError';
  }
}

/** The slice of an LDAP client this needs. Narrow so a test can stand in for a server. */
export interface LdapClient {
  bind(dn: string, password: string): Promise<void>;
  search(
    baseDN: string,
    options: { scope?: string; filter?: string; attributes?: string[] },
  ): Promise<{ searchEntries: Record<string, unknown>[] }>;
  unbind(): Promise<void>;
}

export interface LdapDirectoryOptions {
  /** Attribute holding the subject from the access token. `uid` in most directories. */
  readonly subjectAttribute?: string;
  /** Where the module groups live. Defaults to `ou=modules` under the people base's parent. */
  readonly groupsDN?: string;
  /** Attribute on the group naming the module. `cn` by convention. */
  readonly moduleAttribute?: string;
  /**
   * How long an answer stays good.
   *
   * Enrolments change a few times a term, and the platform budget is 500 ms for the whole round
   * trip — a bind plus two searches on every question would spend most of it. A minute is long
   * enough to matter and short enough that a student who just registered is not told otherwise
   * for the rest of the day.
   */
  readonly cacheMs?: number;
  /** Injected in tests. Defaults to a real `ldapts` client. */
  readonly connect?: () => LdapClient;
}

/**
 * Escapes a value for an LDAP filter, per RFC 4515.
 *
 * The subject arrives from an access token, so it is not arbitrary user input — but it is still
 * interpolated into a query language, and `*` alone would turn a lookup for one person into a
 * match on everybody. Escaping is cheaper than reasoning about who can mint a token.
 */
export function escapeFilterValue(value: string): string {
  return [...value]
    .map((char) => {
      switch (char) {
        case '\\':
          return '\\5c';
        case '*':
          return '\\2a';
        case '(':
          return '\\28';
        case ')':
          return '\\29';
        case '\0':
          return '\\00';
        default:
          return char;
      }
    })
    .join('');
}

/** `ou=people,dc=carrigmore,dc=ie` → `ou=modules,dc=carrigmore,dc=ie`. */
function defaultGroupsDN(baseDN: string): string {
  const parts = baseDN.split(',');
  return parts.length > 1 ? ['ou=modules', ...parts.slice(1)].join(',') : baseDN;
}

function asStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

export function createLdapDirectory(
  source: DirectorySource,
  options: LdapDirectoryOptions = {},
): DirectoryLookup & { close(): Promise<void> } {
  const subjectAttribute = options.subjectAttribute ?? 'uid';
  const moduleAttribute = options.moduleAttribute ?? 'cn';
  const groupsDN = options.groupsDN ?? defaultGroupsDN(source.baseDN);
  const cacheMs = options.cacheMs ?? 60_000;
  const connect = options.connect ?? ((): LdapClient => new Client({ url: source.url }) as unknown as LdapClient);

  const cache = new Map<string, { at: number; modules: readonly string[] | null }>();

  async function lookUp(subject: string): Promise<readonly string[] | null> {
    // A fresh connection per lookup. The server is stateless by design and replicas come and go;
    // a pooled connection would be one more thing to reason about for a saving the cache already
    // makes irrelevant.
    const client = connect();

    try {
      await client.bind(source.bindDN, source.bindPassword);

      const person = await client.search(source.baseDN, {
        scope: 'sub',
        filter: `(${subjectAttribute}=${escapeFilterValue(subject)})`,
        attributes: ['dn'],
      });

      const dn = person.searchEntries[0]?.['dn'];
      // Unknown subject is `null`, distinct from a known person enrolled in nothing, which is an
      // empty list. One is "I have no record of you", the other is "you have no classes".
      if (typeof dn !== 'string') return null;

      const groups = await client.search(groupsDN, {
        scope: 'sub',
        filter: `(member=${escapeFilterValue(dn)})`,
        attributes: [moduleAttribute],
      });

      return groups.searchEntries.flatMap((entry) => asStrings(entry[moduleAttribute]));
    } catch (error) {
      throw new DirectoryError(
        `Could not read the directory at '${source.url}' for subject '${subject}'.`,
        { cause: error },
      );
    } finally {
      // Never let a failed unbind mask the real error above.
      await client.unbind().catch(() => undefined);
    }
  }

  return {
    async modulesFor(subject) {
      const hit = cache.get(subject);
      if (hit && Date.now() - hit.at < cacheMs) return hit.modules;

      const modules = await lookUp(subject);
      cache.set(subject, { at: Date.now(), modules });
      return modules;
    },

    async close() {
      cache.clear();
    },
  };
}
