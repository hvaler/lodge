/**
 * The demonstration orchestrator.
 *
 * Alexa+ for Builders is limited to selected partners, so the hackathon's own guidance is to
 * "simulate an Alexa+ experience using your preferred agentic tools via a web app". This is that
 * simulation — and because it is ours, it ships as open source rather than being a throwaway.
 *
 * What makes it a demonstration of Lodge rather than of itself: **the tools come from the live MCP
 * server**. Nothing here knows there are six of them, what they are called, or what they do. Point
 * it at Carrigmore and it offers four; point it at an institution with no issue tracker and the
 * agent genuinely cannot file a fault, because the tool was never in the catalogue.
 */

import type { Client } from '@modelcontextprotocol/client';

import type { Model, ToolCall, ToolResult, ToolSpec, Turn, Usage } from './model.ts';
import { modelNameLookup } from './model.ts';

/** One step, as the demo shows it. M3 asks for a visible call trace; this is what it renders. */
export interface TraceEntry {
  readonly step: number;
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly output: string;
  readonly ms: number;
  readonly failed?: boolean;
}

export interface Card {
  readonly uri: string;
  readonly mimeType: string;
  readonly html: string;
}

export interface Exchange {
  /** What the agent says. On a speaker this is the entire answer. */
  readonly said: string;
  readonly cards: readonly Card[];
  readonly trace: readonly TraceEntry[];
  /** End to end, against the 500 ms platform budget. */
  readonly ms: number;
  /** Summed over every round of the tool loop, not just the last one. */
  readonly usage: Usage;
}

export interface OrchestratorOptions {
  readonly model: Model;
  /** A connected MCP client. Which institution it points at is the caller's business. */
  readonly client: Client;
  /**
   * How many times the model may call tools before it has to answer.
   *
   * Bounded because a model that keeps calling tools would otherwise spin until the request times
   * out, and a speaker that says nothing for a minute is worse than one that says it is stuck.
   */
  readonly maxRounds?: number;
  readonly now?: () => number;
}

/**
 * The instruction the model works under.
 *
 * Deliberately short and mostly prohibitions. The behaviour that matters here is the behaviour the
 * use cases demand, and every one of those is a thing *not* to do: do not invent a date, do not
 * answer at length, do not claim a capability the catalogue does not offer.
 */
export function systemPrompt(institution: string, locale: string, toolNames: readonly string[]): string {
  return [
    `You are the porter's desk at ${institution}. You answer students and staff out loud.`,
    '',
    `Answer in the language of this locale: ${locale}. Match it exactly, including for numbers and dates.`,
    '',
    'Rules, in order of importance:',
    '1. Never invent a fact about the campus. Rooms, timetables, deadlines and faults come only from',
    '   the tools. If a tool returns nothing, say plainly that it is not on record and suggest asking',
    '   the registry — and name no other place to look, because a portal or an app you have not been',
    '   told about is another invented fact. A confidently wrong deadline is how somebody misses the',
    '   real one.',
    '2. Keep it to one or two sentences. This is spoken aloud, not read.',
    '3. Plain sentences only. No markdown, no asterisks, no bullet points, no headings: a speech',
    '   synthesiser reads the symbols out, so "**INC-2026-0032**" becomes "asterisk asterisk".',
    '4. Use the tools available to you and nothing else. If what is asked needs a tool you do not',
    '   have, say this institution cannot answer that here.',
    '5. Repeat back reference numbers exactly as the tool gave them.',
    '',
    toolNames.length > 0
      ? `Tools available at this institution: ${toolNames.join(', ')}.`
      : 'You have no tools here, so you can only explain that you cannot help.',
  ].join('\n');
}

/** Turns the MCP catalogue into what the model needs to choose between them. */
async function readCatalogue(client: Client): Promise<ToolSpec[]> {
  const { tools } = await client.listTools();

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? tool.name,
    inputSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
  }));
}

interface CallOutcome {
  readonly result: ToolResult;
  readonly entry: TraceEntry;
  readonly cards: readonly Card[];
}

