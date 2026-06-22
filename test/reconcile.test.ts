import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManifest, readManifest } from '../src/manifest';
import { parseSurfaceSpec } from '../src/experience';
import { compileScreen } from '../src/compile';
import { reconcileSpec } from '../src/reconcile';

const EXPERIENCE = [
  '# EXPERIENCE',
  '',
  '## Task Detail',
  'Purpose: show one task',
  'Layout:',
  '- header',
  '- body',
  '',
  '## Settings',
  'Purpose: settings',
  '',
].join('\n');

function setup(refinements: string[]): { dir: string; md: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loomis-reconcile-'));
  const md = join(dir, 'EXPERIENCE.md');
  writeFileSync(md, EXPERIENCE, 'utf8');
  writeManifest(dir, {
    projectId: 'p1',
    entry: [],
    edges: [],
    unresolved: [],
    screens: [{ screenId: 'task-detail', surface: 'Task Detail', story: '2-3', status: 'done', refinements }],
  });
  return { dir, md };
}

describe('reconcileSpec (fold refinements back into the spec)', () => {
  it('writes refinements under the surface, clears the manifest copy, and re-weave reproduces them', () => {
    const { dir, md } = setup(['lighter theme, smaller header']);
    try {
      const { folded } = reconcileSpec(dir, md);
      expect(folded).toEqual([
        { screenId: 'task-detail', surface: 'Task Detail', refinements: ['lighter theme, smaller header'] },
      ]);

      const updated = readFileSync(md, 'utf8');
      expect(parseSurfaceSpec(updated, 'Task Detail').refinements).toContain('lighter theme, smaller header');
      // didn't bleed into the next surface
      expect(parseSurfaceSpec(updated, 'Settings').refinements).toEqual([]);

      // manifest copy cleared - the nudge goes quiet
      expect(readManifest(dir).screens[0]!.refinements).toBeUndefined();

      // a clean re-weave would now carry the adjustment in the prompt
      const prompt = compileScreen(updated, 'Task Detail').prompt;
      expect(prompt).toContain('REFINEMENTS');
      expect(prompt).toContain('lighter theme, smaller header');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent - re-running adds nothing and reports nothing pending', () => {
    const { dir, md } = setup(['rounder corners']);
    try {
      reconcileSpec(dir, md);
      const after1 = readFileSync(md, 'utf8');
      const second = reconcileSpec(dir, md);
      expect(second.folded).toEqual([]); // manifest already cleared
      expect(readFileSync(md, 'utf8')).toEqual(after1); // no duplicate block
      expect(parseSurfaceSpec(after1, 'Task Detail').refinements).toEqual(['rounder corners']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges into an existing Refinements block without duplicating it', () => {
    const { dir, md } = setup(['second tweak']);
    try {
      // seed an existing refinement inside the Task Detail section
      const seeded = readFileSync(md, 'utf8').replace('## Settings', 'Refinements:\n- first tweak\n\n## Settings');
      writeFileSync(md, seeded, 'utf8');
      reconcileSpec(dir, md);
      expect(parseSurfaceSpec(readFileSync(md, 'utf8'), 'Task Detail').refinements).toEqual([
        'first tweak',
        'second tweak',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
