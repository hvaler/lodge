/**
 * Visual cards, as MCP Apps resources.
 *
 * The rule that governs every one of them: **the card is an improvement, never the answer.** UC-04
 * says the spoken directions must get you there on their own, and most of the surface Lodge is
 * built for is a speaker with no screen at all. So a card is attached only when the client has said
 * it can show one, and removing it never costs information the listener needed.
 *
 * Each card is one self-contained HTML document: no scripts, no fonts, no images, no network. A
 * card that needs to fetch something is a card that fails on the kiosk in the corridor.
 */

import type { McpServer } from '@modelcontextprotocol/server';

import type { Room, Ticket } from '../provider/index.ts';
import type { Messages } from '../tools/messages.ts';

/** The MIME type the MCP Apps extension defines for an interactive card. */
export const CARD_MIME = 'text/html;profile=mcp-app';

const UI_EXTENSION = 'io.modelcontextprotocol/ui';

/**
 * Whether this client said it can render a card.
 *
 * Asked per call rather than assumed per deployment: the same server answers a speaker with no
 * screen and a tablet in the same corridor.
 */
export function clientShowsCards(server: McpServer): boolean {
  const capabilities = server.server.getClientCapabilities() as
    | { extensions?: Record<string, { mimeTypes?: string[] }> }
    | undefined;

  const mimeTypes = capabilities?.extensions?.[UI_EXTENSION]?.mimeTypes;
  return Array.isArray(mimeTypes) && mimeTypes.some((type) => type.startsWith('text/html'));
}

/** Wraps a rendered card as the resource content block a tool result carries. */
export function asCard(uri: string, html: string): {
  type: 'resource';
  resource: { uri: string; mimeType: string; text: string };
} {
  return { type: 'resource', resource: { uri, mimeType: CARD_MIME, text: html } };
}

/** Escapes text for HTML. Room names and equipment come from an institution's own files. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The shared shell.
 *
 * Colours come from `color-scheme` and a media query rather than a fixed palette: these render on
 * whatever the venue's device is set to, and a white card at night in a dark corridor is its own
 * kind of wrong answer.
 */
function document_(title: string, locale: string, body: string): string {
  return `<!doctype html>
<html lang="${esc(locale)}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --ink:#14181d; --dim:#5b6570; --line:#dfe4ea; --bg:#fff;
          --free:#1f7a4d; --free-bg:#e7f4ed; --busy:#8a8f96; --busy-bg:#f1f3f5; --mark:#b4530a; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#eceff3; --dim:#a3acb8; --line:#333a44; --bg:#171a1f;
            --free:#5dd39e; --free-bg:#16302a; --busy:#7b828c; --busy-bg:#22262c; --mark:#f0a868; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--ink);
         font:15px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  h1 { margin:0 0 2px; font-size:17px; font-weight:650; letter-spacing:-0.01em; }
  .sub { margin:0 0 14px; color:var(--dim); font-size:13px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(132px,1fr)); gap:8px; }
  .room { border:1px solid var(--line); border-radius:9px; padding:9px 10px; background:var(--busy-bg); }
  .room.free { background:var(--free-bg); border-color:color-mix(in srgb, var(--free) 35%, var(--line)); }
  .id { font-weight:640; font-variant-numeric:tabular-nums; }
  .room.free .id { color:var(--free); }
  .room:not(.free) .id { color:var(--busy); }
  .meta { color:var(--dim); font-size:12px; margin-top:2px; }
  .floor { margin:0 0 6px; font-size:12px; font-weight:640; color:var(--dim);
           text-transform:uppercase; letter-spacing:.06em; }
  .floor + .grid { margin-bottom:14px; }
  .here { outline:2px solid var(--mark); outline-offset:1px; }
  .here .id { color:var(--mark); }
  dl { display:grid; grid-template-columns:auto 1fr; gap:5px 14px; margin:0; }
  dt { color:var(--dim); font-size:13px; }
  dd { margin:0; font-weight:560; }
  .tag { display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; font-weight:620;
         background:var(--busy-bg); color:var(--dim); border:1px solid var(--line); }
  .tag.open { background:var(--free-bg); color:var(--free);
              border-color:color-mix(in srgb, var(--free) 35%, var(--line)); }
  .note { margin:14px 0 0; padding-top:10px; border-top:1px solid var(--line);
          color:var(--dim); font-size:12px; }
</style>
${body}
</html>`;
}

