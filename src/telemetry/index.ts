/**
 * Tracing, as instrumentation rather than as a subsystem.
 *
 * The only thing imported here is `@opentelemetry/api`, which has no dependencies of its own and is
 * a no-op until somebody registers a provider. So Lodge always emits spans and, by default, nothing
 * listens and nothing is paid. `setup.ts` does the wiring, and only when an endpoint is configured.
 *
 * What makes this worth having in an MCP server rather than generic hygiene: the trace **continues**
 * the caller's. A student asks Alexa+ something, the agent calls `campus.find_room`, and the
 * institution sees one trace from the question to the LDAP query it caused. That only works if the
 * W3C context in the request is picked up rather than a fresh trace started, which is most of what
 * this file is for.
 *
 * The other constraint is the 500 ms budget. Every span here is started and ended in process and
 * exported in the background — nothing on the request path waits for a collector, and if the
 * collector is down the requests do not notice.
 */

import { SpanStatusCode, context, propagation, trace } from '@opentelemetry/api';
import type { Attributes, Context, Span } from '@opentelemetry/api';

/** The instrumentation scope traces are attributed to. */
export const TRACER_NAME = 'lodge';

function tracer(): ReturnType<typeof trace.getTracer> {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Runs `fn` inside a span.
 *
 * Failures are recorded and rethrown, never swallowed: a span that hides an exception is worse than
 * no span, because it makes the trace say the call succeeded.
 */
export async function traced<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * The caller's trace context, from wherever they put it.
 *
 * Two places, because MCP is carried over more than one transport. Over Streamable HTTP the
 * standard `traceparent` header is the natural home; over stdio there are no headers at all, so the
 * protocol carries the same W3C values in the request's `_meta`. The names are identical, so one
 * carrier covers both — and an explicit `_meta` value wins, because it is the one the *protocol*
 * client set rather than whatever proxy last touched the connection.
 */
export function contextFrom(carriers: readonly (Record<string, unknown> | undefined)[]): Context {
  const carrier: Record<string, string> = {};
  for (const source of carriers) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (typeof value === 'string') carrier[key.toLowerCase()] = value;
    }
  }
  return propagation.extract(context.active(), carrier);
}

/** Runs `fn` with `ctx` active, so spans started inside it continue the caller's trace. */
export function within<T>(ctx: Context, fn: () => Promise<T>): Promise<T> {
  return context.with(ctx, fn);
}
