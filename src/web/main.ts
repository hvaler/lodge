/**
 * The demonstration entrypoint.
 *
 * Starts two servers and connects the second to the first over the network:
 *
 *   :3000  Lodge itself — the MCP server, exactly as an institution would run it
 *   :8080  this demonstration — a web page and the agent behind it, an MCP *client*
 *
 * They are separate on purpose. The submission claims Lodge is a server anyone's agent can speak
 * to; a demo that called the provider in the same process would be evidence of something else. Both
 * URLs are printed so a judge can point the MCP Inspector, or their own client, at :3000 and get
 * the same answers this page gets.
 *
 * `npm run demo` needs no container, no AWS beyond credentials, and no configuration.
 */

import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { nodeToRequest, writeWebResponse } from '../shared/http.ts';

import { createBedrockModel, bedrockOptionsFrom } from '../orchestrator/index.ts';
import type { Provider } from '../provider/index.ts';
import { configPathFrom, createProvidersFrom, loadLodgeConfig } from '../server/config.ts';
import { createHttpServer } from '../server/main.ts';
import type { ServedInstitutions } from '../server/main.ts';
import { startTelemetry } from '../telemetry/setup.ts';
import { createDemoApi } from './api.ts';
import { createDemoHandler } from './handler.ts';
import type { DemoInstitution } from './api.ts';
import { demoPage } from './page.ts';

const MCP_PORT = Number(process.env['LODGE_MCP_PORT'] ?? 3000);
const UI_PORT = Number(process.env['PORT'] ?? 8080);

/**
 * Who the demo can pretend to be, and what is worth asking.
 *
 * Kept here rather than in the adapters: an institution's data has no opinion about which of its
 * people make a good demonstration. The identities are real subjects in the fixtures, so the
 * answers are the institution's own and not staged.
 */
const SCRIPTS: Record<string, Pick<DemoInstitution, 'identities' | 'suggestions'>> = {
  'san-telmo': {
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
  carrigmore: {
    identities: [
      { subject: 'u-1001', label: 'Student' },
      { subject: 'u-1042', label: 'Student, other programme' },
    ],
    // The last one is the point of the whole exercise: Carrigmore has no issue tracker, so the
    // agent cannot file a fault here. Not because it was told not to — because the tool is not
    // in the catalogue it was given.
    suggestions: [
      'Which rooms are free right now?',
      'When does registration close?',
      'How do I get to QUA-101?',
      'The projector in QUA-G01 is broken',
    ],
  },
};

/** The two-institution demonstration, from the fixtures in this repository. No container needed. */
async function defaultInstitutions(): Promise<Map<string, Provider>> {
  // `../../fixtures` resolves the same from `src/web` and from `dist/web`, so development and the
  // compiled artefact read the same files.
  const fixtures = resolve(import.meta.dirname, '../../fixtures/carrigmore');

  return createProvidersFrom({
    institutions: new Map([
      ['san-telmo', { adapter: 'synthetic' as const }],
      [
        'carrigmore',
        {
          adapter: 'standards' as const,
          standards: {
            institution: 'Carrigmore College',
            locale: 'en-IE',
            timeZone: 'Europe/Dublin',
            inventory: { location: resolve(fixtures, 'rooms.csv') },
            calendars: {
              timetable: resolve(fixtures, 'timetable.ics'),
              deadlines: resolve(fixtures, 'deadlines.ics'),
            },
            // No directory. Without one the standards adapter never publishes a timetable, which is
            // the honest thing to show: Carrigmore's catalogue is genuinely shorter here, and it is
            // shorter for a reason a deployment can fix by configuring LDAP.
          },
        },
      ],
    ]),
    defaultSlug: 'san-telmo',
  });
}

await startTelemetry(process.env, 'lodge-demo');

const configPath = configPathFrom(process.env);
const providers = configPath
  ? await createProvidersFrom(await loadLodgeConfig(configPath))
  : await defaultInstitutions();

const served: ServedInstitutions = { providers, defaultSlug: null };

// The identity header is enabled for *this* server only, by passing an environment to the handler
// rather than setting one on the process. It is an authentication bypass — the demo needs it to
// show that two identities get two different timetables, and nothing else should inherit it.
const lodge = createHttpServer(served, {
  env: { ...process.env, LODGE_DEV_IDENTITY: '1' },
});

const institutions: DemoInstitution[] = [...providers].map(([slug, provider]) => ({
  slug,
  name: provider.descriptor.institution,
  locale: provider.descriptor.locale,
  mcpUrl: `http://127.0.0.1:${MCP_PORT}/mcp/${slug}`,
  identities: SCRIPTS[slug]?.identities ?? [],
  suggestions: SCRIPTS[slug]?.suggestions ?? [],
}));

const api = createDemoApi({
  institutions,
  model: createBedrockModel(bedrockOptionsFrom(process.env)),
});

const handle = createDemoHandler({ api, page: demoPage() });

const ui = createServer((req, res) => {
  void (async () => {
    // `http://localhost` only so the URL is absolute; nothing routes on the host.
    const response = await handle(await nodeToRequest(req, `http://localhost:${UI_PORT}`));
    await writeWebResponse(res, response);
  })().catch(() => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"the demonstration failed"}');
  });
});

lodge.listen(MCP_PORT, '127.0.0.1', () => {
  ui.listen(UI_PORT, () => {
    const names = institutions.map((i) => `${i.slug} (${i.name})`).join(', ');
    process.stdout.write(
      `\nLodge      http://127.0.0.1:${MCP_PORT}/mcp/{slug} — ${names}\n` +
        `Demo       http://localhost:${UI_PORT}\n\n` +
        `WARNING: this entrypoint enables LODGE_DEV_IDENTITY on the MCP server it starts, so the\n` +
        `page can switch identities without OAuth. Never run it as a deployment; use 'npm start'.\n\n`,
    );
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    ui.close(() => lodge.close(() => process.exit(0)));
  });
}
