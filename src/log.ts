// JSONL run log: one event per line appended to .loomis-run.log in the run folder.
// The clock is injectable so tests are deterministic.

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export const RUN_LOG_FILE = '.loomis-run.log';

export interface LogEvent {
  event: string;
  screenId?: string;
  detail?: unknown;
}

export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

export function appendLog(runFolder: string, ev: LogEvent, clock: Clock = systemClock): void {
  const line = JSON.stringify({ ts: clock(), ...ev }) + '\n';
  appendFileSync(join(runFolder, RUN_LOG_FILE), line, 'utf8');
}

/**
 * Live, human-readable progress to STDERR - so the developer can watch a long run unfold.
 * stdout stays the single JSON envelope (the agent<->core contract). Suppressed under tests
 * or when LOOMIS_QUIET is set.
 */
export function progress(message: string): void {
  if (process.env.LOOMIS_QUIET || process.env.VITEST) return;
  process.stderr.write(`▸ ${message}\n`);
}
