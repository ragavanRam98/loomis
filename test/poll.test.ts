import { describe, it, expect } from 'vitest';
import { pollUntil, TimeoutError, isConnectionError } from '../src/poll';

describe('pollUntil', () => {
  it('returns the value once isDone is true', async () => {
    let n = 0;
    const value = await pollUntil(
      async () => {
        n += 1;
        return n;
      },
      (x) => x >= 3,
      { sleep: async () => {}, now: () => 0 },
    );
    expect(value).toBe(3);
  });

  it('throws TimeoutError once maxMs is exceeded (never retry-spams)', async () => {
    let t = 0;
    await expect(
      pollUntil(async () => 'pending', () => false, {
        sleep: async () => {},
        now: () => {
          t += 100;
          return t;
        },
        maxMs: 250,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('isConnectionError', () => {
  it('flags dropped-connection style errors', () => {
    expect(isConnectionError(new Error('ECONNRESET'))).toBe(true);
    expect(isConnectionError(new Error('fetch failed'))).toBe(true);
    expect(isConnectionError(new Error('provider HTTP 403'))).toBe(false);
  });
});
