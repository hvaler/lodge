/**
 * The MCP server.
 *
 * Streamable HTTP, stateless, serving both protocol eras from one factory. Stateless is a
 * deliberate property rather than a consequence: a server meant to be deployed on other people's
 * infrastructure has to replicate without coordination, and `createMcpHandler` keeps nothing
 * between requests (ADR-009).
 */

import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import type { McpHttpHandler, McpRequestContext } from '@modelcontextprotocol/server';

import type { Provider, RequestContext } from '../provider/index.ts';
import { assertProviderCoherent, toolCatalogue } from '../provider/index.ts';
import { contextFrom, traced, within } from '../telemetry/index.ts';
import { registerTools } from '../tools/index.ts';
import { devPrincipalFrom, principalFrom } from './identity.ts';

export const SERVER_NAME = 'lodge';
export const SERVER_VERSION = '0.0.0';

export interface LodgeServerOptions {
  /** Injected so tests can pin it and the synthetic adapter stays reproducible. */
  readonly clock?: () => Date;
  readonly onError?: (error: Error) => void;
  readonly env?: NodeJS.ProcessEnv;
}

/** What a request says about itself, read without consuming the body the handler still needs. */
interface Peeked {
  readonly method: string;
  readonly tool?: string;
  readonly meta?: Record<string, unknown>;
}

/**
 * Reads the JSON-RPC envelope off a clone of the request.
 *
 * A clone because the original body is a stream the handler is about to read, and a request whose
 * body has already been consumed answers nothing. Best-effort throughout: a malformed body is the
 * handler's business to reject, and a span is never a reason to fail a request that would otherwise
 * have worked.
 */
async function peek(request: Request): Promise<Peeked | null> {
  if (request.method !== 'POST') return null;

  try {
    const body = (await request.clone().json()) as {
      method?: unknown;
      params?: { name?: unknown; _meta?: Record<string, unknown> };
    };
    if (typeof body.method !== 'string') return null;

    return {
      method: body.method,
      ...(typeof body.params?.name === 'string' ? { tool: body.params.name } : {}),
      ...(body.params?._meta ? { meta: body.params._meta } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * One span per MCP request, continuing whatever trace the caller was already in.
 *
 * Wrapped here rather than around each tool: this is the boundary the 500 ms budget is
 * measured at, and it is the only place that sees the request as a whole. The adapters add their
 * own spans underneath for the parts that actually go somewhere — a directory lookup, a calendar
 * fetch — which is where a slow answer will turn out to have been spent.
 */
function withRequestSpan(handler: McpHttpHandler, provider: Provider): McpHttpHandler {
  return {
    ...handler,
    async fetch(request: Request, options?: Parameters<McpHttpHandler['fetch']>[1]) {
      const rpc = await peek(request);
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Headers first, `_meta` second so the protocol client's own value wins over whatever proxy
      // last touched the connection.
      const caller = contextFrom([headers, rpc?.meta]);
      const name = rpc ? (rpc.tool ? `${rpc.method} ${rpc.tool}` : rpc.method) : request.method;

      return within(caller, () =>
        traced(
          name,
          {
            'rpc.system': 'jsonrpc',
            ...(rpc ? { 'mcp.method.name': rpc.method } : {}),
            ...(rpc?.tool ? { 'mcp.tool.name': rpc.tool } : {}),
            'lodge.institution': provider.descriptor.institution,
            'lodge.adapter': provider.descriptor.id,
          },
          async (span) => {
            const response = await handler.fetch(request, options);
            span.setAttribute('http.response.status_code', response.status);
            return response;
          },
        ),
      );
    },
  };
}

/** Where the MCP endpoint lives. One institution answers here; several answer beneath it. */
export const MCP_PATH = '/mcp';

/**
 * Which institution a path is asking for.
 *
 * `/mcp` is the default one, `/mcp/{slug}` is that one by name, and nothing deeper is an endpoint.
 * Shared by the Node server and the Lambda entry point rather than written twice: they serve the
 * same URLs, and two copies of this would drift the first time one of them gained an institution.
 *
 * - a slug — serve it (it may still not exist; the caller says so)
 * - `null` — several are served and none is the default, so `/mcp` cannot answer without guessing
 * - `undefined` — not an MCP path at all
 */
export function institutionFor(path: string, defaultSlug: string | null): string | null | undefined {
  if (path === MCP_PATH) return defaultSlug;
  if (!path.startsWith(`${MCP_PATH}/`)) return undefined;

  const rest = path.slice(MCP_PATH.length + 1);
  return rest.length > 0 && !rest.includes('/') ? rest : undefined;
}

/**
 * Builds the HTTP handler for one provider.
 *
 * The coherence check runs here, once, rather than per request: an adapter that declares a
 * capability it does not implement should stop the process at start-up, not surface halfway
 * through somebody's conversation.
 */
export function createLodgeHandler(provider: Provider, options: LodgeServerOptions = {}): McpHttpHandler {
  assertProviderCoherent(provider);

  const clock = options.clock ?? ((): Date => new Date());

  const handler = createMcpHandler(
    (mcpCtx: McpRequestContext) => {
      const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        { capabilities: { tools: {} } },
      );

      // The principal is settled once per HTTP request, from the verified token. The development
      // override only ever applies when it has been switched on explicitly.
      const principal =
        principalFrom(mcpCtx.authInfo) ?? devPrincipalFrom(mcpCtx.requestInfo, options.env);

      const resolveContext = (): RequestContext => ({
        principal,
        now: clock(),
        locale: provider.descriptor.locale,
      });

      registerTools(server, provider, resolveContext);
      return server;
    },
    {
      // Each 2025-era request is answered on its own and holds nothing afterwards, which is what
      // lets a replica that has never seen this caller answer them correctly.
      legacy: 'stateless',
      ...(options.onError ? { onerror: options.onError } : {}),
    },
  );

  return withRequestSpan(handler, provider);
}

/** What this deployment is serving. Useful in a health probe and in the adoption guide. */
export function describeDeployment(provider: Provider): {
  server: string;
  version: string;
  institution: string;
  locale: string;
  timeZone: string;
  capabilities: readonly string[];
  tools: readonly string[];
} {
  return {
    server: SERVER_NAME,
    version: SERVER_VERSION,
    institution: provider.descriptor.institution,
    locale: provider.descriptor.locale,
    timeZone: provider.descriptor.timeZone,
    capabilities: provider.descriptor.capabilities,
    tools: toolCatalogue(provider),
  };
}
