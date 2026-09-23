/**
 * Two institutions from one managed function.
 *
 * Its own file because the handler reads `LODGE_CARRIGMORE_DIR` while the module is evaluated, so
 * the variable has to exist before the import does. That is deliberate rather than awkward: the
 * adapters are built once per container, and a test that could set it afterwards would be testing
 * something the runtime never does.
 */

import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { FunctionUrlEvent, FunctionUrlResult } from './event.ts';

type Handler = (event: FunctionUrlEvent) => Promise<FunctionUrlResult>;
let lambdaHandler: Handler;

beforeAll(async () => {
  // What the Lambda layer mounts at /opt/carrigmore, read here straight from the repository.
  process.env['LODGE_CARRIGMORE_DIR'] = join(process.cwd(), 'fixtures', 'carrigmore');
  ({ lambdaHandler } = await import('./handler.ts'));
});

function event(rawPath: string, body?: string): FunctionUrlEvent {
  return {
    rawPath,
    requestContext: { http: { method: body ? 'POST' : 'GET' } },
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    ...(body ? { body } : {}),
  };
}

const TOOLS_LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

async function toolsAt(path: string): Promise<string[]> {
  const result = await lambdaHandler(event(path, TOOLS_LIST));
  expect(result.statusCode).toBe(200);

  // The body is an SSE frame; the tool names are what this is about.
  return ['campus.find_room', 'campus.room_schedule', 'campus.timetable', 'campus.deadlines',
    'campus.wayfind', 'campus.report_issue', 'campus.issue_status', 'campus.book_room']
    .filter((t) => result.body.includes(`"${t}"`));
}

describe('one function, two institutions', () => {
  it('keeps San Telmo at bare /mcp, where everything already points', async () => {
    // Clients, the documentation and the demonstration page all use this path. Moving it to earn
    // symmetry with the second institution would break all three to gain nothing.
    expect(await toolsAt('/mcp')).toHaveLength(8);
  });

  it('serves each of them by name too', async () => {
    expect(await toolsAt('/mcp/san-telmo')).toHaveLength(8);
    expect((await toolsAt('/mcp/carrigmore')).length).toBeGreaterThan(0);
  });

  it('gives Carrigmore a SMALLER catalogue, which is the whole point', async () => {
    // UC-07 in a browser. No LDAP inside a Lambda and no service desk to mail, so Carrigmore
    // declares what it can prove: a room table and two calendars. It never offers to tell you
    // your timetable, because it cannot know who you are.
    expect(await toolsAt('/mcp/carrigmore')).toEqual([
      'campus.find_room',
      'campus.room_schedule',
      'campus.deadlines',
      'campus.wayfind',
    ]);
  });

  it('answers Carrigmore in its own language, from its own room table', async () => {
    const call = JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'campus.wayfind', arguments: { to: 'QUA-G01' } },
    });
    const result = await lambdaHandler(event('/mcp/carrigmore', call));

    expect(result.body).toContain('QUA-G01');
    expect(result.body).toMatch(/floor/i);
  });

  it('says which institutions exist rather than guessing at an unknown one', async () => {
    const result = await lambdaHandler(event('/mcp/nowhere', TOOLS_LIST));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toMatchObject({
      error: "no institution called 'nowhere'",
      paths: ['/mcp/san-telmo', '/mcp/carrigmore'],
    });
  });

  it('names both in the health probe, with what each publishes', async () => {
    const result = await lambdaHandler(event('/health'));
    const body = JSON.parse(result.body) as {
      institutions: Record<string, { institution: string; tools: string[] }>;
    };

    expect(body.institutions['carrigmore']?.institution).toBe('Carrigmore College');
    expect(body.institutions['carrigmore']?.tools).toHaveLength(4);
    expect(body.institutions['san-telmo']?.tools).toHaveLength(8);
  });
});
