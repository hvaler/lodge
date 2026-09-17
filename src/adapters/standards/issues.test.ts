/**
 * Filing faults outward, against servers that answer.
 *
 * Both destinations are exercised over a real socket rather than a stubbed `fetch`. That is L-002
 * applied before it costs anything this time: a mocked fetch proves our mock agrees with us, and
 * the interesting failures here — a non-2xx, a body without the field we need, an endpoint that is
 * simply not there — are all things a fake would have to be told to do.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InvalidRequestError, NotFoundError, UnauthenticatedError } from '../../provider/index.ts';
import type { RequestContext } from '../../provider/index.ts';
import { capabilitiesFor } from './config.ts';
import type { StandardsConfig } from './config.ts';
import { createStandardsProvider } from './index.ts';
import { IssueSinkError, createJiraTracker, createWebhookSink } from './issues.ts';

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures/carrigmore');
const NOW = new Date('2026-10-06T15:30:00Z');

const REPORT = {
  roomId: 'QUA-G01',
  equipment: 'projector',
  reportedBy: 'u-1001',
  reportedAt: NOW,
  institution: 'Carrigmore College',
};

let servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((done) => s.close(() => done()))));
  servers = [];
});

/** Starts a server that records what it was sent and answers what the test says. */
async function serving(
  reply: (body: unknown, url: string) => { status?: number; json?: unknown; text?: string },
): Promise<{ url: string; received: { url: string; headers: Record<string, string>; body: unknown }[] }> {
  const received: { url: string; headers: Record<string, string>; body: unknown }[] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body: unknown = raw ? JSON.parse(raw) : null;
      received.push({
        url: req.url ?? '',
        headers: req.headers as Record<string, string>,
        body,
      });

      const answer = reply(body, req.url ?? '');
      res.writeHead(answer.status ?? 200, { 'content-type': 'application/json' });
      res.end(answer.text ?? JSON.stringify(answer.json ?? {}));
    });
  });

  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  return { url: `http://127.0.0.1:${address.port}`, received };
}

describe('the webhook destination', () => {
  it('files the fault and speaks back the reference the institution gave it', async () => {
    const { url } = await serving(() => ({ json: { reference: 'FM-4471' } }));
    const sink = createWebhookSink({ url, referenceField: 'reference' });

    expect(await sink.file(REPORT)).toBe('FM-4471');
  });

  it('sends a payload an institution can wire to something', async () => {
    const { url, received } = await serving(() => ({ json: { reference: 'x' } }));

    await createWebhookSink({ url, referenceField: 'reference' }).file({
      ...REPORT,
      note: 'flickers after ten minutes',
    });

    expect(received[0]?.body).toEqual({
      room: 'QUA-G01',
      equipment: 'projector',
      note: 'flickers after ten minutes',
      reportedBy: 'u-1001',
      reportedAt: '2026-10-06T15:30:00.000Z',
      institution: 'Carrigmore College',
      source: 'lodge',
    });
  });

  it('carries the headers the institution configured, which is where a shared secret goes', async () => {
    const { url, received } = await serving(() => ({ json: { reference: 'x' } }));

    await createWebhookSink({
      url,
      referenceField: 'reference',
      headers: { 'x-api-key': 'not-a-real-key' },
    }).file(REPORT);

    expect(received[0]?.headers['x-api-key']).toBe('not-a-real-key');
  });

  it('digs the reference out of a nested field', async () => {
    const { url } = await serving(() => ({ json: { data: { ticket: { id: 9912 } } } }));

    const reference = await createWebhookSink({ url, referenceField: 'data.ticket.id' }).file(REPORT);

    // A number is a perfectly good reference; it just has to be said out loud as a string.
    expect(reference).toBe('9912');
  });

  it('refuses to invent a reference when the endpoint returned none', async () => {
    // The reference is what somebody quotes to the service desk later. Making one up would hand
    // them a number that means nothing to the people they will quote it to.
    const { url } = await serving(() => ({ json: { ok: true } }));

    await expect(createWebhookSink({ url, referenceField: 'reference' }).file(REPORT)).rejects.toThrow(
      IssueSinkError,
    );
    await expect(createWebhookSink({ url, referenceField: 'reference' }).file(REPORT)).rejects.toThrow(
      /answered without 'reference'/,
    );
  });

  it('says so when the endpoint refuses the report', async () => {
    const { url } = await serving(() => ({ status: 403, json: { error: 'nope' } }));

    await expect(createWebhookSink({ url, referenceField: 'reference' }).file(REPORT)).rejects.toThrow(
      /answered 403/,
    );
  });

  it('says so when the endpoint is not there at all', async () => {
    const sink = createWebhookSink({ url: 'http://127.0.0.1:1/hook', referenceField: 'reference' });

    await expect(sink.file(REPORT)).rejects.toThrow(/could not be reached/);
  });

  it('says so when the endpoint answers something that is not JSON', async () => {
    const { url } = await serving(() => ({ text: '<html>maintenance</html>' }));

    await expect(createWebhookSink({ url, referenceField: 'reference' }).file(REPORT)).rejects.toThrow(
      /did not answer with JSON/,
    );
  });
});

