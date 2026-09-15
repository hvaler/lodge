/**
 * Cards, through a real MCP client.
 *
 * The behaviour worth protecting is not how they look — it is that they are *optional*. A client
 * with no screen must get exactly the same spoken answer, and nothing in that answer may depend on
 * a card the listener cannot see.
 */

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { campusInstant } from '../adapters/synthetic/campus.ts';
import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import { InMemoryIssueStore } from '../adapters/synthetic/issues.ts';
import type { Provider, RequestContext } from '../provider/index.ts';
import { registerTools } from '../tools/index.ts';
import { CARD_MIME } from './index.ts';

/** Tuesday 6 October 2026, 16:30 campus time — mid-peak, so the grid has both states in it. */
const NOW = campusInstant('2026-10-06', '16:30');

let client: Client;
let principal: string | null;
let onConfirm: () => { action: 'accept'; content: { confirm: boolean } } | { action: 'decline' };

/** `withScreen` decides whether the client declares the MCP Apps UI extension. */
async function connect(withScreen: boolean): Promise<void> {
  const provider: Provider = createSyntheticProvider(new InMemoryIssueStore());
  const server = new McpServer({ name: 'cards-test', version: '0.0.0' }, { capabilities: { tools: {} } });

  const resolveContext = (): RequestContext => ({
    principal: principal ? { subject: principal } : null,
    now: NOW,
    locale: provider.descriptor.locale,
  });

  registerTools(server, provider, resolveContext);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client(
    { name: withScreen ? 'tablet' : 'speaker', version: '0.0.0' },
    {
      capabilities: {
        elicitation: {},
        ...(withScreen
          ? { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [CARD_MIME] } } }
          : {}),
      },
    },
  );
  client.setRequestHandler('elicitation/create', async () => onConfirm());
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
}

