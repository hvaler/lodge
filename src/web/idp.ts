/**
 * A stand-in identity provider, for the demonstration only.
 *
 * Lodge does not issue tokens and is not going to (ADR-013): an institution that has a directory
 * almost certainly has an OIDC provider in front of it, and the thing nobody wants to deploy is a
 * second place where their students' passwords live. So this lives beside the Alexa+ simulation in
 * `src/web/`, never in `src/server/`, and it stands in for the institution's own provider exactly
 * as the orchestrator stands in for Alexa+.
 *
 * It exists because the demonstration used to resolve identity with `LODGE_DEV_IDENTITY` and an
 * `x-lodge-dev-subject` header, which is an authentication bypass. UC-02 — "same question, two
 * people, two answers" — was being shown with a control that proves nothing: no token, no
 * signature, no audience. Now the page performs a real authorization-code flow with PKCE and Lodge
 * verifies what comes back, which is the same code path a deployment runs.
 *
 * What it is NOT: a product. There are no passwords, the login page says so, the codes live in
 * memory and the signing key is generated fresh on every start. It is a demonstration of the
 * *protocol*, not of authentication.
 *
 * Two things it deliberately leaves out, written down so nobody has to guess whether they were
 * forgotten:
 *
 * - **The `client_credentials` grant authenticates no client.** Anything that can reach this port
 *   can mint a token naming `lodge-demo`. It is a loopback service over invented data, and the
 *   token it hands out cannot answer for a person — the tools that speak about somebody resolve
 *   against the subject, and that subject is not one. A real provider would want a secret here.
 * - **`state` is passed through but not required.** The page binds its callback with the PKCE
 *   verifier it kept in `sessionStorage`, which covers the same ground for a public client. A real
 *   provider should demand it.
 *
 * What is NOT optional, and is checked: the `redirect_uri` must be one that was registered. Without
 * that this is an open redirector that hands out authorization codes, and PKCE does not help —
 * whoever crafts the link knows their own verifier.
 */

import { createHash, randomUUID } from 'node:crypto';

import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { CryptoKey } from 'jose';

/** Someone the demonstration can sign in as, per institution. */
export interface DemoLogin {
  readonly subject: string;
  readonly label: string;
}

export interface DemoIdpOptions {
  /** Absolute origin this provider is reachable at, e.g. `http://127.0.0.1:9000`. No trailing slash. */
  readonly issuer: string;
  /** Institution slug → its name and who can sign in there. Absent from the map means nobody. */
  readonly institutions: ReadonlyMap<string, { readonly name: string; readonly people: readonly DemoLogin[] }>;
  /**
   * Exactly where a code may be sent back to. Compared as whole strings, never by prefix.
   *
   * Without this the provider is an open redirector that hands out authorization codes: anyone can
   * craft `/authorize?…&redirect_uri=https://somewhere.else/` and collect the code of whoever
   * follows the link. PKCE does not save you — an attacker who starts the flow knows their own
   * verifier. The registered-URI check is the part that does, and it is why OAuth has one.
   */
  readonly redirectUris: readonly string[];
  /** Scopes minted into every token. Must cover whatever the institutions require. */
  readonly scopes?: readonly string[];
  /** Overridable so tests can drive expiry without waiting. */
  readonly clock?: () => number;
}

export interface DemoIdp {
  readonly issuer: string;
  readonly jwksUri: string;
  /** Answers a request, or `null` when the path is not one of ours. */
  fetch(request: Request): Promise<Response | null>;
}

/** How long an authorization code stays usable. Short: it is redeemed within the same click. */
const CODE_TTL_MS = 60_000;
const TOKEN_TTL_SECONDS = 600;

/** Who the demonstration backend is when it reads a catalogue. Never a person. */
export const SERVICE_SUBJECT = 'lodge-demo';

