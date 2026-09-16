/**
 * The model, behind an interface.
 *
 * Bedrock lives at the edge on purpose: everything above this file is testable without an AWS
 * account, and swapping the model is a constructor argument rather than a rewrite. That mattered
 * concretely — the orchestrator was built while the AWS account was still being verified.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { ContentBlock, Message, Tool } from '@aws-sdk/client-bedrock-runtime';

/**
 * The SDK types arbitrary JSON as its own recursive `DocumentType`.
 *
 * Casting happens here and only here: letting that type into {@link ToolSpec} would leak AWS
 * upwards through an interface whose whole point is that nothing above it knows about AWS. A
 * JSON Schema and a tool's arguments are JSON by definition, so the cast is safe by construction.
 *
 * The shape is declared here rather than imported: `DocumentType` lives in `@smithy/types`, which
 * is a transitive dependency, and reaching into somebody else's dependency tree for a type this
 * small buys a breakage for nothing. Structurally it is the same type.
 */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const asDocument = (value: Record<string, unknown>): Json => value as Json;

/** A tool as the model sees it: a name, a sentence, and a JSON Schema for its arguments. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** One reply from the model: something to say, tools to call, or both. */
export interface ModelTurn {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

/** What the conversation so far looks like. Tool results are answers to the model's own calls. */
export type Turn =
  | { readonly role: 'user'; readonly text: string }
  | { readonly role: 'assistant'; readonly text: string; readonly toolCalls: readonly ToolCall[] }
  | { readonly role: 'toolResults'; readonly results: readonly ToolResult[] };

export interface ToolResult {
  readonly id: string;
  readonly text: string;
  readonly failed?: boolean;
}

export interface Model {
  /** For the trace, so a viewer can see which model answered. */
  readonly id: string;
  converse(system: string, turns: readonly Turn[], tools: readonly ToolSpec[]): Promise<ModelTurn>;
}

/**
 * Bedrock rejects a tool name that is not `[a-zA-Z0-9_-]`, and every Lodge tool is `campus.x`.
 *
 * The dot is part of the MCP contract and is not up for negotiation on that side, so the mapping
 * happens here and nowhere else: the model sees `campus_find_room`, the server keeps
 * `campus.find_room`, and neither has to know about the other's constraint.
 */
export function toModelName(mcpName: string): string {
  return mcpName.replace(/\./g, '_');
}

/** The inverse. Built from the live catalogue rather than by replacing underscores, because an
 *  institution could one day publish a tool whose own name contains one. */
export function modelNameLookup(mcpNames: readonly string[]): ReadonlyMap<string, string> {
  return new Map(mcpNames.map((name) => [toModelName(name), name]));
}

export interface BedrockModelOptions {
  /**
   * Geographic inference profile, not the bare model id.
   *
   * Nova 2 Lite has no in-region availability anywhere: `amazon.nova-2-lite-v1:0` fails even in
   * us-east-1, which the model card's own sample code gets wrong.
   */
  readonly modelId?: string;
  readonly region?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

/**
 * Geography defaults to EU, and the reason is not only speed.
 *
 * Measured from Spain with the full orchestrator, six turns each: EU 1 437 ms median against US
 * 1 669 ms — about 14 % and worth having, though not the big lever. What settles it is the other
 * half: Lodge is pitched at European institutions whose data-protection office asks where requests
 * are processed, and "Ireland, Frankfurt, Milan, Spain, Paris or Stockholm" is a shorter
 * conversation than "somewhere in the United States".
 *
 * A US deployment changes one environment variable. Nothing else moves.
 */
export const DEFAULT_MODEL_ID = 'eu.amazon.nova-2-lite-v1:0';
export const DEFAULT_REGION = 'eu-west-1';

/** Reads the geography from the environment, so a deployment is configuration and not a rebuild. */
export function bedrockOptionsFrom(env: NodeJS.ProcessEnv): BedrockModelOptions {
  return {
    modelId: env['LODGE_BEDROCK_MODEL'] ?? DEFAULT_MODEL_ID,
    region: env['LODGE_BEDROCK_REGION'] ?? DEFAULT_REGION,
  };
}

function toBedrockTools(tools: readonly ToolSpec[]): Tool[] {
  return tools.map((tool) => ({
    toolSpec: {
      name: toModelName(tool.name),
      description: tool.description,
      inputSchema: { json: asDocument(tool.inputSchema) },
    },
  }));
}

function toBedrockMessages(turns: readonly Turn[]): Message[] {
  return turns.map((turn): Message => {
    if (turn.role === 'user') return { role: 'user', content: [{ text: turn.text }] };

    if (turn.role === 'assistant') {
      const content: ContentBlock[] = [];
      if (turn.text) content.push({ text: turn.text });
      for (const call of turn.toolCalls) {
        content.push({
          toolUse: { toolUseId: call.id, name: toModelName(call.name), input: asDocument(call.input) },
        });
      }
      return { role: 'assistant', content };
    }

    // Tool results go back as a user turn: that is the shape Converse expects.
    return {
      role: 'user',
      content: turn.results.map((result) => ({
        toolResult: {
          toolUseId: result.id,
          content: [{ text: result.text }],
          status: result.failed ? ('error' as const) : ('success' as const),
        },
      })),
    };
  });
}

export function createBedrockModel(options: BedrockModelOptions = {}): Model {
  const modelId = options.modelId ?? DEFAULT_MODEL_ID;
  const client = new BedrockRuntimeClient({ region: options.region ?? DEFAULT_REGION });

  return {
    id: modelId,

    async converse(system, turns, tools) {
      const response = await client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: system }],
          messages: toBedrockMessages(turns),
          ...(tools.length > 0 ? { toolConfig: { tools: toBedrockTools(tools) } } : {}),
          inferenceConfig: {
            // Short by design: this is read aloud, and every token is latency against a 500 ms
            // budget. The model is told to be brief; this makes it impossible not to be.
            maxTokens: options.maxTokens ?? 512,
            temperature: options.temperature ?? 0.2,
          },
          // No `reasoningConfig` (ADR-010). It defaults to disabled, and the console playground
          // turning it on is what produced a 5.3-second answer to a one-line question.
        }),
      );

      const content = response.output?.message?.content ?? [];
      const text = content
        .map((block) => block.text)
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .trim();

      const toolCalls = content
        .map((block) => block.toolUse)
        .filter((use): use is NonNullable<typeof use> => Boolean(use?.toolUseId && use.name))
        .map((use) => ({
          id: use.toolUseId!,
          name: use.name!,
          input: (use.input ?? {}) as Record<string, unknown>,
        }));

      return {
        text,
        toolCalls,
        usage: {
          inputTokens: response.usage?.inputTokens ?? 0,
          outputTokens: response.usage?.outputTokens ?? 0,
        },
      };
    },
  };
}
