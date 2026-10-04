// ==UserScript==
// @name         NBA Research Room - draft listener (read-only)
// @namespace    research-room.local
// @version      0.1.0
// @description  Watches the Yahoo draft room's pick list and reports each new pick to the local draft API (127.0.0.1:8765). It never clicks, types or submits anything on Yahoo.
// @match        https://basketball.fantasysports.yahoo.com/*draft*
// @match        https://*.fantasysports.yahoo.com/*draftclient*
// @match        file:///*mock_draft_room.html*
// @match        http://127.0.0.1/*mock_draft_room.html*
// @match        http://localhost/*mock_draft_room.html*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

/*
 * READ-ONLY BY DESIGN. This script only *reads* the page (querySelector / textContent) and
 * POSTs what it saw to http://127.0.0.1:8765/draft/pick. It never clicks, focuses, types,
 * dispatches events, changes form values or submits anything on Yahoo. Its badge has
 * `pointer-events: none`, so clicks go straight through it to Yahoo's controls.
 *
 * UNVERIFIED SELECTORS. Nobody has seen the live Yahoo draft room with this script yet. Every
 * selector below is a guess with fallbacks, tested only against scripts/mock_draft_room.html.
 * Check them in a Yahoo MOCK draft before the real draft (Sun Oct 18, 7:00 pm EDT), using a
 * throwaway draft id on the Draft page. If the badge says "pick list not found" or sends
 * nothing, enter picks manually on the Draft page (the fallback) and update CONFIG.selectors.
 * README.md "Live draft listener (Tampermonkey)" explains how.
 */

