/**
 * OAuth 2.1, against real signatures.
 *
 * No mocked verifier and no stubbed JWKS: a key pair is generated, the public half is served over
 * HTTP the way an identity provider serves it, and every token below is signed for real. A mocked
 * verifier would prove that our own mock says yes, which is not the question.
 *
 * The test that matters most is the audience one. Lodge answers for several institutions from one
 * process, and the only thing keeping Carrigmore's token from working at San Telmo's endpoint is
 * the RFC 8707 binding. If that check is wrong, UC-07 is a security hole rather than a feature.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';

import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { campusInstant } from '../adapters/synthetic/campus.ts';
import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import { protect } from './auth.ts';
import type { ProtectedInstitution } from './auth.ts';
import { createHttpServer } from './main.ts';

const NOW = campusInstant('2026-10-06', '16:30');
const KID = 'test-key';

/** Stands in for the institution's identity provider. Serves one document: its public keys. */
let idp: Server;
let issuer: string;
let jwksUri: string;
let signingKey: CryptoKey;

/** Lodge itself, protected. */
let lodge: Server;
let publicUrl: string;
let guards: Map<string, ProtectedInstitution>;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  signingKey = privateKey;

  const jwks = JSON.stringify({
    keys: [{ ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' }],
  });

  idp = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(jwks);
  });
  issuer = await listen(idp);
  jwksUri = `${issuer}/jwks`;

  // Lodge is started twice over: once to learn its own port, because the canonical URI a token is
  // bound to has to be the URL clients actually reach. A deployment reads it from configuration;
  // a test has to discover it.
  const provisional = createServer(() => {});
  publicUrl = await listen(provisional);
  await new Promise<void>((resolve) => provisional.close(() => resolve()));

  guards = new Map(
    (['san-telmo', 'carrigmore'] as const).map((slug) => [
      slug,
      protect({
        slug,
        institution: slug,
        config: { issuer, jwksUri, scopes: ['lodge.read'] },
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

  const port = new URL(publicUrl).port;
  await new Promise<void>((resolve) => lodge.listen(Number(port), '127.0.0.1', resolve));
  // Generating an RSA key pair and standing up two servers is not five seconds of work on an idle
  // machine and can be on a busy one. A setup that times out under load reads as a broken test.
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => lodge.close(() => resolve()));
  await new Promise<void>((resolve) => idp.close(() => resolve()));
});

interface TokenOptions {
  readonly audience?: string;
  readonly issuer?: string;
  readonly subject?: string;
  readonly scope?: string;
  readonly expiresIn?: string;
  readonly claims?: Record<string, unknown>;
}

async function token(options: TokenOptions = {}): Promise<string> {
  return new SignJWT({ scope: options.scope ?? 'lodge.read', ...options.claims })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt()
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? guards.get('san-telmo')!.resource)
    .setSubject(options.subject ?? 'est-0001')
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(signingKey);
}

/** One `tools/call`, with whatever Authorization header the test wants. */
async function callTool(bearer: string | null, slug = 'san-telmo'): Promise<Response> {
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

describe('the discovery document', () => {
  it('is served where RFC 9728 says to look for it', async () => {
    const response = await fetch(`${publicUrl}/.well-known/oauth-protected-resource/mcp/carrigmore`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: `${publicUrl}/mcp/carrigmore`,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['lodge.read'],
      resource_name: 'carrigmore',
    });
  });

  it('needs no token, because the client asking has not got one yet', async () => {
    const response = await fetch(`${publicUrl}/.well-known/oauth-protected-resource/mcp/san-telmo`);

    expect(response.status).toBe(200);
  });

  it('names each institution its own resource, so one token cannot mean both', async () => {
    const [one, other] = await Promise.all(
      ['san-telmo', 'carrigmore'].map(async (slug) =>
        ((await (await fetch(`${publicUrl}/.well-known/oauth-protected-resource/mcp/${slug}`)).json()) as {
          resource: string;
        }).resource,
      ),
    );

    expect(one).not.toBe(other);
  });
});

describe('the gate', () => {
  it('refuses a request with no token and says where to get one', async () => {
    const response = await callTool(null);

    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toMatch(/^Bearer/);
    expect(challenge).toContain(guards.get('san-telmo')!.metadataUrl);
  });

  it('admits a properly signed token and answers as whoever it names', async () => {
    const response = await callTool(await token({ subject: 'est-0001' }));

    expect(response.status).toBe(200);
    // est-0001 reads law, so the answer carries law course codes and not computing ones.
    const body = await response.text();
    expect(body).toContain('DER-');
    expect(body).not.toContain('tienes que identificarte');
  });

  it('gives two tokens two different timetables (UC-02, now through real identity)', async () => {
    const [law, computing] = await Promise.all([
      callTool(await token({ subject: 'est-0001' })).then((r) => r.text()),
      callTool(await token({ subject: 'est-0002' })).then((r) => r.text()),
    ]);

    expect(law).not.toBe(computing);
    expect(law).toContain('DER-');
    expect(computing).toContain('INF-');
  });

  it('refuses a token minted for the other institution on this server', async () => {
    // The whole of UC-07's trust boundary. Same process, same issuer, same signing key — and the
    // token still must not work here, because it was addressed somewhere else.
    const forCarrigmore = await token({ audience: guards.get('carrigmore')!.resource });

    const response = await callTool(forCarrigmore, 'san-telmo');

    expect(response.status).toBe(401);
  });

  it('accepts that same token at the endpoint it was actually meant for', async () => {
    const forCarrigmore = await token({ audience: guards.get('carrigmore')!.resource });

    expect((await callTool(forCarrigmore, 'carrigmore')).status).toBe(200);
  });

  it('refuses a token signed by somebody else entirely', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const forged = await new SignJWT({ scope: 'lodge.read' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(guards.get('san-telmo')!.resource)
      .setSubject('est-0001')
      .setExpirationTime('5m')
      .sign(privateKey);

    expect((await callTool(forged)).status).toBe(401);
  });

  it('refuses a token from an issuer this institution does not trust', async () => {
    expect((await callTool(await token({ issuer: 'https://login.elsewhere.example' }))).status).toBe(401);
  });

  it('refuses an expired token', async () => {
    expect((await callTool(await token({ expiresIn: '-1s' }))).status).toBe(401);
  });

  it('refuses a token that is missing the scope this institution requires', async () => {
    const response = await callTool(await token({ scope: 'openid profile' }));

    // 403 rather than 401: the token is real, it just does not authorise this.
    expect(response.status).toBe(403);
  });

  it('refuses a token carrying no subject, rather than answering as nobody', async () => {
    const anonymous = await new SignJWT({ scope: 'lodge.read' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(guards.get('san-telmo')!.resource)
      .setExpirationTime('5m')
      .sign(signingKey);

    expect((await callTool(anonymous)).status).toBe(401);
  });
});

describe('the subject claim is configurable', () => {
  it('reads the claim the institution named instead of sub', async () => {
    // An institution whose IdP mints opaque subjects but whose directory keys on `uid`.
    const guard = protect({
      slug: 'san-telmo',
      institution: 'San Telmo',
      config: { issuer, jwksUri, subjectClaim: 'uid' },
      publicUrl,
      alone: false,
    });

    const opaque = await new SignJWT({ uid: 'est-0002' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(guard.resource)
      .setSubject('8f14e45fceea167a5a36dedd4bea2543')
      .setExpirationTime('5m')
      .sign(signingKey);

    const authInfo = await guard.verifier.verifyAccessToken(opaque);

    expect(authInfo.extra?.['sub']).toBe('est-0002');
  });
});
