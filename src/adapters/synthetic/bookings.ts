/**
 * The room diary.
 *
 * Behind a small interface for the same reason the fault queue is: what holds a booking differs by
 * institution and by deployment. Here it is memory, in the managed target it is DynamoDB, and at a
 * real university it is whatever already owns the room calendars — Exchange resource mailboxes,
 * most often. The adapter does not care which, and the provider interface never hears about it.
 *
 * That is the whole point of putting an interface here for an MVP: the simulation and the real
 * system are the same shape, so replacing one with the other is a constructor argument rather than
 * a rewrite.
 */

import type { Booking, TimeWindow } from '../../provider/index.ts';
import { campusInstant } from './campus.ts';

/** A held room, plus who holds it. Nothing outside this module needs the second part. */
export interface StoredBooking extends Booking {
  /** Subject of whoever booked it. */
  readonly bookedBy: string;
}

export interface BookingStore {
  /** Everything overlapping `window`, for availability and for one room's diary. */
  overlapping(window: TimeWindow): Promise<readonly StoredBooking[]>;
  add(booking: Omit<StoredBooking, 'reference'>): Promise<StoredBooking>;
}

/** `RES-2026-0007`, in the shape of the fault references so both read alike out loud. */
export function formatBookingReference(sequence: number): string {
  return `RES-2026-${String(sequence).padStart(4, '0')}`;
}

const FIRST_FREE_BOOKING = 4;

/**
 * In-memory diary, seeded so a clean clone has something to collide with.
 *
 * The seed matters more here than it does for faults: a booking tool that never says "that one is
 * taken" has not been seen to work. These three are in San Telmo's quietest rooms on purpose, so
 * the demonstration can find a free room *and* be refused a taken one within the same minute.
 */
export class InMemoryBookingStore implements BookingStore {
  readonly #bookings: StoredBooking[];
  #nextSequence: number;

  constructor(seed: readonly StoredBooking[] = seededBookings()) {
    this.#bookings = [...seed];
    const highest = Math.max(
      FIRST_FREE_BOOKING - 1,
      ...seed.map((b) => Number(b.reference.slice(-4))),
    );
    this.#nextSequence = highest + 1;
  }

  async overlapping(window: TimeWindow): Promise<readonly StoredBooking[]> {
    return this.#bookings
      .filter((b) => b.start < window.end && b.end > window.start)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async add(booking: Omit<StoredBooking, 'reference'>): Promise<StoredBooking> {
    const stored: StoredBooking = {
      ...booking,
      reference: formatBookingReference(this.#nextSequence),
    };
    this.#nextSequence++;
    this.#bookings.push(stored);
    return stored;
  }
}

/**
 * Three standing bookings, on the generated campus's own clock.
 *
 * Deterministic like everything else here: whoever clones the repository gets the same diary, so a
 * recorded demonstration and a fresh checkout agree about which rooms are taken.
 */
function seededBookings(): StoredBooking[] {
  return [
    {
      reference: formatBookingReference(1),
      roomId: 'MEN-101',
      start: campusInstant('2026-09-23', '10:00'),
      end: campusInstant('2026-09-23', '11:30'),
      purpose: 'Reunión de departamento',
      bookedBy: 'doc-0007',
    },
    {
      reference: formatBookingReference(2),
      roomId: 'MEN-101',
      start: campusInstant('2026-09-23', '16:00'),
      end: campusInstant('2026-09-23', '17:00'),
      purpose: 'Tutoría de trabajos fin de grado',
      bookedBy: 'doc-0007',
    },
    {
      reference: formatBookingReference(3),
      roomId: 'FAR-201',
      start: campusInstant('2026-09-24', '09:00'),
      end: campusInstant('2026-09-24', '10:00'),
      purpose: 'Comisión de convalidaciones',
      bookedBy: 'doc-0007',
    },
  ];
}
