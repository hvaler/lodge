/**
 * The Alexa bridge, driven by the envelopes Alexa actually sends.
 *
 * The device is the one surface nobody can attach a debugger to, and the one most likely to be
 * discovered broken with a camera running. So the translation is exercised here with hand-built
 * envelopes: the launch, the built-in intents every skill must answer, the question slot, the
 * session that carries a conversation between turns, and the two ways this can be handed an
 * envelope that is not ours.
 *
 * The orchestrator behind it is stubbed on purpose. What it answers is already covered by the
 * demonstration's own tests; what is untested until here is whether Alexa's JSON survives the trip.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ASK_INTENT, QUESTION_SLOT } from './alexa.ts';
import type { AlexaEnvelope } from './alexa.ts';

type Skill = (envelope: AlexaEnvelope) => Promise<{
  response: {
    outputSpeech: { text: string };
    shouldEndSession: boolean;
    reprompt?: { outputSpeech: { text: string } };
  };
  sessionAttributes?: Record<string, unknown>;
}>;

let createSkill: (options: {
  ask: (r: {
    institution: string;
    utterance: string;
    subject: string;
    history: readonly { role: 'user' | 'assistant'; text: string }[];
  }) => Promise<{ said: string }>;
  slug: string;
  subject: string;
  skillId?: string;
  progressive?: () => Promise<void>;
  onError?: (error: Error) => void;
}) => Skill;

beforeAll(async () => {
  // The entry point demands a server while the module is evaluated, which is the right behaviour
  // for a deployment and an obstacle for a test. Set before the import, as the runtime would.
  process.env['LODGE_MCP_URL'] = 'http://127.0.0.1:1/mcp';
  ({ createSkill } = await import('./skill.ts'));
});

function envelope(request: AlexaEnvelope['request'], extra: Partial<AlexaEnvelope> = {}): AlexaEnvelope {
  return { version: '1.0', request, ...extra };
}

function asking(question: string, attributes?: Record<string, unknown>): AlexaEnvelope {
  return envelope(
    {
      type: 'IntentRequest',
      requestId: 'r-1',
      locale: 'es-ES',
      intent: { name: ASK_INTENT, slots: { [QUESTION_SLOT]: { value: question } } },
    },
    attributes ? { session: { attributes } } : {},
  );
}

function skillWith(
  ask: (r: { utterance: string; history: readonly { role: 'user' | 'assistant'; text: string }[] }) => Promise<{ said: string }>,
  options: { skillId?: string; onError?: (e: Error) => void } = {},
): Skill {
  return createSkill({
    ask: ask as never,
    slug: 'san-telmo',
    subject: 'est-0001',
    progressive: async () => {},
    ...options,
  });
}

const echo = async (r: { utterance: string }): Promise<{ said: string }> => ({
  said: `respondo a ${r.utterance}`,
});

describe('opening and closing', () => {
  it('says what it can do when somebody just opens it', async () => {
    const answered = await skillWith(echo)(envelope({ type: 'LaunchRequest', requestId: 'r-0' }));

    expect(answered.response.outputSpeech.text).toContain('aula libre');
    // Left open: a skill that hangs up after hello is a skill nobody uses twice.
    expect(answered.response.shouldEndSession).toBe(false);
    expect(answered.response.reprompt).toBeDefined();
  });

  it('answers the built-ins every skill has to answer', async () => {
    const skill = skillWith(echo);
    const built = (name: string): AlexaEnvelope =>
      envelope({ type: 'IntentRequest', requestId: 'r-2', intent: { name } });

    expect((await skill(built('AMAZON.StopIntent'))).response.shouldEndSession).toBe(true);
    expect((await skill(built('AMAZON.CancelIntent'))).response.shouldEndSession).toBe(true);

    const help = await skill(built('AMAZON.HelpIntent'));
    expect(help.response.shouldEndSession).toBe(false);
    expect(help.response.outputSpeech.text).toContain('Mendizábal');
  });

  it('ends without saying anything when the session ends on its own', async () => {
    const ended = await skillWith(echo)(envelope({ type: 'SessionEndedRequest', requestId: 'r-3' }));

    expect(ended.response.shouldEndSession).toBe(true);
    expect(ended.response.outputSpeech.text).toBe('');
  });
});

describe('a question', () => {
  it('passes what was said through and speaks what came back', async () => {
    const answered = await skillWith(echo)(asking('¿qué aula está libre?'));

    expect(answered.response.outputSpeech.text).toBe('respondo a ¿qué aula está libre?');
    expect(answered.response.shouldEndSession).toBe(false);
  });

  it('falls back to help rather than asking with an empty slot', async () => {
    const ask = vi.fn(echo);
    const empty = envelope({
      type: 'IntentRequest',
      requestId: 'r-4',
      intent: { name: ASK_INTENT, slots: { [QUESTION_SLOT]: { value: '   ' } } },
    });

    expect((await skillWith(ask)(empty)).response.outputSpeech.text).toContain('Pregúntame');
    expect(ask).not.toHaveBeenCalled();
  });

  it('speaks before it works, so a cold start is not silence', async () => {
    const order: string[] = [];
    const skill = createSkill({
      ask: async () => {
        order.push('ask');
        return { said: 'ya está' };
      },
      slug: 'san-telmo',
      subject: 'est-0001',
      progressive: async () => {
        order.push('filler');
      },
    });

    await skill(asking('¿y mañana?'));
    expect(order).toEqual(['filler', 'ask']);
  });
});

describe('the conversation between turns', () => {
  it('carries what was said back in the session, which is what makes a confirmation work', async () => {
    // UC-05 by voice: the first turn asks whether to file, the second acts on it (ADR-011). With
    // nothing carried the model would never see its own question.
    const first = await skillWith(async () => ({ said: '¿Lo abro?' }))(asking('el proyector no va'));

    expect(first.sessionAttributes?.['history']).toEqual([
      { role: 'user', text: 'el proyector no va' },
      { role: 'assistant', text: '¿Lo abro?' },
    ]);

    const seen: unknown[] = [];
    await skillWith(async (r) => {
      seen.push(r.history);
      return { said: 'Abierto.' };
    })(asking('sí', first.sessionAttributes));

    expect(seen[0]).toEqual([
      { role: 'user', text: 'el proyector no va' },
      { role: 'assistant', text: '¿Lo abro?' },
    ]);
  });

  it('keeps the session small, because it is not a database', async () => {
    let carried: Record<string, unknown> | undefined;
    for (let turn = 0; turn < 6; turn++) {
      const answered = await skillWith(echo)(asking(`pregunta ${turn}`, carried));
      carried = answered.sessionAttributes;
    }

    expect((carried?.['history'] as unknown[]).length).toBe(6);
  });

  it('ignores a session carrying something that is not a conversation', async () => {
    // Session attributes come back from outside this function, so they are somebody else's data.
    const seen: unknown[] = [];
    await skillWith(async (r) => {
      seen.push(r.history);
      return { said: 'vale' };
    })(asking('hola', { history: 'no soy una lista' }));

    expect(seen[0]).toEqual([]);
  });
});

describe('envelopes that are not ours', () => {
  it('refuses one addressed to another skill', async () => {
    const skill = skillWith(echo, { skillId: 'amzn1.ask.skill.nuestra' });
    const other = envelope(
      { type: 'IntentRequest', requestId: 'r-5', intent: { name: ASK_INTENT, slots: {} } },
      { context: { System: { application: { applicationId: 'amzn1.ask.skill.de-otro' } } } },
    );

    const refused = await skill(other);
    expect(refused.response.shouldEndSession).toBe(true);
    expect(refused.response.outputSpeech.text).toContain('no responde a esa aplicación');
  });

  it('answers a question with something a person can act on when the turn fails', async () => {
    const onError = vi.fn();
    const broken = skillWith(async () => {
      throw new Error('bedrock is having a day');
    }, { onError });

    const answered = await broken(asking('¿qué tengo mañana?'));

    // Never a raw throw: Alexa turns that into "there was a problem with the requested skill's
    // response", which tells the person nothing and whoever is debugging it less.
    expect(answered.response.outputSpeech.text).toContain('Inténtalo otra vez');
    expect(answered.response.shouldEndSession).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
  });
});
