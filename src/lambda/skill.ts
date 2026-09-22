/**
 * The bridge to a real device: a classic Alexa custom skill over the same MCP server.
 *
 * **Say this out loud wherever this is shown: it is not Alexa+.** The Alexa+ add-on registry is
 * limited to "select partners working directly with our team", so no entrant can register one, and
 * the hackathon's own guidance is to simulate the experience in a web app — which is what
 * `src/web/` is. This exists for one reason the web app cannot cover: a speaker on a table
 * answering out loud is evidence that the server is real in a way a browser tab is not.
 *
 * It is deliberately thin. Alexa's envelope comes in, the orchestrator that already runs the
 * demonstration answers it, and the envelope goes back out. Nothing about campuses, tools or models
 * lives here: the same `createDemoApi` the page uses does all of it, so the device cannot drift
 * from what the page shows.
 *
 * Identity: this talks to the sandbox deployment, which runs `LODGE_DEV_IDENTITY` and takes a
 * subject from a header. That is an authentication bypass and it is fine *here* — the deployment it
 * points at serves two invented universities — but it means the device demonstrates the voice path,
 * not the identity path. Identity is demonstrated in the web app, where the sign-in is real
 * (`src/web/idp.ts`).
 */

import { bedrockOptionsFrom, createBedrockModel } from '../orchestrator/index.ts';
import { startTelemetry } from '../telemetry/setup.ts';
import { createDemoApi } from '../web/api.ts';
import { ASK_INTENT, historyIn, isOurSkill, questionIn, saySomethingFirst, speak } from './alexa.ts';
import type { AlexaEnvelope, AlexaResponse } from './alexa.ts';

/** Where Lodge is. Without it there is nothing to bridge to, so this fails loudly at init. */
function lodgeUrl(): string {
  const url = process.env['LODGE_MCP_URL'];
  if (!url) {
    throw new Error('LODGE_MCP_URL is not set. The skill is an MCP client and needs a server.');
  }
  return url.replace(/\/+$/, '');
}

const SKILL_ID = process.env['LODGE_SKILL_ID'];
const SUBJECT = process.env['LODGE_SKILL_SUBJECT'] ?? 'est-0001';

/**
 * Which institution a device reaches, decided by the language it is speaking.
 *
 * One skill, two locales, and the same thing the page demonstrates with its institution switcher:
 * a single server answering for more than one place, with the *client* saying which. Somebody
 * asking in Spanish reaches San Telmo; in English, Carrigmore — which is an Irish college with no
 * directory and no service desk, so it publishes three tools where San Telmo publishes six. The
 * device inherits that difference for free, because the catalogue is derived either way.
 *
 * `LODGE_SKILL_INSTITUTION` pins every locale to one institution, for a deployment that serves
 * only its own.
 */
const BY_LANGUAGE: Record<string, string> = { es: 'san-telmo', en: 'carrigmore' };
const PINNED = process.env['LODGE_SKILL_INSTITUTION'];

const SPEECH = {
  es: {
    welcome:
      'Soy la conserjería. Puedes preguntarme por un aula libre, por tu horario, por un plazo o ' +
      'avisar de una avería. ¿Qué necesitas?',
    help: 'Pregúntame por ejemplo qué aula está libre ahora en Mendizábal, o qué tienes mañana.',
    filler: 'Un momento, lo miro.',
    bye: 'Hasta luego.',
    more: '¿Algo más?',
    broken: 'No he podido consultarlo ahora mismo. Inténtalo otra vez en un momento.',
    notOurs: 'Esta conserjería no responde a esa aplicación.',
  },
  en: {
    welcome:
      'This is the campus lodge. Ask me which room is free, when a deadline closes, or how to ' +
      'find a room. What do you need?',
    help: 'Try asking which room is free right now, or when registration closes.',
    filler: 'One moment, let me check.',
    bye: 'Goodbye.',
    more: 'Anything else?',
    broken: 'I could not look that up just now. Try again in a moment.',
    notOurs: 'This lodge does not answer that application.',
  },
} as const;

/** Alexa sends `es-ES`, `en-GB`, `en-IE`… and the language is the part that decides. */
export function languageOf(locale: string | undefined): 'es' | 'en' {
  return (locale ?? '').toLowerCase().startsWith('es') ? 'es' : 'en';
}

