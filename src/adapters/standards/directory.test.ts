/**
 * The directory, against a stand-in server.
 *
 * The LDAP client is injected, so these run in CI with nothing installed. A real OpenLDAP is
 * exercised separately by `directory.integration.test.ts`, which skips itself when none is
 * listening — CI should not go red because a developer has no Docker running.
 */

import { describe, expect, it, vi } from 'vitest';

import type { DirectorySource } from './config.ts';
import { DirectoryError, createLdapDirectory, escapeFilterValue } from './directory.ts';
import type { LdapClient } from './directory.ts';

const SOURCE: DirectorySource = {
  url: 'ldap://localhost:1389',
  bindDN: 'cn=admin,dc=carrigmore,dc=ie',
  bindPassword: 'secret',
  baseDN: 'ou=people,dc=carrigmore,dc=ie',
};

/** Mirrors the LDIF fixture: people by uid, module groups by member DN. */
const PEOPLE: Record<string, string> = {
  'u-1001': 'uid=u-1001,ou=people,dc=carrigmore,dc=ie',
  'u-1002': 'uid=u-1002,ou=people,dc=carrigmore,dc=ie',
  'u-1003': 'uid=u-1003,ou=people,dc=carrigmore,dc=ie',
};

const MEMBERSHIPS: Record<string, string[]> = {
  'uid=u-1001,ou=people,dc=carrigmore,dc=ie': ['CS101', 'CS201'],
  'uid=u-1002,ou=people,dc=carrigmore,dc=ie': ['LAW101', 'LAW201'],
  'uid=u-1003,ou=people,dc=carrigmore,dc=ie': [],
};

interface Recorder {
  readonly binds: string[];
  readonly filters: string[];
  readonly connections: number;
}

function fakeServer(overrides: Partial<LdapClient> = {}): {
  connect: () => LdapClient;
  recorder: Recorder;
} {
  const binds: string[] = [];
  const filters: string[] = [];
  let connections = 0;

  const connect = (): LdapClient => {
    connections++;
    return {
      async bind(dn) {
        binds.push(dn);
      },
      async search(baseDN, options) {
        const filter = options.filter ?? '';
        filters.push(filter);

        const uid = /\(uid=([^)]*)\)/.exec(filter)?.[1];
        if (uid !== undefined) {
          const dn = PEOPLE[uid];
          return { searchEntries: dn ? [{ dn }] : [] };
        }

        const member = /\(member=([^)]*)\)/.exec(filter)?.[1] ?? '';
        const modules = MEMBERSHIPS[member] ?? [];
        return { searchEntries: modules.map((cn) => ({ cn })) };
      },
      async unbind() {},
      ...overrides,
    };
  };

  return {
    connect,
    recorder: {
      get binds() {
        return binds;
      },
      get filters() {
        return filters;
      },
      get connections() {
        return connections;
      },
    },
  };
}

describe('reading enrolment as group membership', () => {
  it('returns the modules a person is a member of', async () => {
    const { connect } = fakeServer();
    const directory = createLdapDirectory(SOURCE, { connect, cacheMs: 0 });

    expect(await directory.modulesFor('u-1001')).toEqual(['CS101', 'CS201']);
    expect(await directory.modulesFor('u-1002')).toEqual(['LAW101', 'LAW201']);
  });

  it('distinguishes "no record of you" from "you have no classes"', async () => {
    // Two very different answers: one is an unknown subject, the other a real student between
    // terms. Collapsing them would have the agent tell a registered student they do not exist.
    const { connect } = fakeServer();
    const directory = createLdapDirectory(SOURCE, { connect, cacheMs: 0 });

    expect(await directory.modulesFor('u-9999')).toBeNull();
    expect(await directory.modulesFor('u-1003')).toEqual([]);
  });

  it('binds before searching, using the configured credentials', async () => {
    const { connect, recorder } = fakeServer();
    const directory = createLdapDirectory(SOURCE, { connect, cacheMs: 0 });

    await directory.modulesFor('u-1001');

    expect(recorder.binds).toEqual([SOURCE.bindDN]);
  });

  it('looks up the person first and the groups by their DN', async () => {
    const { connect, recorder } = fakeServer();
    const directory = createLdapDirectory(SOURCE, { connect, cacheMs: 0 });

    await directory.modulesFor('u-1001');

    expect(recorder.filters[0]).toBe('(uid=u-1001)');
    expect(recorder.filters[1]).toBe('(member=uid=u-1001,ou=people,dc=carrigmore,dc=ie)');
  });

  it('honours a directory that names people by something other than uid', async () => {
    const { connect, recorder } = fakeServer();
    const directory = createLdapDirectory(SOURCE, {
      connect,
      cacheMs: 0,
      subjectAttribute: 'employeeNumber',
    });

    await directory.modulesFor('u-1001');

    expect(recorder.filters[0]).toBe('(employeeNumber=u-1001)');
  });

  it('derives the modules branch from the people branch', async () => {
    const { connect } = fakeServer();
    const searched: string[] = [];
    const spy = createLdapDirectory(SOURCE, {
      cacheMs: 0,
      connect: () => {
        const client = connect();
        return {
          ...client,
          async search(baseDN, options) {
            searched.push(baseDN);
            return client.search(baseDN, options);
          },
        };
      },
    });

    await spy.modulesFor('u-1001');

    expect(searched).toEqual(['ou=people,dc=carrigmore,dc=ie', 'ou=modules,dc=carrigmore,dc=ie']);
  });
});

