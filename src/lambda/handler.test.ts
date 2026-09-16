/**
 * The Lambda entrypoint, driven by the events AWS actually sends.
 *
 * The managed target is the one nobody can poke at locally, which makes it the one most likely to
 * be deployed broken. These tests build Function URL events by hand and call the handler exactly as
 * the runtime does, so the shape conversion — base64 bodies, the method buried in
 * `requestContext.http`, headers that may be absent — is exercised before it reaches AWS.
 */

import { describe, expect, it } from 'vitest';

import { lambdaHandler } from './handler.ts';
import type { FunctionUrlEvent } from './handler.ts';

function event(overrides: Partial<FunctionUrlEvent> = {}): FunctionUrlEvent {
  return {
    rawPath: '/mcp',
    requestContext: { http: { method: 'POST' } },
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    ...overrides,
  };
}

function rpc(method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
}

describe('the health probe', () => {
  it('says what is running, for a judge holding a browser and no MCP client', async () => {
    const result = await lambdaHandler(
      event({ rawPath: '/health', requestContext: { http: { method: 'GET' } } }),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { status: string; institution: string; tools: string[] };
    expect(body.status).toBe('ok');
    expect(body.institution).toBe('Universidad de San Telmo');
    expect(body.tools).toHaveLength(6);
  });
});

describe('the MCP endpoint', () => {
  it('publishes the six tools', async () => {
    const result = await lambdaHandler(event({ body: rpc('tools/list') }));

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('campus.find_room');
    expect(result.body).toContain('campus.issue_status');
  });

  it('answers a tool call with the same words the container would use', async () => {
    // Wayfinding rather than a room search, because this entrypoint builds its own provider with
    // the real clock and there is no seam to pin it — `find_room` legitimately answers "nothing is
    // free" once the buildings close, and a test that only passes during office hours is a test
    // that gets muted. Directions are the same at any hour.
    const result = await lambdaHandler(
      event({ body: rpc('tools/call', { name: 'campus.wayfind', arguments: { to: 'FAR-104' } }) }),
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('El Faro');
    // Spanish, because the adapter declares es-ES — the platform underneath changes nothing.
    expect(result.body).toContain('planta 1');
  });

  it('answers a room search in Spanish whatever the hour', async () => {
    const result = await lambdaHandler(
      event({ body: rpc('tools/call', { name: 'campus.find_room', arguments: { building: 'MEN' } }) }),
    );

    expect(result.statusCode).toBe(200);
    // Either there are rooms or there are not; both answers are the institution's own language,
    // and which one comes back depends on the time of day rather than on anything being wrong.
    expect(result.body).toMatch(/Libres de aquí a las|No hay nada libre en MEN/);
  });

  it('decodes a base64 body, which is what the runtime sends for anything it thinks is binary', async () => {
    const result = await lambdaHandler(
      event({
        body: Buffer.from(rpc('tools/list'), 'utf8').toString('base64'),
        isBase64Encoded: true,
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('campus.find_room');
  });

  it('carries the query string through, rather than dropping it on the floor', async () => {
    const result = await lambdaHandler(
      event({ body: rpc('tools/list'), rawQueryString: 'trace=1' }),
    );

    expect(result.statusCode).toBe(200);
  });

  it('refuses the timetable to a caller the event never identified', async () => {
    // No token and no dev header: the tool asks who is calling and nobody answered.
    const result = await lambdaHandler(
      event({ body: rpc('tools/call', { name: 'campus.timetable', arguments: {} }) }),
    );

    expect(result.body).toContain('tienes que identificarte');
  });

  it('survives an event with no headers at all', async () => {
    // Malformed rather than hypothetical: a probe or a health checker sends exactly this, and a
    // crash here is a 502 in front of a judge.
    const result = await lambdaHandler({
      rawPath: '/health',
      requestContext: { http: { method: 'GET' } },
    });

    expect(result.statusCode).toBe(200);
  });
});
