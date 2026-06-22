import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendLog, progress, RUN_LOG_FILE } from '../src/log';

describe('appendLog (JSONL run log)', () => {
  it('appends one JSON line per event with the injected timestamp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-log-'));
    try {
      const clock = () => '2026-06-17T00:00:00.000Z';
      appendLog(dir, { event: 'init' }, clock);
      appendLog(dir, { event: 'generate', screenId: 'today', detail: { tries: 1 } }, clock);

      const lines = readFileSync(join(dir, RUN_LOG_FILE), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual({ ts: '2026-06-17T00:00:00.000Z', event: 'init' });
      expect(JSON.parse(lines[1]!)).toMatchObject({
        ts: '2026-06-17T00:00:00.000Z',
        event: 'generate',
        screenId: 'today',
        detail: { tries: 1 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('progress (live stderr stream)', () => {
  it('writes to stderr, and is suppressed when LOOMIS_QUIET is set', () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((s: unknown) => {
      writes.push(String(s));
      return true;
    }) as unknown as typeof process.stderr.write);
    const savedVitest = process.env.VITEST;
    const savedQuiet = process.env.LOOMIS_QUIET;
    try {
      delete process.env.VITEST;
      delete process.env.LOOMIS_QUIET;
      progress('weaving now');
      process.env.LOOMIS_QUIET = '1';
      progress('should be hidden');
    } finally {
      spy.mockRestore();
      if (savedVitest !== undefined) process.env.VITEST = savedVitest;
      else delete process.env.VITEST;
      if (savedQuiet !== undefined) process.env.LOOMIS_QUIET = savedQuiet;
      else delete process.env.LOOMIS_QUIET;
    }
    expect(writes.join('')).toContain('weaving now');
    expect(writes.join('')).not.toContain('should be hidden');
  });
});
