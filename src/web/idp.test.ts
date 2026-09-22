/**
 * The demonstration's sign-in, end to end over real sockets.
 *
 * `src/server/auth.test.ts` already proves Lodge verifies tokens. What it cannot prove is that the
 * *demonstration* obtains one: it mints its tokens directly with `SignJWT`, skipping the browser's
 * half of the flow entirely. This drives the half that was missing — the authorization request, the
 * code, the PKCE exchange — against a provider and a Lodge that are both listening on a port.
 *
 * That is L-002 applied to identity. The demonstration used to switch identities with a header, a
 * test of which would have proved nothing about OAuth; the point of these is that every step here
 * is the step a deployment runs.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import { campusInstant } from '../adapters/synthetic/campus.ts';
import { protect } from '../server/auth.ts';
import type { ProtectedInstitution } from '../server/auth.ts';
import { createHttpServer } from '../server/main.ts';
import { nodeToRequest, writeWebResponse } from '../shared/http.ts';
import { createDemoIdp } from './idp.ts';
import type { DemoIdp } from './idp.ts';

/** Tuesday 6 October 2026, 16:30 — the same instant the server's own auth tests pin. */
const NOW = campusInstant('2026-10-06', '16:30');
const REDIRECT = 'http://localhost:8080/';

const INSTITUCIONES = new Map([
  [
    'san-telmo',
    {
      name: 'Universidad de San Telmo',
      people: [
        { subject: 'est-0001', label: 'Estudiante de Derecho' },
        { subject: 'est-0002', label: 'Estudiante de Informática' },
      ],
    },
  ],
  [
    'carrigmore',
    { name: 'Carrigmore College', people: [{ subject: 'est-0003', label: 'Alguien de Carrigmore' }] },
  ],
]);

let idp: DemoIdp;
let idpServer: Server;
let idpOrigin: string;

let lodge: Server;
let publicUrl: string;
let guards: Map<string, ProtectedInstitution>;

async function listen(server: Server, port = 0): Promise<string> {
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

/** Wraps the provider's `fetch` in a Node server, the way `main.ts` does. */
function serve(handler: (request: Request) => Promise<Response | null>, origin: () => string): Server {
  return createServer((req, res) => {
    void (async () => {
      const response = (await handler(await nodeToRequest(req, origin()))) ?? new Response(null, { status: 404 });
      await writeWebResponse(res, response);
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
}

beforeAll(async () => {
  // The provider is started twice over for the same reason Lodge is: its own issuer has to be the
  // origin clients actually reach, and only listening tells us the port.
  const provisionalIdp = createServer(() => {});
  idpOrigin = await listen(provisionalIdp);
  await new Promise<void>((resolve) => provisionalIdp.close(() => resolve()));

  idp = await createDemoIdp({ issuer: idpOrigin, institutions: INSTITUCIONES, scopes: ['lodge.read'] });
  idpServer = serve((r) => idp.fetch(r), () => idpOrigin);
  await listen(idpServer, Number(new URL(idpOrigin).port));

  const provisionalLodge = createServer(() => {});
  publicUrl = await listen(provisionalLodge);
  await new Promise<void>((resolve) => provisionalLodge.close(() => resolve()));

  guards = new Map(
    (['san-telmo', 'carrigmore'] as const).map((slug) => [
      slug,
      protect({
        slug,
        institution: slug,
        config: { issuer: idp.issuer, jwksUri: idp.jwksUri, scopes: ['lodge.read'] },
        publicUrl,
        alone: false,
      }),
    ]),
  );

  lodge = createHttpServer(
    {
      providers: new Map([
        ['san-telmo', createSyntheticProvider()],
        ['carrigmore', createSyntheticProvider()],
      ]),
      defaultSlug: 'san-telmo',
      protection: guards,
    },
    { clock: () => NOW },
  );
  await listen(lodge, Number(new URL(publicUrl).port));
  // Two servers and an RSA key pair is not five seconds of work on a busy machine.
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => lodge.close(() => resolve()));
  await new Promise<void>((resolve) => idpServer.close(() => resolve()));
});

// ── The browser's half of PKCE ───────────────────────────────────────────────

function verifier(): string {
  return randomBytes(32).toString('base64url');
}

function challengeFor(v: string): string {
  return createHash('sha256').update(v).digest('base64url');
}

function authorizeUrl(slug: string, challenge: string, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: 'lodge-demo',
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: guards.get(slug)!.resource,
    scope: 'lodge.read',
    ...extra,
  });
  return `${idpOrigin}/authorize?${p.toString()}`;
}

/** Everything a click on "Entrar" does, as far as holding a token. */
async function signIn(subject: string, slug = 'san-telmo'): Promise<string> {
  const v = verifier();
  const granted = await fetch(authorizeUrl(slug, challengeFor(v), { subject }), { redirect: 'manual' });
  expect(granted.status).toBe(302);

  const code = new URL(granted.headers.get('location') ?? '').searchParams.get('code');
  expect(code).toBeTruthy();

  const exchanged = await fetch(`${idpOrigin}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code ?? '',
      redirect_uri: REDIRECT,
      client_id: 'lodge-demo',
      code_verifier: v,
    }),
  });
  expect(exchanged.status).toBe(200);

  const body = (await exchanged.json()) as { access_token: string; token_type: string };
  expect(body.token_type).toBe('Bearer');
  return body.access_token;
}

async function askTimetable(bearer: string | null, slug = 'san-telmo'): Promise<Response> {
  return fetch(`${publicUrl}/mcp/${slug}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'campus.timetable', arguments: {} },
    }),
  });
}

