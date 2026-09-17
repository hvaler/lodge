/**
 * The server over real HTTP.
 *
 * This is M1's deliverable stated as a test: a generic MCP client, over Streamable HTTP, against a
 * listening socket. The in-memory tests in `src/tools` prove the tools; these prove the wire.
 */

import type { Server } from 'node:http';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { campusInstant } from '../adapters/synthetic/campus.ts';
import { createStandardsProvider } from '../adapters/standards/index.ts';
import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import type { Provider } from '../provider/index.ts';
import { InMemoryIssueStore } from '../adapters/synthetic/issues.ts';
import { DEV_SUBJECT_HEADER } from './identity.ts';
import { createHttpServer } from './main.ts';

const NOW = campusInstant('2026-10-06', '16:30');

let server: Server;
let baseUrl: string;

async function listen(env: NodeJS.ProcessEnv = {}): Promise<void> {
  const provider = createSyntheticProvider(new InMemoryIssueStore());
  server = createHttpServer(provider, { clock: () => NOW, env });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

/** Starts a server holding several institutions, as the demo deployment does. */
async function listenMany(
  providers: Map<string, Provider>,
  defaultSlug: string | null,
): Promise<void> {
  server = createHttpServer({ providers, defaultSlug }, { clock: () => NOW });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function connectClient(
  headers: Record<string, string> = {},
  versionNegotiation?: { mode: 'legacy' | 'auto' },
  path = '/mcp',
): Promise<Client> {
  const client = new Client(
    { name: 'generic-client', version: '0.0.0' },
    { capabilities: { elicitation: {} } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}${path}`), {
      requestInit: { headers },
      ...(versionNegotiation ? { versionNegotiation } : {}),
    }),
  );
  return client;
}

async function textOf(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  return ((result.content ?? []) as { text?: string }[]).map((b) => b.text).join(' ');
}

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('a generic MCP client can use it over HTTP', () => {
  beforeEach(async () => {
    await listen();
  });

  it('lists the six tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      'campus.deadlines',
      'campus.find_room',
      'campus.issue_status',
      'campus.report_issue',
      'campus.timetable',
      'campus.wayfind',
    ]);
    await client.close();
  });

  it('answers a question about a free room', async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: 'campus.find_room', arguments: { building: 'MEN' } });
    const text = ((result.content ?? []) as { text?: string }[]).map((b) => b.text).join(' ');

    expect(text).toMatch(/Libres de aquí a las/);
    await client.close();
  });

  it('holds nothing between connections, because it is stateless', async () => {
    // Two independent clients, no shared session. A replica that has never seen the caller must
    // answer identically — that is what lets this be deployed without coordination.
    const first = await connectClient();
    const second = await connectClient();

    const call = async (client: Client): Promise<string> => {
      const result = await client.callTool({ name: 'campus.find_room', arguments: {} });
      return ((result.content ?? []) as { text?: string }[]).map((b) => b.text).join(' ');
    };

    expect(await call(first)).toBe(await call(second));
    await Promise.all([first.close(), second.close()]);
  });

  it.each([['legacy'], ['auto']] as const)(
    'serves a client negotiating in %s mode',
    async (mode) => {
      // createMcpHandler promises both protocol eras from one factory, and ADR-009 leans on it:
      // 2025-11-25 is what Alexa+ speaks, and the modern era comes along for free. Asserting both
      // here is what stops that promise from being untested.
      const client = await connectClient({}, { mode });

      const { tools } = await client.listTools();
      expect(tools).toHaveLength(6);
      expect(await textOf(client, 'campus.find_room')).toMatch(/Libres de aquí a las/);

      await client.close();
    },
  );

  it('serves a health probe describing what this deployment is', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as Record<string, unknown>;

    const institutions = body['institutions'] as Record<string, Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(body['status']).toBe('ok');
    expect(institutions['default']?.['institution']).toBe('Universidad de San Telmo');
    expect(institutions['default']?.['timeZone']).toBe('Europe/Madrid');
    expect(institutions['default']?.['tools']).toHaveLength(6);
  });

  it('404s anything that is not the two paths it serves', async () => {
    const response = await fetch(`${baseUrl}/admin`);

    expect(response.status).toBe(404);
  });
});

describe('the development identity header', () => {
  it('is ignored unless it has been switched on explicitly', async () => {
    // An unset variable, a blank one and "true" all mean off. Only "1" means on: a header that
    // lets any caller name themselves is an authentication bypass, so it must never come on by
    // accident.
    for (const env of [{}, { LODGE_DEV_IDENTITY: '' }, { LODGE_DEV_IDENTITY: 'true' }]) {
      await listen(env);
      const client = await connectClient({ [DEV_SUBJECT_HEADER]: 'est-0001' });
      const result = await client.callTool({ name: 'campus.timetable', arguments: {} });
      const text = ((result.content ?? []) as { text?: string }[]).map((b) => b.text).join(' ');

      expect(text, `env ${JSON.stringify(env)}`).toMatch(/tienes que identificarte/);
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // The afterEach closes a server; give it one that is already closed-safe.
    await listen();
  });

  it('identifies the caller when it is on, which is how the demo runs before OAuth', async () => {
    await listen({ LODGE_DEV_IDENTITY: '1' });
    const client = await connectClient({ [DEV_SUBJECT_HEADER]: 'est-0001' });

    const result = await client.callTool({ name: 'campus.timetable', arguments: {} });
    const text = ((result.content ?? []) as { text?: string }[]).map((b) => b.text).join(' ');

    expect(text).toMatch(/DER-/);
    await client.close();
  });

  it('still separates two identities when it is on', async () => {
    await listen({ LODGE_DEV_IDENTITY: '1' });

    const read = async (subject: string): Promise<string> => {
      const client = await connectClient({ [DEV_SUBJECT_HEADER]: subject });
      const result = await client.callTool({ name: 'campus.timetable', arguments: {} });
      await client.close();
      return ((result.content ?? []) as { text?: string }[]).map((b) => b.text).join(' ');
    };

    expect(await read('est-0001')).not.toBe(await read('est-0002'));
  });
});

describe('latency', () => {
  beforeEach(async () => {
    await listen();
  });

  it('does not get slower by an order of magnitude, over the wire', async () => {
    // A regression guard over a real socket, not the proof of the 500 ms budget — the same two
    // claims the adapter's own latency test used to conflate.
    //
    // It cannot be the proof. This file runs alongside twenty-three other workers, and a round
    // trip that takes single-digit milliseconds on an idle machine takes about 250 under that
    // contention. Twenty of them then exceed the test timeout, which is how this surfaced: not as
    // a failed assertion but as a test that never finished.
    //
    // The budget itself is evidenced where it is actually spent: **214 ms end to end from Spain,
    // network included**, measured against the deployed server. That number is in use-cases.md.
    const client = await connectClient();
    const samples: number[] = [];

    for (let i = 0; i < 8; i++) {
      const started = performance.now();
      await client.callTool({ name: 'campus.find_room', arguments: {} });
      samples.push(performance.now() - started);
    }

    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;

    expect(median, `median was ${median.toFixed(1)} ms`).toBeLessThan(1000);
    await client.close();
  }, 60_000);
});

describe('UC-07 · one server, two institutions', () => {
  const FIXTURES = join(process.cwd(), 'fixtures', 'carrigmore');

  /** Carrigmore with a stubbed directory: LDAP itself is covered in the adapter's own tests. */
  async function carrigmore(): Promise<Provider> {
    return createStandardsProvider(
      {
        institution: 'Carrigmore College',
        locale: 'en-IE',
        timeZone: 'Europe/Dublin',
        inventory: { location: join(FIXTURES, 'rooms.csv') },
        calendars: {
          timetable: join(FIXTURES, 'timetable.ics'),
          deadlines: join(FIXTURES, 'deadlines.ics'),
        },
      },
      { async modulesFor(subject) { return subject === 'u-1001' ? ['CS101', 'CS201'] : null; } },
    );
  }

  async function bothInstitutions(defaultSlug: string | null = 'san-telmo'): Promise<void> {
    await listenMany(
      new Map([
        ['san-telmo', createSyntheticProvider(new InMemoryIssueStore()) as Provider],
        ['carrigmore', await carrigmore()],
      ]),
      defaultSlug,
    );
  }

  it('answers the same question differently at each path, with no restart', async () => {
    // The acceptance criterion: the same sentence returns the other institution's data, with no
    // restart and no recompile. Here it is one process, two paths, two answers.
    await bothInstitutions();

    const spanish = await connectClient({}, undefined, '/mcp/san-telmo');
    const irish = await connectClient({}, undefined, '/mcp/carrigmore');

    const ask = async (client: Client): Promise<string> => {
      const result = await client.callTool({ name: 'campus.deadlines', arguments: {} });
      return ((result.content ?? []) as { text?: string }[]).map((b) => b.text).join(' ');
    };

    const fromSanTelmo = await ask(spanish);
    const fromCarrigmore = await ask(irish);

    expect(fromSanTelmo).not.toBe(fromCarrigmore);
    expect(fromCarrigmore).toMatch(/Registration closes|fee instalment|Module change/);
    await Promise.all([spanish.close(), irish.close()]);
  });

  it('publishes a different catalogue at each path', async () => {
    // Carrigmore has no issue tracker, so those two tools do not exist there — and the switch
    // changes what the agent can offer, not just the data behind it.
    await bothInstitutions();

    const spanish = await connectClient({}, undefined, '/mcp/san-telmo');
    const irish = await connectClient({}, undefined, '/mcp/carrigmore');

    expect((await spanish.listTools()).tools).toHaveLength(6);
    const irishTools = (await irish.listTools()).tools.map((t) => t.name);
    expect(irishTools).toHaveLength(4);
    expect(irishTools).not.toContain('campus.report_issue');

    await Promise.all([spanish.close(), irish.close()]);
  });

  it('describes both institutions in one health probe', async () => {
    await bothInstitutions();
    const body = (await (await fetch(`${baseUrl}/health`)).json()) as {
      default: string;
      institutions: Record<string, { path: string; institution: string; locale: string }>;
    };

    expect(body.default).toBe('san-telmo');
    expect(body.institutions['san-telmo']?.locale).toBe('es-ES');
    expect(body.institutions['carrigmore']?.locale).toBe('en-IE');
    expect(body.institutions['carrigmore']?.path).toBe('/mcp/carrigmore');
  });

  it('serves the named default at bare /mcp', async () => {
    await bothInstitutions('carrigmore');
    const client = await connectClient({}, undefined, '/mcp');

    expect((await client.listTools()).tools).toHaveLength(4);
    await client.close();
  });

  it('refuses to guess when several are served and none is default', async () => {
    // Picking one would be a coin toss, and the losing side of that coin hands somebody another
    // institution's data.
    await bothInstitutions(null);
    const response = await fetch(`${baseUrl}/mcp`, { method: 'POST' });

    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).toMatch(/several institutions/);
  });

  it('404s an institution it does not serve, listing the ones it does', async () => {
    await bothInstitutions();
    const response = await fetch(`${baseUrl}/mcp/oxford`, { method: 'POST' });
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(404);
    expect(body).toMatch(/no institution called 'oxford'/);
    expect(body).toMatch(/\/mcp\/carrigmore/);
  });
});
