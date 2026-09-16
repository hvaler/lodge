/**
 * The public demonstration, on Lambda.
 *
 * A judge should not have to install an MCP client to see this work. This function serves the page
 * and the agent behind it; Lodge itself is a **separate function** and this one reaches it over
 * HTTP, exactly as `npm run demo` does locally. Keeping them apart is the whole claim: what you
 * watch this page do, your own agent can do, because this page is only somebody's agent.
 *
 * It is the one part of Lodge that spends money per question — the model is called on every ask —
 * so it is also the one part with a hard daily ceiling. See `web/quota.ts` for why a cap and not a
 * rate limit.
 */

import { bedrockOptionsFrom, createBedrockModel } from '../orchestrator/index.ts';
import { startTelemetry } from '../telemetry/setup.ts';
import { createDemoApi } from '../web/api.ts';
import type { DemoInstitution } from '../web/api.ts';
import { createDemoHandler } from '../web/handler.ts';
import { demoPage } from '../web/page.ts';
import { createDailyQuota, dailyLimitFrom, quotaTableFrom } from '../web/quota.ts';
import { toRequest, toResult } from './event.ts';
import type { FunctionUrlEvent, FunctionUrlResult } from './event.ts';

/** Where Lodge is. Without it there is nothing to demonstrate, so this fails loudly at init. */
function lodgeUrl(): string {
  const url = process.env['LODGE_MCP_URL'];
  if (!url) {
    throw new Error(
      'LODGE_MCP_URL is not set. The demonstration is an MCP client and needs a server to talk to.',
    );
  }
  return url.replace(/\/+$/, '');
}

/**
 * Only San Telmo here.
 *
 * The local demonstration serves Carrigmore too, from the CSV and iCalendar files in the repository.
 * Those are not in this function's bundle and the managed Lodge does not serve them, so offering
 * the switch would be offering a button that fails. The institution-switching moment is in the
 * video and in `npm run demo`, where it is real.
 */
const INSTITUTIONS: readonly Omit<DemoInstitution, 'mcpUrl'>[] = [
  {
    slug: 'san-telmo',
    name: 'Universidad de San Telmo',
    locale: 'es-ES',
    identities: [
      { subject: 'est-0001', label: 'Estudiante de Derecho' },
      { subject: 'est-0002', label: 'Estudiante de Informática' },
      { subject: 'doc-0007', label: 'Profesor con avisos abiertos' },
    ],
    suggestions: [
      '¿Qué aula está libre ahora en Mendizábal?',
      '¿Qué tengo mañana?',
      '¿Cuándo acaba el plazo de convalidaciones?',
      '¿Cómo llego al aula 104 de El Faro?',
      'El proyector de MEN-203 no funciona',
    ],
  },
];

// Built once per container. The page is a constant and the API holds no per-request state.
const base = lodgeUrl();
const api = createDemoApi({
  institutions: INSTITUTIONS.map((i) => ({ ...i, mcpUrl: `${base}/mcp` })),
  model: createBedrockModel(bedrockOptionsFrom(process.env)),
});

const quotaTable = quotaTableFrom(process.env);
const limit = dailyLimitFrom(process.env);

const handle = createDemoHandler({
  api,
  page: demoPage(),
  ...(quotaTable && limit
    ? { quota: createDailyQuota({ tableName: quotaTable, limit }) }
    : {}),
  // Logged rather than swallowed: this function is the one nobody can attach a debugger to.
  onError: (error) => console.log(error.message),
});

const telemetry = await startTelemetry(process.env, 'lodge-demo');

export async function demoHandler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  try {
    return await toResult(await handle(toRequest(event)));
  } finally {
    // Lambda freezes the container the instant this resolves, so a batched exporter would lose
    // whatever it had not sent. Costs nothing when no collector is configured.
    await telemetry?.shutdown();
  }
}

export { demoHandler as handler };
