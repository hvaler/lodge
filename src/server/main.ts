/**
 * Node entrypoint for the self-hosted deployment.
 *
 * Kept small and boring on purpose: an institution's IT lead should be able to read this file and
 * see exactly what is exposed. Routing is a handful of paths and no framework.
 *
 * One institution is served at `/mcp`. Several are served at `/mcp/{slug}` — that is UC-07, the
 * exchange student asking the same question of two places, and it is why the switch happens with
 * no restart and no recompile.
 */

import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';

import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import type { Provider } from '../provider/index.ts';
import { configPathFrom, createProvidersFrom, loadLodgeConfig } from './config.ts';
import { devIdentityEnabled } from './identity.ts';
import { createLodgeHandler, describeDeployment } from './index.ts';
import type { LodgeServerOptions } from './index.ts';

const MCP_PATH = '/mcp';
const HEALTH_PATH = '/health';

function port(env: NodeJS.ProcessEnv): number {
  const raw = env['PORT'];
  const parsed = raw ? Number(raw) : 3000;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`PORT must be a port number, got '${raw}'.`);
  }
  return parsed;
}

export interface ServedInstitutions {
  /** Slug → provider. */
  readonly providers: ReadonlyMap<string, Provider>;
  /** Which slug answers at bare `/mcp`, or `null` when several exist and none was chosen. */
  readonly defaultSlug: string | null;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createHttpServer(
  served: ServedInstitutions | Provider,
  options: LodgeServerOptions = {},
): Server {
  // A bare provider is the ordinary case: one institution, served at `/mcp`.
  const institutions: ServedInstitutions =
    'providers' in served ? served : { providers: new Map([['default', served]]), defaultSlug: 'default' };

  // Handlers are built once, not per request: each one is already stateless inside.
  const handlers = new Map(
    [...institutions.providers].map(([slug, provider]) => [
      slug,
      toNodeHandler(createLodgeHandler(provider, options)),
    ]),
  );

  const health = JSON.stringify({
    status: 'ok',
    default: institutions.defaultSlug,
    institutions: Object.fromEntries(
      [...institutions.providers].map(([slug, provider]) => [
        slug,
        { path: `${MCP_PATH}/${slug}`, ...describeDeployment(provider) },
      ]),
    ),
  });

  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    if (path === HEALTH_PATH) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(health);
      return;
    }

    // `/mcp` or `/mcp/{slug}`; nothing deeper.
    const slug =
      path === MCP_PATH
        ? institutions.defaultSlug
        : path.startsWith(`${MCP_PATH}/`) && !path.slice(MCP_PATH.length + 1).includes('/')
          ? path.slice(MCP_PATH.length + 1)
          : undefined;

    if (slug === undefined) {
      json(res, 404, { error: 'not found', paths: [...handlers.keys()].map((s) => `${MCP_PATH}/${s}`) });
      return;
    }

    // Several institutions and no default chosen: `/mcp` says which paths exist rather than
    // picking one. Answering as a coin toss would give somebody another institution's timetable.
    if (slug === null) {
      json(res, 404, {
        error: 'this deployment serves several institutions; choose one',
        paths: [...handlers.keys()].map((s) => `${MCP_PATH}/${s}`),
      });
      return;
    }

    const handler = handlers.get(slug);
    if (!handler) {
      json(res, 404, { error: `no institution called '${slug}'`, paths: [...handlers.keys()].map((s) => `${MCP_PATH}/${s}`) });
      return;
    }

    // Node types `method` and `url` as optional; the MCP adapter requires both. Guard for real
    // — a request missing either is malformed — and then assert on the *same object*. Spreading
    // it into a new one would drop the prototype and stop it being a readable stream.
    if (!req.method || !req.url) {
      json(res, 400, { error: 'request has no method or url' });
      return;
    }
    void handler(req as typeof req & { method: string; url: string }, res);
  });
}

/** Only runs when this file is the entrypoint, so importing it in a test starts nothing. */
if (import.meta.main) {
  // No configuration means the reference institution, so the image answers questions out of the
  // box. An institution points LODGE_CONFIG at its own file and gets its own sources.
  const configPath = configPathFrom(process.env);

  const served: ServedInstitutions = configPath
    ? await (async () => {
        const config = await loadLodgeConfig(configPath);
        return { providers: await createProvidersFrom(config), defaultSlug: config.defaultSlug };
      })()
    : { providers: new Map([['default', createSyntheticProvider()]]), defaultSlug: 'default' };

  const server = createHttpServer(served);
  const listenOn = port(process.env);

  server.listen(listenOn, () => {
    for (const [slug, provider] of served.providers) {
      const { institution, tools } = describeDeployment(provider);
      const where = slug === served.defaultSlug ? MCP_PATH : `${MCP_PATH}/${slug}`;
      process.stdout.write(
        `Lodge :${listenOn}${where} — ${institution}, ${tools.length} tools: ${tools.join(', ')}\n`,
      );
    }
    if (devIdentityEnabled()) {
      process.stdout.write(
        'WARNING: LODGE_DEV_IDENTITY is on. Any caller can name themselves via a header. Development only.\n',
      );
    }
  });

  // Finish in-flight requests before exiting: a container stop should not cut a conversation off.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}
