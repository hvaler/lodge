/**
 * The demonstration page.
 *
 * Shipped as a string rather than a file under `public/` so that `node src/web/main.ts` and
 * `node dist/web/main.js` serve exactly the same bytes with no copy step in the build and nothing
 * to forget in the Dockerfile. The cards already take this shape, for the same reason.
 *
 * No framework, no CDN, no web fonts. Partly consistency — a card that needs the network is a card
 * that fails on the kiosk in the corridor, and the same goes for the page around it — and partly
 * that a judge should be able to open this on a train.
 *
 * What it is trying to show, in order of how much it matters:
 *
 *  1. That the answer is spoken. This is the Alexa+ track; the screen is the improvement.
 *  2. That the tools come from the live server. Switch institution and the catalogue changes,
 *     because it was read from `tools/list` and not from anything in this file.
 *  3. That two identities get two different answers, and that neither can ask for the other's.
 *  4. That nothing is filed without a yes.
 */

const STYLE = `
:root {
  color-scheme: dark;
  --ink: #e8e6e1;
  --dim: #9a978f;
  --bg: #16171a;
  --panel: #1e2024;
  --line: #2e3138;
  --accent: #f0b429;
  --good: #7bb26a;
  --bad: #d4736b;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
header {
  padding: 18px 24px;
  border-bottom: 1px solid var(--line);
  display: flex;
  gap: 16px;
  align-items: baseline;
  flex-wrap: wrap;
}
header h1 { font-size: 19px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
header p { margin: 0; color: var(--dim); font-size: 14px; }
main {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 24px;
  padding: 24px;
  max-width: 1180px;
  margin: 0 auto;
}
@media (max-width: 860px) { main { grid-template-columns: 1fr; } }

aside { display: flex; flex-direction: column; gap: 20px; }
.block h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--dim);
  margin: 0 0 8px;
  font-weight: 600;
}
.choices { display: flex; flex-direction: column; gap: 4px; }
.choices button {
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  color: var(--ink);
  padding: 8px 10px;
  border-radius: 7px;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
}
.choices button:hover { background: var(--panel); }
.choices button[aria-pressed="true"] {
  background: var(--panel);
  border-color: var(--line);
  box-shadow: inset 3px 0 0 var(--accent);
}
.choices small { display: block; color: var(--dim); font-size: 12px; }

#catalogue { display: flex; flex-direction: column; gap: 3px; }
#catalogue code {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--dim);
  padding: 3px 0;
}
#catalogue code b { color: var(--ink); font-weight: 500; }
#catalogue .absent { color: #5d5f66; text-decoration: line-through; }

.ask { display: flex; gap: 8px; }
.ask input {
  flex: 1;
  min-width: 0;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--ink);
  font: inherit;
  padding: 13px 15px;
}
.ask input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.ask button {
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink);
  border-radius: 9px;
  padding: 0 16px;
  font: inherit;
  cursor: pointer;
}
.ask button:hover:not(:disabled) { border-color: var(--accent); }
.ask button:disabled { opacity: 0.45; cursor: default; }
#mic[aria-pressed="true"] { border-color: var(--bad); color: var(--bad); }

.suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.suggestions button {
  background: transparent;
  border: 1px dashed var(--line);
  color: var(--dim);
  border-radius: 20px;
  padding: 5px 13px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.suggestions button:hover { color: var(--ink); border-color: var(--dim); }

#talk { margin: 24px 0 0; display: flex; flex-direction: column; gap: 14px; }
.turn { max-width: 46em; }
.turn.you { color: var(--dim); font-size: 16px; }
.turn.you::before { content: "— "; }
.turn.lodge {
  font-size: 25px;
  line-height: 1.38;
  letter-spacing: -0.012em;
}
.turn.lodge.thinking { color: var(--dim); font-size: 16px; }
#reset {
  background: none;
  border: 0;
  color: var(--dim);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  align-self: flex-start;
}
#reset:hover { color: var(--ink); }

.meta {
  margin-top: 20px;
  color: var(--dim);
  font-size: 13px;
  font-family: var(--mono);
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}

#trace { margin-top: 26px; display: flex; flex-direction: column; gap: 8px; }
.call {
  border: 1px solid var(--line);
  border-left: 3px solid var(--good);
  border-radius: 8px;
  padding: 10px 14px;
  background: var(--panel);
  font-family: var(--mono);
  font-size: 13px;
  overflow-x: auto;
}
.call.failed { border-left-color: var(--bad); }
.call .name { color: var(--accent); }
.call .ms { float: right; color: var(--dim); }
.call .out { color: var(--dim); display: block; margin-top: 5px; white-space: pre-wrap; }

#cards { margin-top: 26px; display: flex; flex-direction: column; gap: 14px; }
#cards iframe {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  height: 300px;
}
footer {
  padding: 22px 24px 40px;
  color: var(--dim);
  font-size: 13px;
  max-width: 1180px;
  margin: 0 auto;
}
footer code { font-family: var(--mono); }
`;