interface Block {
  type: string;
  text?: string;
  resource?: { uri: string; mimeType: string; text: string };
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<Block[]> {
  const result = await client.callTool({ name, arguments: args });
  return (result.content ?? []) as Block[];
}

const spoken = (blocks: Block[]): string =>
  blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
const card = (blocks: Block[]): Block['resource'] =>
  blocks.find((b) => b.type === 'resource')?.resource;

beforeEach(() => {
  principal = null;
  onConfirm = () => ({ action: 'accept', content: { confirm: true } });
});

afterEach(async () => {
  await client.close();
});

describe('a card is an improvement, never the answer', () => {
  it('sends no card to a client that never said it had a screen', async () => {
    await connect(false);
    const blocks = await call('campus.find_room', { building: 'MEN' });

    expect(card(blocks)).toBeUndefined();
    expect(spoken(blocks)).toMatch(/Libres hasta las|No hay nada libre/);
  });

  it('gives the speaker and the tablet the identical spoken answer', async () => {
    // This is the guarantee. If the card ever changes what is said, the corridor kiosk and the
    // phone held to an ear stop agreeing, and the surface with no screen is the one that loses.
    await connect(false);
    const withoutScreen = spoken(await call('campus.find_room', { building: 'MEN' }));
    await client.close();

    await connect(true);
    const withScreen = spoken(await call('campus.find_room', { building: 'MEN' }));

    expect(withScreen).toBe(withoutScreen);
  });

  it('never mentions the card in what it says aloud', async () => {
    await connect(true);
    const blocks = await call('campus.wayfind', { from: 'MEN', to: 'FAR-104' });

    expect(card(blocks)).toBeDefined();
    for (const giveaway of ['card://', 'plano', 'pantalla', 'tarjeta', 'see the']) {
      expect(spoken(blocks).toLowerCase()).not.toContain(giveaway.toLowerCase());
    }
  });
});

describe('the occupancy grid', () => {
  it('shows the rooms that were not offered, which is the point of a grid', async () => {
    await connect(true);
    const blocks = await call('campus.find_room', { building: 'MEN' });
    const html = card(blocks)!.text;

    // MEN-101 is teaching at the peak, so it is in the grid but not in the spoken shortlist.
    expect(html).toContain('MEN-101');
    expect(spoken(blocks)).not.toContain('MEN-101');
  });

  it('marks free and busy differently', async () => {
    await connect(true);
    const html = card(await call('campus.find_room', { building: 'MEN' }))!.text;

    expect(html).toMatch(/class="room free"/);
    expect(html).toMatch(/class="room"/);
  });

  it('is labelled in the institution’s language', async () => {
    await connect(true);
    const html = card(await call('campus.find_room', { building: 'MEN' }))!.text;

    expect(html).toContain('Aulas de MEN');
    expect(html).toContain('libres de');
    expect(html).toContain('lang="es-ES"');
  });

  it('carries the MCP Apps mime type and a stable uri', async () => {
    await connect(true);
    const resource = card(await call('campus.find_room', { building: 'MEN' }))!;

    expect(resource.mimeType).toBe(CARD_MIME);
    expect(resource.uri).toBe('card://rooms/MEN');
  });
});

describe('the floor plan', () => {
  it('marks the destination among the rooms on its floor', async () => {
    await connect(true);
    const html = card(await call('campus.wayfind', { to: 'MEN-203' }))!.text;

    expect(html).toContain('class="room here"');
    expect(html).toContain('MEN-203');
    // Its neighbours on floor 2 are there for context; floor 1 is not.
    expect(html).toContain('MEN-201');
    expect(html).not.toContain('MEN-101');
  });

  it('says which floor, in words', async () => {
    await connect(true);

    expect(card(await call('campus.wayfind', { to: 'MEN-203' }))!.text).toContain('MEN, planta 2');
    expect(card(await call('campus.wayfind', { to: 'MEN-001' }))!.text).toContain('MEN, planta baja');
  });

  it('sends none for a building-only destination, since there is no floor to draw', async () => {
    await connect(true);
    const blocks = await call('campus.wayfind', { to: 'FAR' });

    expect(spoken(blocks)).toContain('El Faro');
    expect(card(blocks)).toBeUndefined();
  });
});

describe('the fault card', () => {
  it('shows the reference, and says it aloud as well', async () => {
    // A reference that only exists on a screen is useless to someone holding a phone to their ear.
    await connect(true);
    principal = 'doc-0007';
    const blocks = await call('campus.report_issue', { room: 'MEN-203', equipment: 'proyector' });

    expect(spoken(blocks)).toContain('INC-2026-0032');
    expect(card(blocks)!.text).toContain('INC-2026-0032');
    expect(card(blocks)!.uri).toBe('card://issue/INC-2026-0032');
  });

  it('labels its fields in Spanish and keeps the institution’s own words', async () => {
    await connect(true);
    principal = 'doc-0007';
    const html = card(await call('campus.report_issue', { room: 'MEN-203', equipment: 'proyector' }))!.text;

    // The number is the heading, not a labelled row: that is what reads from a lectern.
    expect(html).toContain('<h1>INC-2026-0032</h1>');
    expect(html).toContain('Estado');
    expect(html).toContain('abierto');
    expect(html).toContain('proyector');
  });

  it('sends nothing when the fault was never filed', async () => {
    await connect(true);
    principal = 'doc-0007';
    onConfirm = () => ({ action: 'decline' });

    expect(card(await call('campus.report_issue', { room: 'MEN-203', equipment: 'proyector' }))).toBeUndefined();
  });
});

describe('every card stands alone', () => {
  it('pulls in nothing from the network', async () => {
    // These render on a kiosk in a corridor. A card that fetches a font is a card that is blank
    // when the venue's wifi is captive.
    await connect(true);
    principal = 'doc-0007';

    const cards = [
      card(await call('campus.find_room', {}))!.text,
      card(await call('campus.wayfind', { to: 'MEN-203' }))!.text,
      card(await call('campus.report_issue', { room: 'MEN-203', equipment: 'proyector' }))!.text,
    ];

    for (const html of cards) {
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toMatch(/<img|<iframe|@import|url\(/i);
    }
  });

  it('adapts to the reader’s theme rather than assuming daylight', async () => {
    await connect(true);
    const html = card(await call('campus.find_room', {}))!.text;

    expect(html).toContain('color-scheme: light dark');
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it('escapes whatever the institution put in its files', async () => {
    await connect(true);
    const html = card(await call('campus.find_room', {}))!.text;

    // Nothing in San Telmo contains markup, but the escaping is what makes that not matter.
    expect(html).not.toMatch(/<div class="id">[^<]*<[^/]/);
  });
});
