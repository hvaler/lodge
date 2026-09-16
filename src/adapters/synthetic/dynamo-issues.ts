/**
 * The fault queue, in DynamoDB.
 *
 * The managed target runs on Lambda, where "in memory" means *this container's* memory: a fault
 * filed by one invocation is invisible to the next, and UC-06 — chasing the report you just made —
 * would work or not depending on which container answered. The table is the smallest thing that
 * fixes that, and it is the only state Lodge has anywhere.
 *
 * Note what is *not* in the table: the seeded faults. Those are part of the San Telmo dataset, which
 * is generated and deterministic, so they live in code and are merged in on read. That keeps a
 * fresh deployment able to answer UC-06 with no seeding step, no migration, and no way for a
 * half-run seeder to leave the demo in a state the video does not match.
 */

import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';

import type { IssueStatus } from '../../provider/index.ts';
import { FIRST_FREE_ISSUE_NUMBER, SEEDED_ISSUES, formatIssueNumber } from './academic.ts';
import type { IssueStore, StoredIssue } from './issues.ts';

/**
 * Where the counter lives.
 *
 * It shares the table with the faults rather than needing a second one, under a partition key no
 * subject can collide with: a `sub` claim is an identifier from an identity provider and will not
 * be the literal string below.
 */
const SEQUENCE_KEY = '#sequence';

/** Just the part of the SDK client this uses, so a test can supply forty lines instead of a table. */
export interface DynamoLike {
  send(command: never): Promise<unknown>;
}

export interface DynamoIssueStoreOptions {
  readonly tableName: string;
  /** Defaults to a client built from the ambient credentials, which is what Lambda provides. */
  readonly client?: DynamoLike;
}

function str(value: AttributeValue | undefined): string {
  return typeof value?.S === 'string' ? value.S : '';
}

export class DynamoIssueStore implements IssueStore {
  readonly #client: DynamoLike;
  readonly #table: string;

  constructor(options: DynamoIssueStoreOptions) {
    this.#client = options.client ?? (new DynamoDBClient({}) as unknown as DynamoLike);
    this.#table = options.tableName;
  }

  async openedBy(subject: string): Promise<readonly StoredIssue[]> {
    // The counter lives in this table too, and a query for its partition would hand it back as a
    // fault with every field empty. No real subject is this string, but "no real caller does that"
    // is how a nonsense row ends up being read aloud to somebody.
    if (subject === SEQUENCE_KEY) return [];

    const response = (await this.#client.send(
      new QueryCommand({
        TableName: this.#table,
        KeyConditionExpression: 'openedBy = :subject',
        ExpressionAttributeValues: { ':subject': { S: subject } },
      }) as never,
    )) as { Items?: Record<string, AttributeValue>[] };

    const filed: StoredIssue[] = (response.Items ?? []).map((item) => ({
      number: str(item['number']),
      roomId: str(item['roomId']),
      equipment: str(item['equipment']),
      status: str(item['status']) as IssueStatus,
      openedAt: new Date(str(item['openedAt'])),
      openedBy: str(item['openedBy']),
    }));

    const seeded = SEEDED_ISSUES.filter((issue) => issue.openedBy === subject).map(
      (issue): StoredIssue => ({
        number: issue.number,
        roomId: issue.roomId,
        equipment: issue.equipment,
        status: issue.status satisfies IssueStatus,
        openedAt: issue.openedAt,
        openedBy: issue.openedBy,
      }),
    );

    // Newest first: somebody chasing a report means the one they have just filed.
    return [...seeded, ...filed].sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  }

  async add(issue: Omit<StoredIssue, 'number'>): Promise<StoredIssue> {
    // An atomic counter rather than "read the highest and add one", which two people reporting the
    // same broken projector at the same time would resolve to the same reference. `ADD` on an
    // absent attribute starts from zero, so the first fault of a fresh table lands on the first
    // free number and the seeded ones are never reused.
    const counter = (await this.#client.send(
      new UpdateItemCommand({
        TableName: this.#table,
        Key: { openedBy: { S: SEQUENCE_KEY }, number: { S: SEQUENCE_KEY } },
        UpdateExpression: 'ADD seq :one',
        ExpressionAttributeValues: { ':one': { N: '1' } },
        ReturnValues: 'UPDATED_NEW',
      }) as never,
    )) as { Attributes?: Record<string, AttributeValue> };

    const taken = Number(counter.Attributes?.['seq']?.N ?? '1');
    const stored: StoredIssue = {
      ...issue,
      number: formatIssueNumber(FIRST_FREE_ISSUE_NUMBER - 1 + taken),
    };

    await this.#client.send(
      new PutItemCommand({
        TableName: this.#table,
        Item: {
          openedBy: { S: stored.openedBy },
          number: { S: stored.number },
          roomId: { S: stored.roomId },
          equipment: { S: stored.equipment },
          status: { S: stored.status },
          openedAt: { S: stored.openedAt.toISOString() },
        },
      }) as never,
    );

    return stored;
  }
}

/** Where the table is. Absent means this deployment keeps its faults in memory. */
export function issuesTableFrom(env: NodeJS.ProcessEnv): string | null {
  return env['LODGE_ISSUES_TABLE'] ?? null;
}
