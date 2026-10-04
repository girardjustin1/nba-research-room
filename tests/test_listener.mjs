// Node tests for scripts/draft_listener.user.js (run: node --test tests/test_listener.mjs).
// No npm packages: the userscript's pure functions are loaded in a vm sandbox, and the mock draft
// room's static markup is parsed into a tiny DOM shim that supports the selector subset the
// listener's CONFIG uses (tag, #id, .class, [attr], [attr=|*=|^=|$=|~= "v" i], descendant).
// tests/test_listener.py runs this file and also drives the real page in headless Chrome.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'draft_listener.user.js'), 'utf8');
const MOCK = fs.readFileSync(path.join(ROOT, 'scripts', 'mock_draft_room.html'), 'utf8');

function loadListener() {
  const module = { exports: {} };
  vm.runInNewContext(SRC, { module, console, setTimeout, clearTimeout, URLSearchParams });
  return module.exports;
}
const L = loadListener();
// Objects from the vm realm have other prototypes: compare their JSON form.
const same = (actual, expected, msg) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, msg);

// ------------------------------------------------------------------ DOM shim
class Text {
  constructor(data) { this.nodeType = 3; this.data = data; this.parentNode = null; }
  get textContent() { return this.data; }
}

class Element {
  constructor(tag, attrs = {}) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    this.childNodes = [];
    this.parentNode = null;
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes = [new Text(String(v))]; }
  *descendants() {
    for (const c of this.children) { yield c; yield* c.descendants(); }
  }
  querySelectorAll(selector) {
    const groups = parseSelector(selector);
    return [...this.descendants()].filter((el) => groups.some((g) => matchesComplex(el, g, this)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementById(id) { return [...this.descendants()].find((e) => e.getAttribute('id') === id) || null; }
}

function splitTop(s, sepRe) {
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '[') depth += 1;
    if (ch === ']') depth -= 1;
    if (depth === 0 && sepRe.test(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseCompound(src) {
  const c = { tag: null, ids: [], classes: [], attrs: [] };
  let s = src;
  const tag = s.match(/^([a-zA-Z][\w-]*|\*)/);
  if (tag) { c.tag = tag[1] === '*' ? null : tag[1].toUpperCase(); s = s.slice(tag[0].length); }
  while (s.length) {
    let m;
    if ((m = s.match(/^#([\w-]+)/))) c.ids.push(m[1]);
    else if ((m = s.match(/^\.([\w-]+)/))) c.classes.push(m[1]);
    else if ((m = s.match(/^\[\s*([\w-]+)\s*(?:([*^$~]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?\s*\]/))) {
      c.attrs.push({ name: m[1], op: m[2] || null, value: m[3] ?? m[4] ?? m[5] ?? null, ci: !!m[6] });
    } else throw new SyntaxError(`shim does not support selector: ${src}`);
    s = s.slice(m[0].length);
  }
  return c;
}

function parseSelector(selector) {
  return splitTop(selector, /,/).map((complex) => {
    if (/[>+~]\s/.test(complex.replace(/\[[^\]]*\]/g, ''))) throw new SyntaxError(`combinator: ${complex}`);
    return splitTop(complex, /\s/).map(parseCompound);
  });
}

function matchesCompound(el, c) {
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.ids.some((id) => el.getAttribute('id') !== id)) return false;
  const classes = (el.getAttribute('class') || '').split(/\s+/);
  if (c.classes.some((k) => !classes.includes(k))) return false;
  return c.attrs.every((a) => {
    let v = el.getAttribute(a.name);
    if (v == null) return false;
    if (!a.op) return true;
    let want = a.value;
    if (a.ci) { v = v.toLowerCase(); want = want.toLowerCase(); }
    switch (a.op) {
      case '=': return v === want;
      case '*=': return v.includes(want);
      case '^=': return v.startsWith(want);
      case '$=': return v.endsWith(want);
      case '~=': return v.split(/\s+/).includes(want);
      default: return false;
    }
  });
}

function matchesComplex(el, compounds, scope) {
  if (!matchesCompound(el, compounds[compounds.length - 1])) return false;
  let node = el.parentNode;
  for (let i = compounds.length - 2; i >= 0; i -= 1) {
    while (node && node !== scope.parentNode && !(node.nodeType === 1 && matchesCompound(node, compounds[i]))) {
      node = node.parentNode;
    }
    if (!node || node === scope.parentNode) return false;
    node = node.parentNode;
  }
  return true;
}

const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr']);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function parseHTML(html) {
  const doc = new Element('#document');
  const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/i, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  let cur = doc;
  const re = /<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)([^>]*?)\/?>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) {
      while (cur !== doc && cur.tagName !== m[1].toUpperCase()) cur = cur.parentNode;
      if (cur !== doc) cur = cur.parentNode;
    } else if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attrs[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      }
      const el = cur.appendChild(new Element(m[2], attrs));
      if (!VOID.has(m[2].toLowerCase())) cur = el;
    } else {
      cur.appendChild(new Text(decode(m[4])));
    }
  }
  return doc;
}

function pickRow(n, name, teamPos) {
  const li = new Element('li', { class: 'pick-row', 'data-pick-no': String(n) });
  const add = (cls, text) => { const s = new Element('span', { class: cls }); s.textContent = text; li.appendChild(s); li.appendChild(new Text(' ')); };
  add('pick-num', `${n}.`);
  add('player-name', name);
  add('team-pos', teamPos);
  return li;
}

// ------------------------------------------------------------------ parsing
test('parsePickText reads the common row formats', () => {
  const cases = [
    ['12. Avery Stone (DEN - C)', { pick_no: 12, player_name: 'Avery Stone', nba_team: 'DEN', positions: 'C' }],
    ['#7 Théo Lindqvist (MIN - C) Team 7', { pick_no: 7, player_name: 'Théo Lindqvist', nba_team: 'MIN' }],
    ["Pick 3: D'Andre Vale (SA - PF,C)", { pick_no: 3, player_name: "D'Andre Vale", nba_team: 'SAS', positions: 'PF,C' }],
    ['Rd 2, Pick 3: Kai Brooks-Ward (MIA - SG)', { pick_no: 17, player_name: 'Kai Brooks-Ward', nba_team: 'MIA' }],
    ['Round 1 Pick 14 Zoë Marić GS - PG,SG', { pick_no: 14, player_name: 'Zoë Marić', nba_team: 'GSW', positions: 'PG,SG' }],
    ['2.03 Marcus Lee Jr. NY - SF/PF', { pick_no: 17, player_name: 'Marcus Lee Jr.', nba_team: 'NYK', positions: 'SF/PF' }],
    ['Jalen Q. Price (PHO - PG)', { pick_no: null, player_name: 'Jalen Q. Price', nba_team: 'PHX' }],
    ['  5.  Rowan Okafor-Diaz\n (OKC - PG) ', { pick_no: 5, player_name: 'Rowan Okafor-Diaz', nba_team: 'OKC' }],
  ];
  for (const [text, want] of cases) {
    const got = L.parsePickText(text, 14);
    assert.ok(got, `no parse: ${text}`);
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, `${text} -> ${k}`);
  }
});

test('parsePickText rejects empty slots and non-pick text', () => {
  for (const text of ['', '4.', '4. Team 4', '12. —', 'Draft results', 'Kai Brooks-Ward']) {
    assert.equal(L.parsePickText(text, 14), null, text);
  }
});

test('round.pick numbering uses the team count', () => {
  assert.equal(L.parsePickText('Rd 3, Pick 2: Avery Stone (DEN - C)', 12).pick_no, 26);
  assert.equal(L.parsePickNo('1.12', 14), 12);
  assert.equal(L.parsePickNo('Rd 2, Pick 1', 14), 15);
  assert.equal(L.parsePickNo('#33', 14), 33);
});

// ------------------------------------------------------------------ DOM reading (mock room)
test('extractPicks reads the mock room pick list and ignores the available-players list', () => {
  const doc = parseHTML(MOCK);
  const { container, strategy, picks } = L.extractPicks(doc, L.CONFIG, 14);
  assert.ok(container, 'pick list container found');
  assert.equal(container.getAttribute('data-testid'), 'draft-results');
  assert.equal(strategy, 'row:li');
  same(picks.map((p) => [p.pick_no, p.player_name, p.nba_team, p.positions]), [
    [1, 'Avery Stone', 'DEN', 'C'],
    [2, 'Rowan Okafor-Diaz', 'OKC', 'PG'],
    [3, "D'Andre Vale", 'SAS', 'PF,C'],
  ]);
  assert.ok(!picks.some((p) => p.player_name === 'Quinn Hartley'), 'available players are not picks');
});

test('no pick list on the page means no picks, never a page-wide scan', () => {
  const doc = parseHTML('<main><ul><li>1. Avery Stone (DEN - C)</li></ul></main>');
  const res = L.extractPicks(doc, L.CONFIG, 14);
  assert.equal(res.container, null);
  same(res.picks, []);
});

test('falls back to text lines when rows have no recognised markup', () => {
  const doc = parseHTML('<div id="pick-history">\n1. Avery Stone (DEN - C)\n2. Quinn Hartley (BOS - SF)\n</div>');
  const res = L.extractPicks(doc, L.CONFIG, 14);
  assert.equal(res.strategy, 'text-lines');
  same(res.picks.map((p) => p.pick_no), [1, 2]);
});

test('table rows with round.pick cells', () => {
  const doc = parseHTML('<table class="draft-results"><tbody>'
    + '<tr><td>1.01</td> <td>Avery Stone</td> <td>DEN - C</td></tr>'
    + '<tr><td>2.01</td> <td>Silas Nwosu</td> <td>ATL - SF,PF</td></tr></tbody></table>');
  const res = L.extractPicks(doc, L.CONFIG, 14);
  assert.equal(res.strategy, 'row:tr');
  same(res.picks.map((p) => [p.pick_no, p.player_name]), [[1, 'Avery Stone'], [15, 'Silas Nwosu']]);
});

test('diffPicks sends each pick once and reports conflicts instead of sending them', () => {
  const doc = parseHTML(MOCK);
  const list = doc.getElementById('picks');
  const seen = new Map();
  const scan = () => L.diffPicks(seen, L.extractPicks(doc, L.CONFIG, 14).picks);

  assert.equal(scan().fresh.length, 3);
  assert.equal(scan().fresh.length, 0, 're-scan sends nothing');

  list.appendChild(pickRow(4, 'Quinn Hartley', '(BOS - SF)'));
  const r4 = scan();
  same(r4.fresh.map((p) => [p.pick_no, p.player_name]), [[4, 'Quinn Hartley']]);

  const nameSpan = list.children[1].querySelector('.player-name');
  nameSpan.textContent = 'Somebody Else';
  const r5 = scan();
  assert.equal(r5.fresh.length, 0);
  assert.equal(r5.conflicts.length, 1);
  assert.equal(r5.conflicts[0].before.player_name, 'Rowan Okafor-Diaz');

  list.appendChild(pickRow(6, 'Avery Stone', '(DEN - C)'));
  assert.equal(scan().fresh.length, 0, 'a player already sent is never sent again');
});

test('pickBody sends name, NBA team and pick number, never a draft team', () => {
  same(L.pickBody({ pick_no: 9, player_name: 'Avery Stone', nba_team: 'DEN' }),
    { player_name: 'Avery Stone', source: 'listener', team_abbr: 'DEN', pick_no: 9 });
  same(L.pickBody({ pick_no: null, player_name: 'Avery Stone', nba_team: null }),
    { player_name: 'Avery Stone', source: 'listener' });
});

// ------------------------------------------------------------------ API responses
test('classifyResponse maps the draft API answers', () => {
  const k = (s, j) => L.classifyResponse(s, j).kind;
  assert.equal(k(200, {}), 'ok');
  assert.equal(k(409, { detail: 'pick 3 is already recorded' }), 'duplicate');
  assert.equal(k(409, { detail: 'Avery Stone is already drafted' }), 'duplicate');
  assert.equal(k(409, { detail: { error: "could not match 'Avery Stne' (no_match)", candidates: ['averystone'] } }), 'unmatched');
  assert.equal(k(404, { detail: 'player 5 is not in the draft pool' }), 'unmatched');
  assert.equal(k(409, { detail: 'no draft session; POST /draft/session first' }), 'retry');
  assert.equal(k(0, null), 'retry');
  assert.equal(k(503, {}), 'retry');
  assert.equal(k(409, { detail: 'the draft is complete' }), 'drop');
  assert.equal(k(400, { detail: 'bad' }), 'drop');
});

function manualScheduler() {
  const jobs = [];
  return { jobs, schedule: (fn, ms) => jobs.push({ fn, ms }), runNext: async () => { const j = jobs.shift(); j.fn(); await tick(); } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('API down: picks stay queued in order and are retried with backoff', async () => {
  let up = false;
  const bodies = [];
  const transport = async (body) => { if (!up) throw new Error('ECONNREFUSED'); bodies.push(body); return { status: 200, json: {} }; };
  const sch = manualScheduler();
  const s = new L.PickSender(transport, { schedule: sch.schedule });
  await s.enqueue([{ pick_no: 1, player_name: 'Avery Stone' }, { pick_no: 2, player_name: 'Quinn Hartley' }]);
  assert.equal(s.queue.length, 2);
  assert.match(s.lastError, /unreachable/);
  assert.equal(sch.jobs[0].ms, 2000);
  await sch.runNext();
  assert.equal(sch.jobs[0].ms, 4000, 'backoff doubles');
  up = true;
  await sch.runNext();
  assert.equal(s.queue.length, 0);
  same(bodies.map((b) => b.pick_no), [1, 2]);
  assert.equal(s.sent.length, 2);
  assert.equal(s.lastError, null);
});

test('duplicates are quiet; unmatched names are kept for the badge', async () => {
  const answers = [
    { status: 409, json: { detail: 'pick 1 is already recorded' } },
    { status: 409, json: { detail: { error: "could not match 'Nobody Known' (no_match)", candidates: [] } } },
    { status: 200, json: {} },
  ];
  const s = new L.PickSender(async () => answers.shift(), { schedule: () => assert.fail('no retry expected') });
  await s.enqueue([{ pick_no: 1, player_name: 'Avery Stone' }, { pick_no: 2, player_name: 'Nobody Known' },
    { pick_no: 3, player_name: 'Quinn Hartley' }]);
  assert.equal(s.duplicates, 1);
  assert.equal(s.unmatched.length, 1);
  assert.equal(s.sent.length, 1);
  const text = L.badgeText({ sender: s, seen: new Map(), conflicts: new Map(), containerFound: true,
    strategy: 'row:li', draftId: 'test', dryRun: false });
  assert.match(text, /UNMATCHED: Nobody Known -> enter manually/);
  assert.match(text, /sent 1 · dup 1 · queued 0 · last #3 Quinn Hartley/);
});

// ------------------------------------------------------------------ read-only guarantees
test('the userscript never interacts with the page', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['.click(', 'dispatchEvent', '.submit(', '.focus(', 'KeyboardEvent', 'MouseEvent',
    'execCommand', 'innerHTML', '.value =', 'requestSubmit', 'sendKeys']) {
    assert.ok(!code.includes(banned), `found ${banned}`);
  }
  assert.match(SRC, /pointer-events:none/);
});

test('userscript header targets the Yahoo draft room and only the local API', () => {
  const header = SRC.split('==/UserScript==')[0];
  assert.match(header, /@match\s+https:\/\/basketball\.fantasysports\.yahoo\.com\/\*draft\*/);
  assert.match(header, /@grant\s+GM_xmlhttpRequest/);
  const connects = [...header.matchAll(/@connect\s+(\S+)/g)].map((m) => m[1]);
  same(connects, ['127.0.0.1']);
  assert.equal(L.CONFIG.apiUrl, 'http://127.0.0.1:8765');
});
