/**
 * Lodge on AWS Lambda, behind a Function URL.
 *
 * The managed target from ADR-003: AWS is *a* destination, not a requirement. Everything below the
 * server layer is the same code the container runs — same adapter, same six tools, same answers.
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

import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import { DynamoIssueStore, issuesTableFrom } from '../adapters/synthetic/dynamo-issues.ts';
import { createLodgeHandler, describeDeployment } from '../server/index.ts';
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

// Built once per container, not per request: the adapter generates a campus and the handler
// registers six tools, and paying for that on every invocation would be paying for nothing.
const provider = createSyntheticProvider(issueStore(process.env));
const mcp = createLodgeHandler(provider);

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
const health = JSON.stringify({ status: 'ok', ...describeDeployment(provider) });

export async function lambdaHandler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  const path = event.rawPath ?? '/';

  try {
    // A judge with a browser and no MCP client should still be able to see what is running here.
    if (path === '/health') {
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: health };
    }

    return await toResult(await mcp.fetch(toRequest(event)));
  } finally {
    await telemetry?.shutdown();
  }
}

export { lambdaHandler as handler };
export type { FunctionUrlEvent, FunctionUrlResult } from './event.ts';
