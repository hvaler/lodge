/**
 * The six tools, exercised through a real MCP client over an in-memory transport.
 *
 * Deliberately not unit tests on the handlers: M1's output is "answers a generic MCP client", so
 * the tests go through the same listTools / callTool path any client would. That is what catches a
 * tool that is registered but not published, or a result shape the protocol rejects.
 */

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import { campusInstant } from '../adapters/synthetic/campus.ts';
import { InMemoryBookingStore } from '../adapters/synthetic/bookings.ts';
import { InMemoryIssueStore } from '../adapters/synthetic/issues.ts';
import type { Provider, RequestContext } from '../provider/index.ts';
import { registerTools } from './index.ts';

/** Tuesday 6 October 2026, 16:30 campus time — mid-peak, in the pile-up week. */
const NOW = campusInstant('2026-10-06', '16:30');

let client: Client;
let provider: Provider;
let principal: string | null;

async function connect(p: Provider = createSyntheticProvider(new InMemoryIssueStore())): Promise<void> {
  provider = p;
  const server = new McpServer({ name: 'lodge-test', version: '0.0.0' }, { capabilities: { tools: {} } });

  const resolveContext = (): RequestContext => ({
    principal: principal ? { subject: principal } : null,
    now: NOW,
    locale: p.descriptor.locale,
  });

  registerTools(server, p, resolveContext);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  // No `elicitation`, deliberately. Confirmation is an argument and a second call (ADR-011), so
  // a client with no server-to-client channel at all must still be able to complete UC-05 —
  // which is the shape every Streamable HTTP client has.
  client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
}

