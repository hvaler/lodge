/**
 * The demonstration, tested without AWS.
 *
 * The model is scripted and the Lodge it talks to is a real HTTP server, which is the right way
 * round: the model is the part that costs money and varies between runs, and the transport is the
 * part that has already hidden two bugs from this suite.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { campusInstant } from '../adapters/synthetic/campus.ts';
import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import type { Model, ModelTurn, ToolCall, Turn } from '../orchestrator/model.ts';
import { createLodgeHandler } from '../server/index.ts';
import { createDemoApi, UnknownInstitutionError } from './api.ts';
import type { DemoInstitution } from './api.ts';
import { demoPage } from './page.ts';

const NOW = campusInstant('2026-10-06', '16:30');

interface Step {
  readonly text?: string;
  readonly toolCalls?: readonly ToolCall[];
}

/** Replays a script, and records what it was asked so the tests can look. */
function scriptedModel(script: readonly Step[]): Model & { seenTurns: Turn[][] } {
  let round = 0;
  const seenTurns: Turn[][] = [];

  return {
    id: 'scripted',
    seenTurns,
    async converse(_system, turns): Promise<ModelTurn> {
      seenTurns.push([...turns]);
      const step = script[round++] ?? {};
      return {
        text: step.text ?? '',
        toolCalls: step.toolCalls ?? [],
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    },
  };
}

let server: Server;
let institutions: DemoInstitution[];

beforeAll(async () => {
  const handler = createLodgeHandler(createSyntheticProvider(), {
    clock: () => NOW,
    env: { ...process.env, LODGE_DEV_IDENTITY: '1' },
  });
  server = createServer(toNodeHandler(handler));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');

  institutions = [
    {
      slug: 'san-telmo',
      name: 'Universidad de San Telmo',
      locale: 'es-ES',
      timeZone: 'Europe/Madrid',
      mcpUrl: `http://127.0.0.1:${address.port}/`,
      identities: [{ subject: 'est-0001', label: 'Derecho' }],
      suggestions: ['¿Qué aula está libre?'],
    },
  ];
  // Generating the campus and standing up a server is not five seconds of work on an idle machine
  // and can be on a busy one. A setup that times out under load reads as a broken test.
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function apiWith(script: readonly Step[]): ReturnType<typeof createDemoApi> & { model: ReturnType<typeof scriptedModel> } {
  const model = scriptedModel(script);
  return Object.assign(createDemoApi({ institutions, model }), { model });
}

const callFindRoom: ToolCall[] = [{ id: 'a', name: 'campus_find_room', input: { building: 'MEN' } }];

describe('the catalogue the page draws', () => {
  it('comes from the live server, not from the page', async () => {
    const { tools } = (await apiWith([]).catalogues())[0]!;

    expect(tools.map((t) => t.name)).toContain('campus.report_issue');
    expect(tools).toHaveLength(8);
    // Descriptions too: they are what the model chooses between.
    expect(tools[0]?.description).not.toBe('');
  });
});

describe('asking', () => {
  it('reports what the agent said, what it called, and what it cost', async () => {
    const api = apiWith([{ toolCalls: callFindRoom }, { text: 'Tienes MEN-001 libre.' }]);

    const answer = await api.ask({ institution: 'san-telmo', utterance: '¿aulas libres?' });

    expect(answer.said).toBe('Tienes MEN-001 libre.');
    expect(answer.trace).toHaveLength(1);
    expect(answer.trace[0]?.tool).toBe('campus.find_room');
    expect(answer.usage.inputTokens).toBe(20);
  });

  it('brings back the card, over the transport where that used to fail', async () => {
    const api = apiWith([{ toolCalls: callFindRoom }, { text: 'Listo.' }]);

    const answer = await api.ask({ institution: 'san-telmo', utterance: '¿aulas libres?' });

    expect(answer.cards).toHaveLength(1);
    expect(answer.cards[0]?.mimeType).toBe('text/html;profile=mcp-app');
  });

  it('carries the identity, so two people get two different answers', async () => {
    const timetable: ToolCall[] = [{ id: 'a', name: 'campus_timetable', input: {} }];
    const outputFor = async (subject: string): Promise<string> => {
      const api = apiWith([{ toolCalls: timetable }, { text: 'ya está' }]);
      const answer = await api.ask({ institution: 'san-telmo', utterance: '¿qué tengo?', subject });
      return answer.trace[0]?.output ?? '';
    };

    const [law, computing] = await Promise.all([outputFor('est-0001'), outputFor('est-0002')]);

    expect(law).not.toBe(computing);
    expect(law).toMatch(/DER-/);
    expect(computing).toMatch(/INF-/);
  });

  it('refuses the timetable to a caller who named nobody', async () => {
    const api = apiWith([{ toolCalls: [{ id: 'a', name: 'campus_timetable', input: {} }] }, { text: '.' }]);

    const answer = await api.ask({ institution: 'san-telmo', utterance: '¿qué tengo?' });

    expect(answer.trace[0]?.output).toMatch(/tienes que identificarte/);
  });

  it('puts the conversation so far in front of the model', async () => {
    // This is what makes "sí" mean something: the model can see the question it just asked.
    const api = apiWith([{ text: 'Hecho.' }]);

    await api.ask({
      institution: 'san-telmo',
      utterance: 'sí',
      history: [
        { role: 'user', text: 'El proyector de MEN-203 no funciona' },
        { role: 'assistant', text: '¿Abro un aviso por proyector en MEN-203?' },
      ],
    });

    const turns = api.model.seenTurns[0] ?? [];
    expect(turns).toHaveLength(3);
    expect(turns[1]).toMatchObject({ role: 'assistant', text: '¿Abro un aviso por proyector en MEN-203?' });
    expect(turns[2]).toMatchObject({ role: 'user', text: 'sí' });
  });

  it('says which institution it does not know, rather than guessing one', async () => {
    await expect(
      apiWith([]).ask({ institution: 'bath-spa', utterance: 'hola' }),
    ).rejects.toBeInstanceOf(UnknownInstitutionError);
  });
});

describe('the page', () => {
  it('fetches nothing from anywhere', () => {
    // Same rule as the cards: a demonstration that needs the network is one that fails on a train.
    // The check is on what the page would actually *load* — `href` and `src` — rather than on the
    // string "http". An XML namespace looks like a URL and is only ever an identifier; failing on
    // one would train whoever hits it next to reach for the assertion instead of the cause.
    const html = demoPage();

    expect(html).not.toMatch(/(?:href|src)\s*=\s*["']?(?:https?:)?\/\//i);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/fetch\(\s*["'](?:https?:)?\/\//);
  });

  it('escapes what it puts into the page', () => {
    // The trace prints tool output, which is the institution's data and not ours to trust.
    expect(demoPage()).toContain("replace(/[&<>]/g");
  });
});