interface PendingCode {
  readonly subject: string;
  readonly challenge: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly expiresAt: number;
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/** The S256 half of PKCE, which is the only method this accepts. */
function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // A public client exchanging a code from the browser is the ordinary OAuth 2.1 shape, and it
      // needs CORS. Permissive here because everything this serves is invented.
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** OAuth says errors come back on the redirect when we have one we can trust, and inline otherwise. */
function badRequest(message: string): Response {
  return html(
    `<!doctype html><meta charset="utf-8"><title>No se puede continuar</title>` +
      `<body style="font:16px/1.6 system-ui;margin:3rem auto;max-width:34rem;color:#12161b">` +
      `<h1 style="font-size:1.3rem">No se puede continuar</h1><p>${message}</p></body>`,
    400,
  );
}

const PAGINA = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acceso · __INSTITUCION__</title>
<style>
 *{box-sizing:border-box}
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eceef1;
   font:400 16px/1.55 "Segoe UI",system-ui,sans-serif;color:#12161b;padding:2rem 1rem}
 .caja{background:#fff;max-width:29rem;width:100%;padding:2.4rem 2.4rem 2rem;border-radius:10px;
   box-shadow:0 1px 3px rgba(16,22,30,.09),0 10px 34px rgba(16,22,30,.08)}
 .et{font-size:.68rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#6e1622;margin:0 0 .5rem}
 h1{font-size:1.5rem;font-weight:600;margin:0 0 .3rem;letter-spacing:-.01em}
 .sub{margin:0 0 1.6rem;color:#5a636e;font-size:.95rem}
 a.quien{display:flex;align-items:center;gap:.8rem;padding:.85rem 1rem;border:1px solid #dfe3e8;
   border-radius:8px;text-decoration:none;color:inherit;margin-bottom:.55rem;transition:border-color .15s,background .15s}
 a.quien:hover{border-color:#6e1622;background:#faf7f7}
 .ini{width:34px;height:34px;flex:none;border-radius:50%;background:#6e1622;color:#fff;
   display:grid;place-items:center;font-size:.85rem;font-weight:600}
 .aviso{margin:1.5rem 0 0;padding:.8rem 1rem;background:#fff8e6;border:1px solid #e6d9a8;
   border-radius:6px;font-size:.84rem;line-height:1.5;color:#5a4d24}
 code{font:.85em ui-monospace,Consolas,monospace;background:#f2f4f6;border-radius:3px;padding:.08em .32em}
</style></head>
<body><div class="caja">
 <p class="et">Proveedor de identidad de demostración</p>
 <h1>__INSTITUCION__</h1>
 <p class="sub">Elige con quién quieres entrar.</p>
 __OPCIONES__
 <p class="aviso"><b>Esto no es un sistema de autenticación.</b> No hay contraseñas: es un suplente
 del proveedor de identidad que trae la institución, y existe para que la demostración use un token
 de verdad en vez de una cabecera. Lodge <b>verifica</b> tokens y nunca los emite.</p>
</div></body></html>`;

/**
 * Builds the provider.
 *
 * Async because the signing key is generated here: a fresh RS256 pair per start, never on disk,
 * so nothing about this can be mistaken for something to deploy.
 */
export async function createDemoIdp(options: DemoIdpOptions): Promise<DemoIdp> {
  const issuer = options.issuer.replace(/\/+$/, '');
  const now = options.clock ?? ((): number => Date.now());
  const scopes = options.scopes ?? [];

  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = randomUUID();
  const jwks = JSON.stringify({
    keys: [{ ...(await exportJWK(publicKey as CryptoKey)), kid, use: 'sig', alg: 'RS256' }],
  });

  const codes = new Map<string, PendingCode>();

  /** The audience is the institution's canonical URI (RFC 8707), and that is the whole point of it:
   * a token minted for one institution is useless at another served by the same process. */
  async function mint(subject: string, resource: string): Promise<string> {
    return new SignJWT({ ...(scopes.length ? { scope: scopes.join(' ') } : {}) })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(issuer)
      .setSubject(subject)
      .setAudience(resource)
      .setIssuedAt(Math.floor(now() / 1000))
      .setExpirationTime(Math.floor(now() / 1000) + TOKEN_TTL_SECONDS)
      .sign(privateKey);
  }

  function whoCanSignIn(
    resource: string,
  ): { name: string; people: readonly DemoLogin[] } | null {
    // The resource is the institution's canonical URI: `…/mcp/{slug}`, or `…/mcp` when it is alone.
    const slug = new URL(resource).pathname.replace(/^\/mcp\/?/, '');
    const found = slug ? options.institutions.get(slug) : null;
    if (found) return found;

    const only = [...options.institutions.values()];
    return !slug && only.length === 1 && only[0] ? only[0] : null;
  }

  function authorize(url: URL): Response {
    const p = url.searchParams;
    const redirectUri = p.get('redirect_uri');
    const challenge = p.get('code_challenge');
    const resource = p.get('resource');
    const state = p.get('state') ?? '';

    if (!redirectUri) return badRequest('Falta <code>redirect_uri</code>.');
    // Refused here and not by redirecting: sending anything at all to an address we have not
    // registered is the bug, so an unregistered one never gets a response it can read.
    if (!options.redirectUris.includes(redirectUri)) {
      return badRequest('Ese <code>redirect_uri</code> no está registrado.');
    }
    if (!resource) return badRequest('Falta <code>resource</code>: sin él no hay a qué ligar el token.');
    if (!challenge || p.get('code_challenge_method') !== 'S256') {
      return badRequest('Hace falta PKCE con <code>code_challenge_method=S256</code>.');
    }

    const target = whoCanSignIn(resource);
    if (!target) return badRequest('Ese <code>resource</code> no es de ninguna institución conocida.');

    // Second pass: somebody picked a name on the page below.
    const chosen = p.get('subject');
    if (chosen) {
      if (!target.people.some((l) => l.subject === chosen)) return badRequest('Esa persona no existe aquí.');

      const code = randomUUID();
      codes.set(code, {
        subject: chosen,
        challenge,
        redirectUri,
        resource,
        expiresAt: now() + CODE_TTL_MS,
      });

      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      if (state) back.searchParams.set('state', state);
      return new Response(null, { status: 302, headers: { location: back.toString() } });
    }

    const opciones = target.people
      .map((l) => {
        const next = new URL(url.toString());
        next.searchParams.set('subject', l.subject);
        // First and LAST word: «Estudiante de Derecho» and «Estudiante de Informática» share their
        // first two, and two identical circles are worse than none.
        const words = l.label.split(/\s+/).filter(Boolean);
        const initials = [words[0], words.length > 1 ? words[words.length - 1] : '']
          .map((w) => (w ?? '')[0] ?? '')
          .join('')
          .toUpperCase();
        return (
          `<a class="quien" href="${next.pathname}${next.search}">` +
          `<span class="ini">${initials}</span><span>${l.label}</span></a>`
        );
      })
      .join('\n');

    return html(PAGINA.replaceAll('__INSTITUCION__', target.name).replace('__OPCIONES__', opciones));
  }

  async function token(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const grant = form.get('grant_type');

    /**
     * The demonstration's own token, for reading tool catalogues.
     *
     * The page has to draw the catalogue before anyone signs in — that is the moment where
     * switching institution makes four tools disappear — and `tools/list` is behind the same
     * protected endpoint as everything else. So the demonstration backend is a client in its own
     * right and holds a token that names *it*, not a person.
     *
     * It cannot impersonate a student: the tools that answer about somebody resolve against the
     * principal in the token, and this one is `lodge-demo`. It never reaches the browser.
     */
    if (grant === 'client_credentials') {
      const resource = form.get('resource');
      if (!resource || !whoCanSignIn(resource)) return json({ error: 'invalid_target' }, 400);
      return json({
        access_token: await mint(SERVICE_SUBJECT, resource),
        token_type: 'Bearer',
        expires_in: TOKEN_TTL_SECONDS,
      });
    }

    if (grant !== 'authorization_code') return json({ error: 'unsupported_grant_type' }, 400);

    const code = form.get('code') ?? '';
    const pending = codes.get(code);
    // One use only, whether or not it turns out to be valid: a replayed code is never a good sign.
    codes.delete(code);

    if (!pending || pending.expiresAt < now()) return json({ error: 'invalid_grant' }, 400);
    if (form.get('redirect_uri') !== pending.redirectUri) return json({ error: 'invalid_grant' }, 400);

    const verifier = form.get('code_verifier') ?? '';
    if (!verifier || challengeFor(verifier) !== pending.challenge) {
      return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }

    const access = await mint(pending.subject, pending.resource);

    return json({
      access_token: access,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      ...(scopes.length ? { scope: scopes.join(' ') } : {}),
    });
  }

  return {
    issuer,
    jwksUri: `${issuer}/jwks`,

    async fetch(request: Request): Promise<Response | null> {
      const url = new URL(request.url);

      // Preflight for the browser's token exchange.
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST, GET, OPTIONS',
            'access-control-allow-headers': 'content-type',
          },
        });
      }

      if (url.pathname === '/.well-known/openid-configuration') {
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      }

      if (url.pathname === '/jwks') {
        return new Response(jwks, {
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        });
      }

      if (url.pathname === '/authorize' && request.method === 'GET') return authorize(url);
      if (url.pathname === '/token' && request.method === 'POST') return token(request);

      return null;
    },
  };
}
