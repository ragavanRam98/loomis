// Canonical input hashing (FR-13): a stable per-surface fingerprint so re-runs can skip
// unchanged-and-done screens and regenerate only what actually changed. Order-independent
// (keys sorted) so cosmetic reordering never invalidates a cache.

import { createHash } from 'node:crypto';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function hashInputs(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}
