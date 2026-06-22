import { describe, it, expect } from 'vitest';
import { slugify } from '../src/slug';

describe('slugify (the one canonical slug rule)', () => {
  it('maps "Project detail" -> "project-detail"', () => {
    expect(slugify('Project detail')).toBe('project-detail');
  });

  it('maps "Today / Home" -> "today-home" (collapses spaces and "/")', () => {
    expect(slugify('Today / Home')).toBe('today-home');
  });

  it('collapses repeated whitespace', () => {
    expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces');
  });

  it('drops non-alphanumeric characters', () => {
    expect(slugify('Weird@#Chars!')).toBe('weirdchars');
  });

  it('is idempotent on an already-slugged id', () => {
    expect(slugify('project-detail')).toBe('project-detail');
  });
});
