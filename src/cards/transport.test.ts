/**
 * Cards over the transport Lodge actually deploys on.
 *
 * This file exists because of a bug the rest of the suite could not see. Every card test used an
 * in-memory transport, which is one long-lived server with a remembered `initialize`. Streamable
 * HTTP is not: the handler builds a fresh server per request, `getClientCapabilities()` is `null`
 * at tool-call time, and the old "attach only if the client declared a screen" rule therefore
 * attached nothing. Cards passed every test and rendered in no container.
 *
 * So the point here is not the card. It is the transport: a test that goes over a real socket,
 * through `createLodgeHandler`, the way a deployment does.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSyntheticProvider } from '../adapters/synthetic/index.ts';
import { campusInstant } from '../adapters/synthetic/campus.ts';
import { createLodgeHandler } from '../server/index.ts';
import { CARD_MIME } from './index.ts';

/** The same instant the other card tests pin, so the answers are comparable. */
const NOW = campusInstant('2026-10-06', '16:30');

interface Block {
  type: string;
  text?: string;
  resource?: { uri: string; mimeType: string; text: string };
}

let server: Server;
let url: URL;

beforeAll(async () => {
  const handler = createLodgeHandler(createSyntheticProvider(), { clock: () => NOW });
  server = createServer(toNodeHandler(handler));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  url = new URL(`http://127.0.0.1:${address.port}/`);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function blocksOf(tool: string, args: Record<string, unknown> = {}): Promise<Block[]> {
  const client = new Client({ name: 'tablet', version: '0.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(url));
  try {
    const result = await client.callTool({ name: tool, arguments: args });
    return (result.content ?? []) as Block[];
  } finally {
    await client.close();
  }
}

describe('over Streamable HTTP, as deployed', () => {
  it('attaches the card to a room search', async () => {
    const blocks = await blocksOf('campus.find_room', { building: 'MEN' });
    const cards = blocks.filter((b) => b.type === 'resource');

    expect(cards).toHaveLength(1);
    expect(cards[0]?.resource?.mimeType).toBe(CARD_MIME);
    expect(cards[0]?.resource?.uri).toBe('card://rooms/MEN');
  });

  it('still says the whole answer out loud, card or no card', async () => {
    // The invariant the inversion had to preserve: the card adds, it never carries.
    const blocks = await blocksOf('campus.find_room', { building: 'MEN' });
    const spoken = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ');

    expect(spoken).toMatch(/Libres de aquí a las/);
    expect(spoken).toContain('MEN-');
  });

  it('sends a card that needs nothing from the network', async () => {
    // A card that fetches something is a card that fails on the kiosk in the corridor — and this
    // is the transport where that would actually be attempted.
    const blocks = await blocksOf('campus.wayfind', { to: 'FAR-104', from: 'MEN' });
    const html = blocks.find((b) => b.type === 'resource')?.resource?.text ?? '';

    expect(html).not.toBe('');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