/** The spoken answer, which is the part that has to stand on its own. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const blocks = (result.content ?? []) as { type: string; text?: string }[];
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ');
}

beforeEach(async () => {
  principal = null;
  await connect();
});

afterEach(async () => {
  await client.close();
});

describe('the catalogue is derived from capabilities', () => {
  it('publishes all eight tools for San Telmo, which can answer everything', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      'campus.book_room',
      'campus.deadlines',
      'campus.find_room',
      'campus.issue_status',
      'campus.report_issue',
      'campus.room_schedule',
      'campus.timetable',
      'campus.wayfind',
    ]);
  });

  it('publishes nothing about faults for an institution with no issue tracker', async () => {
    // The point of ADR-004: the agent never offers what the institution cannot do.
    const limited = createSyntheticProvider();
    const narrowed: Provider = {
      ...limited,
      descriptor: {
        ...limited.descriptor,
        capabilities: ['room-inventory', 'room-availability', 'deadlines'],
      },
      findFreeRooms: limited.findFreeRooms.bind(limited),
      roomSchedule: limited.roomSchedule.bind(limited),
      getRoom: limited.getRoom.bind(limited),
      deadlines: limited.deadlines.bind(limited),
    };
    await client.close();
    await connect(narrowed);

    const names = (await client.listTools()).tools.map((t) => t.name);

    expect(names.sort()).toEqual([
      'campus.deadlines',
      'campus.find_room',
      'campus.room_schedule',
    ]);
    expect(names).not.toContain('campus.report_issue');
    // And nothing about booking: it can say a room is free and has nowhere to write that it is
    // taken, which is the whole difference between reading a calendar and owning one.
    expect(names).not.toContain('campus.book_room');
  });

  it('describes the timetable tool without any parameter for whose it is', async () => {
    const { tools } = await client.listTools();
    const timetable = tools.find((t) => t.name === 'campus.timetable');
    const properties = Object.keys((timetable?.inputSchema as { properties?: object }).properties ?? {});

    // A model cannot ask for someone else's timetable if there is nowhere to put the name.
    expect(properties).toEqual(['when']);
  });
});

describe('campus.find_room', () => {
  it('offers a shortlist, not a catalogue, because it is being read aloud', async () => {
    const answer = await call('campus.find_room');

    // San Telmo answers in Spanish, which is what it declares.
    expect(answer).toMatch(/Libres de aquí a las/);
    expect(answer.match(/\d+ plazas/g)?.length).toBeLessThanOrEqual(3);
  });

  it('never offers a room that is teaching at the peak', async () => {
    const answer = await call('campus.find_room', { building: 'MEN' });

    for (const busy of ['MEN-101', 'MEN-201', 'MEN-206']) {
      expect(answer).not.toContain(busy);
    }
  });

  it('says so plainly when nothing is free', async () => {
    // Santa Clara's rooms are all labs or occupied lecture halls; supervised ones never count.
    const answer = await call('campus.find_room', { building: 'SCL', minCapacity: 500 });

    expect(answer).toMatch(/No hay nada libre en SCL/);
  });

  it('respects how long the room is needed for', async () => {
    const answer = await call('campus.find_room', { forMinutes: 90 });

    expect(answer).toContain('18:00');
  });
});

describe('campus.timetable', () => {
  it('refuses an unauthenticated caller instead of guessing', async () => {
    expect(await call('campus.timetable')).toMatch(/tienes que identificarte/);
  });

  it('gives two identities two different answers', async () => {
    principal = 'est-0001';
    const one = await call('campus.timetable');
    principal = 'est-0002';
    const other = await call('campus.timetable');

    expect(one).not.toBe(other);
    expect(one).toMatch(/DER-/);
    expect(other).toMatch(/INF-/);
  });

  it('answers for tomorrow when asked', async () => {
    principal = 'est-0001';
    const answer = await call('campus.timetable', { when: 'tomorrow' });

    expect(answer.toLowerCase()).toContain('7');
  });
});

describe('campus.deadlines', () => {
  it('gives the date and how long is left', async () => {
    const answer = await call('campus.deadlines', { topic: 'credit-transfer' });

    // Tuesday to Friday is three days to a person, not the 3.3 elapsed days rounded up.
    expect(answer).toMatch(/Solicitud de convalidaciones —/);
    // "quedan 3 días": in Spanish the verb agrees with the number, which is why messages are
    // functions rather than templates with holes.
    expect(answer).toMatch(/quedan 3 días/);
  });

  it('says "closes today" rather than "0 days left" on the last day', async () => {
    // The most urgent case deserves the clearest phrasing.
    const answer = await call('campus.deadlines', { topic: 'credit-transfer' });
    expect(answer).not.toMatch(/quedan 0|queda 0/);
  });

  it('says a deadline is not on record rather than offering the nearest one', async () => {
    const answer = await call('campus.deadlines', { topic: 'parking permit' });

    expect(answer).toMatch(/No me consta nada sobre parking permit/);
    // Crucially, it names no date at all.
    expect(answer).not.toMatch(/\d{1,2} (January|October|November)/);
  });

  it('reports a deadline that has already passed as closed, not as upcoming', async () => {
    // San Telmo's own label, in its own language: enrolment closed in July.
    const answer = await call('campus.deadlines', { topic: 'Matrícula ordinaria' });

    expect(answer).toMatch(/— cerrado,/);
  });
});

describe('campus.wayfind', () => {
  it('gives directions that work without a screen', async () => {
    const answer = await call('campus.wayfind', { to: 'FAR-104', from: 'MEN' });

    expect(answer).toContain('paseo marítimo');
    expect(answer).toContain('El Faro');
    expect(answer).toContain('planta 1');
  });

  it('does not read the floor-plan reference out loud', async () => {
    const answer = await call('campus.wayfind', { to: 'MEN-203' });

    expect(answer).not.toContain('floor-2');
  });

  it('admits it does not know a place rather than inventing a route', async () => {
    expect(await call('campus.wayfind', { to: 'ZZZ-999' })).toMatch(/No conozco ningún sitio/);
  });
});

describe('campus.report_issue', () => {
  beforeEach(() => {
    principal = 'doc-0007';
  });

  it('asks before filing, and files nothing while it is asking', async () => {
    const answer = await call('campus.report_issue', { room: 'MEN-203', equipment: 'proyector' });

    expect(answer).toBe('¿Abro un aviso por proyector en MEN-203?');
    // UC-05: no ticket exists without confirmation. doc-0007 already has the seeded
    // INC-2026-0031, so the check is that no NEW one appeared.
    expect(await call('campus.issue_status')).not.toContain('INC-2026-0032');
  });

  it('files nothing when the answer was no', async () => {
    // A declined confirmation is the caller simply not making the second call. Nothing to
    // roll back, nothing parked server-side waiting to time out.
    await call('campus.report_issue', { room: 'MEN-203', equipment: 'proyector', confirmed: false });

    expect(await call('campus.issue_status')).not.toContain('INC-2026-0032');
  });

  it('files the fault once confirmed, and speaks the reference back', async () => {
    const answer = await call('campus.report_issue', {
      room: 'MEN-203',
      equipment: 'proyector',
      confirmed: true,
    });

    expect(answer).toMatch(/Hecho\. La referencia es INC-2026-0032/);
    expect(answer).toContain('proyector');
    expect(answer).toContain('MEN-203');
    // And it is now chaseable by the person who filed it (UC-06).
    expect(await call('campus.issue_status')).toContain('INC-2026-0032');
  });

  it('asks about the room the person actually named', async () => {
    const asked = await call('campus.report_issue', {
      room: 'FAR-104',
      equipment: 'pantalla táctil',
    });

    expect(asked).toBe('¿Abro un aviso por pantalla táctil en FAR-104?');
  });

  it('checks the room and the equipment before asking, not after', async () => {
    // Confirming and only then learning the room has no projector wastes the person's turn.
    const answer = await call('campus.report_issue', { room: 'MEN-301', equipment: 'proyector' });

    expect(answer).toMatch(/MEN-301 no tiene proyector/);
    // The equipment names are the institution's own words and stay untranslated.
    expect(answer).toMatch(/pizarra/);
  });

  it('says so when the room does not exist', async () => {
    expect(await call('campus.report_issue', { room: 'MEN-999', equipment: 'proyector' })).toMatch(
      /No tengo ningún aula llamada MEN-999/,
    );
  });

  it('refuses an unauthenticated reporter, even with the confirmation set', async () => {
    principal = null;

    expect(
      await call('campus.report_issue', {
        room: 'MEN-203',
        equipment: 'proyector',
        confirmed: true,
      }),
    ).toMatch(/tienes que identificarte/);
  });

  it('says you are not signed in before asking, not after you have answered', async () => {
    principal = null;

    // The first call is the one a person hears. Being asked to confirm and only then told you
    // were never signed in costs a turn and makes the confirmation look like theatre.
    expect(
      await call('campus.report_issue', { room: 'MEN-203', equipment: 'proyector' }),
    ).toMatch(/tienes que identificarte/);
  });
});

describe('campus.issue_status', () => {
  it('returns only what the caller filed', async () => {
    principal = 'doc-0011';
    const theirs = await call('campus.issue_status');

    expect(theirs).toContain('INC-2026-0028');
    expect(theirs).toContain('INC-2026-0019');
    expect(theirs).not.toContain('INC-2026-0031');
  });

  it('reads statuses aloud without the hyphen', async () => {
    principal = 'doc-0011';

    expect(await call('campus.issue_status')).toContain('en curso');
  });

  it('says nothing is outstanding for someone who never reported anything', async () => {
    principal = 'est-0001';

    expect(await call('campus.issue_status')).toMatch(/No has dado ningún aviso/);
  });

  it('refuses an unauthenticated caller', async () => {
    expect(await call('campus.issue_status')).toMatch(/tienes que identificarte/);
  });
});

describe('campus.room_schedule', () => {
  it('says a named room is taken, by what, and when the gap after it closes', async () => {
    // MEN-101 has INF-101 at 16:00 and again at 17:00: taken now, then a ten-minute gap.
    expect(await call('campus.room_schedule', { room: 'MEN-101' })).toBe(
      'MEN-101 está ocupada hasta las 16:50, con INF-101. Después queda libre hasta las 17:00.',
    );
  });

  it('says a free room is free, and until when', async () => {
    const answer = await call('campus.room_schedule', { room: 'FAR-101' });

    expect(answer).toMatch(/^FAR-101 está libre (todo el día|hasta las \d{2}:\d{2})\.$/);
  });

  it('counts a booking as taken, and names its purpose', async () => {
    await connect(
      createSyntheticProvider(
        new InMemoryIssueStore(),
        new InMemoryBookingStore([
          {
            reference: 'RES-2026-0001',
            roomId: 'FAR-101',
            start: campusInstant('2026-10-06', '16:00'),
            end: campusInstant('2026-10-06', '18:00'),
            purpose: 'Tribunal de tesis',
            bookedBy: 'doc-0007',
          },
        ]),
      ),
    );

    expect(await call('campus.room_schedule', { room: 'FAR-101' })).toMatch(
      /^FAR-101 está ocupada hasta las 18:00, con Tribunal de tesis\. /,
    );
  });

  it('says it has no such room rather than calling it free', async () => {
    const answer = await call('campus.room_schedule', { room: 'MEN-999' });

    expect(answer).toContain('MEN-999');
    expect(answer).not.toContain('libre');
  });
});

describe('campus.book_room', () => {
  beforeEach(async () => {
    principal = 'doc-0007';
    // An empty diary, so every "taken" below comes from the timetable or from this test.
    await connect(createSyntheticProvider(new InMemoryIssueStore(), new InMemoryBookingStore([])));
  });

  it('asks before holding, and holds nothing while it is asking', async () => {
    const answer = await call('campus.book_room', { room: 'FAR-101', at: '17:00' });

    expect(answer).toBe('¿Reservo FAR-101 a las 17:00 durante 60 minutos?');
    expect(await call('campus.room_schedule', { room: 'FAR-101' })).not.toContain('ocupada');
  });

  it('holds the room once confirmed, and speaks the reference back', async () => {
    const answer = await call('campus.book_room', {
      room: 'FAR-101',
      at: '17:00',
      purpose: 'Reunión de grupo',
      confirmed: true,
    });

    expect(answer).toBe('Hecho. FAR-101 es tuya a las 17:00. La referencia es RES-2026-0004.');
    expect(await call('campus.room_schedule', { room: 'FAR-101' })).toBe(
      'FAR-101 está libre hasta las 17:00.',
    );
  });

  it('takes a booked room out of the free-room answer', async () => {
    const free = async (): Promise<string[]> =>
      (
        await provider.findFreeRooms!(
          { principal: null, now: NOW, locale: 'es-ES' },
          { window: { start: NOW, end: new Date(NOW.getTime() + 3_600_000) }, building: 'FAR' },
        )
      ).map((room) => room.id);

    expect(await free()).toContain('FAR-101');
    await call('campus.book_room', { room: 'FAR-101', confirmed: true });

    expect(await free()).not.toContain('FAR-101');
  });

  it('says a taken room is taken before asking anything, and refuses it if pressed', async () => {
    expect(await call('campus.book_room', { room: 'MEN-101', at: '17:00' })).toMatch(
      /^MEN-101 está ocupada hasta las/,
    );
    expect(await call('campus.book_room', { room: 'MEN-101', at: '17:00', confirmed: true })).toContain(
      'already taken',
    );
  });

  it('refuses a building that is shut for part of it', async () => {
    // Santa Clara closes at 20:00.
    expect(
      await call('campus.book_room', { room: 'SCL-001', at: '19:30', confirmed: true }),
    ).toContain('not open');
  });

  it('refuses a supervised lab, however empty', async () => {
    expect(await call('campus.book_room', { room: 'SCL-101', confirmed: true })).toContain('supervised');
  });

  it('says there is no such room before asking', async () => {
    expect(await call('campus.book_room', { room: 'MEN-999' })).toBe('No tengo ningún aula llamada MEN-999.');
  });

  it('will not hold anything for somebody who is not signed in', async () => {
    principal = null;

    expect(await call('campus.book_room', { room: 'FAR-101', confirmed: true })).toBe(
      'Para eso tienes que identificarte.',
    );
  });
});

describe('campus.find_room across sites', () => {
  it('keeps the answer to one site when asked', async () => {
    const answer = await call('campus.find_room', { site: 'mar' });

    expect(answer).toContain('FAR-');
    expect(answer).not.toMatch(/MEN-|SCL-/);
  });
});
