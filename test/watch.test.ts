import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManifest } from '../src/manifest';
import { appendLog } from '../src/log';
import { readState, progressHtml, createWatchServer } from '../src/watch';
import type { Manifest } from '../src/types';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-watch-'));
}

const clock = (): string => '2026-06-18T00:00:00.000Z';

describe('readState (live weave state from disk)', () => {
  it('counts each status, derives the phase, and is not complete mid-weave', () => {
    const dir = tmp();
    try {
      const m: Manifest = {
        entry: ['login'],
        edges: [],
        unresolved: [],
        screens: [
          { screenId: 'login', surface: 'login', status: 'done' },
          { screenId: 'dashboard', surface: 'dashboard', status: 'in-flight' },
          { screenId: 'settings', surface: 'settings', status: 'pending' },
        ],
      };
      writeManifest(dir, m);
      appendLog(dir, { event: 'enumerate' }, clock);
      appendLog(dir, { event: 'screen-start', screenId: 'dashboard' }, clock);

      const st = readState(dir);
      expect(st.total).toBe(3);
      expect(st.done).toBe(1);
      expect(st.inFlight).toBe(1);
      expect(st.pending).toBe(1);
      expect(st.failed).toBe(0);
      expect(st.phase).toBe('Generating screens');
      expect(st.complete).toBe(false);
      expect(st.events.at(-1)).toMatchObject({ event: 'screen-start', screenId: 'dashboard' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports complete only once all screens are terminal AND the bundle is assembled', () => {
    const dir = tmp();
    try {
      writeManifest(dir, {
        entry: ['a'],
        edges: [],
        unresolved: [],
        screens: [
          { screenId: 'a', status: 'done' },
          { screenId: 'b', status: 'failed' },
        ],
      });
      // All terminal, but no assemble/board/check yet -> not complete.
      expect(readState(dir).complete).toBe(false);
      appendLog(dir, { event: 'assemble' }, clock);
      const st = readState(dir);
      expect(st.complete).toBe(true);
      expect(st.failed).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tolerates a missing manifest/log (early start) without throwing', () => {
    const dir = tmp();
    try {
      const st = readState(dir);
      expect(st.total).toBe(0);
      expect(st.complete).toBe(false);
      expect(st.events).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('progressHtml', () => {
  it('is a self-contained page that polls the state endpoint', () => {
    const html = progressHtml();
    expect(html).toContain('Loomis');
    expect(html).toContain('fetch("state"');
    expect(html).not.toMatch(/https?:\/\//); // no external assets - fully local
  });
});

describe('createWatchServer', () => {
  it('serves live JSON state and the HTML page, then closes cleanly', async () => {
    const dir = tmp();
    writeManifest(dir, {
      entry: [],
      edges: [],
      unresolved: [],
      screens: [{ screenId: 'home', status: 'done' }],
    });
    const { url, close } = await createWatchServer(dir);
    try {
      const state = (await (await fetch(`${url}state`)).json()) as { total: number; done: number };
      expect(state.total).toBe(1);
      expect(state.done).toBe(1);

      const page = await (await fetch(url)).text();
      expect(page).toContain('<!doctype html>');
    } finally {
      await close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
