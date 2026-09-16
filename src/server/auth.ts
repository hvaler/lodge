/**
 * OAuth 2.1 — Lodge as a **resource server**, never an authorization server.
 *
 * Lodge issues no tokens, holds no passwords and runs no login page. It publishes an RFC 9728
 * document saying "here is my canonical URI, and here is the authorization server I trust", then
 * verifies the tokens that server signs. PKCE happens between the client and that server; Lodge
 * never sees it.
 *
 * That division is the runbook's thesis applied to identity. An institution that has a directory
 * almost certainly has an OIDC provider in front of it, and the thing nobody wants to deploy is a
 * second place where student passwords live. Naming an issuer in a config file is an afternoon;
 * operating an identity provider is a project.
 *
 * The audience binding is the part that earns its keep. A token is verified against the *canonical
 * URI of this institution's endpoint* (RFC 8707), so a token minted for Carrigmore's Lodge is
 * rejected by San Telmo's even though the same process serves both. Without it, UC-07's one server
 * and two institutions would share one trust boundary.
 */

import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import type {
  AuthInfo,
  OAuthProtectedResourceMetadata,
  OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';

/** What an institution has to say about its identity provider. */
export interface AuthConfig {
  /** The `iss` claim its tokens carry, e.g. `https://login.carrigmore.ie`. */
  readonly issuer: string;
  /**
   * Where its signing keys live.
   *
   * Required rather than discovered from the issuer. Discovery would mean a network call to the
   * institution's identity provider before Lodge can answer anything, which turns their brief
   * outage into ours; and the URI is one line their IdP already publishes. Explicit and boring
   * beats clever here.
   */
  readonly jwksUri: string;
  /** Scopes a token must carry. Empty means any valid token for this resource is enough. */
  readonly scopes?: readonly string[];
  /**
   * Claim holding the subject that {@link principalFrom} turns into a principal. Defaults to `sub`.
   *
   * Configurable because `sub` is often an opaque provider id while the adapter keys on something
   * the institution recognises — the same `uid` its LDAP directory uses, say. An institution whose
   * IdP and directory disagree about who someone is should be able to say which one Lodge follows.
   */
  readonly subjectClaim?: string;
}

/**
 * The canonical URI of an institution's endpoint, which is what a token must be minted for.
 *
 * One institution is served at `/mcp` and is identified by it. Several are served at `/mcp/{slug}`
 * and identified by that, because there is no honest way for two institutions to share one
 * identifier. A multi-institution deployment that also answers at bare `/mcp` treats that as an
 * alias: the discovery document tells a client the canonical URI, which is the whole point of
 * publishing one.
 */
export function resourceIdentifier(publicUrl: string, slug: string, alone: boolean): string {
  const base = publicUrl.replace(/\/+$/, '');
  return alone ? `${base}/mcp` : `${base}/mcp/${slug}`;
}

/** Where a client looks for the document below, per RFC 9728's path-insertion rule. */
export function metadataPathFor(resource: string): string {
  const { pathname } = new URL(resource);
  return `/.well-known/oauth-protected-resource${pathname}`;
}

/**
 * The RFC 9728 document.
 *
 * Built here rather than with the SDK's `buildOAuthProtectedResourceMetadata`, which also wants the
 * authorization server's own RFC 8414 metadata so it can serve it for legacy clients. We would have
 * to either fetch that at start-up — the outage coupling again — or hand-write another party's
 * metadata, which is theirs to publish and not ours to guess. Six fields is not worth either.
 */
export function protectedResourceMetadata(options: {
  readonly resource: string;
  readonly issuer: string;
  readonly scopes?: readonly string[];
  readonly resourceName?: string;
}): OAuthProtectedResourceMetadata {
  return {
    resource: options.resource,
    authorization_servers: [options.issuer],
    bearer_methods_supported: ['header'],
    ...(options.scopes && options.scopes.length > 0 ? { scopes_supported: [...options.scopes] } : {}),
    ...(options.resourceName ? { resource_name: options.resourceName } : {}),
  };
}

function scopesOf(claim: unknown): string[] {
  // RFC 8693 says space-delimited string; plenty of providers send an array anyway.
  if (typeof claim === 'string') return claim.split(' ').filter(Boolean);
  if (Array.isArray(claim)) return claim.filter((s): s is string => typeof s === 'string');
  return [];
}

/**
 * Verifies a token against the institution's keys, its issuer and this endpoint's identifier.
 *
 * The remote key set is cached and refreshed by `jose`, so a key rotation does not need a restart
 * and a burst of requests does not become a burst of fetches.
 */
export function createJwtVerifier(config: AuthConfig, resource: string): OAuthTokenVerifier {
  const keys = createRemoteJWKSet(new URL(config.jwksUri));
  const subjectClaim = config.subjectClaim ?? 'sub';

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, keys, {
          issuer: config.issuer,
          // The audience check is the RFC 8707 binding, and it is not optional: a token addressed
          // to another resource is a valid token being replayed at us.
          audience: resource,
        }));
      } catch (error) {
        // Deliberately not echoing the token or the library's internals back to the caller. The
        // reason a token failed is useful to an attacker and useless to an honest client, which
        // only needs to know to go and get a new one.
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          error instanceof Error ? error.message : 'The access token could not be verified.',
        );
      }

      const subject = payload[subjectClaim];
      if (typeof subject !== 'string' || subject.length === 0) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          `The access token carries no '${subjectClaim}' claim, so there is nobody to answer as.`,
        );
      }

      return {
        token,
        // An id for the application, not the person. It is reported for logs and never used to
        // decide whose timetable this is — see `principalFrom`, which refuses that fallback.
        clientId: typeof payload['azp'] === 'string' ? payload['azp'] : (payload['client_id'] as string) ?? '',
        scopes: scopesOf(payload['scope'] ?? payload['scp']),
        ...(typeof payload.exp === 'number' ? { expiresAt: payload.exp } : {}),
        resource: new URL(resource),
        extra: { sub: subject },
      };
    },
  };
}

/** Everything one institution needs to be protected: who signs, and what for. */
export interface ProtectedInstitution {
  readonly slug: string;
  readonly resource: string;
  /** Path this deployment serves the document at. */
  readonly metadataPath: string;
  /** The same, absolute — it is what the `WWW-Authenticate` challenge points a client at. */
  readonly metadataUrl: string;
  readonly metadata: OAuthProtectedResourceMetadata;
  readonly verifier: OAuthTokenVerifier;
  readonly requiredScopes: string[];
}

export function protect(options: {
  readonly slug: string;
  readonly institution: string;
  readonly config: AuthConfig;
  readonly publicUrl: string;
  readonly alone: boolean;
}): ProtectedInstitution {
  const resource = resourceIdentifier(options.publicUrl, options.slug, options.alone);
  const metadataPath = metadataPathFor(resource);

  return {
    slug: options.slug,
    resource,
    metadataPath,
    metadataUrl: new URL(metadataPath, resource).toString(),
    metadata: protectedResourceMetadata({
      resource,
      issuer: options.config.issuer,
      ...(options.config.scopes ? { scopes: options.config.scopes } : {}),
      resourceName: options.institution,
    }),
    verifier: createJwtVerifier(options.config, resource),
    requiredScopes: [...(options.config.scopes ?? [])],
  };
}

/** Where this deployment answers from. Absent means no OAuth, which several places must announce. */
export function publicUrlFrom(env: NodeJS.ProcessEnv): string | null {
  return env['LODGE_PUBLIC_URL'] ?? null;
}
