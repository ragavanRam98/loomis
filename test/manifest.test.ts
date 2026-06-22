import { describe, it, expect } from 'vitest';
import { validate, emptyManifest, ManifestError } from '../src/manifest';

describe('manifest validation (ajv)', () => {
  it('accepts a valid camelCase manifest with a valid status', () => {
    const m = {
      projectId: 'p1',
      entry: ['today'],
      edges: [{ from: 'today', to: 'projects' }],
      unresolved: [],
      screens: [{ screenId: 'today', status: 'done' }],
    };
    expect(validate(m)).toBe(m);
  });

  it('accepts the empty manifest', () => {
    expect(() => validate(emptyManifest())).not.toThrow();
  });

  it('rejects a snake_case field on a screen (additionalProperties:false)', () => {
    const m = { edges: [], unresolved: [], screens: [{ screen_id: 'x', status: 'done' }] };
    expect(() => validate(m)).toThrow(ManifestError);
  });

  it('rejects a top-level snake_case field', () => {
    const m = { project_id: 'x', edges: [], unresolved: [], screens: [] };
    expect(() => validate(m)).toThrow(ManifestError);
  });

  it('rejects an out-of-enum status ("complete")', () => {
    const m = { edges: [], unresolved: [], screens: [{ screenId: 'x', status: 'complete' }] };
    expect(() => validate(m)).toThrow(ManifestError);
  });

  it('surfaces a machine-readable code on the error', () => {
    try {
      validate({ edges: [], unresolved: [], screens: [{ screenId: 'x', status: 'complete' }] });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestError);
      expect((e as ManifestError).code).toBe('MANIFEST_INVALID');
    }
  });
});
