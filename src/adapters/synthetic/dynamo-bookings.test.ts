/**
 * The DynamoDB room diary, against a table that behaves like one — same reasoning as the fault
 * queue's test: the key is the interesting part, so the fake has to honour it.
 */

import { describe, expect, it } from 'vitest';

import { campusInstant } from './campus.ts';
import { DynamoBookingStore } from './dynamo-bookings.ts';
import type { DynamoLike } from './dynamo-issues.ts';

interface Item {
  [key: string]: { S?: string; N?: string };
}

/** One partition key, one sort key, an atomic counter and a query: what the store uses. */
function fakeTable(): DynamoLike {
  const rows = new Map<string, Item>();
  const keyOf = (item: Item): string => `${item['startDay']?.S}|${item['reference']?.S}`;

  return {
    async send(command: never): Promise<unknown> {
      const { input } = command as unknown as { input: Record<string, unknown> };
      const name = (command as unknown as object).constructor.name;

      if (name === 'QueryCommand') {
        const day = (input['ExpressionAttributeValues'] as Item)[':day']?.S;
        return { Items: [...rows.values()].filter((row) => row['startDay']?.S === day) };
      }
      if (name === 'UpdateItemCommand') {
        const key = keyOf(input['Key'] as Item);
        const next = Number(rows.get(key)?.['seq']?.N ?? '0') + 1;
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

const afternoon = {
  start: campusInstant('2026-10-06', '16:00'),
  end: campusInstant('2026-10-06', '18:00'),
};

describe('DynamoBookingStore', () => {
  it('hands out references after the seeded ones, one each', async () => {
    const store = new DynamoBookingStore({ tableName: 'b', client: fakeTable() });
    const hold = { roomId: 'FAR-101', start: afternoon.start, end: afternoon.end, bookedBy: 'doc-0007' };

    expect((await store.add(hold)).reference).toBe('RES-2026-0004');
    expect((await store.add(hold)).reference).toBe('RES-2026-0005');
  });

  it('sees a booking made by another instance, which is the point of the table', async () => {
    const table = fakeTable();
    await new DynamoBookingStore({ tableName: 'b', client: table }).add({
      roomId: 'FAR-101',
      start: afternoon.start,
      end: afternoon.end,
      purpose: 'Tribunal',
      bookedBy: 'doc-0007',
    });

    const seen = await new DynamoBookingStore({ tableName: 'b', client: table }).overlapping(afternoon);

    expect(seen).toEqual([
      expect.objectContaining({ roomId: 'FAR-101', purpose: 'Tribunal', start: afternoon.start }),
    ]);
  });

  it('finds a booking that started the UTC day before and runs into the window', async () => {
    const store = new DynamoBookingStore({ tableName: 'b', client: fakeTable() });
    await store.add({
      roomId: 'FAR-101',
      start: new Date('2026-10-06T20:00:00Z'),
      end: new Date('2026-10-07T02:00:00Z'),
      bookedBy: 'doc-0007',
    });

    const seen = await store.overlapping({
      start: new Date('2026-10-07T01:00:00Z'),
      end: new Date('2026-10-07T03:00:00Z'),
    });

    expect(seen.map((b) => b.roomId)).toEqual(['FAR-101']);
  });

  it('merges the seeded diary in on read, so a fresh table matches a fresh clone', async () => {
    const store = new DynamoBookingStore({ tableName: 'b', client: fakeTable() });

    const seen = await store.overlapping({
      start: campusInstant('2026-09-23', '09:00'),
      end: campusInstant('2026-09-23', '12:00'),
    });

    expect(seen.map((b) => b.reference)).toEqual(['RES-2026-0001']);
  });

  it('leaves a booking with no purpose without one, rather than an empty string', async () => {
    const store = new DynamoBookingStore({ tableName: 'b', client: fakeTable() });
    await store.add({ roomId: 'FAR-101', start: afternoon.start, end: afternoon.end, bookedBy: 'x' });

    const [seen] = await store.overlapping(afternoon);

    expect(seen).not.toHaveProperty('purpose');
  });
});