describe('the Jira destination', () => {
  const source = (url: string) => ({
    url,
    project: 'FM',
    email: 'lodge@example.ie',
    token: 'not-a-real-token',
  });

  it('creates an issue in the configured project and speaks back its key', async () => {
    const { url, received } = await serving(() => ({ json: { id: '10001', key: 'FM-88' } }));

    expect(await createJiraTracker(source(url)).file(REPORT)).toBe('FM-88');

    const sent = received[0]!;
    expect(sent.url).toBe('/rest/api/3/issue');
    expect(sent.headers.authorization).toMatch(/^Basic /);
    const fields = (sent.body as { fields: Record<string, unknown> }).fields;
    expect(fields['project']).toEqual({ key: 'FM' });
    expect(fields['summary']).toBe('projector in QUA-G01');
  });

  it('labels the issue with who reported it, rather than needing them to exist in Jira', async () => {
    // Using Jira's `reporter` would mean a Jira account per student. A label is free.
    const { url, received } = await serving(() => ({ json: { key: 'FM-1' } }));

    await createJiraTracker(source(url)).file(REPORT);

    const fields = (received[0]!.body as { fields: Record<string, unknown> }).fields;
    expect(fields['labels']).toEqual(['lodge-u-1001', 'lodge']);
  });

  it('reads back only what that person reported', async () => {
    const { url, received } = await serving(() => ({
      json: {
        issues: [
          {
            key: 'FM-88',
            fields: {
              summary: 'projector in QUA-G01',
              created: '2026-10-06T15:30:00.000Z',
              status: { statusCategory: { key: 'indeterminate' } },
            },
          },
        ],
      },
    }));

    const theirs = await createJiraTracker(source(url)).openedBy('u-1001');

    expect(theirs).toEqual([
      {
        number: 'FM-88',
        roomId: 'QUA-G01',
        equipment: 'projector',
        status: 'in-progress',
        openedAt: new Date('2026-10-06T15:30:00.000Z'),
      },
    ]);
    // The privacy boundary is in the query, not in a filter applied afterwards.
    const { jql } = received[0]!.body as { jql: string };
    expect(jql).toContain('labels = "lodge-u-1001"');
    expect(jql).toContain('project = "FM"');
  });

  it('maps Jira status categories rather than status names, which projects rename freely', async () => {
    const categories = [
      ['new', 'open'],
      ['indeterminate', 'in-progress'],
      ['done', 'resolved'],
      ['something-else', 'open'],
    ] as const;

    for (const [category, expected] of categories) {
      const { url } = await serving(() => ({
        json: {
          issues: [
            {
              key: 'FM-1',
              fields: {
                summary: 'projector in QUA-G01',
                created: '2026-10-06T15:30:00.000Z',
                status: { statusCategory: { key: category } },
              },
            },
          ],
        },
      }));

      const [ticket] = await createJiraTracker(source(url)).openedBy('u-1001');
      expect(ticket?.status, category).toBe(expected);
    }
  });

  it('says so when Jira refuses, without repeating what it said', async () => {
    // Jira's error bodies carry field names and project configuration, and this message reaches a
    // person through a speaker.
    const { url } = await serving(() => ({ status: 400, json: { errors: { project: 'invalid' } } }));

    const failing = createJiraTracker(source(url)).file(REPORT);

    await expect(failing).rejects.toThrow(/answered 400/);
    await expect(failing).rejects.not.toThrow(/invalid/);
  });
});