/** What the routing needs, so it can be driven without a model or a server behind it. */
export interface SkillOptions {
  readonly ask: (request: {
    institution: string;
    utterance: string;
    subject: string;
    history: readonly { role: 'user' | 'assistant'; text: string }[];
  }) => Promise<{ said: string }>;
  /** Language → which institution it reaches. */
  readonly institutions: Readonly<Record<string, string>>;
  readonly subject: string;
  /** Absent skips the check, which is the local-testing case. */
  readonly skillId?: string;
  /** Injected so a test does not have to reach the directive service. */
  readonly progressive?: typeof saySomethingFirst;
  readonly onError?: (error: Error) => void;
}

/**
 * The routing, apart from the wiring.
 *
 * Separated so it can be tested at all: the entry point below builds a Bedrock client and demands
 * a server URL while the module is evaluated, and a test of a thing that cannot be imported without
 * both is a test of nothing.
 */
export function createSkill(options: SkillOptions) {
  return async function answer(envelope: AlexaEnvelope): Promise<AlexaResponse> {
    // Everything the device says, in the language it is speaking. Which is also the language the
    // institution behind it answers in, because that is the institution's to declare.
    const lang = languageOf(envelope.request.locale);
    const says = SPEECH[lang];
    const slug = options.institutions[lang] ?? Object.values(options.institutions)[0] ?? '';

    try {
      if (!isOurSkill(envelope, options.skillId)) return speak(says.notOurs, { end: true });

      const type = envelope.request.type;
      if (type === 'SessionEndedRequest') return speak('', { end: true });
      if (type === 'LaunchRequest') return speak(says.welcome, { reprompt: says.help });

      const name = envelope.request.intent?.name ?? '';
      if (name === 'AMAZON.StopIntent' || name === 'AMAZON.CancelIntent') {
        return speak(says.bye, { end: true });
      }
      if (name === 'AMAZON.HelpIntent') return speak(says.help, { reprompt: says.help });

      const question = questionIn(envelope);
      if (name !== ASK_INTENT || !question) return speak(says.help, { reprompt: says.help });

      // The filler goes out before the work starts, not after: its whole job is to fill the gap.
      await (options.progressive ?? saySomethingFirst)(envelope, says.filler);

      const history = historyIn(envelope);
      const answered = await options.ask({
        institution: slug,
        utterance: question,
        subject: options.subject,
        history,
      });

      // Carried in the session so a second turn can act on the first — which is what makes filing
      // a fault work by voice: the agent asks "¿lo abro?", somebody says "sí", and the model has
      // its own question in front of it (ADR-011). Trimmed: a session attribute is not a database.
      const carried = [
        ...history,
        { role: 'user' as const, text: question },
        { role: 'assistant' as const, text: answered.said },
      ].slice(-6);

      return speak(answered.said, { attributes: { history: carried }, reprompt: says.more });
    } catch (error) {
      // A skill that throws says "there was a problem with the requested skill's response", which
      // tells the person nothing and the author less.
      options.onError?.(error as Error);
      return speak(says.broken, { end: true });
    }
  };
}

// Pinning collapses both languages onto one institution, for a deployment that serves its own.
const REACHES: Record<string, string> = PINNED
  ? Object.fromEntries(Object.keys(BY_LANGUAGE).map((lang) => [lang, PINNED]))
  : BY_LANGUAGE;

// Built once per container: the model client and the catalogue cost nothing per invocation.
const base = lodgeUrl();
const api = createDemoApi({
  institutions: [...new Set(Object.values(REACHES))].map((slug) => ({
    slug,
    name: slug,
    locale: slug === 'san-telmo' ? 'es-ES' : 'en-IE',
    // Declared here rather than discovered because this entry point has no provider to ask; the
    // deployment publishes it at /health, and these two are the only institutions it serves.
    timeZone: slug === 'san-telmo' ? 'Europe/Madrid' : 'Europe/Dublin',
    mcpUrl: `${base}/mcp/${slug}`,
    identities: [],
    suggestions: [],
  })),
  model: createBedrockModel(bedrockOptionsFrom(process.env)),
});

const telemetry = await startTelemetry(process.env, 'lodge-skill');

const answer = createSkill({
  ask: (request) => api.ask(request),
  institutions: REACHES,
  subject: SUBJECT,
  ...(SKILL_ID ? { skillId: SKILL_ID } : {}),
  onError: (error) => console.log(error.message),
});

export async function skillHandler(envelope: AlexaEnvelope): Promise<AlexaResponse> {
  try {
    return await answer(envelope);
  } finally {
    // Lambda freezes the container the instant this resolves.
    await telemetry?.shutdown();
  }
}

export { skillHandler as handler };
