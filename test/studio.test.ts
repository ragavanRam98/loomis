import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManifest, emptyManifest } from '../src/manifest';
import { FakeProvider } from '../src/provider/fake';
import { StudioSession } from '../src/studio';

const DESIGN = ['# Demo', 'name: Demo', 'primary: #7C3AED', 'font: Inter', 'tone: clean', ''].join('\n');
const EXP = [
  '# EXPERIENCE',
  '',
  '## Information Architecture',
  '',
  '| Surface | Reached from | Purpose |',
  '|---|---|---|',
  '| Home | App open | the home |',
  '| Detail | Home | a detail |',
  '',
  '## Home',
  'Purpose: home',
  'Story: s1',
  'Layout:',
  '- a header',
  'Nav:',
  '- a row -> Detail',
  '',
  '## Detail',
  'Purpose: detail',
  'Story: s2',
  'Layout:',
  '- a back',
  '',
].join('\n');

function until(pred: () => boolean, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const i = setInterval(() => {
      if (pred()) {
        clearInterval(i);
        resolve();
      } else if (Date.now() - t0 > ms) {
        clearInterval(i);
        reject(new Error('timeout'));
      }
    }, 20);
  });
}

describe('StudioSession (interactive weave orchestration)', () => {
  it('drives plan → theme gate → generate → review(refine) → done', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-studio-'));
    try {
      writeManifest(dir, emptyManifest());
      const provider = new FakeProvider();
      const session = new StudioSession(dir, provider, DESIGN, EXP, 'app');
      const done = session.run();

      // PLAN - the plan is parsed and we wait at the start gate
      await until(() => session.state.awaiting === 'start');
      expect(session.state.app.surfaces.map((s) => s.surface)).toEqual(['Home', 'Detail']);
      session.submit({ type: 'start' });

      // DESIGN - theme resolved, waiting at the theme gate
      await until(() => session.state.awaiting === 'approve-theme');
      expect(session.state.theme).toBeDefined();
      session.submit({ type: 'approve-theme' });

      // GENERATE → REVIEW - every screen generated
      await until(() => session.state.phase === 'review');
      expect(session.state.screens).toHaveLength(2);
      expect(session.state.screens.every((s) => s.status === 'done')).toBe(true);

      // REVIEW - a directed refine is applied in-session
      const first = session.state.screens[0]!.screenId;
      session.submit({ type: 'refine', screenId: first, feedback: 'lighter header' });
      await until(() => session.state.screens[0]!.refinements.length === 1 && !session.state.screens[0]!.busy);
      expect(provider.calls.editScreen).toBe(1);

      // FINISH - assemble + done, with a runnable bundle
      session.submit({ type: 'finish' });
      await done;
      expect(session.state.phase).toBe('done');
      expect(existsSync(join(dir, 'out', 'index.html'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25000);

  it('routes a natural-language intent through the brain into a real edit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-studio-'));
    try {
      writeManifest(dir, emptyManifest());
      const provider = new FakeProvider();
      const session = new StudioSession(dir, provider, DESIGN, EXP, 'app'); // default MechanicalBrain
      const done = session.run();

      await until(() => session.state.awaiting === 'start');
      session.submit({ type: 'start' });
      await until(() => session.state.awaiting === 'approve-theme');
      session.submit({ type: 'approve-theme' });
      await until(() => session.state.phase === 'review');

      const first = session.state.screens[0]!.screenId;
      session.submit({ type: 'intent', screenId: first, text: 'make the header lighter' });
      await until(() => session.state.screens[0]!.refinements.length === 1 && !!session.state.screens[0]!.note);

      expect(provider.calls.editScreen).toBe(1); // the brain chose a directed edit
      expect(session.state.screens[0]!.note).toContain('directed edit');

      session.submit({ type: 'finish' });
      await done;
      expect(session.state.phase).toBe('done');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25000);

  it('resumes a finished project straight to review - no gates, no re-weave', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-studio-'));
    try {
      writeManifest(dir, emptyManifest());
      const provider = new FakeProvider();

      // First studio: full weave to a shipped bundle.
      const s1 = new StudioSession(dir, provider, DESIGN, EXP, 'app');
      const d1 = s1.run();
      await until(() => s1.state.awaiting === 'start');
      s1.submit({ type: 'start' });
      await until(() => s1.state.awaiting === 'approve-theme');
      s1.submit({ type: 'approve-theme' });
      await until(() => s1.state.phase === 'review');
      s1.submit({ type: 'finish' });
      await d1;
      const gens = provider.calls.generateScreen;
      const syncs = provider.calls.syncDesignSystem;
      expect(gens).toBe(2);

      // Second studio on the SAME run folder: should RESUME - land directly on review with the
      // saved screens, an openable prototype, and zero new provider work.
      const s2 = new StudioSession(dir, provider, DESIGN, EXP, 'app');
      const d2 = s2.run();
      await until(() => s2.state.phase === 'review');
      expect(s2.state.resumed).toBe(true);
      expect(s2.state.awaiting).toBe('finish'); // never paused at start/theme
      expect(s2.state.screens).toHaveLength(2);
      expect(s2.state.screens.every((x) => x.status === 'done')).toBe(true);
      expect(s2.state.outReady).toBe(true); // prior bundle is openable immediately
      expect(provider.calls.generateScreen).toBe(gens); // no re-weave
      expect(provider.calls.syncDesignSystem).toBe(syncs); // no re-sync

      s2.submit({ type: 'finish' });
      await d2;
      expect(s2.state.phase).toBe('done');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25000);

  it('routes a natural-language "add a screen" intent into a real new screen (additive)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-studio-'));
    try {
      writeManifest(dir, emptyManifest());
      const provider = new FakeProvider();
      const session = new StudioSession(dir, provider, DESIGN, EXP, 'app');
      const done = session.run();

      await until(() => session.state.awaiting === 'start');
      session.submit({ type: 'start' });
      await until(() => session.state.awaiting === 'approve-theme');
      session.submit({ type: 'approve-theme' });
      await until(() => session.state.phase === 'review');
      expect(session.state.screens).toHaveLength(2);

      const home = session.state.screens[0]!.screenId;
      session.submit({ type: 'intent', screenId: home, text: 'add another screen for the empty state' });
      await until(() => session.state.screens.length === 3);

      const added = session.state.screens.find((s) => /empty/i.test(s.surface || ''));
      expect(added).toBeTruthy();
      expect(added!.status).toBe('done');
      // The two original screens are still present and untouched.
      expect(session.state.screens.filter((s) => s.screenId === home)).toHaveLength(1);

      session.submit({ type: 'finish' });
      await done;
      expect(session.state.phase).toBe('done');
      expect(existsSync(join(dir, 'out', 'index.html'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25000);

  it('ignores review actions before the review phase (no overlap with generation)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-studio-'));
    try {
      writeManifest(dir, emptyManifest());
      const provider = new FakeProvider();
      const session = new StudioSession(dir, provider, DESIGN, EXP, 'app');
      const done = session.run();
      await until(() => session.state.awaiting === 'start');

      // a stray refine before review must be a no-op
      session.submit({ type: 'refine', screenId: 'home', feedback: 'too early' });
      expect(provider.calls.editScreen).toBe(0);

      session.submit({ type: 'start' });
      await until(() => session.state.awaiting === 'approve-theme');
      session.submit({ type: 'approve-theme' });
      await until(() => session.state.phase === 'review');
      session.submit({ type: 'finish' });
      await done;
      expect(session.state.phase).toBe('done');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25000);
});
