// Live progress board (the "watch" view). A tiny hand-rolled HTTP server - ZERO new deps,
// just node:http - serves a self-refreshing page that POLLS the run's manifest + run-log.
// The viewer only READS the engine's on-disk output; it never blocks or couples to the weave
// (run it in one terminal, weave in another). `loomis watch <run>` opens a browser tab and
// streams pending -> in-flight -> done/failed, screen by screen, then closes itself when done.

import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { MANIFEST_FILE } from './manifest';
import { RUN_LOG_FILE, progress } from './log';
import type { Manifest } from './types';

export interface WatchState {
  phase: string;
  total: number;
  done: number;
  failed: number;
  inFlight: number;
  pending: number;
  screens: Array<{ screenId: string; surface?: string; story?: string; status: string }>;
  events: Array<{ event: string; screenId?: string; ts?: string }>;
  complete: boolean;
}

// Map the latest run-log event to a human phase label for the board header.
const PHASE_BY_EVENT: Record<string, string> = {
  init: 'Initializing',
  'design-system-sync': 'Building design system',
  'design-gate': 'Resolving design system',
  enumerate: 'Planning screens',
  'screen-start': 'Generating screens',
  'screen-generated': 'Generating screens',
  'screen-skip': 'Generating screens',
  'screen-failed': 'Generating screens',
  repair: 'Repairing omissions',
  'nav-graph': 'Building navigation',
  wire: 'Wiring navigation',
  assemble: 'Assembling offline bundle',
  board: 'Finalizing',
  coverage: 'Checking coverage',
  check: 'Verifying links',
};

