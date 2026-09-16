/**
 * The orchestrator, against a scripted model and a real MCP server.
 *
 * The model is a double and the server is not, which is the right way round: what is worth testing
 * is that the loop drives the *real* catalogue correctly. Whether Nova picks the right tool is
 * Nova's business, and asserting it would make the suite depend on an AWS account and on a model
 * that is free to change its mind.
 */

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { campusInstant } from '../adapters/synthetic/campus.ts';
import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import { InMemoryIssueStore } from '../adapters/synthetic/issues.ts';
import { CARD_MIME } from '../cards/index.ts';
import type { Provider, RequestContext } from '../provider/index.ts';
import { createStandardsProvider } from '../adapters/standards/index.ts';
import { registerTools } from '../tools/index.ts';
import { createOrchestrator, systemPrompt } from './index.ts';
import { toModelName } from './model.ts';
import type { Model, ModelTurn, ToolSpec, Turn } from './model.ts';

import { join } from 'node:path';

const NOW = campusInstant('2026-10-06', '16:30');

/** A model that replays a script, and records what it was asked. */
function scriptedModel(script: Partial<ModelTurn>[]): Model & {
  readonly seenTools: ToolSpec[][];
  readonly seenTurns: Turn[][];
  readonly seenSystem: string[];
} {
  const seenTools: ToolSpec[][] = [];
  const seenTurns: Turn[][] = [];
  const seenSystem: string[] = [];
  let round = 0;

  return {
    id: 'scripted',
    seenTools,
    seenTurns,
    seenSystem,
    async converse(system, turns, tools) {
      seenSystem.push(system);
      seenTurns.push([...turns]);
      seenTools.push([...tools]);
      const step = script[round++] ?? {};
      return {
        text: step.text ?? '',
        toolCalls: step.toolCalls ?? [],
        usage: step.usage ?? { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
}

let client: Client;

async function connect(provider: Provider, principal: string | null = null): Promise<Client> {
  const server = new McpServer({ name: 'orch-test', version: '0.0.0' }, { capabilities: { tools: {} } });
  const resolveContext = (): RequestContext => ({
    principal: principal ? { subject: principal } : null,
    now: NOW,
    locale: provider.descriptor.locale,
  });
  registerTools(server, provider, resolveContext);

  const [ct, st] = InMemoryTransport.createLinkedPair();
  client = new Client(
    { name: 'orchestrator', version: '0.0.0' },
    { capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [CARD_MIME] } } } },
  );
  await Promise.all([client.connect(ct), server.connect(st)]);
  return client;
}

const sanTelmo = (principal: string | null = null): Promise<Client> =>
  connect(createSyntheticProvider(new InMemoryIssueStore()), principal);

afterEach(async () => {
  await client?.close();
});

describe('the tools come from the server, not from this file', () => {
  it('offers the model whatever the institution publishes', async () => {
    const model = scriptedModel([{ text: 'Vale.' }]);
    const orchestrator = createOrchestrator({ model, client: await sanTelmo() });

    await orchestrator.ask('hola', { institution: 'San Telmo', locale: 'es-ES' });

    expect(model.seenTools[0]?.map((t) => t.name).sort()).toEqual([
      'campus.deadlines',
      'campus.find_room',
      'campus.issue_status',
      'campus.report_issue',
      'campus.timetable',
      'campus.wayfind',
    ]);
  });

  it('offers fewer tools at an institution that has fewer', async () => {
    // Nothing in the orchestrator knows there are six. Point it at Carrigmore and the agent cannot
    // file a fault, because the tool was never in the catalogue it was handed.
    const carrigmore = await createStandardsProvider({
      institution: 'Carrigmore College',
      locale: 'en-IE',
      timeZone: 'Europe/Dublin',
      inventory: { location: join(process.cwd(), 'fixtures', 'carrigmore', 'rooms.csv') },
      calendars: {
        timetable: join(process.cwd(), 'fixtures', 'carrigmore', 'timetable.ics'),
        deadlines: join(process.cwd(), 'fixtures', 'carrigmore', 'deadlines.ics'),
      },
    });
    const model = scriptedModel([{ text: 'Right.' }]);
    const orchestrator = createOrchestrator({ model, client: await connect(carrigmore) });

    await orchestrator.ask('hello', { institution: 'Carrigmore College', locale: 'en-IE' });

    const names = model.seenTools[0]?.map((t) => t.name) ?? [];
    expect(names).toHaveLength(3);
    expect(names).not.toContain('campus.report_issue');
  });

  it('passes each tool’s schema through, so the model can fill the arguments', async () => {
    const model = scriptedModel([{ text: 'ok' }]);
    const orchestrator = createOrchestrator({ model, client: await sanTelmo() });

    await orchestrator.ask('hola', { institution: 'San Telmo', locale: 'es-ES' });
    const findRoom = model.seenTools[0]?.find((t) => t.name === 'campus.find_room');

    expect(findRoom?.description).toBeTruthy();
    expect(Object.keys((findRoom?.inputSchema as { properties: object }).properties)).toContain('building');
  });
});

describe('tool names cross the boundary in both directions', () => {
  it('shows the model a name Bedrock will accept', () => {
    // Bedrock rejects anything outside [a-zA-Z0-9_-], and every Lodge tool has a dot in it.
    expect(toModelName('campus.find_room')).toBe('campus_find_room');
    expect(toModelName('campus.find_room')).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it('calls the server back with the name the server published', async () => {
    const model = scriptedModel([
      { toolCalls: [{ id: 't1', name: 'campus_deadlines', input: { topic: 'convalidaciones' } }] },
      { text: 'El 9 de octubre.' },
    ]);
    const orchestrator = createOrchestrator({ model, client: await sanTelmo() });

    const exchange = await orchestrator.ask('¿cuándo acaban las convalidaciones?', {
      institution: 'San Telmo',
      locale: 'es-ES',
    });

    expect(exchange.trace[0]?.tool).toBe('campus.deadlines');
    expect(exchange.trace[0]?.output).toContain('Solicitud de convalidaciones');
  });

  it('says so when the model invents a tool, rather than calling something arbitrary', async () => {
    const model = scriptedModel([
      { toolCalls: [{ id: 't1', name: 'campus_order_coffee', input: {} }] },
      { text: 'Eso no lo puedo hacer.' },
    ]);
    const orchestrator = createOrchestrator({ model, client: await sanTelmo() });

    const exchange = await orchestrator.ask('un café', { institution: 'San Telmo', locale: 'es-ES' });

    expect(exchange.trace[0]?.failed).toBe(true);
    expect(exchange.trace[0]?.output).toMatch(/no tool called campus_order_coffee/);
    // And the model is told, so it can say something useful instead of the turn dying.
    const results = model.seenTurns[1]?.find((t) => t.role === 'toolResults');
    expect(JSON.stringify(results)).toMatch(/no tool called/);
  });
});

describe('the call trace M3 asks for', () => {
  it('records every call with its arguments, answer and timing', async () => {
    const model = scriptedModel([
      {
        toolCalls: [
          { id: 'a', name: 'campus_find_room', input: { building: 'MEN' } },
          { id: 'b', name: 'campus_deadlines', input: {} },
        ],
      },
      { text: 'Tienes MEN-301 libre.' },
    ]);
    const orchestrator = createOrchestrator({ model, client: await sanTelmo() });

    const exchange = await orchestrator.ask('¿qué hay?', { institution: 'San Telmo', locale: 'es-ES' });

    expect(exchange.trace).toHaveLength(2);
    expect(exchange.trace.map((e) => e.step)).toEqual([1, 2]);
    expect(exchange.trace[0]?.tool).toBe('campus.find_room');
    expect(exchange.trace[0]?.input).toEqual({ building: 'MEN' });
    expect(exchange.trace[0]?.ms).toBeGreaterThanOrEqual(0);
  });

  it('adds up the tokens across rounds, which is what the run costs', async () => {
    const model = scriptedModel([
      { toolCalls: [{ id: 'a', name: 'campus_deadlines', input: {} }], usage: { inputTokens: 900, outputTokens: 40 } },
      { text: 'Listo.', usage: { inputTokens: 1200, outputTokens: 30 } },
    ]);
    const orchestrator = createOrchestrator({ model, client: await sanTelmo() });

    const exchange = await orchestrator.ask('¿plazos?', { institution: 'San Telmo', locale: 'es-ES' });

    expect(exchange.usage).toEqual({ inputTokens: 2100, outputTokens: 70 });
  });
});

describe('cards travel around the model, not through it', () => {
  it('collects them from the tool result and hands them on untouched', async () => {
    // Passing HTML through a language model would spend the latency budget on tokens nobody reads,
    // and invite it to edit the markup.
    const model = scriptedModel([
      { toolCalls: [{ id: 'a', name: 'campus_find_room', input: { building: 'MEN' } }] },
      { text: 'MEN-301 está libre.' },
    ]);
    const orchestrator = createOrchestrator({ model, client: await sanTelmo() });

    const exchange = await orchestrator.ask('¿aula libre?', { institution: 'San Telmo', locale: 'es-ES' });

    expect(exchange.cards).toHaveLength(1);
    expect(exchange.cards[0]?.mimeType).toBe(CARD_MIME);
    expect(exchange.cards[0]?.html).toContain('<!doctype html>');
    // The model never saw the HTML: what it got back was the spoken text only.
    const results = JSON.stringify(model.seenTurns[1]);
    expect(results).not.toContain('<!doctype');
  });
});

describe('the loop is bounded', () => {
  it('stops after maxRounds instead of spinning', async () => {
    // A speaker that says nothing for a minute is worse than one that says it is stuck.
    const forever = Array.from({ length: 20 }, () => ({
      text: 'un momento',
      toolCalls: [{ id: 'x', name: 'campus_deadlines', input: {} }],
    }));
    const model = scriptedModel(forever);
    const orchestrator = createOrchestrator({ model, client: await sanTelmo(), maxRounds: 3 });

    const exchange = await orchestrator.ask('¿y?', { institution: 'San Telmo', locale: 'es-ES' });

    expect(model.seenTurns).toHaveLength(3);
    expect(exchange.trace).toHaveLength(3);
    expect(exchange.said).toBe('un momento');
  });

  it('answers in one round when the model needs no tools', async () => {
    const model = scriptedModel([{ text: 'Buenos días.' }]);
    const orchestrator = createOrchestrator({ model, client: await sanTelmo() });

    const exchange = await orchestrator.ask('hola', { institution: 'San Telmo', locale: 'es-ES' });

    expect(model.seenTurns).toHaveLength(1);
    expect(exchange.trace).toEqual([]);
    expect(exchange.said).toBe('Buenos días.');
  });
});

describe('a tool that fails is reported, not thrown', () => {
  it('tells the model what went wrong and keeps the turn alive', async () => {
    const model = scriptedModel([
      // An unauthenticated timetable lookup: the tool answers, it does not throw.
      { toolCalls: [{ id: 'a', name: 'campus_timetable', input: {} }] },
      { text: 'Necesitas identificarte.' },
    ]);
    const orchestrator = createOrchestrator({ model, client: await sanTelmo(null) });

    const exchange = await orchestrator.ask('¿qué tengo hoy?', { institution: 'San Telmo', locale: 'es-ES' });

    expect(exchange.trace[0]?.output).toMatch(/identificarte/);
    expect(exchange.said).toBe('Necesitas identificarte.');
  });
});

describe('the instruction the model works under', () => {
  const prompt = systemPrompt('Universidad de San Telmo', 'es-ES', ['campus.find_room']);

  it('names the institution and the language it must answer in', () => {
    expect(prompt).toContain('Universidad de San Telmo');
    expect(prompt).toContain('es-ES');
  });

  it('forbids inventing a fact about the campus, in the first rule', () => {
    // Every acceptance criterion in docs/use-cases.md is a thing not to do, and this is the one
    // that causes real harm: a confidently wrong deadline is how somebody misses the real one.
    expect(prompt).toMatch(/Never invent/);
    expect(prompt).toMatch(/not on record/);
  });

  it('asks for one or two sentences, because it is spoken', () => {
    expect(prompt).toMatch(/one or two sentences/);
  });

  it('lists only the tools this institution has', () => {
    expect(prompt).toContain('campus.find_room');
    expect(prompt).not.toContain('campus.report_issue');
  });

  it('says plainly when an institution has none', () => {
    expect(systemPrompt('Minimal College', 'en-IE', [])).toMatch(/no tools here/);
  });
});

describe('where the model runs', () => {
  it('defaults to the EU geography', async () => {
    const { DEFAULT_MODEL_ID, DEFAULT_REGION, bedrockOptionsFrom } = await import('./model.ts');

    // Measured from Spain: EU 1 437 ms median against US 1 669 ms. But the deciding half is that
    // Lodge is pitched at European institutions, and naming six European regions is a shorter
    // conversation with their data-protection office than "somewhere in the United States".
    expect(DEFAULT_MODEL_ID).toBe('eu.amazon.nova-2-lite-v1:0');
    expect(DEFAULT_REGION).toBe('eu-west-1');
    expect(bedrockOptionsFrom({})).toEqual({
      modelId: 'eu.amazon.nova-2-lite-v1:0',
      region: 'eu-west-1',
    });
  });

  it('is one environment variable away from anywhere else', async () => {
    const { bedrockOptionsFrom } = await import('./model.ts');

    expect(
      bedrockOptionsFrom({
        LODGE_BEDROCK_MODEL: 'us.amazon.nova-2-lite-v1:0',
        LODGE_BEDROCK_REGION: 'us-east-1',
      }),
    ).toEqual({ modelId: 'us.amazon.nova-2-lite-v1:0', region: 'us-east-1' });
  });
});
