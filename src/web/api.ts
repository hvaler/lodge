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
  /** Its own time zone, so the model is told the date the institution is actually living in. */
  readonly timeZone: string;
  /** Absolute URL of its MCP endpoint, e.g. `http://localhost:3000/mcp/san-telmo`. */
  readonly mcpUrl: string;
  /** Who the demo can pretend to be there. Empty when the institution needs no identity. */
  readonly identities: readonly DemoIdentity[];
  /** Questions worth asking, so a demonstration does not depend on typing accurately. */
  readonly suggestions: readonly string[];
  /**
   * Where to sign in for this institution, when it is protected.
   *
   * Absent means the demonstration is running with `--dev-identity` and the page falls back to
   * picking an identity outright. Present means a real authorization-code flow: the page sends
   * somebody to `authorizeUrl`, exchanges the code at `tokenUrl`, and the token it gets back names
   * `resource` as its audience — which is what stops it working at another institution.
   */
  readonly signIn?: {
    readonly authorizeUrl: string;
    readonly tokenUrl: string;
    readonly resource: string;
  };
}

export interface DemoIdentity {
  readonly subject: string;
  readonly label: string;
}

export interface AskRequest {
  readonly institution: string;
  readonly utterance: string;
  /**
   * The access token from the sign-in, when there is one.
   *
   * Absent means an unauthenticated caller — which is now a real absence of credentials rather than
   * a label, so the server answers 401 and several tools correctly refuse.
   */
  readonly token?: string;
  /** Only with `--dev-identity`: the header bypass, kept for the day a recording cannot wait. */
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
  /** Where to sign in, when this institution is protected. Never carries a token. */
  readonly signIn?: DemoInstitution['signIn'];
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
  /**
   * Slug → the demonstration's own token, for reading tool catalogues.
   *
   * The page draws the catalogue before anyone signs in, and `tools/list` sits behind the same
   * protected endpoint as everything else. So the backend is a client in its own right. These stay
   * here and never reach the browser: what `/api/institutions` returns is `signIn`, not a token.
   */
  readonly serviceTokens?: ReadonlyMap<string, string>;
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
    credentials: { readonly token?: string; readonly subject?: string },
  ): Promise<Client> {
    const client = new Client(
      { name: 'lodge-demo', version: '0.0.0' },
      { capabilities: DEMO_CAPABILITIES },
    );

    // A bearer token when the institution is protected; the development header only when the
    // demonstration was started with `--dev-identity` and there is no token to carry.
    const headers = credentials.token
      ? { authorization: `Bearer ${credentials.token}` }
      : credentials.subject
        ? { [DEV_SUBJECT_HEADER]: credentials.subject }
        : undefined;

    const transport = new StreamableHTTPClientTransport(new URL(institution.mcpUrl), {
      requestInit: headers ? { headers } : {},
    });

    await client.connect(transport);
    return client;
  }

  return {
    async catalogues() {
      return Promise.all(
        options.institutions.map(async (institution) => {
          const service = options.serviceTokens?.get(institution.slug);
          const client = await connect(institution, service ? { token: service } : {});
          try {
            const { tools } = await client.listTools();
            return {
              slug: institution.slug,
              name: institution.name,
              locale: institution.locale,
              tools: tools.map((t) => ({ name: t.name, description: t.description ?? '' })),
              identities: institution.identities,
              suggestions: institution.suggestions,
              ...(institution.signIn ? { signIn: institution.signIn } : {}),
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

      const client = await connect(institution, {
        ...(request.token ? { token: request.token } : {}),
        ...(request.subject ? { subject: request.subject } : {}),
      });

      try {
        const orchestrator = createOrchestrator({ model: options.model, client });
        const exchange = await orchestrator.ask(
          request.utterance,
          {
            institution: institution.name,
            locale: institution.locale,
            timeZone: institution.timeZone,
          },
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