(function (root, factory) {
  'use strict';
  const lib = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = lib;                          // node tests load the pure functions only
  } else if (root && root.document) {
    lib.start(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // ==================================================================== CONFIG
  // Everything that depends on Yahoo's markup lives here. To fix the listener for the live
  // room, change these lists (most specific first); no other code should need to change.
  const CONFIG = {
    apiUrl: 'http://127.0.0.1:8765',
    teams: 14,                 // fallback only: the real team count is read from GET /draft/session
    debounceMs: 300,           // wait for Yahoo to finish re-rendering before scanning
    rescanMs: 5000,            // periodic rescan in case a mutation was missed
    retryMinMs: 2000,          // API down: retry the queue with backoff...
    retryMaxMs: 15000,         // ...up to this interval
    requestTimeoutMs: 5000,
    dryRun: false,             // true: log picks in the badge instead of POSTing them
                               // (also on with window.RR_LISTENER_DRY_RUN = true or ?rr_dry_run=1)
    selectors: {
      // The element holding the list of picks already made. Only text inside it is ever parsed,
      // so the available-players list (which also looks like "1. Name (TEAM - POS)") is ignored.
      container: [
        '[data-testid*="draft-results" i]',
        '[data-testid*="pick-history" i]',
        '#draft-results', '#draftResults', '#pick-history', '#draft-picks',
        '[class*="DraftResults"]', '[class*="draft-results"]',
        '[class*="PickHistory"]', '[class*="pick-history"]',
        '[class*="DraftPicks"]', '[class*="draft-picks"]',
        '[aria-label*="draft results" i]', '[aria-label*="pick history" i]',
      ],
      // One element per pick inside the container. The first selector whose rows parse wins.
      row: ['[data-pick]', '[data-testid*="pick" i]', 'li', 'tr', '[role="row"]', '[class*="pick" i]'],
      // Optional fields inside a row. When absent, the row's whole text is parsed (PATTERNS).
      pickNo: ['[data-pick-no]', '[class*="pick-num" i]', '[class*="PickNumber"]', '[class*="pickNo"]'],
      playerName: ['[class*="player-name" i]', '[class*="PlayerName"]', 'a[href*="/players/"]',
        '[data-testid*="player-name" i]'],
      teamPos: ['[class*="team-pos" i]', '[class*="TeamPos"]', '[class*="ysf-player-team-pos"]'],
    },
    // Yahoo team codes that differ from BallDontLie's (the API resolves names; team only
    // breaks ties between players sharing a name).
    teamAliases: { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', NOR: 'NOP', PHO: 'PHX', UTAH: 'UTA',
      WSH: 'WAS', BRK: 'BKN', CHO: 'CHA', CHAR: 'CHA' },
  };

  // ==================================================================== text parsing
  const NAME = "([\\p{L}][\\p{L}\\p{M}'’.\\- ]*?[\\p{L}\\p{M}.])";
  const TEAM = '([A-Z]{2,4})';                                   // NBA team code, upper case
  const POS = '([A-Z]{1,4}(?:\\s*[,/]\\s*[A-Z]{1,4})*)';             // "C", "PG,SG", "SF/PF"
  // After a name: " (DEN - C)" or " DEN - C". Needs "(" or a space before the team code, so a
  // hyphenated name ("Kai Brooks-Ward") is never split into name + team.
  const TEAM_POS = `(?:\\s*\\(\\s*|\\s+)${TEAM}\\s*[-–—]\\s*${POS}(?=\\s*\\)|\\s|$)`;
  const TEAM_POS_FIELD = new RegExp(`^\\(?\\s*${TEAM}\\s*[-–—]\\s*${POS}\\s*\\)?$`, 'u');
  // Row-text patterns, tried in order. Each names its groups' meaning in `fields`.
  const PATTERNS = [
    // "12. Nikola Jokić (DEN - C)" / "#12 Name (DEN - C)" / "Pick 12: Name DEN - C"
    { re: new RegExp(`^(?:#|Pick\\s*)?(\\d{1,3})\\s*[.):#-]?\\s+${NAME}${TEAM_POS}`, 'u'),
      fields: ['pick_no', 'name', 'team', 'pos'] },
    // "Rd 2, Pick 3: Name (BOS - SF)" / "Round 2 Pick 3 Name BOS - SF"
    { re: new RegExp(`^(?:Rd\\.?|RD|Round|ROUND)\\s*(\\d{1,2})\\s*[,·|-]?\\s*(?:Pick|PICK|Pk\\.?)\\s*(\\d{1,2})\\s*[:.)-]?\\s*${NAME}${TEAM_POS}`, 'u'),
      fields: ['round', 'pick_in_round', 'name', 'team', 'pos'] },
    // "2.03 Name (BOS - SF)" (round.pick)
    { re: new RegExp(`^(\\d{1,2})\\.(\\d{1,2})\\s+${NAME}${TEAM_POS}`, 'u'),
      fields: ['round', 'pick_in_round', 'name', 'team', 'pos'] },
    // No pick number in the text: "Name (BOS - SF)" (pick number may come from a field)
    { re: new RegExp(`^${NAME}${TEAM_POS}`, 'u'), fields: ['name', 'team', 'pos'] },
  ];

  function clean(text) {
    return String(text == null ? '' : text).replace(/[ \s]+/g, ' ').trim();
  }

  function normalizeTeam(team) {
    if (!team) return null;
    const t = team.toUpperCase();
    return CONFIG.teamAliases[t] || t;
  }

  /** Parse one pick row's text. Returns {pick_no, round, pick_in_round, player_name, nba_team,
   *  positions} (unknown fields null), or null when the text is not a pick. */
  function parsePickText(text, teams) {
    const s = clean(text);
    if (!s) return null;
    for (const p of PATTERNS) {
      const m = s.match(p.re);
      if (!m) continue;
      const g = {};
      p.fields.forEach((f, i) => { g[f] = m[i + 1]; });
      const out = {
        pick_no: g.pick_no ? parseInt(g.pick_no, 10) : null,
        round: g.round ? parseInt(g.round, 10) : null,
        pick_in_round: g.pick_in_round ? parseInt(g.pick_in_round, 10) : null,
        player_name: clean(g.name),
        nba_team: normalizeTeam(g.team),
        positions: g.pos ? g.pos.replace(/\s+/g, '') : null,
      };
      if (out.pick_no == null && out.round && out.pick_in_round) {
        out.pick_no = (out.round - 1) * (teams || CONFIG.teams) + out.pick_in_round;
      }
      return out;
    }
    return null;
  }

  /** "12", "12.", "#12", "Pick 12", "1.12", "Rd 1, Pick 12" -> overall pick number. */
  function parsePickNo(text, teams) {
    const s = clean(text);
    let m = s.match(/(?:Rd\.?|Round)\s*(\d{1,2})\D+(\d{1,2})/i) || s.match(/^(\d{1,2})\.(\d{1,2})$/);
    if (m) return (parseInt(m[1], 10) - 1) * (teams || CONFIG.teams) + parseInt(m[2], 10);
    m = s.match(/(\d{1,3})/);
    return m ? parseInt(m[1], 10) : null;
  }

  // ==================================================================== DOM reading
  function firstMatch(el, selectors) {
    for (const sel of selectors) {
      try {
        const found = el.querySelector(sel);
        if (found) return found;
      } catch (e) { /* selector unsupported here: try the next one */ }
    }
    return null;
  }

  function textOf(el) {
    return el ? (el.innerText != null ? el.innerText : el.textContent) : '';
  }

  function findContainer(doc, cfg) {
    return firstMatch(doc, (cfg || CONFIG).selectors.container);
  }

  function parseRow(row, cfg, teams) {
    const sel = cfg.selectors;
    const parsed = parsePickText(textOf(row), teams) || {};
    const nameEl = firstMatch(row, sel.playerName);
    const noEl = firstMatch(row, sel.pickNo);
    const tpEl = firstMatch(row, sel.teamPos);
    const pick = {
      pick_no: parsed.pick_no == null ? null : parsed.pick_no,
      player_name: parsed.player_name || null,
      nba_team: parsed.nba_team || null,
      positions: parsed.positions || null,
    };
    if (nameEl && clean(textOf(nameEl))) pick.player_name = clean(textOf(nameEl));
    const attrNo = row.getAttribute && (row.getAttribute('data-pick-no') || row.getAttribute('data-pick'));
    if (attrNo && /^\d+$/.test(attrNo)) pick.pick_no = parseInt(attrNo, 10);
    else if (noEl) pick.pick_no = parsePickNo(textOf(noEl), teams) || pick.pick_no;
    if (tpEl) {
      const m = clean(textOf(tpEl)).match(TEAM_POS_FIELD);
      if (m) { pick.nba_team = normalizeTeam(m[1]); pick.positions = m[2].replace(/\s+/g, ''); }
    }
    return pick.player_name ? pick : null;
  }

  /** Read every pick visible in the pick list. Returns {container, strategy, picks}, picks
   *  sorted by pick_no and de-duplicated. Never reads outside the container. */
  function extractPicks(doc, cfg, teams) {
    cfg = cfg || CONFIG;
    const container = findContainer(doc, cfg);
    if (!container) return { container: null, strategy: null, picks: [] };
    let picks = [];
    let strategy = null;
    for (const sel of cfg.selectors.row) {
      let rows = [];
      try { rows = Array.from(container.querySelectorAll(sel)); } catch (e) { continue; }
      const parsed = rows.map((r) => parseRow(r, cfg, teams)).filter(Boolean);
      if (parsed.length) { picks = parsed; strategy = `row:${sel}`; break; }
    }
    if (!picks.length) {                         // last resort: one pick per line of text
      picks = textOf(container).split(/\n+/).map((l) => parsePickText(l, teams)).filter(Boolean)
        .map((p) => ({ pick_no: p.pick_no, player_name: p.player_name, nba_team: p.nba_team,
          positions: p.positions }));
      if (picks.length) strategy = 'text-lines';
    }
    const byKey = new Map();
    for (const p of picks) if (!byKey.has(pickKey(p))) byKey.set(pickKey(p), p);
    const out = Array.from(byKey.values());
    out.sort((a, b) => (a.pick_no || 1e9) - (b.pick_no || 1e9));
    return { container, strategy, picks: out };
  }

  function nameKey(name) {
    return clean(name).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function pickKey(p) {
    return p.pick_no != null ? `p${p.pick_no}` : `n${nameKey(p.player_name)}`;
  }

  /** Compare a scan with what was already seen. Mutates `seen` (Map key -> pick).
   *  Returns {fresh, conflicts}: new picks to send, and pick numbers whose player changed
   *  (a mis-parse or a commissioner edit: reported, never sent). */
  function diffPicks(seen, picks) {
    const fresh = [];
    const conflicts = [];
    const seenNames = new Set(Array.from(seen.values()).map((p) => nameKey(p.player_name)));
    for (const p of picks) {
      const k = pickKey(p);
      const prev = seen.get(k);
      if (prev) {
        if (nameKey(prev.player_name) !== nameKey(p.player_name)) conflicts.push({ before: prev, now: p });
        continue;
      }
      if (seenNames.has(nameKey(p.player_name))) continue;       // same player, already sent
      seen.set(k, p);
      seenNames.add(nameKey(p.player_name));
      fresh.push(p);
    }
    return { fresh, conflicts };
  }

  /** Body for POST /draft/pick: the API resolves the name and derives the team from the
   *  snake order, so no team_id is sent. */
  function pickBody(p) {
    const body = { player_name: p.player_name, source: 'listener' };
    if (p.nba_team) body.team_abbr = p.nba_team;
    if (p.pick_no != null) body.pick_no = p.pick_no;
    return body;
  }

  // ==================================================================== API responses
  /** ok | duplicate | unmatched | retry | drop. `retry` keeps the pick queued. */
  function classifyResponse(status, json) {
    const d = json && json.detail !== undefined ? json.detail : json;
    const text = typeof d === 'string' ? d : (d && d.error) || '';
    if (status >= 200 && status < 300) return { kind: 'ok' };
    if (!status || status >= 500) return { kind: 'retry', message: 'draft API unreachable' };
    if (status === 409 && d && typeof d === 'object' && /could not match/i.test(text)) {
      return { kind: 'unmatched', message: text, candidates: d.candidates || [] };
    }
    if (status === 404) return { kind: 'unmatched', message: text || 'not in the draft pool', candidates: [] };
    if (status === 409 && /already (recorded|drafted)/i.test(text)) return { kind: 'duplicate', message: text };
    if (status === 409 && /no draft session/i.test(text)) {
      return { kind: 'retry', message: 'no draft session: start one on the Draft page' };
    }
    return { kind: 'drop', message: text || `HTTP ${status}` };
  }

  /** Sends picks one at a time, in order. API down / no session: keep the queue, retry with
   *  backoff. `transport(body)` resolves {status, json} and rejects when unreachable. */
  class PickSender {
    constructor(transport, opts) {
      opts = opts || {};
      this.transport = transport;
      this.schedule = opts.schedule || ((fn, ms) => setTimeout(fn, ms));
      this.onUpdate = opts.onUpdate || (() => {});
      this.queue = [];
      this.sent = [];
      this.duplicates = 0;
      this.unmatched = [];
      this.errors = [];
      this.lastError = null;
      this.busy = false;
      this.retryMs = CONFIG.retryMinMs;
      this.retryPending = false;
    }

    enqueue(picks) {
      this.queue.push(...picks);
      this.onUpdate(this);
      return this.flush();
    }

    async flush() {
      if (this.busy || this.retryPending) return;
      this.busy = true;
      try {
        while (this.queue.length) {
          const pick = this.queue[0];
          let res;
          try {
            res = await this.transport(pickBody(pick));
          } catch (e) {
            res = { status: 0, json: null };
          }
          const c = classifyResponse(res.status, res.json);
          if (c.kind === 'retry') {
            this.lastError = c.message;
            this.retryPending = true;
            const wait = this.retryMs;
            this.retryMs = Math.min(this.retryMs * 2, CONFIG.retryMaxMs);
            this.schedule(() => { this.retryPending = false; this.flush(); }, wait);
            break;
          }
          this.queue.shift();
          this.retryMs = CONFIG.retryMinMs;
          this.lastError = null;
          if (c.kind === 'ok') this.sent.push(pick);
          else if (c.kind === 'duplicate') this.duplicates += 1;
          else if (c.kind === 'unmatched') this.unmatched.push({ pick, message: c.message, candidates: c.candidates });
          else this.errors.push({ pick, message: c.message });
          this.onUpdate(this);
        }
      } finally {
        this.busy = false;
        this.onUpdate(this);
      }
    }
  }

  // ==================================================================== browser glue
  function gmTransport(method, path, body) {
    return new Promise((resolve, reject) => {
      const parse = (t) => { try { return JSON.parse(t); } catch (e) { return { detail: t }; } };
      if (typeof GM_xmlhttpRequest === 'function') {
        // eslint-disable-next-line no-undef
        GM_xmlhttpRequest({
          method, url: CONFIG.apiUrl + path, timeout: CONFIG.requestTimeoutMs,
          headers: { 'Content-Type': 'application/json' },
          data: body ? JSON.stringify(body) : undefined,
          onload: (r) => resolve({ status: r.status, json: parse(r.responseText) }),
          onerror: () => reject(new Error('unreachable')),
          ontimeout: () => reject(new Error('timeout')),
        });
      } else {                                         // page script (mock room without Tampermonkey)
        fetch(CONFIG.apiUrl + path, { method, headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined })
          .then((r) => r.text().then((t) => resolve({ status: r.status, json: parse(t) })))
          .catch(reject);
      }
    });
  }

  const BADGE_ID = 'rr-draft-listener-badge';

  function createBadge(doc) {
    let el = doc.getElementById(BADGE_ID);
    if (el) return el;
    el = doc.createElement('div');
    el.id = BADGE_ID;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = [
      'position:fixed', 'left:8px', 'bottom:8px', 'z-index:2147483647', 'pointer-events:none',
      'user-select:none', 'max-width:340px', 'padding:6px 8px', 'border-radius:6px',
      'font:11px/1.35 -apple-system,system-ui,sans-serif', 'color:#fff', 'background:rgba(20,24,32,.82)',
      'white-space:pre-wrap', 'opacity:.92',
    ].join(';');
    (doc.body || doc.documentElement).appendChild(el);
    return el;
  }

  function badgeText(st) {
    const s = st.sender;
    const lines = [`RR listener${st.dryRun ? ' (DRY RUN)' : ''} · ${st.draftId ? `draft ${st.draftId}` : 'no API session'}`];
    lines.push(st.containerFound ? `pick list found (${st.strategy || 'no picks yet'}) · seen ${st.seen.size}`
      : 'pick list not found: check CONFIG.selectors; enter picks on the Draft page');
    const last = s.sent[s.sent.length - 1];
    lines.push(`sent ${s.sent.length} · dup ${s.duplicates} · queued ${s.queue.length}` +
      (last ? ` · last #${last.pick_no == null ? '?' : last.pick_no} ${last.player_name}` : ''));
    if (s.lastError) lines.push(`waiting: ${s.lastError} (retrying)`);
    for (const u of s.unmatched.slice(-3)) {
      lines.push(`UNMATCHED: ${u.pick.player_name} -> enter manually (${u.message})`);
    }
    for (const e of s.errors.slice(-2)) lines.push(`error: ${e.pick.player_name}: ${e.message}`);
    for (const c of Array.from(st.conflicts.values()).slice(-2)) {
      lines.push(`CONFLICT pick ${c.now.pick_no}: ${c.before.player_name} -> ${c.now.player_name} (not sent)`);
    }
    return lines.join('\n');
  }

  function start(win) {
    const doc = win.document;
    const params = new URLSearchParams((win.location && win.location.search) || '');
    const dryRun = CONFIG.dryRun || win.RR_LISTENER_DRY_RUN === true || params.get('rr_dry_run') === '1';
    const isTop = win.top === win;
    const st = { seen: new Map(), conflicts: new Map(), teams: CONFIG.teams, draftId: null, containerFound: false,
      strategy: null, dryRun, badge: null };

    const dryLog = [];
    const transport = dryRun
      ? (body) => { dryLog.push(body); return Promise.resolve({ status: 200, json: {} }); }
      : (body) => gmTransport('POST', '/draft/pick', body);

    let lastText = '';
    function render() {
      if (!st.badge && (isTop || st.containerFound)) st.badge = createBadge(doc);
      if (!st.badge) return;
      const text = badgeText(st);
      if (text !== lastText) { st.badge.textContent = text; lastText = text; }
      st.badge.setAttribute('data-sent', String(st.sender.sent.length));
      st.badge.setAttribute('data-queued', String(st.sender.queue.length));
      st.badge.setAttribute('data-unmatched', String(st.sender.unmatched.length));
      st.badge.setAttribute('data-found', String(st.containerFound));
    }
    st.sender = new PickSender(transport, { onUpdate: render, schedule: (fn, ms) => win.setTimeout(fn, ms) });

    function scan() {
      const res = extractPicks(doc, CONFIG, st.teams);
      st.containerFound = !!res.container;
      if (res.strategy) st.strategy = res.strategy;
      const { fresh, conflicts } = diffPicks(st.seen, res.picks);
      for (const c of conflicts) st.conflicts.set(`${pickKey(c.now)}|${c.now.player_name}`, c);
      if (fresh.length) st.sender.enqueue(fresh);
      render();
    }

    let timer = null;
    const observer = new win.MutationObserver((records) => {
      // Ignore our own badge updates, otherwise each render would trigger another scan.
      if (st.badge && records.every((r) => st.badge.contains(r.target))) return;
      win.clearTimeout(timer);
      timer = win.setTimeout(scan, CONFIG.debounceMs);
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    win.setInterval(scan, CONFIG.rescanMs);

    if (!dryRun) {
      gmTransport('GET', '/draft/session').then((r) => {
        if (r.status === 200 && r.json) { st.teams = r.json.teams || st.teams; st.draftId = r.json.draft_id; }
        else st.sender.lastError = 'no draft session: start one on the Draft page';
        render();
      }).catch(() => { st.sender.lastError = 'draft API unreachable: run make draft-api'; render(); });
    } else {
      st.draftId = 'dry-run';
    }
    win.__rrDraftListener = { state: st, dryLog, scan };   // for inspection in devtools / tests
    scan();
  }

  return { CONFIG, PATTERNS, parsePickText, parsePickNo, extractPicks, diffPicks, pickBody,
    classifyResponse, PickSender, normalizeTeam, nameKey, badgeText, start };
});
