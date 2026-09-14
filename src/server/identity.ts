/**
 * Who is calling.
 *
 * Until M4 there is no OAuth, so this is the seam where it will land: {@link principalFrom} reads
 * the subject a token verifier has already established, and everything upstream of it is the
 * verifier's job rather than ours.
 */

import type { AuthInfo } from '@modelcontextprotocol/server';

import type { Principal } from '../provider/index.ts';

/** Header carrying a subject in development. Inert unless {@link devIdentityEnabled} says so. */
export const DEV_SUBJECT_HEADER = 'x-lodge-dev-subject';

/**
 * Whether the development identity header is honoured.
 *
 * Opt-in through `LODGE_DEV_IDENTITY=1` and nothing else — not a default, not "unless production",
 * not inferred from NODE_ENV. A header that lets any caller name themselves is an authentication
 * bypass, so the only safe default is off, and the only way on is somebody typing it.
 */
export function devIdentityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['LODGE_DEV_IDENTITY'] === '1';
}

/**
 * The authenticated subject, if there is one.
 *
 * `AuthInfo` carries the token, client and scopes; the subject is whatever the verifier put in
 * `extra.sub`. No fallback to `clientId`: a client id identifies an application, not a person, and
 * quietly treating one as the other would handP one student's timetable to a whole application's
 * users.
 */
export function principalFrom(authInfo: AuthInfo | undefined): Principal | null {
  const subject = authInfo?.extra?.['sub'];
  return typeof subject === 'string' && subject.length > 0 ? { subject } : null;
}

/** The development-only override. Returns `null` whenever the affordance is disabled. */
export function devPrincipalFrom(
  request: Request | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Principal | null {
  if (!devIdentityEnabled(env)) return null;

  const subject = request?.headers.get(DEV_SUBJECT_HEADER);
  return subject ? { subject } : null;
}
