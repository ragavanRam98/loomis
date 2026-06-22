import { describe, it, expect } from 'vitest';
import { hashInputs } from '../src/hash';

describe('hashInputs', () => {
  it('is stable and order-independent (cosmetic reorder never invalidates)', () => {
    expect(hashInputs({ a: 1, b: 2 })).toBe(hashInputs({ b: 2, a: 1 }));
    expect(hashInputs({ a: 1, b: 2 })).toBe(hashInputs({ a: 1, b: 2 }));
  });

  it('changes when any input changes', () => {
    expect(hashInputs({ a: 1 })).not.toBe(hashInputs({ a: 2 }));
    expect(hashInputs({ a: 1 })).not.toBe(hashInputs({ a: 1, b: 1 }));
  });

  it('handles undefined fields deterministically', () => {
    expect(hashInputs({ a: undefined })).toBe(hashInputs({ a: undefined }));
  });
});
