/**
 * The room diary, in DynamoDB.
 *
 * For the reason the fault queue is there too: on Lambda, "in memory" is one container's memory. A
 * room held by one invocation would still look free to the next, and UC-09 — the booking disappears
 * from the free-room answer — would hold or not depending on which container answered.
 *
 * Keyed by the UTC day a booking starts on, so "what overlaps this window" is one query per day the
 * window could reach rather than a scan of every booking ever made. How far back to look is the
 * adapter's longest booking, eight hours.
 *
 * As with the faults, the seeded bookings live in code and are merged in on read, so a fresh table
 * answers exactly what a fresh clone does.
 */

import { DynamoDBClient, PutItemCommand, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';

import type { TimeWindow } from '../../provider/index.ts';
import { FIRST_FREE_BOOKING, formatBookingReference, seededBookings } from './bookings.ts';
import type { BookingStore, StoredBooking } from './bookings.ts';
import type { DynamoLike } from './dynamo-issues.ts';

/** The counter's partition. A UTC date is never this string. */
const SEQUENCE_KEY = '#sequence';

/** How far back a booking can start and still overlap: the adapter's longest booking. */
const LONGEST_BOOKING_MS = 8 * 60 * 60_000;

export interface DynamoBookingStoreOptions {
  readonly tableName: string;
  /** Defaults to a client built from the ambient credentials, which is what Lambda provides. */
  readonly client?: DynamoLike;
}

function str(value: AttributeValue | undefined): string {
  return typeof value?.S === 'string' ? value.S : '';
}

const dayOf = (at: Date): string => at.toISOString().slice(0, 10);

/** Every UTC day a booking overlapping `window` could have started on. */
function daysReaching(window: TimeWindow): string[] {
  const days: string[] = [];
  const cursor = new Date(`${dayOf(new Date(window.start.getTime() - LONGEST_BOOKING_MS))}T00:00:00Z`);
  while (cursor < window.end) {
    days.push(dayOf(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export class DynamoBookingStore implements BookingStore {
  readonly #client: DynamoLike;
  readonly #table: string;
  readonly #seeded = seededBookings();

  constructor(options: DynamoBookingStoreOptions) {
    this.#client = options.client ?? (new DynamoDBClient({}) as unknown as DynamoLike);
    this.#table = options.tableName;
  }

  async overlapping(window: TimeWindow): Promise<readonly StoredBooking[]> {
    const pages = (await Promise.all(
      daysReaching(window).map((day) =>
        this.#client.send(
          new QueryCommand({
            TableName: this.#table,
            KeyConditionExpression: 'startDay = :day',
            ExpressionAttributeValues: { ':day': { S: day } },
          }) as never,
        ),
      ),
    )) as { Items?: Record<string, AttributeValue>[] }[];

    const stored: StoredBooking[] = pages
      .flatMap((page) => page.Items ?? [])
      .map((item) => ({
        reference: str(item['reference']),
        roomId: str(item['roomId']),
        start: new Date(str(item['start'])),
        end: new Date(str(item['end'])),
        ...(item['purpose'] ? { purpose: str(item['purpose']) } : {}),
        bookedBy: str(item['bookedBy']),
      }));

    return [...this.#seeded, ...stored]
      .filter((b) => b.start < window.end && b.end > window.start)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async add(booking: Omit<StoredBooking, 'reference'>): Promise<StoredBooking> {
    // An atomic counter, for the same reason as the fault references: two people holding rooms at
    // the same moment must not be handed the same reference.
    const counter = (await this.#client.send(
      new UpdateItemCommand({
        TableName: this.#table,
        Key: { startDay: { S: SEQUENCE_KEY }, reference: { S: SEQUENCE_KEY } },
        UpdateExpression: 'ADD seq :one',
        ExpressionAttributeValues: { ':one': { N: '1' } },
        ReturnValues: 'UPDATED_NEW',
      }) as never,
    )) as { Attributes?: Record<string, AttributeValue> };

    const taken = Number(counter.Attributes?.['seq']?.N ?? '1');
    const stored: StoredBooking = {
      ...booking,
      reference: formatBookingReference(FIRST_FREE_BOOKING - 1 + taken),
    };

    await this.#client.send(
      new PutItemCommand({
        TableName: this.#table,
        Item: {
          startDay: { S: dayOf(stored.start) },
          reference: { S: stored.reference },
          roomId: { S: stored.roomId },
          start: { S: stored.start.toISOString() },
          end: { S: stored.end.toISOString() },
          bookedBy: { S: stored.bookedBy },
          ...(stored.purpose ? { purpose: { S: stored.purpose } } : {}),
        },
      }) as never,
    );

    return stored;
  }
}

/** Where the diary is. Absent means this deployment keeps its bookings in memory. */
export function bookingsTableFrom(env: NodeJS.ProcessEnv): string | null {
  return env['LODGE_BOOKINGS_TABLE'] ?? null;
}
