/**
 * Errors an adapter raises, and the tool layer translates into something the agent can say.
 *
 * They are part of the frozen contract: a tool must be able to tell "you are not signed in" from
 * "that room does not exist" from "this institution cannot do that", because each one has a
 * different spoken answer. Collapsing them into one `Error` would make the agent apologise
 * vaguely, which is the failure mode UC-03 exists to prevent.
 */

export class UnauthenticatedError extends Error {
  constructor(what: string) {
    super(`${what} needs a signed-in caller.`);
    this.name = 'UnauthenticatedError';
  }
}

/** The thing asked for is not on record. Distinct from "the institution cannot answer that". */
export class NotFoundError extends Error {
  // Declared as fields rather than constructor parameter properties: those need TypeScript to
  // *transform* the code, and Node runs this source by stripping types only. Keeping to
  // strip-only syntax is what lets `node src/...` work without a build step.
  readonly kind: string;
  readonly ref: string;

  constructor(kind: string, ref: string) {
    super(`No ${kind} on record for '${ref}'.`);
    this.name = 'NotFoundError';
    this.kind = kind;
    this.ref = ref;
  }
}

/** The request is well-formed but wrong about the world — a fault on kit the room does not have. */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

/** The adapter does not declare the capability this call needs. */
export class UnsupportedCapabilityError extends Error {
  constructor(capability: string, adapter: string) {
    super(`Adapter '${adapter}' does not support '${capability}'.`);
    this.name = 'UnsupportedCapabilityError';
  }
}
