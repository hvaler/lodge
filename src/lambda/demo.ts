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
 * Both of them, which is the moment the whole architecture exists for.
 *
 * Carrigmore used to be local-only: its files were not in the managed function's bundle, so
 * offering the switch would have been offering a button that fails. A Lambda layer now mounts them
 * and `handler.ts` serves it at `/mcp/carrigmore`, so the switch is real here too.
 *
 * The two are deliberately unequal. San Telmo is generated and complete — a directory, a fault
 * queue, six tools. Carrigmore is read from four files a real institution would already have, with
 * no directory to bind to and no service desk to mail, so it publishes **three**. Nobody has to be
 * told that the catalogue follows the sources: you press the other button and two of the buttons
 * you were just using are gone.
 *
 * It also gives a visitor who does not read Spanish something to read. That was not the reason for
 * doing it, but it is a reason it matters.
 */
const INSTITUTIONS: readonly Omit<DemoInstitution, 'mcpUrl'>[] = [
  {
    slug: 'san-telmo',
    name: 'Universidad de San Telmo',
    locale: 'es-ES',
    timeZone: 'Europe/Madrid',
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
  {
    slug: 'carrigmore',
    name: 'Carrigmore College',
    locale: 'en-IE',
    timeZone: 'Europe/Dublin',
    // Empty on purpose. There is no directory in front of this one, so there is nobody to be: the
    // three tools it publishes are the three that do not need to know who is asking. Offering
    // identities that change nothing would be a control that lies.
    identities: [],
    suggestions: [
      'Which room is free right now in Quay House?',
      'When does registration close?',
      'How do I get to QUA-G01?',
      // The last one is meant to fail, and to fail well: `campus.timetable` is not published here,
      // so the agent says it cannot answer instead of inventing a plausible Tuesday. That is UC-03,
      // and it is easier to believe when you press the button yourself.
      'Can you tell me my timetable?',
    ],
  },
];

// Built once per container. The page is a constant and the API holds no per-request state.
const base = lodgeUrl();
const api = createDemoApi({
  institutions: INSTITUTIONS.map((i) => ({ ...i, mcpUrl: `${base}/mcp/${i.slug}` })),
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