async function runTool(
  client: Client,
  call: ToolCall,
  mcpName: string,
  step: number,
  now: () => number,
): Promise<CallOutcome> {
  const started = now();

  try {
    const response = await client.callTool({ name: mcpName, arguments: call.input });
    const blocks = (response.content ?? []) as {
      type: string;
      text?: string;
      resource?: { uri: string; mimeType: string; text: string };
    }[];

    const text = blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join(' ')
      .trim();

    // Cards travel around the model, not through it. Passing HTML through a language model would
    // spend the latency budget on tokens nobody reads, and invite it to edit the markup.
    const cards = blocks
      .filter((block) => block.type === 'resource' && block.resource)
      .map((block) => ({
        uri: block.resource!.uri,
        mimeType: block.resource!.mimeType,
        html: block.resource!.text,
      }));

    return {
      result: { id: call.id, text: text || '(no answer)' },
      entry: { step, tool: mcpName, input: call.input, output: text, ms: now() - started },
      cards,
    };
  } catch (error) {
    // A failed tool is told to the model rather than thrown: it can say something useful about it,
    // and a stack trace read aloud helps nobody.
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: { id: call.id, text: `The tool failed: ${message}`, failed: true },
      entry: { step, tool: mcpName, input: call.input, output: message, ms: now() - started, failed: true },
      cards: [],
    };
  }
}

/**
 * What was said before, as the page remembers it.
 *
 * Only the spoken halves: the model's own earlier tool calls and their results are not replayed.
 * That keeps a long conversation from growing without bound, and it is enough for the case that
 * needs it — a confirmation works because the room and the equipment are in the question the model
 * itself asked, not in the tool result behind it.
 */
export interface PriorTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export function createOrchestrator(options: OrchestratorOptions): {
  ask(
    utterance: string,
    context: { institution: string; locale: string },
    history?: readonly PriorTurn[],
  ): Promise<Exchange>;
} {
  const { model, client } = options;
  const maxRounds = options.maxRounds ?? 4;
  const now = options.now ?? ((): number => performance.now());

  return {
    async ask(utterance, context, history = []) {
      const startedAt = now();

      const tools = await readCatalogue(client);
      const byModelName = modelNameLookup(tools.map((tool) => tool.name));
      const system = systemPrompt(context.institution, context.locale, tools.map((t) => t.name));

      const turns: Turn[] = [
        ...history.map((turn): Turn =>
          turn.role === 'user'
            ? { role: 'user', text: turn.text }
            : { role: 'assistant', text: turn.text, toolCalls: [] },
        ),
        { role: 'user', text: utterance },
      ];
      const trace: TraceEntry[] = [];
      const cards: Card[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let said = '';

      for (let round = 0; round < maxRounds; round++) {
        const reply = await model.converse(system, turns, tools);
        inputTokens += reply.usage.inputTokens;
        outputTokens += reply.usage.outputTokens;
        cacheReadTokens += reply.usage.cacheReadTokens;
        cacheWriteTokens += reply.usage.cacheWriteTokens;
        said = reply.text || said;

        if (reply.toolCalls.length === 0) break;

        turns.push({ role: 'assistant', text: reply.text, toolCalls: reply.toolCalls });

        const outcomes = await Promise.all(
          reply.toolCalls.map((call, index) => {
            // A name the catalogue does not contain is the model inventing one. Saying so beats
            // calling something arbitrary, and it shows up in the trace as what it was.
            const mcpName = byModelName.get(call.name);
            if (!mcpName) {
              const message = `There is no tool called ${call.name} at this institution.`;
              return Promise.resolve<CallOutcome>({
                result: { id: call.id, text: message, failed: true },
                entry: {
                  step: trace.length + index + 1,
                  tool: call.name,
                  input: call.input,
                  output: message,
                  ms: 0,
                  failed: true,
                },
                cards: [],
              });
            }
            return runTool(client, call, mcpName, trace.length + index + 1, now);
          }),
        );

        for (const outcome of outcomes) {
          trace.push(outcome.entry);
          cards.push(...outcome.cards);
        }
        turns.push({ role: 'toolResults', results: outcomes.map((o) => o.result) });
      }

      return {
        said: said.trim(),
        cards,
        trace,
        ms: now() - startedAt,
        usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
      };
    },
  };
}

export { bedrockOptionsFrom, createBedrockModel, DEFAULT_MODEL_ID, DEFAULT_REGION } from './model.ts';
export type { Model, ToolSpec, Turn, Usage } from './model.ts';
