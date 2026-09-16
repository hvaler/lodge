/**
 * The daily ceiling on the public demonstration.
 *
 * Every answered question spends money on a model, and the page is open to anyone with the link.
 * A counter in DynamoDB is the smallest thing that bounds that: shared across every container,
 * atomic, and it costs a single write per question.
 *
 * It is deliberately a *cap* and not a rate limit. Rate limiting per address is the wrong shape
 * here — a room full of judges behind one NAT is exactly who should not be throttled, and anybody
 * determined to exhaust the budget will use more than one address anyway. What matters is that the
 * total is bounded and that hitting it is a polite sentence rather than a broken page.
 */

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';

import type { Quota } from './handler.ts';

/** Only the part of the SDK client this uses. */
export interface DynamoLike {
  send(command: never): Promise<unknown>;
}

export interface DailyQuotaOptions {
  readonly tableName: string;
  readonly limit: number;
  readonly client?: DynamoLike;
  /** Injected so a test can decide what day it is. */
  readonly now?: () => Date;
}

/** UTC, so the reset happens at a time that is nobody's working day in particular. */
function dayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function createDailyQuota(options: DailyQuotaOptions): Quota {
  const client = options.client ?? (new DynamoDBClient({}) as unknown as DynamoLike);
  const now = options.now ?? ((): Date => new Date());

  return {
    async take() {
      // Counted before answering rather than after. Counting afterwards would let a burst of
      // simultaneous questions all pass the check and all spend, which is precisely the case the
      // cap exists for.
      const response = (await client.send(
        new UpdateItemCommand({
          TableName: options.tableName,
          Key: { day: { S: dayOf(now()) } },
          UpdateExpression: 'ADD asked :one',
          ExpressionAttributeValues: { ':one': { N: '1' } },
          ReturnValues: 'UPDATED_NEW',
        }) as never,
      )) as { Attributes?: Record<string, AttributeValue> };

      const asked = Number(response.Attributes?.['asked']?.N ?? '1');
      return { allowed: asked <= options.limit, remaining: Math.max(0, options.limit - asked) };
    },
  };
}

/** How many questions a day. Absent means no cap, which is right for a local run. */
export function dailyLimitFrom(env: NodeJS.ProcessEnv): number | null {
  const raw = env['LODGE_DEMO_DAILY_LIMIT'];
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`LODGE_DEMO_DAILY_LIMIT must be a positive whole number, got '${raw}'.`);
  }
  return parsed;
}

/** Where the counter lives. Absent means no cap. */
export function quotaTableFrom(env: NodeJS.ProcessEnv): string | null {
  return env['LODGE_DEMO_QUOTA_TABLE'] ?? null;
}
