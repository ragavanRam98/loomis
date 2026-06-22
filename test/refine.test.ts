import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManifest } from '../src/manifest';
import { FakeProvider } from '../src/provider/fake';
import { refineScreen, pendingRefinements } from '../src/refine';
import { RUN_LOG_FILE } from '../src/log';

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), 'loomis-refine-'));
  writeFileSync(
    join(dir, 'task-detail.html'),
    '<!doctype html><html><body><main>task-detail</main></body></html>',
    'utf8',
  );
  writeManifest(dir, {
    projectId: 'p1',
    entry: ['task-detail'],
    edges: [],
    unresolved: [],
    screens: [
      {
        screenId: 'task-detail',
        surface: 'task detail',
        story: '2-3',
        status: 'done',
        providerScreen: 'ps-1',
        htmlPath: 'task-detail.html',
      },
    ],
  });
  return dir;
}

describe('refineScreen (directed edit + provenance)', () => {
  it('applies feedback to the live bytes, records it, and preserves the prior take', async () => {
    const dir = setup();
    try {
      const provider = new FakeProvider();
      const rec = await refineScreen(dir, provider, 'task-detail', 'lighter theme, smaller header');

      // the feedback actually landed in the screen (directed edit, not a blind re-roll)
      expect(readFileSync(join(dir, 'task-detail.html'), 'utf8')).toContain('lighter theme, smaller header');
      expect(provider.calls.editScreen).toBe(1);
      expect(provider.calls.generateScreen).toBe(0);

      // recorded as provenance
      expect(rec.refinements).toEqual(['lighter theme, smaller header']);

      // prior take preserved (non-destructive - Stitch has no delete)
      expect(existsSync(join(dir, 'task-detail.pre-refine1.html'))).toBe(true);

      // logged
      expect(readFileSync(join(dir, RUN_LOG_FILE), 'utf8')).toContain('"event":"refine"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accumulates multiple refinements in order, versioning each prior take', async () => {
    const dir = setup();
    try {
      const provider = new FakeProvider();
      await refineScreen(dir, provider, 'task-detail', 'first change');
      const rec = await refineScreen(dir, provider, 'task-detail', 'second change');
      expect(rec.refinements).toEqual(['first change', 'second change']);
      expect(existsSync(join(dir, 'task-detail.pre-refine1.html'))).toBe(true);
      expect(existsSync(join(dir, 'task-detail.pre-refine2.html'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a screen that has not been generated yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-refine-'));
    try {
      writeManifest(dir, {
        projectId: 'p1',
        entry: [],
        edges: [],
        unresolved: [],
        screens: [{ screenId: 'x', status: 'pending' }],
      });
      await expect(refineScreen(dir, new FakeProvider(), 'x', 'do something')).rejects.toMatchObject({
        code: 'NOT_GENERATED',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses empty feedback', async () => {
    const dir = setup();
    try {
      await expect(refineScreen(dir, new FakeProvider(), 'task-detail', '   ')).rejects.toMatchObject({
        code: 'EMPTY_FEEDBACK',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pendingRefinements surfaces only edited screens (the fold-into-spec nudge)', async () => {
    const dir = setup();
    try {
      expect(pendingRefinements(dir)).toEqual([]);
      await refineScreen(dir, new FakeProvider(), 'task-detail', 'tweak');
      const pending = pendingRefinements(dir);
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        screenId: 'task-detail',
        surface: 'task detail',
        story: '2-3',
        refinements: ['tweak'],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