describe('escaping the filter', () => {
  it('neutralises the characters that change what a filter means', () => {
    expect(escapeFilterValue('*')).toBe('\\2a');
    expect(escapeFilterValue('a)(b')).toBe('a\\29\\28b');
    expect(escapeFilterValue('back\\slash')).toBe('back\\5cslash');
  });

  it('leaves an ordinary subject untouched', () => {
    expect(escapeFilterValue('u-1001')).toBe('u-1001');
  });

  it('stops a wildcard subject from matching everybody', async () => {
    // The subject comes from an access token rather than a text box, but it is still interpolated
    // into a query language. Escaping costs nothing and removes the need to reason about who can
    // mint a token.
    const { connect, recorder } = fakeServer();
    const directory = createLdapDirectory(SOURCE, { connect, cacheMs: 0 });

    await directory.modulesFor('*');

    expect(recorder.filters[0]).toBe('(uid=\\2a)');
  });
});

describe('caching', () => {
  it('asks the directory once inside the window', async () => {
    // The platform budget is 500 ms for the whole round trip; a bind plus two searches on every
    // question would spend most of it.
    const { connect, recorder } = fakeServer();
    const directory = createLdapDirectory(SOURCE, { connect, cacheMs: 60_000 });

    await directory.modulesFor('u-1001');
    await directory.modulesFor('u-1001');
    await directory.modulesFor('u-1001');

    expect(recorder.connections).toBe(1);
  });

  it('asks again once the window has passed', async () => {
    vi.useFakeTimers();
    try {
      const { connect, recorder } = fakeServer();
      const directory = createLdapDirectory(SOURCE, { connect, cacheMs: 1_000 });

      await directory.modulesFor('u-1001');
      vi.advanceTimersByTime(1_500);
      await directory.modulesFor('u-1001');

      expect(recorder.connections).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps people apart', async () => {
    const { connect } = fakeServer();
    const directory = createLdapDirectory(SOURCE, { connect, cacheMs: 60_000 });

    expect(await directory.modulesFor('u-1001')).toEqual(['CS101', 'CS201']);
    expect(await directory.modulesFor('u-1002')).toEqual(['LAW101', 'LAW201']);
  });
});

describe('when the directory is unreachable', () => {
  it('says which server failed, and for whom', async () => {
    const { connect } = fakeServer({
      async bind() {
        throw new Error('ECONNREFUSED');
      },
    });
    const directory = createLdapDirectory(SOURCE, { connect, cacheMs: 0 });

    await expect(directory.modulesFor('u-1001')).rejects.toThrow(DirectoryError);
    await expect(directory.modulesFor('u-1001')).rejects.toThrow(/ldap:\/\/localhost:1389/);
  });

  it('keeps the original failure as the cause', async () => {
    const { connect } = fakeServer({
      async bind() {
        throw new Error('invalid credentials');
      },
    });
    const directory = createLdapDirectory(SOURCE, { connect, cacheMs: 0 });

    await expect(directory.modulesFor('u-1001')).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'invalid credentials' }),
    });
  });

  it('does not let a failed unbind hide the real error', async () => {
    const { connect } = fakeServer({
      async search() {
        throw new Error('search failed');
      },
      async unbind() {
        throw new Error('unbind also failed');
      },
    });
    const directory = createLdapDirectory(SOURCE, { connect, cacheMs: 0 });

    await expect(directory.modulesFor('u-1001')).rejects.toThrow(/Could not read the directory/);
  });
});
