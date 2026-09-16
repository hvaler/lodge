/**
 * The DynamoDB fault queue, against a table that behaves like one.
 *
 * The fake below implements the three operations the store actually uses, rather than asserting
 * that particular commands were constructed. A test that only checks "a PutItemCommand was built"
 * passes just as happily when the key is wrong, and the key is the interesting part.
 */

import { describe, expect, it } from 'vitest';

import { campusInstant } from './campus.ts';
import { DynamoIssueStore } from './dynamo-issues.ts';
import type { DynamoLike } from './dynamo-issues.ts';
import { InMemoryIssueStore } from './issues.ts';

const NOW = campusInstant('2026-10-06', '16:30');

interface Item {
  [key: string]: { S?: string; N?: string };
}

/** Enough of a table: one partition key, one sort key, an atomic counter, and a query. */
function fakeTable(): DynamoLike & { rows(): Item[] } {
  const rows = new Map<string, Item>();
  const keyOf = (item: Item): string => `${item['openedBy']?.S}|${item['number']?.S}`;

  return {
    rows: () => [...rows.values()],
    async send(command: never): Promise<unknown> {
      const { input } = command as unknown as { input: Record<string, never> };
      const name = (command as unknown as object).constructor.name;

      if (name === 'QueryCommand') {
        const wanted = (input['ExpressionAttributeValues'] as Item)[':subject']?.S;
        return { Items: [...rows.values()].filter((row) => row['openedBy']?.S === wanted) };
      }

      if (name === 'UpdateItemCommand') {
        const key = keyOf(input['Key'] as Item);
        const row = rows.get(key) ?? {};
        const next = Number(row['seq']?.N ?? '0') + 1;
        rows.set(key, { ...(input['Key'] as Item), seq: { N: String(next) } });
        return { Attributes: { seq: { N: String(next) } } };
      }

      if (name === 'PutItemCommand') {
        const item = input['Item'] as Item;
        rows.set(keyOf(item), item);
        return {};
      }

      throw new Error(`the fake table does not implement ${name}`);
    },
  };
}

function storeOn(table: DynamoLike): DynamoIssueStore {
  return new DynamoIssueStore({ tableName: 'lodge-issues', client: table });
}

const fault = {
  roomId: 'MEN-203',
  equipment: 'proyector',
  status: 'open' as const,
  openedAt: NOW,
  openedBy: 'doc-0007',
};

describe('the seeded faults are code, not rows', () => {
  it('answers UC-06 on an empty table, so a fresh deployment needs no seeding step', async () => {
    const table = fakeTable();

    const theirs = await storeOn(table).openedBy('doc-0011');

    expect(theirs.map((i) => i.number)).toContain('INC-2026-0028');
    expect(table.rows()).toHaveLength(0);
  });

  it('gives the same answers as the in-memory store it stands in for', async () => {
    // The two deployment targets must not disagree about the dataset, or the video matches one
    // of them and not the other.
    const table = fakeTable();

    const [managed, selfHosted] = await Promise.all([
      storeOn(table).openedBy('doc-0011'),
      new InMemoryIssueStore().openedBy('doc-0011'),
    ]);

    expect(managed).toEqual(selfHosted);
  });

  it('returns nothing for someone who never reported anything', async () => {
    expect(await storeOn(fakeTable()).openedBy('est-0001')).toEqual([]);
  });
});

describe('filing a fault', () => {
  it('starts numbering after the seeded ones, so no reference is ever reused', async () => {
    const filed = await storeOn(fakeTable()).add(fault);

    expect(filed.number).toBe('INC-2026-0032');
  });

  it('gives two simultaneous reports two different references', async () => {
    // The reason for an atomic counter rather than "read the highest and add one": two people
    // reporting the same broken projector at once would otherwise get the same number.
    const store = storeOn(fakeTable());

    const both = await Promise.all([store.add(fault), store.add(fault)]);

    expect(new Set(both.map((i) => i.number)).size).toBe(2);
  });

  it('is chaseable by whoever filed it, and by nobody else', async () => {
    const table = fakeTable();
    const store = storeOn(table);

    const filed = await store.add(fault);

    expect((await store.openedBy('doc-0007')).map((i) => i.number)).toContain(filed.number);
    expect((await store.openedBy('doc-0011')).map((i) => i.number)).not.toContain(filed.number);
  });

  it('survives a round trip through the table with every field intact', async () => {
    const store = storeOn(fakeTable());

    const filed = await store.add(fault);
    const [read] = await store.openedBy('doc-0007');

    expect(read).toEqual(filed);
  });

  it('lists the newest first, because that is the one being asked about', async () => {
    const store = storeOn(fakeTable());

    await store.add({ ...fault, openedAt: campusInstant('2026-10-01', '09:00') });
    const latest = await store.add({ ...fault, openedAt: campusInstant('2026-10-06', '16:30') });

    expect((await store.openedBy('doc-0007'))[0]?.number).toBe(latest.number);
  });

  it('keeps the counter out of anybody’s fault list', async () => {
    const store = storeOn(fakeTable());
    await store.add(fault);

    // The counter shares the table under a partition key no subject can be.
    expect(await store.openedBy('#sequence')).toEqual([]);
  });
});