function safeRead(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Read the current weave state from the run folder - pure, tolerant of mid-write files. */
export function readState(runFolder: string): WatchState {
  let manifest: Manifest | undefined;
  const raw = safeRead(join(runFolder, MANIFEST_FILE));
  if (raw) {
    try {
      manifest = JSON.parse(raw) as Manifest;
    } catch {
      /* a write is mid-flight - serve the last good shape (empty) this tick */
    }
  }

  const screens = (manifest?.screens ?? []).map((s) => ({
    screenId: s.screenId,
    ...(s.surface ? { surface: s.surface } : {}),
    ...(s.story ? { story: s.story } : {}),
    status: s.status,
  }));
  const count = (st: string): number => screens.filter((s) => s.status === st).length;
  const total = screens.length;
  const done = count('done');
  const failed = count('failed');
  const inFlight = count('in-flight');
  const pending = count('pending');

  const events: WatchState['events'] = [];
  const log = safeRead(join(runFolder, RUN_LOG_FILE));
  if (log) {
    for (const line of log.trim().split('\n').slice(-16)) {
      try {
        const e = JSON.parse(line) as { event: string; screenId?: string; ts?: string };
        events.push({
          event: e.event,
          ...(e.screenId ? { screenId: e.screenId } : {}),
          ...(e.ts ? { ts: e.ts } : {}),
        });
      } catch {
        /* skip a partial trailing line */
      }
    }
  }

  const lastEvent = events[events.length - 1]?.event ?? 'init';
  const phase = PHASE_BY_EVENT[lastEvent] ?? 'Weaving';
  const assembled = events.some((e) => e.event === 'assemble' || e.event === 'board' || e.event === 'check');
  const complete = total > 0 && done + failed === total && assembled;

  return { phase, total, done, failed, inFlight, pending, screens, events, complete };
}

/**
 * The self-contained progress page - polls `state` every 1.5s. Design dogfooded: Loomis
 * generated its own board via Stitch, then that look was ported here as hand-written,
 * fully-LOCAL CSS (system fonts + CSS glyphs - no Tailwind/Google Fonts/Material Symbols),
 * so the page stays offline and zero-dependency.
 */
export function progressHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Loomis - weaving…</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0d1117; color: #e8dfee; -webkit-font-smoothing: antialiased;
         font: 16px/1.5 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 56px 24px 96px; }
  .top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .brand { font-size: 38px; font-weight: 700; letter-spacing: -.02em; display: flex; align-items: center; gap: 12px; }
  .brand .spark { color: #7c3aed; }
  .live { display: flex; align-items: center; gap: 8px; background: #221e28; border: 1px solid #30363d;
          border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 600; letter-spacing: .08em;
          text-transform: uppercase; color: #e8dfee; }
  .live .led { width: 8px; height: 8px; border-radius: 50%; background: #2ea043; animation: pulse 1.5s ease-in-out infinite; }
  .live[data-state="done"] .led { background: #3fb950; animation: none; }
  .live[data-state="closed"] .led { background: #6e7681; animation: none; }
  .phase { color: #ccc3d8; font-size: 16px; margin: 0 0 22px; }
  .banner { display: none; margin: 0 0 22px; padding: 12px 16px; border-radius: 10px; font-weight: 600; font-size: 14px; }
  .banner.show { display: block; }
  .banner.ok { background: #0f2417; border: 1px solid #2ea043; color: #56d364; }
  .banner.warn { background: #241a0f; border: 1px solid #9e6a00; color: #e3b341; }
  .track { width: 100%; height: 14px; background: #21262d; border: 1px solid #30363d; border-radius: 999px;
           overflow: hidden; margin-bottom: 28px; }
  .fill { height: 100%; width: 0; border-radius: 999px; background: linear-gradient(90deg,#a371f7,#7c3aed); transition: width .5s ease; }
  .stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 36px; }
  .tile { background: #161b22; border: 1px solid #21262d; border-radius: 10px; padding: 18px 10px; text-align: center; }
  .tile .n { font-size: 30px; font-weight: 700; line-height: 1.1; margin-bottom: 4px; }
  .tile .k { font-size: 12px; font-weight: 500; color: #ccc3d8; letter-spacing: .02em; }
  .tile.weaving { border-color: rgba(124,58,237,.35); box-shadow: 0 0 14px rgba(124,58,237,.18); }
  .tile.weaving .n { color: #a371f7; }
  .tile.weaving .k { color: #c6a5ff; }
  .tile.dim { opacity: .45; }
  .list { background: #161b22; border: 1px solid #21262d; border-radius: 14px; overflow: hidden; margin-bottom: 36px; }
  .row { display: flex; align-items: center; justify-content: space-between; padding: 15px 18px; border-top: 1px solid #21262d; }
  .row:first-child { border-top: none; }
  .row .left { display: flex; align-items: center; gap: 13px; }
  .ic { width: 20px; text-align: center; font-size: 16px; font-weight: 700; flex: none; }
  .name { font-size: 14px; text-transform: capitalize; }
  .tag { font: 500 12px/1 ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace; color: #ccc3d8;
         background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 5px 8px; }
  .row.done .ic { color: #2ea043; }
  .row.failed .ic { color: #f85149; }
  .row.failed .name { color: #ffb4ab; }
  .row.pending { opacity: .6; }
  .row.pending .ic { color: #4a4455; }
  .row.pending .name { color: #ccc3d8; }
  .row.in-flight { background: #1a1f26; border-left: 2px solid #d29922; padding-left: 16px; box-shadow: 0 0 14px rgba(210,153,34,.10) inset; }
  .row.in-flight .ic span { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #d29922;
                            animation: pulse 1.2s ease-in-out infinite; }
  .row.in-flight .name { color: #d29922; font-weight: 600; }
  .row.in-flight .tag { color: #e3b341; background: rgba(210,153,34,.10); border-color: rgba(210,153,34,.30); }
  .hb-label { font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: .16em; color: #ccc3d8; margin: 0 0 12px 6px; }
  .term { background: #0d1117; border: 1px solid #30363d; border-radius: 10px; padding: 16px; max-height: 180px; overflow: auto;
          font: 400 13px/1.7 ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace; color: #958da1; }
  .term .line { display: flex; gap: 10px; }
  .term .chev { color: rgba(124,58,237,.7); }
  .term .line.active .chev, .term .line.active .msg { color: #d29922; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="brand"><span class="spark">✦</span> Loomis</div>
      <div class="live" id="live" data-state="live"><span class="led"></span><span id="livetext">Live</span></div>
    </div>
    <p class="phase" id="phase">Waiting for the weave to begin…</p>
    <div class="banner" id="banner"></div>
    <div class="track"><div class="fill" id="fill"></div></div>
    <div class="stats" id="stats"></div>
    <div class="list" id="list"></div>
    <div class="hb-label">Heartbeat</div>
    <div class="term" id="term">-</div>
  </div>
<script>
  var SYM = { done: "\\u2713", failed: "\\u2717", pending: "\\u25CB" };
  var stop = false;
  function esc(s){ return String(s).replace(/[&<>]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]; }); }
  function setLive(state, text){
    document.getElementById("live").setAttribute("data-state", state);
    document.getElementById("livetext").textContent = text;
  }
  function render(s){
    setLive(s.complete ? "done" : "live", s.complete ? "Done" : "Live");
    document.getElementById("phase").textContent =
      s.total ? (s.phase + " \\u2014 " + s.done + " / " + s.total + " woven") : "Waiting for the weave to begin…";
    var pct = s.total ? Math.round((s.done + s.failed) / s.total * 100) : 0;
    document.getElementById("fill").style.width = pct + "%";

    var tiles = [
      { k: "done", n: s.done, cls: "" },
      { k: "weaving", n: s.inFlight, cls: "weaving" },
      { k: "queued", n: s.pending, cls: "" },
      { k: "failed", n: s.failed, cls: s.failed ? "" : "dim" },
    ];
    document.getElementById("stats").innerHTML = tiles.map(function(t){
      var n = (t.k === "failed" && t.n) ? "<span style='color:#f85149'>" + t.n + "</span>" : t.n;
      return "<div class='tile " + t.cls + "'><div class='n'>" + n + "</div><div class='k'>" + t.k + "</div></div>";
    }).join("");

    document.getElementById("list").innerHTML = (s.screens || []).map(function(r){
      var name = (r.surface || r.screenId || "").replace(/-/g, " ");
      var icon = r.status === "in-flight" ? "<span></span>" : (SYM[r.status] || "\\u25CB");
      var tag = r.story ? esc(r.story) : "\\u2014";
      return "<div class='row " + r.status + "'>" +
               "<div class='left'><span class='ic'>" + icon + "</span><span class='name'>" + esc(name) + "</span></div>" +
               "<span class='tag'>" + tag + "</span>" +
             "</div>";
    }).join("");

    var ev = s.events || [];
    document.getElementById("term").innerHTML = ev.length ? ev.map(function(e, i){
      var active = (i === ev.length - 1) && e.event === "screen-start";
      var msg = esc(e.event) + (e.screenId ? " \\u00B7 " + esc(e.screenId) : "");
      return "<div class='line" + (active ? " active" : "") + "'><span class='chev'>\\u203A</span><span class='msg'>" + msg + "</span></div>";
    }).join("") : "\\u2014";

    if (s.complete) {
      var banner = document.getElementById("banner");
      banner.className = "banner show " + (s.failed ? "warn" : "ok");
      banner.textContent = s.failed
        ? ("Woven with " + s.failed + " failed screen(s) \\u2014 " + s.done + " ready in out/.")
        : ("\\u2713 Woven \\u2014 " + s.done + " screen(s) ready in out/. You can close this tab.");
      stop = true;
    }
  }
  function tick(){
    fetch("state", { cache: "no-store" })
      .then(function(r){ return r.json(); })
      .then(function(s){ render(s); if (!stop) setTimeout(tick, 1500); })
      .catch(function(){ setLive("closed", "offline"); });
  }
  tick();
</script>
</body>
</html>
`;
}

/** Start the board server on an OS-assigned free port. Caller decides when to close it. */
export function createWatchServer(
  runFolder: string,
): Promise<{ url: string; port: number; server: Server; close: () => Promise<void> }> {
  const html = progressHtml();
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/state')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(readState(runFolder)));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const url = `http://127.0.0.1:${port}/`;
      resolve({
        url,
        port,
        server,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** Open the URL in the OS default browser. Never throws (headless/SSH just see the URL). */
function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    const cmd = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    /* no browser available - the URL was already printed to stderr */
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

/** Serve until the run is complete (+ a grace window) or a hard timeout elapses. */
async function waitUntilComplete(runFolder: string, timeoutMs: number, graceMs = 8000): Promise<void> {
  const start = Date.now();
  let completeSince = 0;
  for (;;) {
    const st = readState(runFolder);
    if (st.complete) {
      if (!completeSince) completeSince = Date.now();
      if (Date.now() - completeSince >= graceMs) return;
    } else {
      completeSince = 0;
    }
    if (Date.now() - start >= timeoutMs) return;
    await sleep(1500);
  }
}

export interface WatchOptions {
  /** Don't auto-open the browser; just print the URL (CI / headless / scripted runs). */
  noOpen?: boolean;
  /** Hard ceiling on how long to serve before self-closing (default 1800s = 30 min). */
  timeoutSeconds?: number;
}

/** Run the live board: serve, open a tab, and stay up until the weave finishes (or times out). */
export async function startWatch(runFolder: string, opts: WatchOptions = {}): Promise<{ url: string }> {
  const { url, close } = await createWatchServer(runFolder);
  progress(`Progress board live → ${url}  (open in any browser)`);
  if (!opts.noOpen) openBrowser(url);
  await waitUntilComplete(runFolder, (opts.timeoutSeconds ?? 1800) * 1000);
  progress('Weave finished - closing the progress board.');
  await close();
  return { url };
}
