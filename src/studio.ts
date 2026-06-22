// Loomis Studio - the INTERACTIVE weave. Where `watch` is a read-only board, `studio` is a
// control surface: a local server that DRIVES the engine and narrates the build, pausing at the
// real decision points (confirm the theme; refine / explore options / promote per screen) which
// the developer answers in the browser. Same Node + browser stack as `watch` (no new runtime);
// the difference is the page POSTs actions back and the server calls the engine in-process.

import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { discoverInputs } from './discovery';
import { readManifest, writeManifest, emptyManifest } from './manifest';
import { hashInputs } from './hash';
import { syncDesignSystem } from './design-system';
import { writeDesignPreview, parseDesignTokens } from './design-preview';
import { enumerateSurfaces, enumerateIntoManifest } from './enumerate';
import { writeNavGraph } from './nav-graph';
import { compileScreen } from './compile';
import { generateOneScreen } from './generate';
import { wireRunFolder } from './wire';
import { assembleBundle } from './assemble';
import { writeBoard } from './board';
import { checkRunnable } from './runnable';
import { refineScreen } from './refine';
import { regenScreen } from './regen';
import { suggestScreen, promoteSuggestion } from './suggest';
import { addScreen } from './add-screen';
import { parseIaTable, parseSurfaceSpec } from './experience';
import { progress } from './log';
import { MechanicalBrain, BridgeBrain, type StudioBrain } from './brain';
import type { UIProvider } from './provider/uiprovider';

type Phase = 'plan' | 'design' | 'generate' | 'review' | 'assembling' | 'done' | 'error';

interface PlanSurface {
  screenId: string;
  surface: string;
  story?: string;
  purpose?: string;
}

interface StudioScreen {
  screenId: string;
  surface?: string;
  story?: string;
  status: string; // pending | cooking | done | failed
  hasShot: boolean;
  refinements: string[];
  suggestions: number[];
  busy: boolean;
  /** Bumps whenever this screen's bytes change - the page uses it to cache-bust the screenshot. */
  rev: number;
  /** The brain's latest reasoning for this screen (shown in the portal). */
  note?: string;
}

interface StudioState {
  phase: Phase;
  narration: string;
  brain: string;
  app: { name: string; device?: string; surfaces: PlanSurface[] };
  theme?: {
    colors: Record<string, string>;
    fonts: string[];
    tone?: string;
    paletteSource: string;
    /** The editable DESIGN.md source colors (token -> hex) - the developer can change these. */
    editable?: Record<string, string>;
  };
  /** True while a theme re-sync is in flight. */
  themeBusy?: boolean;
  screens: StudioScreen[];
  awaiting?: 'start' | 'approve-theme' | 'finish';
  outReady: boolean;
  /** True when this studio reopened an existing project's saved memory instead of weaving fresh. */
  resumed?: boolean;
  error?: string;
}

interface Action {
  type: string;
  screenId?: string;
  feedback?: string;
  option?: number;
  count?: number;
  /** Natural-language request for an 'intent' action - routed through the brain. */
  text?: string;
  /** Source-color edits for an 'adjust-theme' action: token -> new hex. */
  edits?: Array<{ token: string; value: string }>;
}

export class StudioSession {
  readonly state: StudioState;
  private waiters: Array<{ types: string[]; resolve: (a: Action) => void }> = [];
  private chain: Promise<unknown> = Promise.resolve();
  private revs: Record<string, number> = {};
  private notes: Record<string, string> = {};

  constructor(
    private readonly runFolder: string,
    private readonly provider: UIProvider,
    private designMd: string,
    private readonly experienceMd: string,
    appName: string,
    private readonly brain: StudioBrain = new MechanicalBrain(),
  ) {
    this.state = {
      phase: 'plan',
      narration: 'Reading your idea…',
      brain: brain.name,
      app: { name: appName, surfaces: [] },
      screens: [],
      outReady: false,
    };
  }

  // ---- action plumbing -------------------------------------------------------

  /** Called by POST /action. Gate actions resolve the current await; review actions run serialized. */
  submit(action: Action): void {
    const idx = this.waiters.findIndex((w) => w.types.includes(action.type));
    if (idx >= 0) {
      const [w] = this.waiters.splice(idx, 1);
      w!.resolve(action);
      return;
    }
    // Theme adjustment at the color gate - edit DESIGN.md colors + re-sync, staying at the gate.
    if (this.state.phase === 'design' && action.type === 'adjust-theme') {
      void this.handleAdjustTheme(action.edits ?? []);
      return;
    }
    // Rework after shipping - re-enter review from the Done screen.
    if (this.state.phase === 'done' && action.type === 'rework') {
      void this.reviewAndAssemble().catch((e) => {
        this.state.error = e instanceof Error ? e.message : String(e);
      });
      return;
    }
    // Per-screen edits + brain intents - only in review, serialized so provider calls never overlap.
    if (this.state.phase === 'review' && ['intent', 'refine', 'suggest', 'promote', 'regenerate'].includes(action.type)) {
      this.enqueue(action);
    }
  }

