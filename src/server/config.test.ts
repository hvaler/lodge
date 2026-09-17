/**
 * The configuration file, as an institution writes it.
 *
 * This is the surface an adopter touches before they touch anything else, and the promise around it
 * is that a mistake stops the container rather than surfacing the first time somebody asks a
 * question. These tests are about the message they get.
 */

import { describe, expect, it } from 'vitest';

import { ConfigFileError, parseLodgeConfig } from './config.ts';

const CARRIGMORE = {
  adapter: 'standards' as const,
  standards: {
    institution: 'Carrigmore College',
    locale: 'en-IE',
    timeZone: 'Europe/Dublin',
    inventory: { location: '/srv/rooms.csv' },
    calendars: { timetable: '/srv/timetable.ics' },
  },
};

describe('where faults go', () => {
  it('accepts an email address, which is the one every institution already has', () => {
    const config = parseLodgeConfig({
      ...CARRIGMORE,
      standards: {
        ...CARRIGMORE.standards,
        issues: {
          email: {
            to: 'facilities@carrigmore.ie',
            from: 'lodge@carrigmore.ie',
            host: 'smtp.carrigmore.ie',
          },
        },
      },
    });

    expect(config.institutions.get('default')?.standards?.issues?.email?.to).toBe(
      'facilities@carrigmore.ie',
    );
  });

  it('accepts a webhook', () => {
    const config = parseLodgeConfig({
      ...CARRIGMORE,
      standards: {
        ...CARRIGMORE.standards,
        issues: { webhook: { url: 'https://desk.example.ie/faults', referenceField: 'id' } },
      },
    });

    expect(config.institutions.get('default')?.standards?.issues?.webhook?.url).toBe(
      'https://desk.example.ie/faults',
    );
  });

  it('accepts Jira', () => {
    const config = parseLodgeConfig({
      ...CARRIGMORE,
      standards: {
        ...CARRIGMORE.standards,
        issues: {
          jira: {
            url: 'https://example.atlassian.net',
            project: 'FM',
            email: 'lodge@example.ie',
            token: 'not-a-real-token',
          },
        },
      },
    });

    expect(config.institutions.get('default')?.standards?.issues?.jira?.project).toBe('FM');
  });

  it('refuses two destinations, and says why', () => {
    // Two would file the same broken projector twice, and somebody would close one of them.
    const parsing = (): unknown =>
      parseLodgeConfig({
        ...CARRIGMORE,
        standards: {
          ...CARRIGMORE.standards,
          issues: {
            email: { to: 'a@b.ie', from: 'c@d.ie', host: 'smtp.example.ie' },
            webhook: { url: 'https://desk.example.ie/faults', referenceField: 'id' },
          },
        },
      });

    expect(parsing).toThrow(ConfigFileError);
    expect(parsing).toThrow(/exactly one destination/);
  });

  it('refuses none at all, rather than publishing a tool with nowhere to report to', () => {
    expect(() =>
      parseLodgeConfig({
        ...CARRIGMORE,
        standards: { ...CARRIGMORE.standards, issues: {} },
      }),
    ).toThrow(/exactly one destination/);
  });

  it('refuses a webhook with no reference field, since it would have nothing to speak back', () => {
    expect(() =>
      parseLodgeConfig({
        ...CARRIGMORE,
        standards: {
          ...CARRIGMORE.standards,
          issues: { webhook: { url: 'https://desk.example.ie/faults' } },
        },
      }),
    ).toThrow(ConfigFileError);
  });

  it('names the field at fault rather than dumping the schema', () => {
    // An institution's IT lead reads this message at half past six on a Friday.
    const parsing = (): unknown =>
      parseLodgeConfig({
        ...CARRIGMORE,
        standards: {
          ...CARRIGMORE.standards,
          issues: { webhook: { url: 'not a url', referenceField: 'id' } },
        },
      });

    expect(parsing).toThrow(/standards\.issues\.webhook\.url/);
  });

  it('is optional, and its absence publishes no fault tools at all', () => {
    const config = parseLodgeConfig(CARRIGMORE);

    expect(config.institutions.get('default')?.standards?.issues).toBeUndefined();
  });
});

describe('the shape of the file', () => {
  it('reads the plain shape as one institution served at /mcp', () => {
    const config = parseLodgeConfig(CARRIGMORE);

    expect([...config.institutions.keys()]).toEqual(['default']);
    expect(config.defaultSlug).toBe('default');
  });

  it('refuses a standards institution with no sources section', () => {
    expect(() => parseLodgeConfig({ adapter: 'standards' })).toThrow(
      /selects the 'standards' adapter but has no 'standards' section/,
    );
  });

  it('serves several institutions and picks no default when none was named', () => {
    const config = parseLodgeConfig({
      institutions: { carrigmore: CARRIGMORE, 'san-telmo': { adapter: 'synthetic' } },
    });

    // Answering as one of them would be a coin toss with somebody's timetable.
    expect(config.defaultSlug).toBeNull();
    expect([...config.institutions.keys()].sort()).toEqual(['carrigmore', 'san-telmo']);
  });
});
