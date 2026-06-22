import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBoard, badgeFor } from '../src/board';
import { syncDesignSystem } from '../src/design-system';
import { batchGenerate } from '../src/batch';
import { writeNavGraph } from '../src/nav-graph';
import { wireRunFolder } from '../src/wire';
import { assembleBundle } from '../src/assemble';
import { generateOneScreen } from '../src/generate';
import { readManifest } from '../src/manifest';
import { checkRunnable } from '../src/runnable';
import { FakeProvider } from '../src/provider/fake';
import type { Manifest } from '../src/types';

const SAMPLE = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Today | App open | a |
| Projects | Today | b |`;

describe('buildBoard (FR-11, pure projection)', () => {
  it('assigns exactly one badge per screen and does not mutate the manifest', () => {
    const m: Manifest = {
      entry: [],
      edges: [],
      unresolved: [],
      screens: [
        { screenId: 'a', status: 'done', htmlPath: 'a.html' },
        { screenId: 'b', status: 'done', htmlPath: 'b.html', omissions: ['missing header'] },
        { screenId: 'c', status: 'failed' },
      ],
    };
    const snapshot = JSON.stringify(m);
    const html = buildBoard(m);

    expect(badgeFor(m.screens[0]!)).toBe('CLEAN');
    expect(badgeFor(m.screens[1]!)).toBe('REVIEW');
    expect(badgeFor(m.screens[2]!)).toBe('FAILED');
    expect(html).toContain('CLEAN');
    expect(html).toContain('REVIEW');
    expect(html).toContain('FAILED');
    expect(JSON.stringify(m)).toBe(snapshot); // no mutation
  });
});

describe('regenerate preserves the page-graph (FR-12, NFR-3)', () => {
  it('regenerating one screen leaves edges + index.html unchanged and stays linkinator-green', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-board-'));
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      await batchGenerate(dir, provider, SAMPLE);
      writeNavGraph(dir, SAMPLE);
      wireRunFolder(dir);
      await assembleBundle(dir, { vendor: false });

      const edgesBefore = JSON.stringify(readManifest(dir).edges);
      const indexBefore = readFileSync(join(dir, 'out', 'index.html'), 'utf8');

      // Targeted regen of one screen, then re-wire + re-assemble (NO graph rebuild).
      await generateOneScreen(dir, provider, { screenId: 'today', surface: 'Today', prompt: 'again' });
      wireRunFolder(dir);
      await assembleBundle(dir, { vendor: false });

      expect(JSON.stringify(readManifest(dir).edges)).toBe(edgesBefore);
      expect(readFileSync(join(dir, 'out', 'index.html'), 'utf8')).toBe(indexBefore);
      const r = await checkRunnable(join(dir, 'out'));
      expect(r.passed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
