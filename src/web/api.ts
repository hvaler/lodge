/**
 * The demonstration's API.
 *
 * Alexa+ for Builders is limited to selected partners, so the hackathon's guidance is to "simulate
 * an Alexa+ experience using your preferred agentic tools via a web app". This is the server half
 * of that simulation.
 *
 * It connects to Lodge **over HTTP, as an ordinary MCP client**, rather than calling the provider
 * in the same process. That costs a few milliseconds of loopback and is worth every one of them:
 * the thing being demonstrated is a server anyone's agent can speak to, and a demo that reached
 * inside the process would be demonstrating something else. Point `mcpUrl` at a Lodge running on
 * another machine and nothing here changes.
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { createOrchestrator } from '../orchestrator/index.ts';
import type { Card, Model, PriorTurn, TraceEntry, Usage } from '../orchestrator/index.ts';
import { DEV_SUBJECT_HEADER } from '../server/identity.ts';

/** One institution this demo can talk to. */
export interface DemoInstitution {
  readonly slug: string;
  readonly name: string;
  readonly locale: string;
  /** Absolute URL of its MCP endpoint, e.g. `http://localhost:3000/mcp/san-telmo`. */
  readonly mcpUrl: string;
  /** Who the demo can pretend to be there. Empty when the institution needs no identity. */
  readonly identities: readonly DemoIdentity[];
  /** Questions worth asking, so a demonstration does not depend on typing accurately. */
  readonly suggestions: readonly string[];
}

export interface DemoIdentity {
  readonly subject: string;
  readonly label: string;
}

export interface AskRequest {
  readonly institution: string;
  readonly utterance: string;
  /** Empty means an unauthenticated caller, which several tools correctly refuse. */
  readonly subject?: string;
  /**
   * What was said before, oldest first.
   *
   * Held by the page rather than the server, which keeps this endpoint as stateless as the thing
   * it is a client of. It is also what makes UC-05 work out loud: the agent asks "shall I file
   * it?", the person says "yes", and the model has its own question in front of it to act on.
   */
  readonly history?: readonly PriorTurn[];
}

export interface AskResponse {
  readonly institution: string;
  readonly said: string;
  readonly cards: readonly Card[];
  readonly trace: readonly TraceEntry[];
  readonly ms: number;
  readonly usage: Usage;
}

export class UnknownInstitutionError extends Error {
  constructor(slug: string) {
    super(`No institution called '${slug}' is configured in this demo.`);
    this.name = 'UnknownInstitutionError';
  }
}

/** The tool catalogue an institution publishes right now, read from the live server. */
export interface Catalogue {
  readonly slug: string;
  readonly name: string;
  readonly locale: string;
  readonly tools: readonly { readonly name: string; readonly description: string }[];
  readonly identities: readonly DemoIdentity[];
  readonly suggestions: readonly string[];
}

/**
 * The capabilities the demo client declares.
 *
 * The UI extension, because this client has a screen and cards should be attached for it. No
 * `elicitation`: over Streamable HTTP there is no server-to-client request channel to deliver one
 * on, so confirmation is an argument and a second call instead (ADR-011). Declaring a capability
 * the transport cannot carry would only hide that.
 */
const DEMO_CAPABILITIES = {
  extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
};

export interface DemoApiOptions {
  readonly institutions: readonly DemoInstitution[];
  /** Built per request rather than shared, so a model client is never reused across identities. */
  readonly model: Model;
}

export function createDemoApi(options: DemoApiOptions): {
  catalogues(): Promise<readonly Catalogue[]>;
  ask(request: AskRequest): Promise<AskResponse>;
} {
  const bySlug = new Map(options.institutions.map((i) => [i.slug, i]));

  /**
   * A fresh connection per request.
   *
   * Tempting to pool them, and wrong here: the identity travels as a connection header, so a
   * pooled client would need mutable state that two concurrent questions could read in the wrong
   * order. Handing one student another's timetable to save a loopback round trip is a bad trade,
   * and on a stateless server connecting costs almost nothing anyway.
   */
  async function connect(
    institution: DemoInstitution,
    subject: string | undefined,
  ): Promise<Client> {
    const client = new Client(
      { name: 'lodge-demo', version: '0.0.0' },
      { capabilities: DEMO_CAPABILITIES },
    );

    const transport = new StreamableHTTPClientTransport(new URL(institution.mcpUrl), {
      requestInit: subject ? { headers: { [DEV_SUBJECT_HEADER]: subject } } : {},
    });

    await client.connect(transport);
    return client;
  }

  return {
    async catalogues() {
      return Promise.all(
        options.institutions.map(async (institution) => {
          const client = await connect(institution, undefined);
          try {
            const { tools } = await client.listTools();
            return {
              slug: institution.slug,
              name: institution.name,
              locale: institution.locale,
              tools: tools.map((t) => ({ name: t.name, description: t.description ?? '' })),
              identities: institution.identities,
              suggestions: institution.suggestions,
            };
          } finally {
            await client.close();
          }
        }),
      );
    },

    async ask(request) {
      const institution = bySlug.get(request.institution);
      if (!institution) throw new UnknownInstitutionError(request.institution);

      const client = await connect(institution, request.subject);

      try {
        const orchestrator = createOrchestrator({ model: options.model, client });
        const exchange = await orchestrator.ask(
          request.utterance,
          { institution: institution.name, locale: institution.locale },
          request.history ?? [],
        );

        return {
          institution: institution.slug,
          said: exchange.said,
          cards: exchange.cards,
          trace: exchange.trace,
          ms: exchange.ms,
          usage: exchange.usage,
        };
      } finally {
        await client.close();
      }
    },
  };
}
