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
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';
import { bearerAuthChallengeResponse, verifyBearerToken } from '@modelcontextprotocol/server';
import type { AuthInfo } from '@modelcontextprotocol/server';

import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import type { Provider } from '../provider/index.ts';
import { protect, publicUrlFrom } from './auth.ts';
import type { ProtectedInstitution } from './auth.ts';
import { configPathFrom, createProvidersFrom, loadLodgeConfig } from './config.ts';
import { devIdentityEnabled } from './identity.ts';
import { startTelemetry } from '../telemetry/setup.ts';
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
  /**
   * Slug → OAuth protection. A slug that is absent is served without a token.
   *
   * Per institution rather than per deployment because the identity provider is the institution's,
   * and UC-07's single server answers for two of them. One may be behind its college's OIDC while
   * the other is still open on a private network.
   */
  readonly protection?: ReadonlyMap<string, ProtectedInstitution>;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Writes a web-standard `Response` — what the SDK's auth helpers build — to a Node response. */
async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(await response.text());
}

/**
 * Checks the bearer token, or answers the challenge itself.
 *
 * The verified token is attached as `req.auth`, which is what `toNodeHandler` forwards to the
 * handler as `authInfo` — so `principalFrom` reads a subject that a signature has already vouched
 * for, and nothing below this line has to think about tokens at all.
 *
 * A refusal carries `WWW-Authenticate` naming the metadata document, which is how a client that
 * arrived with no token finds out where to go and get one (RFC 9728).
 */
async function admits(
  guard: ProtectedInstitution,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const challenge = {
    requiredScopes: guard.requiredScopes,
    resourceMetadataUrl: guard.metadataUrl,
  };

  try {
    const authInfo = await verifyBearerToken(req.headers.authorization, {
      verifier: guard.verifier,
      ...challenge,
    });
    (req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo;
    return true;
  } catch (error) {
    await writeWebResponse(res, bearerAuthChallengeResponse(error, challenge));
    return false;
  }
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

  const protection = institutions.protection ?? new Map<string, ProtectedInstitution>();

  // The discovery documents, indexed by the path each is served at. Answered before anything that
  // needs a token, because a client with no token yet is exactly who comes looking for them. A
  // deployment that also answers at bare `/mcp` publishes the default institution's document there
  // too; the `resource` inside still names the canonical URI, which is what a client binds to.
  const metadata = new Map<string, string>();
  for (const [slug, guard] of protection) {
    metadata.set(guard.metadataPath, JSON.stringify(guard.metadata));
    if (slug === institutions.defaultSlug) {
      metadata.set(`/.well-known/oauth-protected-resource${MCP_PATH}`, JSON.stringify(guard.metadata));
    }
  }

  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    const document = metadata.get(path);
    if (document !== undefined) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(document);
      return;
    }

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

    const guard = protection.get(slug);
    if (!guard) {
      void handler(req as typeof req & { method: string; url: string }, res);
      return;
    }

    void admits(guard, req, res).then((ok) => {
      if (ok) void handler(req as typeof req & { method: string; url: string }, res);
    });
  });
}

/** Only runs when this file is the entrypoint, so importing it in a test starts nothing. */
if (import.meta.main) {
  // No configuration means the reference institution, so the image answers questions out of the
  // box. An institution points LODGE_CONFIG at its own file and gets its own sources.
  const configPath = configPathFrom(process.env);

  // Before anything else, so the spans the first request emits have somewhere to go. Returns null
  // and costs nothing when no collector is configured, which is the default.
  const telemetry = await startTelemetry(process.env);

  const config = configPath ? await loadLodgeConfig(configPath) : null;
  const publicUrl = publicUrlFrom(process.env);

  // Protection is built from the configuration and the public URL together: an issuer without a
  // canonical URI to bind tokens to would accept a token minted for somebody else's server, which
  // is worse than no OAuth at all because it looks like some.
  const built = config ? await createProvidersFrom(config) : null;

  const protection = new Map<string, ProtectedInstitution>();
  if (config && built && publicUrl) {
    const alone = config.institutions.size === 1;
    for (const [slug, institution] of config.institutions) {
      const auth = institution.auth;
      if (!auth) continue;
      protection.set(
        slug,
        protect({
          slug,
          // The provider's own name, not the slug: `resource_name` is what a consent screen shows
          // the person being asked to authorise, and "default" tells them nothing.
          institution: built.get(slug)?.descriptor.institution ?? slug,
          // Keys omitted rather than set to undefined: zod infers `scopes?: string[] | undefined`,
          // and under `exactOptionalPropertyTypes` that is a different type from `scopes?: string[]`.
          config: {
            issuer: auth.issuer,
            jwksUri: auth.jwksUri,
            ...(auth.scopes ? { scopes: auth.scopes } : {}),
            ...(auth.subjectClaim ? { subjectClaim: auth.subjectClaim } : {}),
          },
          publicUrl,
          alone,
        }),
      );
    }
  }

  const served: ServedInstitutions = built
    ? { providers: built, defaultSlug: config!.defaultSlug, protection }
    : { providers: new Map([['default', createSyntheticProvider()]]), defaultSlug: 'default' };

  const server = createHttpServer(served);
  const listenOn = port(process.env);

  server.listen(listenOn, () => {
    for (const [slug, provider] of served.providers) {
      const { institution, tools } = describeDeployment(provider);
      const where = slug === served.defaultSlug ? MCP_PATH : `${MCP_PATH}/${slug}`;
      const guard = protection.get(slug);
      process.stdout.write(
        `Lodge :${listenOn}${where} — ${institution}, ${tools.length} tools: ${tools.join(', ')}\n` +
          (guard
            ? `  OAuth: tokens from ${guard.metadata.authorization_servers?.[0]}, for ${guard.resource}\n`
            : `  OAuth: NOT CONFIGURED — this endpoint answers without a token\n`),
      );
    }

    // Said once and plainly rather than per institution: an operator who meant to configure OAuth
    // and mistyped the variable should find out now, not from an access log.
    if (config && !publicUrl && [...config.institutions.values()].some((i) => i.auth)) {
      process.stdout.write(
        'WARNING: institutions configure an issuer but LODGE_PUBLIC_URL is unset, so no token is\n' +
          'checked. Tokens are bound to this server\'s canonical URI, and without it there is\n' +
          'nothing to bind them to.\n',
      );
    }
    if (devIdentityEnabled()) {
      process.stdout.write(
        'WARNING: LODGE_DEV_IDENTITY is on. Any caller can name themselves via a header. Development only.\n',
      );
    }
  });

  // Finish in-flight requests before exiting: a container stop should not cut a conversation off.
  /**
   * Shutting down without cutting a conversation off, and without hanging on one.
   *
   * `server.close()` stops accepting and waits for open connections, which is what finishes the
   * request somebody is mid-way through. On its own that is not enough: a keep-alive connection
   * that nobody is using will hold it open until it times out, so idle ones are closed explicitly.
   * And the flush runs alongside rather than inside the close callback — the last trace of a run is
   * usually the one being looked for, and it should not depend on a socket letting go first.
   *
   * The deadline is the backstop. A container stop that never finishes gets killed anyway, and
   * being killed at a moment of our choosing is tidier than being killed at the platform's.
   */
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;

      const deadline = setTimeout(() => process.exit(0), 5_000);
      deadline.unref();

      server.close();
      server.closeIdleConnections();

      void Promise.allSettled([telemetry?.shutdown() ?? Promise.resolve()]).then(() =>
        process.exit(0),
      );
    });
  }
}