  /** Edit DESIGN.md source colors and re-sync the design system, without leaving the color gate. */
  private async handleAdjustTheme(edits: Array<{ token: string; value: string }>): Promise<void> {
    if (this.state.themeBusy || edits.length === 0) return;
    this.state.themeBusy = true;
    this.state.narration = 'Re-syncing your theme with Stitch…';
    try {
      for (const e of edits) {
        if (!/^#[0-9a-fA-F]{3,8}$/.test(e.value) || !/^[A-Za-z][\w-]*$/.test(e.token)) continue;
        const re = new RegExp('(^\\s*' + e.token + '\\s*:\\s*")#[0-9a-fA-F]{3,8}(")', 'm');
        this.designMd = this.designMd.replace(re, `$1${e.value}$2`);
      }
      await syncDesignSystem(this.runFolder, this.provider, this.designMd);
      const theme = writeDesignPreview(this.runFolder, this.designMd);
      this.state.theme = {
        colors: theme.colors,
        fonts: theme.fonts,
        ...(theme.tone ? { tone: theme.tone } : {}),
        paletteSource: theme.paletteSource,
        editable: parseDesignTokens(this.designMd).colors,
      };
      this.state.narration = 'Theme updated - confirm it, or keep adjusting.';
    } catch (e) {
      this.state.narration = 'Theme re-sync failed: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      this.state.themeBusy = false;
    }
  }

  private waitFor(types: Array<NonNullable<StudioState['awaiting']>>): Promise<Action> {
    this.state.awaiting = types[0];
    return new Promise((resolve) => this.waiters.push({ types, resolve }));
  }

  private enqueue(action: Action): void {
    this.chain = this.chain
      .then(() => (action.type === 'intent' ? this.handleIntent(action) : this.handleReview(action)))
      .catch((e) => {
        this.state.error = e instanceof Error ? e.message : String(e);
      });
  }

  /** Run one concrete engine verb on a screen - shared by the direct buttons and the brain. */
  private async runVerb(
    verb: string,
    screenId: string,
    o: { feedback?: string; count?: number; option?: number },
  ): Promise<void> {
    if (verb === 'refine' && o.feedback) await refineScreen(this.runFolder, this.provider, screenId, o.feedback);
    else if (verb === 'add' && o.feedback) await addScreen(this.runFolder, this.provider, this.experienceMd, screenId, o.feedback);
    else if (verb === 'regenerate') await regenScreen(this.runFolder, this.provider, this.experienceMd, screenId);
    else if (verb === 'suggest') await suggestScreen(this.runFolder, this.provider, this.experienceMd, screenId, { count: o.count ?? 3 });
    else if (verb === 'promote' && o.option) await promoteSuggestion(this.runFolder, screenId, o.option);
  }

  /** A direct button press maps straight to a verb. */
  private async handleReview(action: Action): Promise<void> {
    const sc = this.state.screens.find((s) => s.screenId === action.screenId);
    if (!sc) return;
    sc.busy = true;
    this.state.narration = `Working on ${sc.surface ?? sc.screenId}…`;
    try {
      await this.runVerb(action.type, action.screenId!, {
        ...(action.feedback ? { feedback: action.feedback } : {}),
        ...(action.count ? { count: action.count } : {}),
        ...(action.option ? { option: action.option } : {}),
      });
    } finally {
      this.afterScreenAction(action.screenId!, sc);
    }
  }

  /** The brain path: send the intent to the agent, then run whatever actions it decides on. */
  private async handleIntent(action: Action): Promise<void> {
    const sc = this.state.screens.find((s) => s.screenId === action.screenId);
    if (!sc) return;
    sc.busy = true;
    this.state.narration =
      (this.brain.name === 'mechanical' ? 'Loomis' : 'The agent') + ` is thinking about ${sc.surface ?? sc.screenId}…`;
    try {
      const decision = await this.brain.decide(
        { kind: 'change', screenId: action.screenId!, text: action.text ?? '' },
        { ...(sc.surface ? { surface: sc.surface } : {}), refinements: sc.refinements },
      );
      this.notes[action.screenId!] = decision.reasoning;
      for (const a of decision.actions) {
        await this.runVerb(a.verb, a.screenId, {
          ...(a.feedback ? { feedback: a.feedback } : {}),
          ...(a.count ? { count: a.count } : {}),
        });
      }
    } finally {
      this.afterScreenAction(action.screenId!, sc);
    }
  }

  private afterScreenAction(screenId: string, sc: StudioScreen): void {
    sc.busy = false;
    this.revs[screenId] = (this.revs[screenId] ?? 0) + 1;
    this.refreshFromManifest();
    this.state.narration = 'Your screens are in. Tell Loomis what to change, or finish.';
  }

  /** Re-sync the studio screen list from the manifest on disk (status, shots, suggestions, refinements). */
  private refreshFromManifest(): void {
    let screens;
    try {
      screens = readManifest(this.runFolder).screens;
    } catch {
      return;
    }
    this.state.screens = screens.map((s) => {
      const prev = this.state.screens.find((p) => p.screenId === s.screenId);
      return {
        screenId: s.screenId,
        ...(s.surface ? { surface: s.surface } : {}),
        ...(s.story ? { story: s.story } : {}),
        status: s.status,
        hasShot: !!s.screenshotPath,
        refinements: s.refinements ?? [],
        suggestions: (s.suggestions ?? []).map((x) => x.option),
        busy: prev?.busy ?? false,
        rev: this.revs[s.screenId] ?? 0,
        ...(this.notes[s.screenId] ? { note: this.notes[s.screenId] } : {}),
      };
    });
  }

  // ---- the orchestration -----------------------------------------------------

  /** A relaunch RESUMES (vs. re-weaves) when the saved memory is still valid: the pinned design
   *  system matches the current DESIGN.md, and every planned surface already has a `done` screen. */
  private isResumable(): boolean {
    let m;
    try {
      m = readManifest(this.runFolder);
    } catch {
      return false;
    }
    if (!m.designSystem?.assetId || m.designSystem.designMdHash !== hashInputs(this.designMd)) return false;
    const surfaces = enumerateSurfaces(this.experienceMd);
    if (surfaces.length === 0) return false;
    return surfaces.every((s) => m.screens.find((x) => x.screenId === s.screenId)?.status === 'done');
  }

  async run(): Promise<void> {
    try {
      // PLAN - "here's what we're building"
      const plan = buildPlan(this.experienceMd);
      this.state.app.surfaces = plan;
      try {
        const summary = writeDesignPreview(this.runFolder, this.designMd);
        if (summary.device) this.state.app.device = summary.device;
        if (summary.name) this.state.app.name = summary.name;
      } catch {
        /* preview is best-effort at plan time */
      }

      // RESUME - if this project's saved memory is still valid (the pinned design system matches
      // DESIGN.md and every planned screen is already woven), reopen it: restore the theme + screen
      // list and drop the developer straight onto the review board. No gates, no re-weave.
      if (this.isResumable()) {
        try {
          const theme = writeDesignPreview(this.runFolder, this.designMd);
          this.state.theme = {
            colors: theme.colors,
            fonts: theme.fonts,
            ...(theme.tone ? { tone: theme.tone } : {}),
            paletteSource: theme.paletteSource,
            editable: parseDesignTokens(this.designMd).colors,
          };
        } catch {
          /* theme preview is best-effort */
        }
        this.refreshFromManifest();
        this.state.resumed = true;
        const woven = this.state.screens.filter((s) => s.status === 'done').length;
        this.state.narration = `Resumed ${this.state.app.name} - ${woven} woven screens are back. Refine, or reopen the prototype.`;
        await this.reviewAndAssemble();
        return;
      }

      this.state.narration = `Here's what we're building: ${this.state.app.name} - ${plan.length} screens. Start when ready.`;
      await this.waitFor(['start']);

      // DESIGN - "asking Stitch for the design system", then the theme gate
      this.state.phase = 'design';
      this.state.awaiting = undefined;
      this.state.narration = 'Asking Stitch to build your design system from DESIGN.md…';
      await syncDesignSystem(this.runFolder, this.provider, this.designMd);
      const theme = writeDesignPreview(this.runFolder, this.designMd);
      this.state.theme = {
        colors: theme.colors,
        fonts: theme.fonts,
        ...(theme.tone ? { tone: theme.tone } : {}),
        paletteSource: theme.paletteSource,
        editable: parseDesignTokens(this.designMd).colors,
      };
      this.state.narration = 'Stitch resolved your theme. Tweak any color and re-sync, or confirm to start weaving.';
      await this.waitFor(['approve-theme']);
      this.approveDesign();

      // GENERATE - stream each screen: "Stitch is cooking" → "Stitch delivered this"
      this.state.phase = 'generate';
      this.state.awaiting = undefined;
      enumerateIntoManifest(this.runFolder, this.experienceMd);
      writeNavGraph(this.runFolder, this.experienceMd);
      this.refreshFromManifest();
      const assetId = readManifest(this.runFolder).designSystem?.assetId;
      // generateOneScreen reads the target device from the manifest itself.
      for (const s of enumerateSurfaces(this.experienceMd)) {
        const sc = this.state.screens.find((x) => x.screenId === s.screenId);
        if (sc) sc.status = 'cooking';
        this.state.narration = `Stitch is cooking: ${s.surface}…`;
        const compiled = compileScreen(this.experienceMd, s.surface, assetId);
        await generateOneScreen(
          this.runFolder,
          this.provider,
          {
            screenId: compiled.screenId,
            surface: compiled.surface,
            prompt: compiled.prompt,
            expectedContent: compiled.expectedContent,
            ...(compiled.story ? { story: compiled.story } : {}),
          },
          {},
        );
        this.revs[compiled.screenId] = (this.revs[compiled.screenId] ?? 0) + 1;
        this.refreshFromManifest();
        this.state.narration = `Stitch delivered: ${s.surface}.`;
      }

      // REVIEW + ASSEMBLE - interactive, and repeatable (the developer can rework after shipping).
      await this.reviewAndAssemble();
    } catch (e) {
      this.state.phase = 'error';
      this.state.error = e instanceof Error ? e.message : String(e);
    }
  }

  /** Review → finish → assemble → done. Re-invokable, so the developer can rework after shipping. */
  private async reviewAndAssemble(): Promise<void> {
    this.state.phase = 'review';
    this.state.awaiting = undefined;
    // A prior ship (resume or rework) leaves a runnable bundle - keep "Open prototype" live now.
    this.state.outReady = existsSync(join(this.runFolder, 'out', 'index.html'));
    this.state.narration = 'Your screens are in. Refine, explore options, or promote - then finish.';
    await this.waitFor(['finish']);

    this.state.phase = 'assembling';
    this.state.awaiting = undefined;
    await this.chain; // drain any in-flight review action
    this.state.narration = 'Wiring navigation, vendoring assets for offline, verifying links…';
    wireRunFolder(this.runFolder);
    await assembleBundle(this.runFolder, {});
    writeBoard(this.runFolder);
    await checkRunnable(join(this.runFolder, 'out'));
    this.refreshFromManifest();

    this.state.outReady = true;
    this.state.phase = 'done';
    const ready = this.state.screens.filter((s) => s.status === 'done').length;
    this.state.narration = `Your app is woven - ${ready} screens, connected and offline. Open it, or refine more.`;
  }

  private approveDesign(): void {
    const m = readManifest(this.runFolder);
    if (m.designSystem) m.designSystem.approved = true;
    writeManifest(this.runFolder, m);
  }
}

/** The plan ("here's what we're building") - surfaces, stories, purposes from EXPERIENCE.md. */
function buildPlan(experienceMd: string): PlanSurface[] {
  const ia = parseIaTable(experienceMd);
  return enumerateSurfaces(experienceMd).map((s) => {
    const row = ia.find((r) => r.surface.toLowerCase() === s.surface.toLowerCase());
    const story = parseSurfaceSpec(experienceMd, s.surface).story;
    return {
      screenId: s.screenId,
      surface: s.surface,
      ...(story ? { story } : {}),
      ...(row?.purpose ? { purpose: row.purpose } : {}),
    };
  });
}

// ---- server ------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
};

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

