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
import { InMemoryIssueStore } from '../adapters/synthetic/issues.ts';
import type { Provider, RequestContext } from '../provider/index.ts';
import { registerTools } from './index.ts';

/** Tuesday 6 October 2026, 16:30 campus time — mid-peak, in the pile-up week. */
const NOW = campusInstant('2026-10-06', '16:30');

let client: Client;
let provider: Provider;
let principal: string | null;
/** How the test client answers a confirmation prompt. Set per test. */
let onConfirm: () => { action: 'accept'; content: { confirm: boolean } } | { action: 'decline' };

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
  // The client must declare `elicitation`: on a 2025-era connection an input_required
  // result is delivered as an `elicitation/create` request, and a client that cannot
  // receive one gets an error instead of a confirmation prompt.
  client = new Client(
    { name: 'test-client', version: '0.0.0' },
    { capabilities: { elicitation: {} } },
  );
  client.setRequestHandler('elicitation/create', async () => onConfirm());
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
  onConfirm = () => ({ action: 'decline' });
  await connect();
});

afterEach(async () => {
  await client.close();
});

describe('the catalogue is derived from capabilities', () => {
  it('publishes all six tools for San Telmo, which can answer everything', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      'campus.deadlines',
      'campus.find_room',
      'campus.issue_status',
      'campus.report_issue',
      'campus.timetable',
      'campus.wayfind',
    ]);
  });

  it('publishes nothing about faults for an institution with no issue tracker', async () => {
    // The point of ADR-004: the agent never offers what the institution cannot do.
    const limited = createSyntheticProvider();
    const narrowed: Provider = {
      ...limited,
      descriptor: { ...limited.descriptor, capabilities: ['rooms', 'deadlines'] },
      findFreeRooms: limited.findFreeRooms.bind(limited),
      getRoom: limited.getRoom.bind(limited),
      deadlines: limited.deadlines.bind(limited),
    };
    await client.close();
    await connect(narrowed);

    const names = (await client.listTools()).tools.map((t) => t.name);

    expect(names.sort()).toEqual(['campus.deadlines', 'campus.find_room']);
    expect(names).not.toContain('campus.report_issue');
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

  it('files nothing when the confirmation is declined', async () => {
    onConfirm = () => ({ action: 'decline' });

    await call('campus.report_issue', { room: 'MEN-203', equipment: 'proyector' });

    // UC-05: no ticket exists without confirmation. doc-0007 already has the seeded
    // INC-2026-0031, so the check is that no NEW one appeared.
    expect(await call('campus.issue_status')).not.toContain('INC-2026-0032');
  });

  it('files nothing when the box is left unchecked', async () => {
    onConfirm = () => ({ action: 'accept', content: { confirm: false } });

    await call('campus.report_issue', { room: 'MEN-203', equipment: 'proyector' });

    expect(await call('campus.issue_status')).not.toContain('INC-2026-0032');
  });

  it('files the fault once confirmed, and speaks the reference back', async () => {
    onConfirm = () => ({ action: 'accept', content: { confirm: true } });

    const answer = await call('campus.report_issue', { room: 'MEN-203', equipment: 'proyector' });

    expect(answer).toMatch(/Hecho\. La referencia es INC-2026-0032/);
    expect(answer).toContain('proyector');
    expect(answer).toContain('MEN-203');
    // And it is now chaseable by the person who filed it (UC-06).
    expect(await call('campus.issue_status')).toContain('INC-2026-0032');
  });

  it('asks about the room the person actually named', async () => {
    let asked = '';
    onConfirm = () => ({ action: 'decline' });
    client.setRequestHandler('elicitation/create', async (request) => {
      asked = (request.params as { message?: string }).message ?? '';
      return { action: 'decline' as const };
    });

    await call('campus.report_issue', { room: 'FAR-104', equipment: 'pantalla táctil' });

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

  it('refuses an unauthenticated reporter, even after they confirm', async () => {
    principal = null;
    onConfirm = () => ({ action: 'accept', content: { confirm: true } });

    expect(await call('campus.report_issue', { room: 'MEN-203', equipment: 'proyector' })).toMatch(
      /tienes que identificarte/,
    );
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
