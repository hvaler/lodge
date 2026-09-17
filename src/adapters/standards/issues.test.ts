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
import { createServer as createSocketServer } from 'node:net';
import type { Server as SocketServer } from 'node:net';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InvalidRequestError, NotFoundError, UnauthenticatedError } from '../../provider/index.ts';
import type { RequestContext } from '../../provider/index.ts';
import { capabilitiesFor } from './config.ts';
import type { StandardsConfig } from './config.ts';
import { createStandardsProvider } from './index.ts';
import {
  IssueSinkError,
  createEmailSink,
  createJiraTracker,
  createWebhookSink,
} from './issues.ts';

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures/carrigmore');
const NOW = new Date('2026-10-06T15:30:00Z');

const REPORT = {
  roomId: 'QUA-G01',
  equipment: 'projector',
  reportedBy: 'u-1001',
  reportedAt: NOW,
  institution: 'Carrigmore College',
};

let servers: (Server | SocketServer)[] = [];

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

/**
 * Enough SMTP to take one message: greet, accept the envelope, swallow the body.
 *
 * Written out rather than mocked because the point of this one test is the wire. A stubbed
 * transport proves our stub agrees with us; this proves nodemailer and a socket agree with each
 * other, which is where an institution's first attempt actually fails.
 */
async function smtpServer(): Promise<{ port: number; messages: string[] }> {
  const messages: string[] = [];

  const server = createSocketServer((socket) => {
    let body: string[] | null = null;
    let buffer = '';

    socket.write('220 localhost ESMTP test\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let cut: number;
      while ((cut = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);

        if (body !== null) {
          if (line === '.') {
            messages.push(body.join('\n'));
            body = null;
            socket.write('250 Queued\r\n');
          } else {
            body.push(line);
          }
          continue;
        }

        const verb = line.slice(0, 4).toUpperCase();
        // No STARTTLS advertised, so nodemailer stays in plaintext on a loopback port.
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250-localhost\r\n250 SIZE 10240000\r\n');
        else if (verb === 'MAIL' || verb === 'RCPT') socket.write('250 OK\r\n');
        else if (verb === 'DATA') {
          body = [];
          socket.write('354 Go ahead\r\n');
        } else if (verb === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else socket.write('250 OK\r\n');
      }
    });
  });

  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  return { port: address.port, messages };
}

describe('the email destination', () => {
  /** Records what would have been sent, for the assertions that are about wording. */
  function recording(): { sent: Record<string, string>[]; transport: { sendMail(m: never): Promise<unknown> } } {
    const sent: Record<string, string>[] = [];
    return {
      sent,
      transport: {
        async sendMail(message: never) {
          sent.push(message as unknown as Record<string, string>);
          return {};
        },
      },
    };
  }

  it('mints a reference and leads the subject with it', async () => {
    // An inbox assigns nothing until a human triages it, so this is the only identifier that
    // exists — and putting it where the desk will read it is what makes it worth quoting.
    const { sent, transport } = recording();
    const sink = createEmailSink(
      { to: 'desk@example.ie', from: 'lodge@example.ie', host: 'smtp.example.ie' },
      { transport, reference: () => 'LDG-7K2MPQ' },
    );

    expect(await sink.file(REPORT)).toBe('LDG-7K2MPQ');
    expect(sent[0]?.['subject']).toBe(
      '[LDG-7K2MPQ] projector in QUA-G01 — Carrigmore College',
    );
  });

  it('writes plain, labelled lines a person or a mail rule can both read', async () => {
    const { sent, transport } = recording();

    await createEmailSink(
      { to: 'desk@example.ie', from: 'lodge@example.ie', host: 'smtp.example.ie' },
      { transport, reference: () => 'LDG-AAAAAA' },
    ).file({ ...REPORT, note: 'flickers after ten minutes' });

    const text = sent[0]?.['text'] ?? '';
    expect(text).toContain('Reference:   LDG-AAAAAA');
    expect(text).toContain('Room:        QUA-G01');
    expect(text).toContain('Equipment:   projector');
    expect(text).toContain('Reported by: u-1001');
    expect(text).toContain('Note:        flickers after ten minutes');
    // Nobody at the desk should think replying reaches the student.
    expect(text).toContain('does not reach the person who reported it');
  });

  it('leaves the note out entirely when there is none, rather than printing an empty label', async () => {
    const { sent, transport } = recording();

    await createEmailSink(
      { to: 'desk@example.ie', from: 'lodge@example.ie', host: 'smtp.example.ie' },
      { transport, reference: () => 'LDG-AAAAAA' },
    ).file(REPORT);

    expect(sent[0]?.['text']).not.toContain('Note:');
  });

  it('sends from and to whoever the institution configured', async () => {
    const { sent, transport } = recording();

    await createEmailSink(
      { to: 'facilities@carrigmore.ie', from: 'lodge@carrigmore.ie', host: 'smtp.example.ie' },
      { transport, reference: () => 'LDG-AAAAAA' },
    ).file(REPORT);

    expect(sent[0]?.['to']).toBe('facilities@carrigmore.ie');
    expect(sent[0]?.['from']).toBe('lodge@carrigmore.ie');
  });

  it('generates references nobody can mishear', async () => {
    // Spoken by a synthesiser, repeated by a person, typed at a desk. Every step is a chance to
    // turn an O into a zero, so neither is in the alphabet.
    const { transport } = recording();
    const sink = createEmailSink(
      { to: 'desk@example.ie', from: 'lodge@example.ie', host: 'smtp.example.ie' },
      { transport },
    );

    const references = await Promise.all(Array.from({ length: 40 }, () => sink.file(REPORT)));

    for (const reference of references) expect(reference).toMatch(/^LDG-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    // And they have to be different, or two faults share one.
    expect(new Set(references).size).toBeGreaterThan(35);
  });

  it('actually sends it over SMTP', async () => {
    const { port, messages } = await smtpServer();

    const reference = await createEmailSink({
      to: 'desk@example.ie',
      from: 'lodge@example.ie',
      host: '127.0.0.1',
      port,
      secure: false,
    }).file(REPORT);

    expect(reference).toMatch(/^LDG-/);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(reference);
    expect(messages[0]).toContain('QUA-G01');
  });

  it('says so when the mail server is not there', async () => {
    const sink = createEmailSink({
      to: 'desk@example.ie',
      from: 'lodge@example.ie',
      host: '127.0.0.1',
      port: 1,
    });

    await expect(sink.file(REPORT)).rejects.toThrow(IssueSinkError);
    await expect(sink.file(REPORT)).rejects.toThrow(/could not be sent to 'desk@example.ie'/);
  });
});

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

  it('email publishes reporting and not chasing', () => {
    // The destination every institution already has, and the one that cannot be asked back.
    const capabilities = capabilitiesFor({
      ...base,
      issues: { email: { to: 'desk@example.ie', from: 'lodge@example.ie', host: 'smtp.example.ie' } },
    });

    expect(capabilities).toContain('issue-reporting');
    expect(capabilities).not.toContain('issue-tracking');
  });

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
