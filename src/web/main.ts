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
import { protect } from '../server/auth.ts';
import type { ProtectedInstitution } from '../server/auth.ts';
import { configPathFrom, createProvidersFrom, loadLodgeConfig } from '../server/config.ts';
import { createHttpServer } from '../server/main.ts';
import type { ServedInstitutions } from '../server/main.ts';
import { startTelemetry } from '../telemetry/setup.ts';
import { createDemoApi } from './api.ts';
import { createDemoHandler } from './handler.ts';
import { createDemoIdp } from './idp.ts';
import type { DemoInstitution } from './api.ts';
import { demoPage } from './page.ts';

const MCP_PORT = Number(process.env['LODGE_MCP_PORT'] ?? 3000);
const UI_PORT = Number(process.env['PORT'] ?? 8080);
const IDP_PORT = Number(process.env['LODGE_IDP_PORT'] ?? 9000);

/**
 * The escape hatch, and the only reason the old bypass still exists.
 *
 * `npm run demo -- --dev-identity` goes back to picking an identity from a header. It is here
 * because a recording day is a bad day to discover that something in the sign-in path broke, and
 * for nothing else: it is a flag of the demonstration, never of the server.
 */
const BYPASS = process.argv.includes('--dev-identity');

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

/**
 * The stand-in identity provider, and the protection it makes possible.
 *
 * Lodge does not issue tokens (ADR-013), so the demonstration brings something that does — the way
 * a real deployment brings its institution's OIDC provider. `protect()` derives each institution's
 * canonical URI from the public URL, which is what makes a token minted for one of them useless at
 * the other even though this one process answers for both.
 *
 * Without it the page would be switching identities with a header, which proves nothing about
 * OAuth: no token, no signature, no audience.
 */
const idpOrigin = `http://127.0.0.1:${IDP_PORT}`;
const idp = await createDemoIdp({
  issuer: idpOrigin,
  // The page, and nothing else. Both spellings because a browser may be pointed at either.
  redirectUris: [`http://localhost:${UI_PORT}/`, `http://127.0.0.1:${UI_PORT}/`],
  institutions: new Map(
    [...providers].map(([slug, provider]) => [
      slug,
      { name: provider.descriptor.institution, people: SCRIPTS[slug]?.identities ?? [] },
    ]),
  ),
});

const protection = new Map<string, ProtectedInstitution>(
  [...providers].map(([slug, provider]) => [
    slug,
    protect({
      slug,
      institution: provider.descriptor.institution,
      config: { issuer: idp.issuer, jwksUri: idp.jwksUri },
      publicUrl: `http://127.0.0.1:${MCP_PORT}`,
      alone: false,
    }),
  ]),
);

const served: ServedInstitutions = {
  providers,
  defaultSlug: null,
  ...(BYPASS ? {} : { protection }),
};

// With `--dev-identity` the header bypass comes back for *this* server only, by passing an
// environment to the handler rather than setting one on the process. Nothing else should inherit it.
const lodge = createHttpServer(served, BYPASS ? { env: { ...process.env, LODGE_DEV_IDENTITY: '1' } } : {});

const idpServer = createServer((req, res) => {
  void (async () => {
    const response =
      (await idp.fetch(await nodeToRequest(req, idpOrigin))) ?? new Response(null, { status: 404 });
    await writeWebResponse(res, response);
  })().catch(() => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"the demonstration identity provider failed"}');
  });
});

const institutions: DemoInstitution[] = [...providers].map(([slug, provider]) => ({
  slug,
  name: provider.descriptor.institution,
  locale: provider.descriptor.locale,
  mcpUrl: `http://127.0.0.1:${MCP_PORT}/mcp/${slug}`,
  identities: SCRIPTS[slug]?.identities ?? [],
  suggestions: SCRIPTS[slug]?.suggestions ?? [],
  ...(BYPASS
    ? {}
    : {
        signIn: {
          authorizeUrl: `${idpOrigin}/authorize`,
          tokenUrl: `${idpOrigin}/token`,
          resource: protection.get(slug)?.resource ?? '',
        },
      }),
}));

/**
 * The demonstration's own tokens, one per institution.
 *
 * Obtained through the provider like any other client, not minted behind its back. They let the
 * backend read tool catalogues before anyone has signed in — which is the moment where switching
 * institution makes three tools disappear — and they name `lodge-demo`, so they cannot answer for
 * a person. They never leave this process.
 */
const serviceTokens = new Map<string, string>();
if (!BYPASS) {
  for (const [slug, guard] of protection) {
    const granted = await idp.fetch(
      new Request(`${idpOrigin}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', resource: guard.resource }),
      }),
    );
    const body = (await granted?.json()) as { access_token?: string } | undefined;
    if (body?.access_token) serviceTokens.set(slug, body.access_token);
  }
}

const api = createDemoApi({
  institutions,
  model: createBedrockModel(bedrockOptionsFrom(process.env)),
  serviceTokens,
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

idpServer.listen(IDP_PORT, '127.0.0.1', () => {
  lodge.listen(MCP_PORT, '127.0.0.1', () => {
    ui.listen(UI_PORT, () => {
      const names = institutions.map((i) => `${i.slug} (${i.name})`).join(', ');
      process.stdout.write(
        `\nLodge      http://127.0.0.1:${MCP_PORT}/mcp/{slug} — ${names}\n` +
          `Demo       http://localhost:${UI_PORT}\n` +
          (BYPASS ? '' : `Identidad  ${idpOrigin} — proveedor de demostración\n`) +
          `\n` +
          (BYPASS
            ? `WARNING: started with --dev-identity, so the MCP server takes an identity from a\n` +
              `header instead of a token. It is the recording-day escape hatch, not the demo.\n\n`
            : `Each institution is protected: the page signs in, Lodge verifies the token, and a\n` +
              `token minted for one of them is refused by the other. The provider on ${IDP_PORT} is\n` +
              `a stand-in with no passwords. Never run this as a deployment; use 'npm start'.\n\n`),
      );
    });
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    ui.close(() => lodge.close(() => idpServer.close(() => process.exit(0))));
  });
}
