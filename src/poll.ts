// Canonical long-running helpers: poll until done (bounded), and a connection-error predicate.
// Used by the Stitch adapter's awaitScreen/generate; injectable clock+sleep for deterministic tests.

export class TimeoutError extends Error {
  readonly code = 'TIMEOUT';
  constructor(message = 'operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export interface PollOptions {
  intervalMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Repeatedly call `attempt` until `isDone`, or throw TimeoutError after `maxMs`. Never retry-spams. */
export async function pollUntil<T>(
  attempt: () => Promise<T>,
  isDone: (value: T) => boolean,
  opts: PollOptions = {},
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 5000;
  const maxMs = opts.maxMs ?? 180000;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());
  const start = now();

  for (;;) {
    const value = await attempt();
    if (isDone(value)) return value;
    if (now() - start >= maxMs) throw new TimeoutError();
    await sleep(intervalMs);
  }
}

/** Heuristic: did a fetch/transport call fail because the connection dropped (vs a clean error)? */
export function isConnectionError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  );
}
