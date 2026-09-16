/**
 * Tracing, against spans that were actually recorded.
 *
 * The claim worth testing is not "a span exists" — it is that the span **continues the caller's
 * trace**. An institution's reason to want this is one picture from "a student asked Alexa+
 * something" to "and that is the LDAP query it caused"; a span with a fresh trace id gives them two
 * disconnected pictures and looks identical in the code.
 */

import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { campusInstant } from '../adapters/synthetic/campus.ts';
import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import { createLodgeHandler } from '../server/index.ts';
import { traced } from './index.ts';

const NOW = campusInstant('2026-10-06', '16:30');

/** A trace id somebody else started. The whole point is that ours joins it. */
const CALLER_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const TRACEPARENT = `00-${CALLER_TRACE}-00f067aa0ba902b7-01`;

const spans = new InMemorySpanExporter();
let provider: NodeTracerProvider;
let handler: ReturnType<typeof createLodgeHandler>;

beforeAll(() => {
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] });
  provider.register();
  handler = createLodgeHandler(createSyntheticProvider(), { clock: () => NOW });
});

afterAll(async () => {
  await provider.shutdown();
});

beforeEach(() => {
  spans.reset();
});

async function call(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return handler.fetch(
    new Request('https://lodge.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
    }),
  );
}

const findRoom = {
  method: 'tools/call',
  params: { name: 'campus.find_room', arguments: { building: 'MEN' } },
};

describe('a request makes a span', () => {
  it('names it for the tool, not just the JSON-RPC method', async () => {
    await call(findRoom);

    const [span] = spans.getFinishedSpans().filter((s) => s.name.startsWith('tools/call'));
    expect(span?.name).toBe('tools/call campus.find_room');
  });

  it('records which institution answered, which is the question in a shared deployment', async () => {
    await call(findRoom);

    const span = spans.getFinishedSpans().find((s) => s.name === 'tools/call campus.find_room');
    expect(span?.attributes).toMatchObject({
      'rpc.system': 'jsonrpc',
      'mcp.method.name': 'tools/call',
      'mcp.tool.name': 'campus.find_room',
      'lodge.institution': 'Universidad de San Telmo',
      'lodge.adapter': 'synthetic',
      'http.response.status_code': 200,
    });
  });

  it('leaves the request readable, having only peeked at a clone of it', async () => {
    // The span needs the tool name, which is in the body the handler is about to read. Getting
    // that wrong would not fail the span — it would fail every request.
    const response = await call(findRoom);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('MEN-');
  });
});

describe('the caller’s trace continues', () => {
  it('joins the trace in the traceparent header', async () => {
    await call(findRoom, { traceparent: TRACEPARENT });

    const span = spans.getFinishedSpans().find((s) => s.name === 'tools/call campus.find_room');
    expect(span?.spanContext().traceId).toBe(CALLER_TRACE);
  });

  it('joins the trace in the request’s _meta, for transports that have no headers', async () => {
    // Over stdio there are no HTTP headers at all, so MCP carries the same W3C values in `_meta`.
    await call({
      method: 'tools/call',
      params: { ...findRoom.params, _meta: { traceparent: TRACEPARENT } },
    });

    const span = spans.getFinishedSpans().find((s) => s.name === 'tools/call campus.find_room');
    expect(span?.spanContext().traceId).toBe(CALLER_TRACE);
  });

  it('prefers the protocol’s value over the header a proxy may have rewritten', async () => {
    const other = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    await call(
      { method: 'tools/call', params: { ...findRoom.params, _meta: { traceparent: TRACEPARENT } } },
      { traceparent: `00-${other}-00f067aa0ba902b7-01` },
    );

    const span = spans.getFinishedSpans().find((s) => s.name === 'tools/call campus.find_room');
    expect(span?.spanContext().traceId).toBe(CALLER_TRACE);
  });

  it('starts its own trace when nobody handed it one', async () => {
    await call(findRoom);

    const span = spans.getFinishedSpans().find((s) => s.name === 'tools/call campus.find_room');
    expect(span?.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span?.spanContext().traceId).not.toBe(CALLER_TRACE);
  });
});

describe('a failure is recorded rather than swallowed', () => {
  it('marks the span in error and lets the exception through', async () => {
    await expect(
      traced('deliberate', {}, async () => {
        throw new Error('the directory is unreachable');
      }),
    ).rejects.toThrow('the directory is unreachable');

    const span = spans.getFinishedSpans().find((s) => s.name === 'deliberate');
    // 2 is SpanStatusCode.ERROR. A span that hid this would make the trace say it worked.
    expect(span?.status.code).toBe(2);
    expect(span?.status.message).toBe('the directory is unreachable');
    expect(span?.events.some((e) => e.name === 'exception')).toBe(true);
  });
});
