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

  return createMcpHandler(
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