export function createStudioServer(
  session: StudioSession,
  runFolder: string,
): Promise<{ url: string; close: () => Promise<void>; server: Server }> {
  const html = studioHtml();
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/';

    if (url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(session.state));
      return;
    }
    if (url === '/action' && req.method === 'POST') {
      void readBody(req).then((body) => {
        try {
          session.submit(JSON.parse(body || '{}') as Action);
        } catch {
          /* ignore malformed action */
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }
    // Live screenshot of a screen: /shot/<screenId>
    if (url.startsWith('/shot/')) {
      const id = decodeURIComponent(url.slice('/shot/'.length));
      serveFile(res, join(runFolder, `${id}.png`));
      return;
    }
    // The actual screen HTML, for the in-cockpit live preview: /screen/<screenId>
    if (url.startsWith('/screen/')) {
      const id = decodeURIComponent(url.slice('/screen/'.length));
      serveFile(res, join(runFolder, `${id}.html`));
      return;
    }
    // The finished offline bundle, so "Open the app" works in the same tab: /app/<path>
    if (url === '/app' || url.startsWith('/app/')) {
      const rel = url === '/app' || url === '/app/' ? 'index.html' : url.slice('/app/'.length);
      serveFile(res, join(runFolder, 'out', decodeURIComponent(rel)));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        server,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function serveFile(res: import('node:http').ServerResponse, path: string): void {
  if (!existsSync(path)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(path));
}

function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    const cmd = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    /* headless - the URL was printed */
  }
}

export interface StudioOptions {
  noOpen?: boolean;
  /** How long to keep serving AFTER the weave is done, so the developer can explore (default 30 min). */
  keepAliveSeconds?: number;
  /** Which brain interprets natural-language intents: 'mechanical' (default) or 'agent' (file bus). */
  brain?: 'mechanical' | 'agent';
}

/** One studio holds a project at a time - a lock file in the run folder records the live one. */
const STUDIO_LOCK = '.studio.lock';
interface StudioLock {
  pid: number;
  url: string;
  startedAt: number;
}

function readStudioLock(runFolder: string): StudioLock | null {
  try {
    return JSON.parse(readFileSync(join(runFolder, STUDIO_LOCK), 'utf8')) as StudioLock;
  } catch {
    return null;
  }
}

/** Is a process still running? `kill(pid, 0)` probes without signalling; EPERM means "alive, not ours". */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/** Wire everything: discover inputs, init the run, serve the studio, drive the weave to completion. */
export async function startStudio(
  runFolder: string,
  inputDir: string,
  provider: UIProvider,
  opts: StudioOptions = {},
): Promise<{ url: string }> {
  mkdirSync(runFolder, { recursive: true });
  try {
    readManifest(runFolder);
  } catch {
    writeManifest(runFolder, emptyManifest());
  }

  // ONE studio per project: if a live studio already holds this run folder, send the developer
  // there instead of starting a rival session that would fight over the same manifest/memory.
  const held = readStudioLock(runFolder);
  if (held && held.pid !== process.pid && pidAlive(held.pid)) {
    throw new Error(
      `A Loomis studio for this project is already live at ${held.url} - only one studio per project. Open that one, or stop it first.`,
    );
  }

  const inputs = discoverInputs(inputDir);
  const designMd = readFileSync(inputs.designMd, 'utf8');
  const experienceMd = readFileSync(inputs.experienceMd, 'utf8');

  const brain = opts.brain === 'agent' ? new BridgeBrain(runFolder, () => Date.now()) : new MechanicalBrain();
  const session = new StudioSession(runFolder, provider, designMd, experienceMd, 'your app', brain);
  const { url, close } = await createStudioServer(session, runFolder);
  writeFileSync(join(runFolder, STUDIO_LOCK), JSON.stringify({ pid: process.pid, url, startedAt: Date.now() }));
  progress(`Studio live → ${url}  (open in any browser)`);
  if (!opts.noOpen) openBrowser(url);

  try {
    await session.run(); // resolves when the weave is done (or errors into the 'error' phase)
    // Keep serving after completion so the developer can open the finished app + review board.
    await new Promise<void>((r) => setTimeout(r, (opts.keepAliveSeconds ?? 1800) * 1000));
  } finally {
    await close();
    try {
      rmSync(join(runFolder, STUDIO_LOCK), { force: true }); // release the project for the next session
    } catch {
      /* best-effort lock cleanup */
    }
  }
  return { url };
}

/** The interactive studio page - a Loomis-designed workbench (dark/light), wired to the live weave. */
function studioHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Loomis Studio</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='7'%20fill='%231c1b1d'/%3E%3Cpath%20transform='translate(4,4)'%20fill='%23a855f7'%20d='M13%2013v8h8v-8h-8zM3%2021h8v-8H3v8zM3%203v8h8V3H3zm13.66-1.31L11%207.34%2016.66%2013l5.66-5.66-5.66-5.65z'/%3E%3C/svg%3E" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0&display=swap" rel="stylesheet" />
<script>
  // Decide the theme BEFORE first paint (no flash-of-wrong-theme): saved preference, else the
  // system's color scheme. The manual toggle below persists an override that wins over the system.
  (function(){ var t=null; try{ t=localStorage.getItem("loomis-theme"); }catch(e){}
    if(!t){ try{ t=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark"; }catch(e){ t="dark"; } }
    if(t==="light"){ document.documentElement.classList.add("light"); } })();
</script>
<style>
  :root {
    --bg:#0e0e10; --canvas:#131315; --sidebar:#161519; --header:rgba(19,19,21,.82);
    --panel:#1c1b1d; --panel2:#201f22; --elevated:#2a2a2c;
    --border:#262529; --border2:#353437;
    --text:#e8e6ea; --muted:#a3a1ad; --faint:#6e6d78;
    --accent:#6366f1; --accent2:#8083ff; --accent-text:#b9bbff; --accent-soft:rgba(99,102,241,.14);
    --violet:#a855f7; --on-accent:#fff; --shadow:0 20px 40px -12px rgba(0,0,0,.55);
    color-scheme: dark;
  }
  html.light {
    --bg:#ececf1; --canvas:#f8f8fc; --sidebar:#ffffff; --header:rgba(255,255,255,.85);
    --panel:#ffffff; --panel2:#f4f4f8; --elevated:#ffffff;
    --border:#e7e7ee; --border2:#dadae3;
    --text:#1b1b1f; --muted:#5b5a64; --faint:#8d8c98;
    --accent:#5b5ef0; --accent2:#4f46e5; --accent-text:#4f46e5; --accent-soft:rgba(91,94,240,.10);
    --violet:#7c3aed; --on-accent:#fff; --shadow:0 16px 32px -14px rgba(40,40,80,.22);
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  .material-symbols-outlined { font-family: 'Material Symbols Outlined'; line-height: 1; display: inline-block;
    vertical-align: middle; -webkit-font-smoothing: antialiased; font-size: 20px; }
  .side .nav .material-symbols-outlined, .iconbtn .material-symbols-outlined { font-size: 19px; }
  .stepper .sep.material-symbols-outlined { font-size: 16px; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased;
         font: 14px/1.5 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  .hdr { height: 56px; flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 16px;
         background: var(--header); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border2); z-index: 30; }
  .brand { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 16px; letter-spacing: -.01em; width: 232px; flex: none; }
  .brand .logo { color: var(--violet); font-size: 22px; flex: none; font-variation-settings: 'FILL' 1; }
  .brand .wm { font-weight: 700; }
  .brand .wm .sub { color: var(--muted); font-weight: 500; margin-left: 5px; }
  .stepper { display: flex; align-items: center; gap: 9px; font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; }
  .stepper .st { color: var(--faint); }
  .stepper .st.done { color: var(--muted); }
  .stepper .st.active { color: var(--accent-text); border-bottom: 2px solid var(--accent); padding-bottom: 2px; }
  .stepper .sep { color: var(--faint); }
  .hactions { display: flex; align-items: center; gap: 9px; }
  .iconbtn { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border2);
             background: transparent; color: var(--muted); cursor: pointer; font-size: 15px; }
  .iconbtn:hover { color: var(--text); background: var(--panel2); }
  .badge2 { font: 600 11px/1 'Inter', sans-serif; color: var(--muted); background: var(--panel2);
            border: 1px solid var(--border2); border-radius: 6px; padding: 6px 9px; }
  .btn { font: 600 13px/1 inherit; border: 0; border-radius: 8px; padding: 9px 16px; cursor: pointer;
         background: var(--accent); color: var(--on-accent); box-shadow: 0 0 14px var(--accent-soft); display: inline-flex; align-items: center; gap: 6px; }
  .btn:hover { filter: brightness(1.06); box-shadow: 0 0 22px var(--accent-soft); }
  .btn.ghost { background: transparent; color: var(--muted); border: 1px solid var(--border2); box-shadow: none; }
  .btn.ghost:hover { color: var(--text); }
  .btn.sm { padding: 6px 11px; font-size: 12px; }
  a.linkbtn { text-decoration: none; }
  .main { flex: 1; display: flex; overflow: hidden; }
  .side { width: 232px; flex: none; border-right: 1px solid var(--border2); background: var(--sidebar); padding: 16px 0; display: flex; flex-direction: column; }
  .side .proj { display: flex; align-items: center; gap: 10px; padding: 0 16px 16px; }
  .side .pic { width: 32px; height: 32px; border-radius: 8px; flex: none; background: linear-gradient(135deg, var(--accent), var(--violet)); }
  .side .pname { font-weight: 600; font-size: 13px; text-transform: capitalize; }
  .side .psub { font-size: 12px; color: var(--muted); }
  .side .newbtn { margin: 0 16px 16px; padding: 8px; border-radius: 8px; border: 1px solid var(--border2);
                  background: var(--panel2); color: var(--muted); font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px; }
  .side .nav { display: flex; flex-direction: column; }
  .side .nav .item { display: flex; align-items: center; gap: 10px; padding: 9px 16px; color: var(--muted); font-size: 13px; border-left: 2px solid transparent; cursor: pointer; text-transform: capitalize; }
  .side .nav .item:hover { color: var(--text); background: var(--panel2); }
  .sidelabel { font: 600 11px/1 'Inter', sans-serif; color: var(--faint); text-transform: uppercase; letter-spacing: .08em; padding: 6px 16px 10px; }
  .side .nav .item.active { color: var(--accent-text); background: var(--accent-soft); border-left-color: var(--accent); }
  .canvas { flex: 1; overflow-y: auto; padding: 28px 32px 130px; }
  .canvas::-webkit-scrollbar { width: 9px; }
  .canvas::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 5px; }
  .cwrap { max-width: 1240px; margin: 0 auto; }
  .chead { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 1px solid var(--border2); padding-bottom: 14px; margin-bottom: 26px; gap: 20px; }
  .chead h1 { margin: 0 0 4px; font-size: 32px; font-weight: 700; letter-spacing: -.03em; }
  .chead p { margin: 0; color: var(--muted); max-width: 580px; }
  .wbadge { display: none; align-items: center; gap: 6px; color: var(--accent-text); background: var(--accent-soft);
            border: 1px solid var(--accent-soft); padding: 6px 11px; border-radius: 8px; font: 600 11px/1 'Inter', sans-serif;
            letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; flex: none; }
  .wbadge.show { display: flex; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px,1fr)); gap: 26px; }
  .scard { display: flex; flex-direction: column; gap: 10px; cursor: pointer; }
  .scard .frame { position: relative; border-radius: 12px; overflow: hidden; border: 1px solid var(--border2);
                  background: var(--panel); aspect-ratio: 9/16; transition: border-color .2s, box-shadow .2s; }
  .scard.sel .frame { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 0 26px var(--accent-soft); }
  .scard .frame img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  .scard .frame iframe.thumb { position: absolute; top: 0; left: 0; border: 0; transform-origin: top left; pointer-events: none; background: transparent; }
  .scard .ph { width: 100%; height: 100%; display: grid; place-items: center; color: var(--faint); font-size: 13px; }
  .scard .ovl { position: absolute; inset: 0; background: rgba(0,0,0,.34); opacity: 0; display: flex; align-items: center; justify-content: center; gap: 10px; transition: opacity .2s; }
  .scard .frame:hover .ovl { opacity: 1; }
  .scard .ovl .pv { background: var(--elevated); border: 1px solid var(--border2); color: var(--text); border-radius: 999px; padding: 8px 14px; cursor: pointer; font-size: 12px; }
  .weaving::after { content: ''; position: absolute; inset: -1px; border-radius: 13px; padding: 1px; z-index: 2; pointer-events: none;
    background: linear-gradient(90deg, var(--accent2), var(--violet), var(--accent2)); background-size: 200% auto;
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; animation: pan 2s linear infinite; }
  @keyframes pan { to { background-position: 200% 50%; } }
  .rbadge { position: absolute; top: 8px; right: 8px; z-index: 3; display: flex; align-items: center; gap: 6px;
            font: 600 11px/1 'Inter', sans-serif; color: var(--accent-text); background: var(--bg); border: 1px solid var(--accent); border-radius: 999px; padding: 4px 9px; }
  .rbadge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: ping 1.1s infinite; }
  @keyframes ping { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
  .smeta { display: flex; gap: 9px; align-items: flex-start; }
  .smeta .ic { color: var(--violet); flex: none; font-size: 16px; margin-top: 1px; }
  .smeta h3 { margin: 0 0 2px; font-size: 15px; font-weight: 600; text-transform: capitalize; }
  .smeta .reason { color: var(--muted); font-size: 12.5px; line-height: 1.5; }
  .smeta .opts { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
  .pcard { background: var(--panel); border: 1px solid var(--border2); border-radius: 12px; padding: 16px; }
  .pcard h3 { margin: 0 0 4px; font-size: 15px; text-transform: capitalize; }
  .tag { font: 500 11px/1 'Inter', sans-serif; color: var(--muted); background: var(--panel2); border: 1px solid var(--border2); border-radius: 5px; padding: 4px 7px; display: inline-block; }
  .muted { color: var(--muted); font-size: 13px; }
  .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap: 10px; margin: 4px 0 18px; }
  .sw { display: flex; align-items: center; gap: 10px; }
  .sw .chip { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border2); flex: none; }
  .sw code { font: 500 11px/1 'Inter', sans-serif; color: var(--muted); }
  .swedit { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  .swedit input[type=color] { width: 30px; height: 30px; border: 1px solid var(--border2); border-radius: 8px; background: transparent; padding: 0; cursor: pointer; flex: none; }
  .swedit code { font: 500 11px/1 'Inter', sans-serif; color: var(--muted); }
  .cmd { position: fixed; bottom: 26px; left: calc(50% + 116px); transform: translateX(-50%); width: min(620px, 64vw); z-index: 40; display: none; }
  .cmd.show { display: block; }
  .cmd .pill { display: flex; align-items: center; gap: 10px; background: var(--panel); border: 1px solid var(--border2); border-radius: 999px; padding: 12px 18px; box-shadow: var(--shadow); }
  .cmd .pill:focus-within { border-color: var(--accent); box-shadow: var(--shadow), 0 0 0 3px var(--accent-soft); }
  .cmd .ic { color: var(--violet); flex: none; }
  .cmd input { flex: 1; background: transparent; border: 0; outline: 0; color: var(--text); font: inherit; font-size: 14px; }
  .cmd .kbd { font: 600 10px/1 'Inter', sans-serif; color: var(--muted); border: 1px solid var(--border2); border-radius: 4px; padding: 4px 6px; }
  .err { background: rgba(220,80,70,.10); border: 1px solid #b9433a; color: #ffb4ab; padding: 14px 16px; border-radius: 10px; }
  .spin { display: inline-block; width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--border2);
          border-top-color: var(--accent); animation: rot .8s linear infinite; vertical-align: middle; margin-right: 8px; }
  @keyframes rot { to { transform: rotate(360deg) } }
  .lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.72); z-index: 100; align-items: center; justify-content: center; padding: 28px; }
  .lightbox.show { display: flex; }
  .lbcard { background: var(--canvas); border: 1px solid var(--border2); border-radius: 14px; width: min(1100px,96vw); height: 92vh; display: flex; flex-direction: column; overflow: hidden; }
  .lbbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border2); font-weight: 600; text-transform: capitalize; }
  .lbframe { flex: 1; width: 100%; border: 0; background: #fff; }
</style>
</head>
<body>
  <div class="app">
    <header class="hdr">
      <div class="brand"><span class="material-symbols-outlined logo">widgets</span><span class="wm">Loomis<span class="sub">Studio</span></span></div>
      <div class="stepper" id="stepper"></div>
      <div class="hactions">
        <span class="badge2" id="brainbadge"></span>
        <button class="iconbtn" id="themebtn" title="Toggle light / dark" onclick="toggleTheme()"></button>
        <span id="primary"></span>
      </div>
    </header>
    <div class="main">
      <aside class="side">
        <div class="proj"><div class="pic"></div><div><div class="pname" id="projname">Loomis</div><div class="psub">Active weaving</div></div></div>
        <div class="sidelabel">Screens</div>
        <div class="nav" id="sidenav"></div>
      </aside>
      <main class="canvas">
        <div class="cwrap">
          <div class="chead">
            <div><h1 id="ctitle">Loomis Studio</h1><p id="csub"></p></div>
            <div class="wbadge" id="wbadge"><span class="material-symbols-outlined" style="font-size:14px">auto_awesome</span> <span id="wbadget"></span></div>
          </div>
          <div id="body"></div>
        </div>
      </main>
    </div>
  </div>
  <div class="cmd" id="cmd">
    <div class="pill"><span class="material-symbols-outlined ic">auto_awesome</span><input id="cmdin" placeholder="Ask the AI to change anything…" autocomplete="off" /><span class="kbd">&#8984;K</span></div>
  </div>
  <div id="lightbox" class="lightbox" onclick="if(event.target.id==='lightbox')closePreview()">
    <div class="lbcard"><div class="lbbar"><span id="lbtitle"></span><button class="btn ghost sm" onclick="closePreview()">Close &#10005;</button></div><iframe id="lbframe" class="lbframe" title="screen preview"></iframe></div>
  </div>
<script>
  function applyTheme(t){ document.documentElement.classList.toggle("light", t==="light");
    var b=document.getElementById("themebtn"); if(b) b.innerHTML = "<span class='material-symbols-outlined'>" + (t==="light"?"light_mode":"dark_mode") + "</span>"; }
  function toggleTheme(){ var t = document.documentElement.classList.contains("light") ? "dark" : "light";
    try { localStorage.setItem("loomis-theme", t); } catch(e){} applyTheme(t); }
  (function(){ var t=null; try { t = localStorage.getItem("loomis-theme"); } catch(e){}
    if(!t){ try { t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark"; } catch(e){ t="dark"; } }
    applyTheme(t);
    // Follow the system live - but only until the developer makes a manual choice (which persists).
    try { var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onSys = function(e){ var saved=null; try{ saved=localStorage.getItem("loomis-theme"); }catch(_){} if(!saved) applyTheme(e.matches?"dark":"light"); };
      if (mq.addEventListener) mq.addEventListener("change", onSys); else if (mq.addListener) mq.addListener(onSys);
    } catch(e){} })();

  var STEPS = [["plan","Planning"],["design","Theme"],["generate","Generating"],["review","Reviewing"],["done","Done"]];
  var ORDER = { plan:0, design:1, generate:2, review:3, assembling:3, done:4, error:4 };
  var TITLES = { plan:"Plan your prototype", design:"Confirm your theme", generate:"Weaving screens", review:"Refine screens", assembling:"Assembling", done:"Your app is woven", error:"Something went wrong" };
  var lastSig = "", selectedId = null, names = {}, lastState = null, pending = {}, pendingRev = {};
  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }
  function act(o){ fetch("/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(o)}); }

  function shotInner(sc){
    if (!sc.hasShot) return "<div class='ph'>" + (sc.status==="cooking"?"weaving…":"queued") + "</div>";
    var q = "?v=" + sc.rev, id = encodeURIComponent(sc.screenId), alt = esc(sc.surface||sc.screenId);
    // Stitch's screenshot is a tiny thumbnail that blurs when upscaled. Show it instantly (cached,
    // no flash) but layer a crisp, scaled LIVE-HTML preview on top - the same source the lightbox uses.
    return "<img src='/shot/" + id + q + "' alt='" + alt + "'/>" +
      "<iframe class='thumb' src='/screen/" + id + q + "' scrolling='no' tabindex='-1' aria-hidden='true'></iframe>";
  }
  // Scale each live-preview iframe (rendered at a mobile base width) to fill its responsive frame.
  function fitThumbs(){
    var BASE = 390, frs = document.querySelectorAll(".scard .frame");
    for (var i=0;i<frs.length;i++){
      var f = frs[i], ifr = f.querySelector("iframe.thumb"); if(!ifr) continue;
      var w = f.clientWidth; if(!w) continue;
      var s = w / BASE;
      ifr.style.width = BASE + "px"; ifr.style.height = (f.clientHeight / s) + "px"; ifr.style.transform = "scale(" + s + ")";
    }
  }
  function openPreview(id, title){ document.getElementById("lbtitle").textContent = title || id;
    document.getElementById("lbframe").src = "/screen/" + encodeURIComponent(id) + "?t=" + Date.now();
    document.getElementById("lightbox").classList.add("show"); }
  function closePreview(){ document.getElementById("lightbox").classList.remove("show"); document.getElementById("lbframe").src = "about:blank"; }
  function applyColors(){
    var ins = document.querySelectorAll("input[type=color][data-token]");
    var edits = []; for (var i=0;i<ins.length;i++){ edits.push({ token: ins[i].getAttribute("data-token"), value: ins[i].value }); }
    if (edits.length) act({ type:"adjust-theme", edits: edits });
  }
  function editCard(id){ selectCard(id); var i=document.getElementById("cmdin"); if(i){ i.focus(); i.scrollIntoView({block:"nearest"}); } }
  function selectCard(id){ selectedId = id;
    var cards = document.querySelectorAll(".scard"); for (var i=0;i<cards.length;i++) cards[i].classList.toggle("sel", cards[i].getAttribute("data-id")===id);
    var navs = document.querySelectorAll(".side .nav .item"); for (var j=0;j<navs.length;j++) navs[j].classList.toggle("active", navs[j].getAttribute("data-id")===id);
    var inp = document.getElementById("cmdin"); if (inp) inp.placeholder = "Ask Loomis to change " + (names[id]||id) + "…"; }
  function renderSidenav(s){
    var items = (s.screens && s.screens.length) ? s.screens.map(function(x){ return { id:x.screenId, name:x.surface||x.screenId, done:x.status==="done", busy:x.busy }; })
              : (s.app.surfaces||[]).map(function(p){ return { id:p.screenId, name:p.surface, done:false, busy:false }; });
    document.getElementById("sidenav").innerHTML = items.map(function(it){
      var ico = it.busy ? "progress_activity" : (it.done ? "check_circle" : "crop_square");
      return "<div class='item" + (it.id===selectedId?" active":"") + "' data-id='" + it.id + "' onclick=\\"selectCard('" + it.id + "')\\"><span class='material-symbols-outlined' style='font-size:18px'>" + ico + "</span> " + esc(it.name) + "</div>";
    }).join("");
  }

  function screenCard(sc, review){
    var name = sc.surface || sc.screenId;
    var refining = sc.busy || pending[sc.screenId];
    var weav = (refining || sc.status==="cooking") ? " weaving" : "";
    var rbadge = refining ? "<div class='rbadge'><span class='dot'></span>Refining…</div>"
               : sc.status==="cooking" ? "<div class='rbadge'><span class='dot'></span>Weaving…</div>" : "";
    var nm = esc(name).replace(/'/g,'');
    var ovl = "<div class='ovl'>" +
      (sc.hasShot ? "<button class='pv' title='Preview' onclick=\\"event.stopPropagation();openPreview('" + sc.screenId + "','" + nm + "')\\"><span class='material-symbols-outlined' style='font-size:18px'>visibility</span></button>" : "") +
      "<button class='pv' title='Ask AI to change this screen' onclick=\\"event.stopPropagation();editCard('" + sc.screenId + "')\\"><span class='material-symbols-outlined' style='font-size:18px'>auto_awesome</span></button>" +
      "</div>";
    var promote = (review && sc.suggestions && sc.suggestions.length)
      ? "<div class='opts'>" + sc.suggestions.map(function(n){ return "<button class='btn ghost sm' onclick=\\"event.stopPropagation();act({type:'promote',screenId:'" + sc.screenId + "',option:" + n + "})\\">Use option " + n + "</button>"; }).join("") + "</div>" : "";
    var reason = sc.note ? esc(sc.note) : (review ? "Ready to refine - select it, then use the command bar below." : (sc.status==="done" ? "Delivered." : ""));
    return "<div class='scard" + (sc.screenId===selectedId?" sel":"") + "' data-id='" + sc.screenId + "' onclick=\\"selectCard('" + sc.screenId + "')\\">" +
      "<div class='frame" + weav + "'>" + rbadge + shotInner(sc) + ovl + "</div>" +
      "<div class='smeta'><span class='material-symbols-outlined ic'>psychology</span><div><h3>" + esc(name) + "</h3><p class='reason'>" + reason + "</p>" + promote + "</div></div></div>";
  }

  function renderChrome(s){
    var cur = ORDER[s.phase] != null ? ORDER[s.phase] : 0;
    document.getElementById("stepper").innerHTML = STEPS.map(function(st,i){
      var cls = i < cur ? "done" : (i === cur ? "active" : "");
      return "<span class='st " + cls + "'>" + st[1] + "</span>" + (i < STEPS.length-1 ? "<span class='sep material-symbols-outlined'>chevron_right</span>" : "");
    }).join("");
    document.getElementById("brainbadge").textContent = "brain: " + (s.brain || "mechanical");
    var nm = (s.app && s.app.name && s.app.name !== "your app") ? s.app.name : "Loomis";
    document.getElementById("projname").textContent = nm;
    document.title = (nm !== "Loomis" ? nm + " - " : "") + "Loomis Studio";

    var p = "";
    if (s.awaiting === "start") p = "<button class='btn' onclick=\\"act({type:'start'})\\">Start weaving</button>";
    else if (s.awaiting === "approve-theme") p = "<button class='btn' onclick=\\"act({type:'approve-theme'})\\">Confirm theme &#8594;</button>";
    else if (s.awaiting === "finish") p = "<button class='btn' onclick=\\"act({type:'finish'})\\">Finish &amp; assemble &#8594;</button>";
    else if (s.phase === "done") p = "<a class='linkbtn' href='/app/index.html' target='_blank'><span class='btn'>Ship <span class='material-symbols-outlined' style='font-size:17px'>rocket_launch</span></span></a>";
    document.getElementById("primary").innerHTML = p;

    document.getElementById("cmd").classList.toggle("show", s.phase === "review");
    var wb = document.getElementById("wbadge");
    if (s.phase === "review" || s.phase === "done") { wb.classList.add("show"); document.getElementById("wbadget").textContent = "AI weaving complete"; }
    else if (s.phase === "generate") { wb.classList.add("show"); document.getElementById("wbadget").textContent = "Weaving…"; }
    else wb.classList.remove("show");
    renderSidenav(s);
  }

  function renderBody(s){
    var b = document.getElementById("body");
    document.getElementById("ctitle").textContent = TITLES[s.phase] || "Loomis Studio";
    var busy = s.phase==="assembling" || s.phase==="generate" || (s.screens||[]).some(function(x){return x.busy || pending[x.screenId];}) || (s.phase==="design" && !s.theme);
    document.getElementById("csub").innerHTML = (busy ? "<span class='spin'></span>" : "") + esc(s.narration);
    names = {}; (s.screens||[]).forEach(function(x){ names[x.screenId] = x.surface||x.screenId; });

    if (s.phase === "plan") {
      b.innerHTML = "<div class='grid'>" + (s.app.surfaces||[]).map(function(p){
        return "<div class='pcard'><h3>" + esc(p.surface) + "</h3>" + (p.story?"<span class='tag'>"+esc(p.story)+"</span>":"") +
               (p.purpose?"<p class='muted' style='margin:8px 0 0'>"+esc(p.purpose)+"</p>":"") + "</div>";
      }).join("") + "</div>";

    } else if (s.phase === "design") {
      if (!s.theme) { b.innerHTML = "<p class='muted'>Asking Stitch to build the design system…</p>"; return; }
      var ed = s.theme.editable || {};
      var inputs = Object.keys(ed).map(function(k){
        return "<label class='swedit'><input type='color' value='" + ed[k] + "' data-token='" + k + "'/><span><b>" + esc(k) + "</b><br><code>" + esc(ed[k]) + "</code></span></label>";
      }).join("");
      var resolved = Object.keys(s.theme.colors).map(function(k){
        return "<div class='sw'><span class='chip' style='background:"+esc(s.theme.colors[k])+"'></span><span><b>"+esc(k)+"</b><br><code>"+esc(s.theme.colors[k])+"</code></span></div>";
      }).join("");
      b.innerHTML = "<div class='sidelabel' style='padding:0 0 8px'>Your colors - edit any, then apply</div>" +
        "<div class='swatches'>" + inputs + "</div>" +
        "<div class='row' style='margin:2px 0 26px;gap:14px'><button class='btn' onclick=\\"applyColors()\\"" + (s.themeBusy?" disabled style='opacity:.6'":"") + ">" + (s.themeBusy?"Re-syncing…":"Apply changes & re-sync") + "</button>" +
          "<span class='muted'>" + (s.theme.tone?esc(s.theme.tone)+" · ":"") + esc((s.theme.fonts||[]).join(", ")) + " · " + esc(s.theme.paletteSource) + "</span></div>" +
        "<div class='sidelabel' style='padding:0 0 8px'>Resolved palette (read-only)</div>" +
        "<div class='swatches'>" + resolved + "</div>";

    } else if (s.phase === "generate" || s.phase === "review" || s.phase === "done") {
      var review = s.phase === "review";
      if (review && !selectedId && (s.screens||[]).length) selectedId = s.screens[0].screenId;
      var pre = (s.phase === "done") ? "<div class='row' style='margin:-6px 0 20px;gap:12px;align-items:center'>" +
        "<a class='linkbtn' href='/app/index.html' target='_blank'><span class='btn'>Open prototype <span class='material-symbols-outlined' style='font-size:16px'>open_in_new</span></span></a>" +
        "<button class='btn ghost' onclick=\\"act({type:'rework'})\\">Refine more</button>" +
        "<a class='linkbtn' href='/app/_board/index.html' target='_blank' style='color:var(--accent-text);text-decoration:none'>Review board &#8599;</a></div>" : "";
      b.innerHTML = pre + "<div class='grid'>" + (s.screens||[]).map(function(sc){ return screenCard(sc, review); }).join("") + "</div>";
      if (review && selectedId) selectCard(selectedId);

    } else if (s.phase === "assembling") {
      b.innerHTML = "<p class='muted'>Wiring navigation, vendoring assets for offline, verifying links…</p>";
    } else if (s.phase === "error") {
      b.innerHTML = "<div class='err'><b>The weave hit an error:</b><br>" + esc(s.error) + "</div>";
    }
    fitThumbs();
  }

  document.getElementById("cmdin").addEventListener("keydown", function(e){
    if (e.key === "Enter" && this.value.trim() && selectedId) {
      var txt = this.value.trim();
      act({ type:"intent", screenId:selectedId, text:txt });
      this.value = "";
      // Optimistic feedback - the developer must SEE it registered NOW, not wonder through a
      // 30–90s Stitch edit. Flag the card busy + announce it before the poll/provider catch up.
      var cur = lastState && (lastState.screens||[]).filter(function(x){ return x.screenId===selectedId; })[0];
      pendingRev[selectedId] = cur ? cur.rev : 0;
      pending[selectedId] = true;
      var sub = document.getElementById("csub");
      if (sub) sub.innerHTML = "<span class='spin'></span> Loomis is working on " + esc(names[selectedId]||selectedId) + " - \\"" + esc(txt) + "\\"…";
      if (lastState) renderBody(lastState);
    }
  });
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape") closePreview();
    if ((e.metaKey||e.ctrlKey) && (e.key==="k"||e.key==="K")) { var i=document.getElementById("cmdin");
      if (i && document.getElementById("cmd").classList.contains("show")) { e.preventDefault(); i.focus(); } }
  });

  window.addEventListener("resize", fitThumbs);

  function tick(){
    fetch("/state",{cache:"no-store"}).then(function(r){ return r.json(); }).then(function(s){
      lastState = s;
      // A refine landed once its rev advances past where it sat at submit - drop the optimistic flag.
      (s.screens||[]).forEach(function(x){ if (pending[x.screenId] && x.rev > (pendingRev[x.screenId]||0)) delete pending[x.screenId]; });
      renderChrome(s);
      var sig = JSON.stringify([s.phase, s.theme && [s.theme.paletteSource, Object.values(s.theme.editable||{}).join(",")], s.themeBusy, s.awaiting, s.error, (s.screens||[]).map(function(x){ return [x.status,x.rev,x.busy,(x.suggestions||[]).length,(x.refinements||[]).length, pending[x.screenId]?1:0]; })]);
      // Repaint whenever anything changed. The command bar is a separate floating element, so
      // re-rendering the card grid never disrupts the developer's in-progress typing - gating this
      // on "not typing" only ever HID refine results (the cursor sits in the bar right after Enter).
      if (sig !== lastSig) { lastSig = sig; renderBody(s); }
      setTimeout(tick, 1000);
    }).catch(function(){ setTimeout(tick, 1500); });
  }
  tick();
</script>
</body>
</html>
`;
}
