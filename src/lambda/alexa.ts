/**
 * The envelope a classic Alexa custom skill speaks, and nothing more.
 *
 * **This is not Alexa+.** The Alexa+ add-on registry is "available to select partners working
 * directly with our team" (verified 2026-09-14), so there is no way to register one. What a classic
 * custom skill buys is the only thing missing from the demonstration: a real device on a real table
 * answering out loud, talking to the same MCP server everything else talks to.
 *
 * It is a bridge, not a product. One question, one answer, no certification, no publication — the
 * skill runs in the developer console's own test mode on a device the author owns.
 *
 * Kept apart from the handler so the shape of Alexa's JSON is readable on its own. Only the fields
 * this skill actually reads are typed: a partial view of somebody else's envelope is honest, a
 * hand-copied full one goes stale.
 */

/** What Alexa sends. Fields this skill does not read are left out on purpose. */
export interface AlexaEnvelope {
  readonly version: string;
  readonly session?: {
    readonly sessionId?: string;
    readonly new?: boolean;
    readonly attributes?: Record<string, unknown>;
  };
  readonly context?: {
    readonly System?: {
      /** Where to send a progressive response. Regional: `https://api.eu.amazonalexa.com`. */
      readonly apiEndpoint?: string;
      readonly apiAccessToken?: string;
      readonly application?: { readonly applicationId?: string };
    };
  };
  readonly request: {
    readonly type: string;
    readonly requestId?: string;
    readonly locale?: string;
    readonly intent?: {
      readonly name?: string;
      readonly slots?: Record<string, { readonly value?: string } | undefined>;
    };
  };
}

export interface AlexaResponse {
  readonly version: '1.0';
  readonly sessionAttributes?: Record<string, unknown>;
  readonly response: {
    readonly outputSpeech: { readonly type: 'PlainText'; readonly text: string };
    readonly reprompt?: { readonly outputSpeech: { readonly type: 'PlainText'; readonly text: string } };
    readonly shouldEndSession: boolean;
  };
}

/** The intent that carries a whole question, and the built-ins a skill must answer. */
export const ASK_INTENT = 'PreguntarAlCampusIntent';
export const QUESTION_SLOT = 'pregunta';

export function speak(
  text: string,
  options: { readonly end?: boolean; readonly reprompt?: string; readonly attributes?: Record<string, unknown> } = {},
): AlexaResponse {
  return {
    version: '1.0',
    ...(options.attributes ? { sessionAttributes: options.attributes } : {}),
    response: {
      outputSpeech: { type: 'PlainText', text },
      ...(options.reprompt
        ? { reprompt: { outputSpeech: { type: 'PlainText', text: options.reprompt } } }
        : {}),
      shouldEndSession: options.end ?? false,
    },
  };
}

/** What somebody actually asked, whichever way they got here. */
export function questionIn(envelope: AlexaEnvelope): string | null {
  const slot = envelope.request.intent?.slots?.[QUESTION_SLOT]?.value;
  return typeof slot === 'string' && slot.trim() ? slot.trim() : null;
}

/**
 * Whether this request is for the skill we were deployed for.
 *
 * The trigger permission already scopes who may invoke this function, and this is the second lock:
 * a function that answers any envelope it is handed is one that answers somebody else's skill.
 * With no id configured the check is skipped, which is the local-testing case and says so.
 */
export function isOurSkill(envelope: AlexaEnvelope, expected: string | undefined): boolean {
  if (!expected) return true;
  return envelope.context?.System?.application?.applicationId === expected;
}

/**
 * Tells the device to say something while the answer is still being worked out.
 *
 * The turn measured at 1.5 s warm and 4.5 s cold against an 8 s cut-off (22-09-2026), so this is
 * not strictly needed — but a cold start on the one take that matters is a bad way to find out, and
 * two seconds of silence from a speaker feels much longer than two seconds of silence on a screen.
 *
 * Never allowed to fail the turn: if the directive service is unreachable the answer still goes
 * out, just without the filler.
 */
export async function saySomethingFirst(
  envelope: AlexaEnvelope,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const system = envelope.context?.System;
  const requestId = envelope.request.requestId;
  if (!system?.apiEndpoint || !system.apiAccessToken || !requestId) return;

  try {
    await fetchImpl(`${system.apiEndpoint.replace(/\/+$/, '')}/v1/directives`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${system.apiAccessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        header: { requestId },
        directive: { type: 'VoicePlayer.Speak', speech: text },
      }),
    });
  } catch {
    // Deliberately swallowed, and the reason is the point: this is filler. Failing the answer
    // because the filler did not arrive would trade the thing that matters for the thing that
    // does not.
  }
}

/** The conversation so far, as Alexa hands it back to us. */
export function historyIn(envelope: AlexaEnvelope): readonly { role: 'user' | 'assistant'; text: string }[] {
  const raw = envelope.session?.attributes?.['history'];
  if (!Array.isArray(raw)) return [];

  return raw.filter(
    (t): t is { role: 'user' | 'assistant'; text: string } =>
      typeof t === 'object' &&
      t !== null &&
      (t as { role?: unknown }).role !== undefined &&
      typeof (t as { text?: unknown }).text === 'string',
  );
}
