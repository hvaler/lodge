/**
 * Node entrypoint for the self-hosted deployment.
 *
 * Kept small and boring on purpose: an institution's IT lead should be able to read this file and
 * see exactly what is exposed. Routing is three paths and no framework.
 */

import { createServer } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';

import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import { configPathFrom, createProviderFrom, loadLodgeConfig } from './config.ts';
import type { Provider } from '../provider/index.ts';
import { createLodgeHandler, describeDeployment } from './index.ts';
import type { LodgeServerOptions } from './index.ts';
import { devIdentityEnabled } from './identity.ts';

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

export function createHttpServer(
  provider: Provider = createSyntheticProvider(),
  options: LodgeServerOptions = {},
) {
  const mcp = toNodeHandler(createLodgeHandler(provider, options));
  const health = JSON.stringify({ status: 'ok', ...describeDeployment(provider) });

  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];

    if (path === HEALTH_PATH) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(health);
      return;
    }

    if (path === MCP_PATH) {
      // Node types `method` and `url` as optional; the MCP adapter requires both. Guard for real
      // — a request missing either is malformed — and then assert on the *same object*. Spreading
      // it into a new one would drop the prototype and stop it being a readable stream.
      if (!req.method || !req.url) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'request has no method or url' }));
        return;
      }
      void mcp(req as typeof req & { method: string; url: string }, res);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', paths: [MCP_PATH, HEALTH_PATH] }));
  });
}

/** Only runs when this file is the entrypoint, so importing it in a test starts nothing. */
if (import.meta.main) {
  // No configuration means the reference institution, so the image answers questions out of the
  // box. An institution points LODGE_CONFIG at its own file and gets its own sources.
  const configPath = configPathFrom(process.env);
  const provider = configPath
    ? await createProviderFrom(await loadLodgeConfig(configPath))
    : createSyntheticProvider();

  const server = createHttpServer(provider);
  const listenOn = port(process.env);

  server.listen(listenOn, () => {
    const { institution, tools } = describeDeployment(provider);
    process.stdout.write(
      `Lodge listening on :${listenOn}${MCP_PATH} — ${institution}, ${tools.length} tools: ${tools.join(', ')}\n`,
    );
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