// ── occupancy grid ───────────────────────────────────────────────────────────

/**
 * Every room, marked free or busy. The point of a grid over a list: the spoken answer names two or
 * three, and this shows what else there is and why it was not offered.
 */
export function occupancyCard(
  rooms: readonly Room[],
  freeIds: ReadonlySet<string>,
  m: Messages,
  locale: string,
  options: { title: string; subtitle: string },
): string {
  const byBuilding = new Map<string, Room[]>();
  for (const room of rooms) {
    const list = byBuilding.get(room.building) ?? [];
    list.push(room);
    byBuilding.set(room.building, list);
  }

  const sections = [...byBuilding]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([building, inBuilding]) => {
      const cells = [...inBuilding]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((room) => {
          const free = freeIds.has(room.id);
          return `<div class="room${free ? ' free' : ''}">
    <div class="id">${esc(room.id)}</div>
    <div class="meta">${esc(m.roomKind[room.kind])} · ${room.capacity}</div>
  </div>`;
        })
        .join('\n  ');

      return `<p class="floor">${esc(building)}</p>\n<div class="grid">\n  ${cells}\n</div>`;
    })
    .join('\n');

  return document_(
    options.title,
    locale,
    `<body>
<h1>${esc(options.title)}</h1>
<p class="sub">${esc(options.subtitle)}</p>
${sections}
</body>`,
  );
}

// ── floor plan ───────────────────────────────────────────────────────────────

/** The floor the destination is on, with it marked. Not a map: a layout you can scan. */
export function floorPlanCard(
  rooms: readonly Room[],
  destination: Room,
  m: Messages,
  locale: string,
  options: { title: string; subtitle: string },
): string {
  const onFloor = rooms
    .filter((room) => room.building === destination.building && room.floor === destination.floor)
    .sort((a, b) => a.id.localeCompare(b.id));

  const cells = onFloor
    .map(
      (room) => `<div class="room${room.id === destination.id ? ' here' : ''}">
    <div class="id">${esc(room.id)}</div>
    <div class="meta">${esc(m.roomKind[room.kind])} · ${room.capacity}</div>
  </div>`,
    )
    .join('\n  ');

  return document_(
    options.title,
    locale,
    `<body>
<h1>${esc(options.title)}</h1>
<p class="sub">${esc(options.subtitle)}</p>
<div class="grid">
  ${cells}
</div>
</body>`,
  );
}

// ── issue card ───────────────────────────────────────────────────────────────

/** One fault, with its reference large enough to read from a lectern. */
export function issueCard(
  ticket: Ticket,
  m: Messages,
  locale: string,
  timeZone: string,
  // No `reference` label: the number is the heading, which is what you read off a lectern from
  // three metres away. A row saying "Reference: INC-..." under a heading that already says it
  // is furniture.
  labels: { title: string; room: string; equipment: string; status: string; reported: string },
): string {
  const when = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ticket.openedAt);

  return document_(
    labels.title,
    locale,
    `<body>
<h1>${esc(ticket.number)}</h1>
<p class="sub">${esc(labels.title)}</p>
<dl>
  <dt>${esc(labels.room)}</dt><dd>${esc(ticket.roomId)}</dd>
  <dt>${esc(labels.equipment)}</dt><dd>${esc(ticket.equipment)}</dd>
  <dt>${esc(labels.status)}</dt>
  <dd><span class="tag${ticket.status === 'open' ? ' open' : ''}">${esc(m.issueStatus[ticket.status])}</span></dd>
  <dt>${esc(labels.reported)}</dt><dd>${esc(when)}</dd>
</dl>
</body>`,
  );
}