describe('what an institution gets for configuring each one', () => {
  const base = {
    institution: 'Carrigmore College',
    locale: 'en-IE',
    timeZone: 'Europe/Dublin',
    inventory: { location: resolve(FIXTURES, 'rooms.csv') },
    calendars: { timetable: resolve(FIXTURES, 'timetable.ics') },
  } satisfies StandardsConfig;

  it('a webhook publishes reporting and not chasing', () => {
    // The whole reason ADR-017 split the capability: this institution can take a fault report and
    // genuinely cannot answer "how is mine going".
    const capabilities = capabilitiesFor({
      ...base,
      issues: { webhook: { url: 'https://desk.example.ie/hook', referenceField: 'id' } },
    });

    expect(capabilities).toContain('issue-reporting');
    expect(capabilities).not.toContain('issue-tracking');
  });

  it('Jira publishes both', () => {
    const capabilities = capabilitiesFor({
      ...base,
      issues: { jira: { url: 'https://x.atlassian.net', project: 'FM', email: 'a@b.ie', token: 't' } },
    });

    expect(capabilities).toContain('issue-reporting');
    expect(capabilities).toContain('issue-tracking');
  });

  it('nothing configured publishes neither', () => {
    expect(capabilitiesFor(base)).not.toContain('issue-reporting');
    expect(capabilitiesFor(base)).not.toContain('issue-tracking');
  });
});

describe('through the provider, as a tool would call it', () => {
  async function providerWith(url: string) {
    return createStandardsProvider({
      institution: 'Carrigmore College',
      locale: 'en-IE',
      timeZone: 'Europe/Dublin',
      inventory: { location: resolve(FIXTURES, 'rooms.csv') },
      calendars: { timetable: resolve(FIXTURES, 'timetable.ics') },
      issues: { webhook: { url, referenceField: 'reference' } },
    });
  }

  const ctx = (subject: string | null = 'u-1001'): RequestContext => ({
    principal: subject ? { subject } : null,
    now: NOW,
    locale: 'en-IE',
  });

  it('files a fault and returns a ticket carrying the institution’s own reference', async () => {
    const { url } = await serving(() => ({ json: { reference: 'SD-20260' } }));
    const provider = await providerWith(url);

    const ticket = await provider.reportIssue!(ctx(), {
      roomId: 'QUA-G01',
      equipment: 'projector',
    });

    expect(ticket.number).toBe('SD-20260');
    expect(ticket.roomId).toBe('QUA-G01');
    expect(ticket.status).toBe('open');
  });

  it('refuses a caller who named nobody, before touching the service desk', async () => {
    const { url, received } = await serving(() => ({ json: { reference: 'x' } }));
    const provider = await providerWith(url);

    await expect(
      provider.reportIssue!(ctx(null), { roomId: 'QUA-G01', equipment: 'projector' }),
    ).rejects.toThrow(UnauthenticatedError);
    expect(received).toHaveLength(0);
  });

  it('refuses a room that does not exist, before touching the service desk', async () => {
    const { url, received } = await serving(() => ({ json: { reference: 'x' } }));
    const provider = await providerWith(url);

    await expect(
      provider.reportIssue!(ctx(), { roomId: 'ZZZ-999', equipment: 'projector' }),
    ).rejects.toThrow(NotFoundError);
    expect(received).toHaveLength(0);
  });

  it('refuses equipment the room does not have, and says what it does have', async () => {
    const { url, received } = await serving(() => ({ json: { reference: 'x' } }));
    const provider = await providerWith(url);

    const failing = provider.reportIssue!(ctx(), { roomId: 'QUA-G01', equipment: 'kettle' });

    await expect(failing).rejects.toThrow(InvalidRequestError);
    await expect(failing).rejects.toThrow(/It has: /);
    // A maintenance ticket for a kettle that does not exist wastes somebody's morning.
    expect(received).toHaveLength(0);
  });

  it('publishes no chasing tool, because a webhook cannot answer one', async () => {
    const { url } = await serving(() => ({ json: { reference: 'x' } }));
    const provider = await providerWith(url);

    expect(provider.reportIssue).toBeTypeOf('function');
    expect(provider.issueStatus).toBeUndefined();
  });
});