const SCRIPT = String.raw`
const el = (id) => document.getElementById(id);
let catalogues = [];
let current = null;
let subject = '';
let token = '';
let quien = '';
let speak = true;
// Sent back with each question so the agent can act on what it just asked. Trimmed because a
// conversation that grows without bound eventually pays for itself in latency.
let history = [];
const MEMORIA = 8;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// ── Which institution, and who ──────────────────────────────────────────────
function drawInstitutions() {
  const box = el('institutions');
  box.innerHTML = '';
  for (const c of catalogues) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(c.slug === current.slug));
    b.innerHTML = esc(c.name) + '<small>' + esc(c.locale) + ' · ' + c.tools.length + ' tools</small>';
    b.onclick = () => { choose(c.slug); };
    box.appendChild(b);
  }
}

function drawIdentities() {
  const box = el('identities');
  box.innerHTML = '';

  // Without a sign-in endpoint the demonstration is running with --dev-identity, and identity is
  // picked outright. That is the escape hatch, not the demonstration.
  if (!current.signIn) {
    const options = [{ subject: '', label: 'Not identified' }].concat(current.identities);
    for (const id of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(id.subject === subject));
      b.innerHTML = esc(id.label) + (id.subject ? '<small>' + esc(id.subject) + '</small>' : '');
      b.onclick = () => { subject = id.subject; drawIdentities(); };
      box.appendChild(b);
    }
    return;
  }

  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-pressed', String(!!token));
  b.innerHTML = token
    ? esc(quien) + '<small>sesión iniciada · cerrar</small>'
    : 'Iniciar sesión<small>sin sesión: el servidor responde 401</small>';
  b.onclick = () => { token ? signOut() : startSignIn(); };
  box.appendChild(b);
}

// ── El inicio de sesión, que es OAuth 2.1 de verdad ──────────────────────────
function random(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function startSignIn() {
  const verifier = random(32);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  // The verifier has to survive a full page load, because the provider sends the browser back here.
  sessionStorage.setItem('lodge.pkce', JSON.stringify({ verifier, slug: current.slug }));

  const u = new URL(current.signIn.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', 'lodge-demo');
  u.searchParams.set('redirect_uri', location.origin + location.pathname);
  u.searchParams.set('code_challenge', b64url(new Uint8Array(digest)));
  u.searchParams.set('code_challenge_method', 'S256');
  // What the token will be addressed to, and why it will not work at the other institution.
  u.searchParams.set('resource', current.signIn.resource);
  location.assign(u.toString());
}

function signOut() {
  token = '';
  quien = '';
  reset();
  drawIdentities();
}

/** Only to put a name on the button. The signature is Lodge's business, not this page's. */
function nameIn(jwt) {
  try {
    const claims = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const found = (current.identities || []).find((i) => i.subject === claims.sub);
    return found ? found.label : claims.sub;
  } catch (e) {
    return 'Sesión iniciada';
  }
}

async function finishSignIn() {
  const code = new URLSearchParams(location.search).get('code');
  const saved = sessionStorage.getItem('lodge.pkce');
  if (!code || !saved) return;

  sessionStorage.removeItem('lodge.pkce');
  window.history.replaceState(null, '', location.pathname);

  const { verifier, slug } = JSON.parse(saved);
  const where = catalogues.find((c) => c.slug === slug);
  if (!where || !where.signIn) return;

  const res = await fetch(where.signIn.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: location.origin + location.pathname,
      client_id: 'lodge-demo',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return;

  const granted = await res.json();
  choose(slug);
  token = granted.access_token;
  quien = nameIn(token);
  drawIdentities();
}

// Every tool any institution in this demo publishes, so the ones THIS one does not have are
// visible as absences. A list that simply got shorter says much less than one with gaps in it.
function drawCatalogue() {
  const every = [];
  for (const c of catalogues) for (const t of c.tools) if (!every.includes(t.name)) every.push(t.name);
  const mine = current.tools.map((t) => t.name);
  el('catalogue').innerHTML = every
    .map((name) =>
      mine.includes(name)
        ? '<code><b>' + esc(name) + '</b></code>'
        : '<code class="absent">' + esc(name) + '</code>',
    )
    .join('');
}

function drawSuggestions() {
  const box = el('suggestions');
  box.innerHTML = '';
  for (const s of current.suggestions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s;
    b.onclick = () => { el('utterance').value = s; ask(); };
    box.appendChild(b);
  }
}

function choose(slug) {
  current = catalogues.find((c) => c.slug === slug);
  subject = '';
  // El token va dirigido a la institucion anterior (RFC 8707), asi que aqui no vale: la sesion
  // no se arrastra, se cierra.
  token = '';
  quien = '';
  // Neither the conversation nor the identity carries across: they belong to the institution you
  // were talking to, and replaying them at another one would be quoting the wrong campus back.
  reset();
  drawInstitutions();
  drawIdentities();
  drawCatalogue();
  drawSuggestions();
  el('utterance').placeholder = 'Pregunta a ' + current.name + '…';
}

// ── Asking ──────────────────────────────────────────────────────────────────
function reset() {
  history = [];
  el('talk').innerHTML = '';
  el('meta').textContent = '';
  el('trace').innerHTML = '';
  el('cards').innerHTML = '';
  el('reset').hidden = true;
  window.speechSynthesis && window.speechSynthesis.cancel();
}

function addTurn(who, text) {
  const p = document.createElement('p');
  p.className = 'turn ' + who;
  p.textContent = text;
  el('talk').appendChild(p);
  p.scrollIntoView({ block: 'nearest' });
  return p;
}

async function ask() {
  const utterance = el('utterance').value.trim();
  if (!utterance) return;

  el('utterance').value = '';
  el('send').disabled = true;
  el('reset').hidden = false;
  el('trace').innerHTML = '';
  el('cards').innerHTML = '';
  el('meta').textContent = '';
  window.speechSynthesis && window.speechSynthesis.cancel();

  addTurn('you', utterance);
  const pending = addTurn('lodge thinking', 'Pensando…');

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ institution: current.slug, utterance, token, subject, history }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'la petición ha fallado');

    pending.className = 'turn lodge';
    pending.textContent = data.said || '(sin respuesta)';
    history = history.concat([
      { role: 'user', text: utterance },
      { role: 'assistant', text: data.said },
    ]).slice(-MEMORIA);

    render(data);
  } catch (e) {
    pending.className = 'turn lodge';
    pending.textContent = 'I could not ask: ' + e.message;
  } finally {
    el('send').disabled = false;
    el('utterance').focus();
  }
}

function render(data) {
  if (speak) say(data.said);

  for (const step of data.trace) {
    const div = document.createElement('div');
    div.className = 'call' + (step.failed ? ' failed' : '');
    div.innerHTML =
      '<span class="ms">' + Math.round(step.ms) + ' ms</span>' +
      '<span class="name">' + esc(step.tool) + '</span> ' +
      esc(JSON.stringify(step.input)) +
      '<span class="out">' + esc(step.output) + '</span>';
    el('trace').appendChild(div);
  }

  for (const card of data.cards) {
    const frame = document.createElement('iframe');
    // The cards are self-contained documents with no scripts and no network. Sandboxed with
    // nothing granted back, because a card is the institution's HTML and this page is not.
    frame.setAttribute('sandbox', '');
    frame.setAttribute('title', 'Tarjeta ' + card.uri);
    frame.srcdoc = card.html;
    el('cards').appendChild(frame);
  }

  const u = data.usage;
  el('meta').textContent =
    Math.round(data.ms) + ' ms · ' + data.trace.length + ' llamadas · ' +
    u.inputTokens + ' entrada / ' + u.outputTokens + ' salida' +
    (u.cacheReadTokens ? ' · ' + u.cacheReadTokens + ' de caché' : '');
}

function say(text) {
  if (!text || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = current.locale;
  window.speechSynthesis.speak(u);
}

// ── Voice ───────────────────────────────────────────────────────────────────
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let listening = null;

function toggleMic() {
  if (listening) { listening.stop(); return; }
  const r = new Recognition();
  r.lang = current.locale;
  r.interimResults = false;
  r.onresult = (e) => { el('utterance').value = e.results[0][0].transcript; ask(); };
  r.onend = () => { listening = null; el('mic').setAttribute('aria-pressed', 'false'); };
  r.onerror = r.onend;
  listening = r;
  el('mic').setAttribute('aria-pressed', 'true');
  r.start();
}

// ── Start-up ────────────────────────────────────────────────────────────────
(async function start() {
  catalogues = await (await fetch('/api/institutions')).json();
  if (!catalogues.length) {
    addTurn('lodge', 'This deployment serves no institution.');
    return;
  }
  choose(catalogues[0].slug);
  // Volvemos de la pantalla de acceso del proveedor con un codigo que canjear.
  await finishSignIn();

  el('send').onclick = () => ask();
  el('utterance').onkeydown = (e) => { if (e.key === 'Enter') ask(); };
  el('reset').onclick = reset;
  el('speak').onclick = () => {
    speak = !speak;
    el('speak').setAttribute('aria-pressed', String(speak));
    if (!speak) window.speechSynthesis && window.speechSynthesis.cancel();
  };

  if (Recognition) el('mic').onclick = toggleMic;
  else el('mic').remove();
})();
`;

