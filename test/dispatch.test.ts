import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch, main } from '../src/index';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-disp-'));
}

describe('dispatch (verb -> envelope)', () => {
  it('returns ok:false / UNKNOWN_VERB for an unrecognised verb', async () => {
    const dir = tmp();
    try {
      expect(await dispatch('frobnicate', dir)).toMatchObject({ ok: false, code: 'UNKNOWN_VERB' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init writes a schema-valid manifest; validate reads it back', async () => {
    const dir = tmp();
    try {
      expect(await dispatch('init', dir)).toMatchObject({ ok: true, screens: 0 });
      const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      expect(m).toMatchObject({ edges: [], unresolved: [], screens: [] });
      expect(await dispatch('validate', dir)).toMatchObject({ ok: true, screens: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a manifest validation failure as ok:false with a code (no throw)', async () => {
    const dir = tmp();
    try {
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({ edges: [], unresolved: [], screens: [{ screenId: 'x', status: 'complete' }] }),
      );
      expect(await dispatch('validate', dir)).toMatchObject({ ok: false, code: 'MANIFEST_INVALID' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sync --fake discovers inputs and instantiates a design system without network', async () => {
    const inputDir = tmp();
    const runFolder = tmp();
    try {
      const ux = join(inputDir, 'ux-app');
      mkdirSync(ux, { recursive: true });
      writeFileSync(join(ux, 'DESIGN.md'), '# design');
      writeFileSync(join(ux, 'EXPERIENCE.md'), '# experience');

      const env = await dispatch('sync', runFolder, [inputDir, '--fake']);
      expect(env).toMatchObject({ ok: true, projectId: 'fake-project-1', assetId: 'fake-asset-1' });
    } finally {
      rmSync(inputDir, { recursive: true, force: true });
      rmSync(runFolder, { recursive: true, force: true });
    }
  });

  it('discover surfaces a missing input as ok:false with a code', async () => {
    const inputDir = tmp();
    try {
      writeFileSync(join(inputDir, 'DESIGN.md'), '# design'); // EXPERIENCE.md missing
      expect(await dispatch('discover', inputDir)).toMatchObject({ ok: false, code: 'NO_EXPERIENCE_MD' });
    } finally {
      rmSync(inputDir, { recursive: true, force: true });
    }
  });
});

describe('main (stdout/exit contract)', () => {
  let writes: string[] = [];
  let spy: { mockRestore: () => void } | undefined;

  function captureStdout(): void {
    writes = [];
    spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as unknown as typeof process.stdout.write);
  }

  afterEach(() => {
    spy?.mockRestore();
    spy = undefined;
  });

  it('prints exactly ONE envelope and returns 0 on success', async () => {
    const dir = tmp();
    try {
      captureStdout();
      const code = await main(['init', dir]);
      spy?.mockRestore();
      expect(code).toBe(0);
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0]!)).toMatchObject({ ok: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints exactly ONE failure envelope and returns non-zero on missing args', async () => {
    captureStdout();
    const code = await main([]);
    spy?.mockRestore();
    expect(code).toBe(1);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!)).toMatchObject({ ok: false, code: 'USAGE' });
  });
});
