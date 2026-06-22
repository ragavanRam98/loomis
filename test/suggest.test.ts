import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManifest, readManifest } from '../src/manifest';
import { FakeProvider } from '../src/provider/fake';
import { suggestScreen, promoteSuggestion } from '../src/suggest';

const EXP = ['## Task Detail', 'Purpose: a task', 'Layout:', '- header', ''].join('\n');

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), 'loomis-suggest-'));
  writeFileSync(join(dir, 'task-detail.html'), '<main>original</main>', 'utf8');
  writeManifest(dir, {
    projectId: 'p1',
    entry: [],
    edges: [],
    unresolved: [],
    screens: [
      {
        screenId: 'task-detail',
        surface: 'Task Detail',
        story: '2-3',
        status: 'done',
        providerScreen: 'ps-1',
        htmlPath: 'task-detail.html',
      },
    ],
  });
  return dir;
}

describe('suggestScreen + promoteSuggestion (multiple UI options)', () => {
  it('generates N non-destructive options recorded in the manifest', async () => {
    const dir = setup();
    try {
      const provider = new FakeProvider();
      const options = await suggestScreen(dir, provider, EXP, 'task-detail', { count: 3 });

      expect(options).toHaveLength(3);
      expect(provider.calls.generateVariants).toBe(1);
      for (let n = 1; n <= 3; n += 1) {
        expect(existsSync(join(dir, `task-detail.option-${n}.html`))).toBe(true);
      }
      // the live screen is untouched - these are candidates
      expect(readFileSync(join(dir, 'task-detail.html'), 'utf8')).toBe('<main>original</main>');

      const rec = readManifest(dir).screens[0]!;
      expect(rec.suggestions).toHaveLength(3);
      expect(rec.suggestions![1]).toMatchObject({ option: 2, htmlPath: 'task-detail.option-2.html' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('promote makes a chosen option live and preserves the prior take', async () => {
    const dir = setup();
    try {
      await suggestScreen(dir, new FakeProvider(), EXP, 'task-detail', { count: 3 });
      const rec = await promoteSuggestion(dir, 'task-detail', 2);

      expect(readFileSync(join(dir, 'task-detail.html'), 'utf8')).toContain('option 2');
      expect(rec.providerScreen).toBe('ps-1-variant-2');
      // prior live take preserved
      expect(existsSync(join(dir, 'task-detail.pre-promote.html'))).toBe(true);
      expect(readFileSync(join(dir, 'task-detail.pre-promote.html'), 'utf8')).toBe('<main>original</main>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to promote an unknown option', async () => {
    const dir = setup();
    try {
      await suggestScreen(dir, new FakeProvider(), EXP, 'task-detail', { count: 2 });
      await expect(promoteSuggestion(dir, 'task-detail', 5)).rejects.toMatchObject({ code: 'UNKNOWN_OPTION' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to suggest for a screen that is not generated yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-suggest-'));
    try {
      writeManifest(dir, {
        projectId: 'p1',
        entry: [],
        edges: [],
        unresolved: [],
        screens: [{ screenId: 'x', surface: 'X', status: 'pending' }],
      });
      await expect(suggestScreen(dir, new FakeProvider(), '## X\n', 'x', {})).rejects.toMatchObject({
        code: 'NOT_GENERATED',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