const BODY = `
<header>
  <h1>Lodge</h1>
  <p>The porter&rsquo;s lodge that never closes &middot; an Alexa+ simulation over the MCP server</p>
</header>

<main>
  <aside>
    <div class="block">
      <h2>Institution</h2>
      <div class="choices" id="institutions"></div>
    </div>
    <div class="block">
      <h2>Who is asking</h2>
      <div class="choices" id="identities"></div>
    </div>
    <div class="block">
      <h2>Tools published</h2>
      <div id="catalogue"></div>
    </div>
  </aside>

  <section>
    <div class="ask">
      <input id="utterance" autocomplete="off" placeholder="Ask something…" aria-label="Your question">
      <button id="mic" type="button" aria-pressed="false" title="Ask by voice">🎙</button>
      <button id="speak" type="button" aria-pressed="true" title="Read the answer aloud">🔊</button>
      <button id="send" type="button">Ask</button>
    </div>
    <div class="suggestions" id="suggestions"></div>

    <div id="talk"></div>
    <button id="reset" type="button" hidden>Start again</button>

    <div class="meta" id="meta"></div>
    <div id="trace"></div>
    <div id="cards"></div>
  </section>
</main>

<footer>
  The tools on the left are not written into this page: they are read from the server with
  <code>tools/list</code> on start-up. Switch to Carrigmore and three of them disappear &mdash; it
  has a room table and two calendars, and no directory, so it never offers to tell you your
  timetable. The catalogue follows the sources, and nothing is offered by halves.
  <br><br>
  Each institution answers in <strong>its own language</strong>. That is the adapter&rsquo;s, not
  this page&rsquo;s.
  <br><br>
  Report a fault and you will see it ask first and open nothing; answer <strong>yes</strong> and
  then it does. Two tool calls, and the first one writes nothing.
</footer>
`;

/** The whole page, as one document. */
export function demoPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lodge · demonstration</title>
<!-- Inline, like everything else here: a 404 in the console of a demonstration is a distraction
     the viewer has to be told to ignore. -->
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%2316171a'/><g fill='%23f0b429'><path d='M13 41a19 19 0 0 1 38 0z'/><rect x='9' y='42.5' width='46' height='6.5' rx='3.25'/><circle cx='32' cy='19' r='4.5'/></g><rect x='20' y='33' width='24' height='3.5' rx='1.75' fill='%2316171a'/></svg>">
<style>${STYLE}</style>
</head>
<body>
${BODY}
<script>${SCRIPT}</script>
</body>
</html>
`;
}