// ── What the demonstration now proves ────────────────────────────────────────

describe('signing in', () => {
  it('offers the people of that institution, and says it is not real authentication', async () => {
    const page = await (await fetch(authorizeUrl('san-telmo', challengeFor(verifier())))).text();

    // El titular nombra la institucion, no su slug: es lo que lee quien esta delante. El slug
    // sigue apareciendo en el 'resource' de los enlaces, que es donde le toca estar.
    expect(page).toMatch(/<h1[^>]*>Universidad de San Telmo<\/h1>/);
    expect(page).toContain('Estudiante de Derecho');
    expect(page).toContain('Estudiante de Informática');
    // Nobody should be able to mistake this for a product, least of all in a recorded video.
    expect(page).toContain('No hay contraseñas');
  });

  it('will not start a flow without PKCE', async () => {
    const p = new URLSearchParams({
      response_type: 'code',
      redirect_uri: REDIRECT,
      resource: guards.get('san-telmo')!.resource,
    });
    const refused = await fetch(`${idpOrigin}/authorize?${p.toString()}`);

    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('S256');
  });

  it('will not start a flow without a resource, because there is nothing to bind the token to', async () => {
    const p = new URLSearchParams({
      response_type: 'code',
      redirect_uri: REDIRECT,
      code_challenge: challengeFor(verifier()),
      code_challenge_method: 'S256',
    });

    expect((await fetch(`${idpOrigin}/authorize?${p.toString()}`)).status).toBe(400);
  });
});

describe('the exchange', () => {
  it('refuses a code redeemed with the wrong verifier', async () => {
    const granted = await fetch(
      authorizeUrl('san-telmo', challengeFor(verifier()), { subject: 'est-0001' }),
      { redirect: 'manual' },
    );
    const code = new URL(granted.headers.get('location') ?? '').searchParams.get('code') ?? '';

    const refused = await fetch(`${idpOrigin}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier(), // a different one, which is the whole point of PKCE
      }),
    });

    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('spends a code once', async () => {
    const v = verifier();
    const granted = await fetch(authorizeUrl('san-telmo', challengeFor(v), { subject: 'est-0001' }), {
      redirect: 'manual',
    });
    const code = new URL(granted.headers.get('location') ?? '').searchParams.get('code') ?? '';
    const body = (): URLSearchParams =>
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        code_verifier: v,
      });
    const post = async (): Promise<Response> =>
      fetch(`${idpOrigin}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body(),
      });

    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(400);
  });
});

describe('what Lodge does with the token', () => {
  it('gives two people two different timetables — UC-02, through a real sign-in', async () => {
    const [law, computing] = await Promise.all([
      signIn('est-0001').then((t) => askTimetable(t)).then((r) => r.text()),
      signIn('est-0002').then((t) => askTimetable(t)).then((r) => r.text()),
    ]);

    expect(law).not.toBe(computing);
    expect(law).toContain('DER-');
    expect(computing).toContain('INF-');
  });

  it('answers a request with no token with a 401 that says where to get one', async () => {
    // What "Not identified" means now: not a label on a button, an actual absence of credentials.
    const refused = await askTimetable(null);

    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toContain(guards.get('san-telmo')!.metadataUrl);
  });

  it('refuses a token minted for the other institution — RFC 8707, through the real flow', async () => {
    // Same provider, same signing key, same process serving both. The token still must not work
    // here, because the sign-in that produced it named somewhere else.
    const elsewhere = await signIn('est-0003', 'carrigmore');

    expect((await askTimetable(elsewhere, 'san-telmo')).status).toBe(401);
    expect((await askTimetable(elsewhere, 'carrigmore')).status).toBe(200);
  });
});
