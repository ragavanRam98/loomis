import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { screenToStory, storyToScreens, detectOmissions, danglingStories } from '../src/provenance';
import { generateOneScreen } from '../src/generate';
import { syncDesignSystem } from '../src/design-system';
import { FakeProvider } from '../src/provider/fake';
import type { Manifest } from '../src/types';

const M: Manifest = {
  entry: [],
  edges: [],
  unresolved: [],
  screens: [
    { screenId: 'a', status: 'done', story: 'story-1' },
    { screenId: 'b', status: 'done', story: 'story-1' },
    { screenId: 'c', status: 'done', story: 'story-2' },
    { screenId: 'd', status: 'done' }, // no story
  ],
};

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-prov-'));
}

describe('provenance (FR-13)', () => {
  it('resolves screen->story and story->screen(s), both directions consistent', () => {
    expect(screenToStory(M)).toEqual({ a: 'story-1', b: 'story-1', c: 'story-2' });
    expect(storyToScreens(M)).toEqual({ 'story-1': ['a', 'b'], 'story-2': ['c'] });
  });

  it('detectOmissions flags requested verbatim content missing from the HTML', () => {
    const html = '<html><body><h1>Welcome</h1></body></html>';
    expect(detectOmissions(html, ['Welcome', 'Sign in'])).toEqual(['Sign in']);
  });

  it('danglingStories flags screens whose story is not in the known set', () => {
    expect(danglingStories(M, ['story-1'])).toEqual(['c']); // c->story-2 dangles; d has no story
  });

  it('generateOneScreen records omissions for missing verbatim content', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      const rec = await generateOneScreen(dir, provider, {
        screenId: 'today',
        prompt: 'P',
        expectedContent: ['Next', 'NONEXISTENT COPY'],
      });
      expect(rec.omissions).toEqual(['NONEXISTENT COPY']); // 'Next' is in the FAKE html
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detectOmissions matches entity-encoded content (no false positives)', () => {
    const html = '<a>Help &amp; docs</a><span>Last 30 days</span><b>3m&nbsp;42s</b>';
    expect(detectOmissions(html, ['Help & docs', 'Last 30 days', '3m 42s'])).toEqual([]);
    expect(detectOmissions(html, ['Truly missing'])).toEqual(['Truly missing']);
  });
});
