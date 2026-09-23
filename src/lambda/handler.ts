/**
 * Lodge on AWS Lambda, behind a Function URL.
 *
 * The managed target from ADR-003: AWS is *a* destination, not a requirement. Everything below the
 * server layer is the same code the container runs — same adapter, same tools, same answers.
 * The event-to-`Request` translation lives in `event.ts`, shared with the demonstration function.
 *
 * It is short because the server is stateless (ADR-009). There is no session to rebuild, nothing to
 * hand off between invocations, and no sticky routing to arrange: each request is answered on its
 * own by whichever container is awake. A stateful MCP server on Lambda would need most of DynamoDB
 * just to exist; this one needs a table for the fault queue and nothing else.
 *
 * Buffered rather than streamed responses, deliberately. A tool call answers with a single
 * `text/event-stream` message, so there is nothing to stream — the whole body is ready when the
 * handler returns, and `awslambda.streamifyResponse` would buy latency we do not need and a
 * non-standard entrypoint we would have to explain.
 */

import { join } from 'node:path';

import { createStandardsProvider } from '../adapters/standards/index.ts';
import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import { DynamoBookingStore, bookingsTableFrom } from '../adapters/synthetic/dynamo-bookings.ts';
import { DynamoIssueStore, issuesTableFrom } from '../adapters/synthetic/dynamo-issues.ts';
import type { Provider } from '../provider/index.ts';
import { createLodgeHandler, describeDeployment, institutionFor } from '../server/index.ts';
import { startTelemetry } from '../telemetry/setup.ts';
import { toRequest, toResult } from './event.ts';
import type { FunctionUrlEvent, FunctionUrlResult } from './event.ts';

/**
 * The fault queue this deployment uses.
 *
 * In memory means *this container's* memory, which on Lambda is a fault that vanishes when the
 * container does and is invisible to every other one. With a table configured, UC-06 works; without
 * one it works by luck, which is worse than not working.
 */
function issueStore(env: NodeJS.ProcessEnv): DynamoIssueStore | undefined {
  const table = issuesTableFrom(env);
  return table ? new DynamoIssueStore({ tableName: table }) : undefined;
}

/** The room diary, for the same reason: a room held in one container must be taken in all of them. */
function bookingStore(env: NodeJS.ProcessEnv): DynamoBookingStore | undefined {
  const table = bookingsTableFrom(env);
  return table ? new DynamoBookingStore({ tableName: table }) : undefined;
}

/**
 * Carrigmore College, when its files shipped with this deployment.
 *
 * A Lambda layer mounts `fixtures/carrigmore/` read-only, and `LODGE_CARRIGMORE_DIR` says where.
 * Without the variable this returns nothing and the deployment serves one institution, which is
 * what every deployment did before: the second one is an addition, not a requirement.
 *
 * No directory and no fault destination here, and that is the point rather than a shortcut. There
 * is no LDAP inside a Lambda and no service desk to mail, so Carrigmore declares what it can prove
 * — a room table and two calendars — and its catalogue comes out **four tools against San Telmo's
 * six**. That difference is UC-07, visible in a browser rather than described in a README.
 */
async function carrigmore(dir: string): Promise<Provider> {
  return createStandardsProvider({
    institution: 'Carrigmore College',
    locale: 'en-IE',
    timeZone: 'Europe/Dublin',
    inventory: { location: join(dir, 'rooms.csv') },
    calendars: {
      timetable: join(dir, 'timetable.ics'),
      deadlines: join(dir, 'deadlines.ics'),
    },
  });
}

// Built once per container, not per request: the adapters read their sources and each handler
// registers its tools, and paying for that on every invocation would be paying for nothing.
const carrigmoreDir = process.env['LODGE_CARRIGMORE_DIR'];
const providers = new Map<string, Provider>([
  ['san-telmo', createSyntheticProvider(issueStore(process.env), bookingStore(process.env))],
  ...(carrigmoreDir ? ([['carrigmore', await carrigmore(carrigmoreDir)]] as const) : []),
]);

// San Telmo answers at bare `/mcp` as it always has: the clients, the documentation and the
// demonstration page all point there, and moving it to earn symmetry would break every one of them
// to gain nothing. Both are also reachable by name at `/mcp/{slug}`.
const DEFAULT_SLUG = 'san-telmo';
const handlers = new Map([...providers].map(([slug, p]) => [slug, createLodgeHandler(p)]));

function notFound(error: string): FunctionUrlResult {
  return {
    statusCode: 404,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error, paths: [...handlers.keys()].map((s) => `/mcp/${s}`) }),
  };
}

/**
 * Started during init, flushed before every return.
 *
 * Lambda freezes the container the instant a handler resolves, so a batched exporter would lose
 * whatever it had not sent — which on a demonstration that gets one request an hour is all of it.
 * Flushing costs a round trip to the collector on each invocation, and that is the right trade
 * because it is only paid by a deployment that configured one: with no endpoint set this is `null`
 * and the whole path disappears.
 */
const telemetry = await startTelemetry(process.env);
const health = JSON.stringify({
  status: 'ok',
  default: DEFAULT_SLUG,
  institutions: Object.fromEntries(
    [...providers].map(([slug, p]) => [slug, { path: `/mcp/${slug}`, ...describeDeployment(p) }]),
  ),
});

export async function lambdaHandler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  const path = event.rawPath ?? '/';

  try {
    // A judge with a browser and no MCP client should still be able to see what is running here.
    if (path === '/health') {
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: health };
    }

    const slug = institutionFor(path, DEFAULT_SLUG);
    if (slug === undefined) return notFound('not found');

    const handler = slug === null ? undefined : handlers.get(slug);
    if (!handler) return notFound(`no institution called '${slug}'`);

    return await toResult(await handler.fetch(toRequest(event)));
  } finally {
    await telemetry?.shutdown();
  }
}

export { lambdaHandler as handler };
export type { FunctionUrlEvent, FunctionUrlResult } from './event.ts';
