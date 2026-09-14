/**
 * The server over real HTTP.
 *
 * This is M1's deliverable stated as a test: a generic MCP client, over Streamable HTTP, against a
 * listening socket. The in-memory tests in `src/tools` prove the tools; these prove the wire.
 */

import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { campusInstant } from '../adapters/synthetic/campus.ts';
import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
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

async function connectClient(headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client(
    { name: 'generic-client', version: '0.0.0' },
    { capabilities: { elicitation: {} } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers } }),
  );
  return client;
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

    expect(text).toMatch(/Free until/);
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

  it('serves a health probe describing what this deployment is', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body['status']).toBe('ok');
    expect(body['institution']).toBe('Universidad de San Telmo');
    expect(body['timeZone']).toBe('Europe/Madrid');
    expect(body['tools']).toHaveLength(6);
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

      expect(text, `env ${JSON.stringify(env)}`).toMatch(/signed in/);
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

  it('answers well inside the 500 ms Alexa+ budget, over the wire', async () => {
    // The platform limit is the whole round trip. Measured here end to end: HTTP in, tool out.
    const client = await connectClient();
    const samples: number[] = [];

    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      await client.callTool({ name: 'campus.find_room', arguments: {} });
      samples.push(performance.now() - started);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;

    expect(p95, `p95 was ${p95.toFixed(1)} ms`).toBeLessThan(500);
    await client.close();
  });
});
