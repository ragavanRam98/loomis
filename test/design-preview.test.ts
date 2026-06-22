import { describe, it, expect } from 'vitest';
import { parseDesignTokens, buildDesignPreviewHtml } from '../src/design-preview';

const DESIGN = `# DESIGN.md - Cadence
name: Cadence
description: A calm app.
primary: "#2563EB"
secondary: "#10B981"
headlineFontFamily: "Inter"
bodyFontFamily: "Inter"
radius: 12px
tone: calm, focused`;

describe('parseDesignTokens', () => {
  it('extracts name, colors, fonts, radius, tone', () => {
    const t = parseDesignTokens(DESIGN);
    expect(t.name).toBe('Cadence');
    expect(t.colors).toEqual({ primary: '#2563EB', secondary: '#10B981' });
    expect(t.fonts).toEqual({ headlineFontFamily: 'Inter', bodyFontFamily: 'Inter' });
    expect(t.radius).toBe('12px');
    expect(t.tone).toBe('calm, focused');
  });

  it('ignores non-token prose (e.g. description)', () => {
    expect(parseDesignTokens(DESIGN).colors.description).toBeUndefined();
  });
});

describe('buildDesignPreviewHtml', () => {
  it('renders swatches, fonts, and provider remaps', () => {
    const html = buildDesignPreviewHtml(parseDesignTokens(DESIGN), { primary: 'primary-container' });
    expect(html).toContain('#2563EB');
    expect(html).toContain('Inter');
    expect(html).toContain('primary-container');
    expect(html).toContain('Cadence');
  });
});
