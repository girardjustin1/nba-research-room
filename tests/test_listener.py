"""The Tampermonkey draft listener (scripts/draft_listener.user.js).

1. Node unit tests (tests/test_listener.mjs): parsing, DOM extraction against the mock room's
   markup, de-duplication, API response handling, retry queue, read-only guarantees.
2. Headless Chrome, driven over the DevTools protocol, runs the real script in the real mock
   room (scripts/mock_draft_room.html) while it appends picks on a timer: dry-run in three row
   layouts, and once through a fake GM_xmlhttpRequest that is down at first, then answers with
   a duplicate and an unmatched name.

Players are synthetic. Nothing contacts Yahoo or the real draft API. Neither test proves the
selectors fit the live Yahoo room; that needs a Yahoo mock draft (see README).
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MOCK = ROOT / "scripts" / "mock_draft_room.html"
NODE = shutil.which("node") or ("/opt/homebrew/bin/node" if Path("/opt/homebrew/bin/node").exists() else None)
_CHROMES = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            shutil.which("google-chrome"), shutil.which("chromium")]
CHROME = next((p for p in _CHROMES if p and Path(p).exists()), None)
# The mock room's synthetic pool, in draft order (see POOL in mock_draft_room.html), with the
# team codes the listener should send after mapping Yahoo-style codes (GS, NY, SA, ...).
EXPECTED = [("Avery Stone", "DEN"), ("Rowan Okafor-Diaz", "OKC"), ("D'Andre Vale", "SAS"),
            ("Quinn Hartley", "BOS"), ("Zoë Marić", "GSW"), ("Kai Brooks-Ward", "MIA"),
            ("Marcus Lee Jr.", "NYK"), ("Théo Lindqvist", "MIN"), ("Jalen Q. Price", "PHX"),
            ("Emeka Stroud", "NOP")]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_listener_unit_tests_pass_in_node():
    r = subprocess.run([NODE, "--test", "--test-reporter=tap", str(ROOT / "tests" / "test_listener.mjs")],
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout[-4000:] + r.stderr[-2000:]
    passed = int(next(line.split()[-1] for line in r.stdout.splitlines() if line.startswith("# pass")))
    assert passed >= 14
    assert "# fail 0" in r.stdout


# ------------------------------------------------------------------ headless Chrome over CDP
class Browser:
    """Minimal DevTools-protocol client: one page, navigate, evaluate. No extra packages."""

    def __init__(self, profile: Path) -> None:
        self.proc = subprocess.Popen(
            [CHROME, "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
             "--use-mock-keychain", "--disable-extensions", f"--user-data-dir={profile}",
             "--remote-debugging-port=0", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        port_file = profile / "DevToolsActivePort"
        deadline = time.monotonic() + 20
        while not port_file.exists() or not port_file.read_text().strip():
            if time.monotonic() > deadline:
                raise RuntimeError("Chrome did not open a DevTools port")
            time.sleep(0.1)
        port = port_file.read_text().split()[0]
        targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5))
        self.ws_url = next(t["webSocketDebuggerUrl"] for t in targets if t["type"] == "page")

    def run(self, url: str, until_js: str, result_js: str, preload_js: str | None = None,
            timeout: float = 25.0) -> dict:
        return asyncio.run(asyncio.wait_for(self._run(url, until_js, result_js, preload_js, timeout),
                                            timeout + 10))

    async def _run(self, url, until_js, result_js, preload_js, timeout) -> dict:
        from websockets.asyncio.client import connect

        async with connect(self.ws_url, max_size=None) as ws:
            n = 0

            async def cmd(method: str, **params):
                nonlocal n
                n += 1
                await ws.send(json.dumps({"id": n, "method": method, "params": params}))
                while True:
                    msg = json.loads(await ws.recv())
                    if msg.get("id") == n:
                        if "error" in msg:
                            raise RuntimeError(msg["error"])
                        return msg["result"]

            async def evaluate(expr: str):
                res = await cmd("Runtime.evaluate", expression=expr, returnByValue=True)
                if "exceptionDetails" in res:
                    raise RuntimeError(res["exceptionDetails"])
                return res["result"].get("value")

            await cmd("Page.enable")
            if preload_js:
                await cmd("Page.addScriptToEvaluateOnNewDocument", source=preload_js)
            await cmd("Page.navigate", url=url)
            deadline = time.monotonic() + timeout
            while not await evaluate(until_js):
                if time.monotonic() > deadline:
                    raise AssertionError(f"timed out; state: {await evaluate(result_js)}")
                await asyncio.sleep(0.2)
            return json.loads(await evaluate(result_js))

    def close(self) -> None:
        self.proc.kill()
        self.proc.wait(timeout=10)


@pytest.fixture
def browser(tmp_path):
    if CHROME is None:
        pytest.skip("Chrome is not installed")
    pytest.importorskip("websockets")       # pinned in requirements.txt (via uvicorn)
    b = Browser(tmp_path / "chrome-profile")
    yield b
    b.close()


BADGE = "document.getElementById('rr-draft-listener-badge')"
RESULT_JS = f"""JSON.stringify({{
  badge: {BADGE} ? Object.assign({{}}, {BADGE}.dataset) : null,
  text: {BADGE} ? {BADGE}.textContent : null,
  pointerEvents: {BADGE} ? getComputedStyle({BADGE}).pointerEvents : null,
  interactions: document.body.dataset.interactions,
  dryLog: window.__rrDraftListener ? window.__rrDraftListener.dryLog : null,
  requests: window.__fakeRequests || null,
}})"""


@pytest.mark.parametrize("query", ["layout=spans", "layout=text", "layout=table",
                                   "layout=spans&order=newest"])
def test_listener_reads_the_mock_room_as_picks_arrive(browser, query):
    url = f"{MOCK.as_uri()}?listener=dry&interval=100&picks=10&{query}"
    out = browser.run(url, until_js=f"{BADGE} && {BADGE}.dataset.sent === '10'", result_js=RESULT_JS)
    bodies = sorted(out["dryLog"], key=lambda b: b["pick_no"])
    assert [b["pick_no"] for b in bodies] == list(range(1, 11))
    assert [(b["player_name"], b["team_abbr"]) for b in bodies] == EXPECTED
    assert all(b["source"] == "listener" and "team_id" not in b for b in bodies)
    assert out["badge"]["found"] == "true"
    assert out["pointerEvents"] == "none"
    assert out["interactions"] == "0", "the listener touched the page"
    assert "sent 10 · dup 0 · queued 0" in out["text"]


FAKE_GM = """
window.__fakeRequests = [];
let failuresLeft = 2;
window.GM_xmlhttpRequest = function (req) {
  const body = req.data ? JSON.parse(req.data) : null;
  window.__fakeRequests.push({ method: req.method, url: req.url, body });
  const reply = (status, json) =>
    setTimeout(() => req.onload({ status, responseText: JSON.stringify(json) }), 5);
  if (req.method === 'GET') return reply(200, { draft_id: 'cdp-test', teams: 14 });
  if (failuresLeft > 0) { failuresLeft -= 1; return setTimeout(() => req.onerror({}), 5); }
  if (body.pick_no === 2) return reply(409, { detail: 'pick 2 is already recorded' });
  if (body.player_name === 'Zoë Marić') {
    return reply(409, { detail: { error: "could not match 'Zoë Marić' (no_match)", candidates: [] } });
  }
  return reply(200, {});
};
"""


def test_listener_queues_while_api_is_down_then_handles_duplicates_and_unmatched(browser):
    url = f"{MOCK.as_uri()}?listener=page&interval=100&picks=5"
    done = f"{BADGE} && {BADGE}.dataset.queued === '0' && {BADGE}.dataset.unmatched === '1'"
    out = browser.run(url, until_js=done, result_js=RESULT_JS, preload_js=FAKE_GM, timeout=30)
    posts = [r for r in out["requests"] if r["method"] == "POST"]
    assert all(r["url"] == "http://127.0.0.1:8765/draft/pick" for r in posts)
    # pick 1 failed twice (API down) and stayed first in the queue; order is preserved
    assert [r["body"]["pick_no"] for r in posts] == [1, 1, 1, 2, 3, 4, 5]
    assert out["badge"]["sent"] == "3"
    assert "draft cdp-test" in out["text"]
    assert "dup 1" in out["text"]
    assert "UNMATCHED: Zoë Marić -> enter manually" in out["text"]
    assert out["interactions"] == "0"
