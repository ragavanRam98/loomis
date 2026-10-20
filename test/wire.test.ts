import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wireHtml, wireRunFolder } from '../src/wire';
import { writeManifest } from '../src/manifest';
import type { Manifest } from '../src/types';

function manifest(done: string[], dead: string[] = []): Manifest {
  return {
    entry: [],
    edges: [],
    unresolved: [],
    screens: [
      ...done.map((id) => ({ screenId: id, status: 'done' as const })),
      ...dead.map((id) => ({ screenId: id, status: 'failed' as const })),
    ],
  };
}

const HTML = `<!doctype html><html><body>
<a data-nav="projects" href="#">Projects</a>
<a data-nav="settings" href="#">Settings</a>
</body></html>`;

describe('wireHtml (FR-9, FR-12, NFR-3)', () => {
  it('links a done target and leaves a dead-stub for a not-done target', () => {
    const out = wireHtml(HTML, manifest(['projects'], ['settings']));
    expect(out).toContain('href="projects.html"');
    expect(out).toContain('data-nav-state="live"');
    expect(out).toContain('data-nav-state="dead"');
    expect(out).not.toContain('href="settings.html"');
  });

  it('promotes a dead-stub to a live link once the target becomes done', () => {
    const out = wireHtml(HTML, manifest(['projects', 'settings']));
    expect(out).toContain('href="projects.html"');
    expect(out).toContain('href="settings.html"');
    expect(out).not.toContain('data-nav-state="dead"');
  });

  it('is a no-op on hook-free HTML (byte-identical - fidelity)', () => {
    const plain = `<!doctype html><html><head></head><body><p>hello</p></body></html>`;
    expect(wireHtml(plain, manifest(['projects']))).toBe(plain);
  });

  it('wires data-card drill-downs via a forward chevron when one drill target is unwired', () => {
    const m: Manifest = {
      entry: ['list'],
      edges: [{ from: 'list', to: 'item-detail' }],
      unresolved: [],
      screens: [
        { screenId: 'list', surface: 'List', status: 'done' },
        { screenId: 'item-detail', surface: 'Item Detail', status: 'done' },
      ],
    };
    const html = `<div>
      <div class="card cursor-pointer">Buy milk <span data-icon="chevron_right"></span></div>
      <div class="card cursor-pointer">Walk dog <span data-icon="chevron_right"></span></div>
    </div>`;
    const out = wireHtml(html, m, 'list');
    // both data rows now drill into the detail (their text never matched by name)
    expect((out.match(/href="item-detail\.html"/g) || []).length).toBe(2);
  });

  it('does NOT guess data-card drill-downs when multiple targets are unwired (stays honest)', () => {
    const m: Manifest = {
      entry: ['list'],
      edges: [
        { from: 'list', to: 'a-detail' },
        { from: 'list', to: 'b-detail' },
      ],
      unresolved: [],
      screens: [
        { screenId: 'list', surface: 'List', status: 'done' },
        { screenId: 'a-detail', surface: 'A Detail', status: 'done' },
        { screenId: 'b-detail', surface: 'B Detail', status: 'done' },
      ],
    };
    const html = `<div class="card cursor-pointer">some data <span data-icon="chevron_right"></span></div>`;
    expect(wireHtml(html, m, 'list')).not.toContain('.html"');
  });

  it('is idempotent (wiring an already-wired bundle returns the same output)', () => {
    const once = wireHtml(HTML, manifest(['projects'], ['settings']));
    expect(wireHtml(once, manifest(['projects'], ['settings']))).toBe(once);
  });

  it('falls back to wiring an icon button when the provider omits data-nav hooks', () => {
    const html = `<header><button data-icon="history">history</button></header>`;
    const m: Manifest = {
      entry: ['calculator'],
      edges: [{ from: 'calculator', to: 'history' }],
      unresolved: [],
      screens: [
        { screenId: 'calculator', status: 'done' },
        { screenId: 'history', status: 'done' },
      ],
    };
    const out = wireHtml(html, m, 'calculator');
    expect(out).toContain('href="history.html"');
    expect(out).toContain('data-nav="history"');
  });

  it('falls back to a back-affordance for an entry-node edge', () => {
    const html = `<header><button data-icon="chevron_left">chevron_left</button></header>`;
    const m: Manifest = {
      entry: ['calculator'],
      edges: [{ from: 'history', to: 'calculator' }],
      unresolved: [],
      screens: [
        { screenId: 'calculator', status: 'done' },
        { screenId: 'history', status: 'done' },
      ],
    };
    expect(wireHtml(html, m, 'history')).toContain('href="calculator.html"');
  });

  it('content-aware fallback wires a CTA link (verb + surface name), not just an icon', () => {
    const html = `<main><a href="#" class="cta">View report →</a><div class="kpi cursor-pointer">Active Users 48,219</div></main>`;
    const m: Manifest = {
      entry: ['overview'],
      edges: [{ from: 'overview', to: 'report-detail' }],
      unresolved: [],
      screens: [
        { screenId: 'overview', status: 'done' },
        { screenId: 'report-detail', status: 'done', surface: 'Report detail' },
      ],
    };
    const out = wireHtml(html, m, 'overview');
    expect(out).toContain('href="report-detail.html"');
    expect(out).toContain('data-nav="report-detail"');
    // The CTA anchor is chosen over the KPI card, and stays an <a>.
    expect(out).toMatch(/<a[^>]*href="report-detail\.html"[^>]*>View report/);
  });

  it('wires a declared link by its label when the hook is missing and the text never names the target', () => {
    const m: Manifest = {
      entry: ['dashboard'],
      edges: [{ from: 'dashboard', to: 'requests-queue', label: 'See the requests' }],
      unresolved: [],
      screens: [
        { screenId: 'dashboard', surface: 'Dashboard', status: 'done' },
        { screenId: 'requests-queue', surface: 'Requests queue', status: 'done' },
      ],
    };
    const html = `<main><section><h2>Needs attention</h2><button class="link">See the requests</button></section></main>`;
    expect(wireHtml(html, m, 'dashboard')).toMatch(/<a[^>]*href="requests-queue\.html"[^>]*>See the requests<\/a>/);
  });

  it('prefers the element carrying the label over one that only names the target', () => {
    const m: Manifest = {
      entry: ['dashboard'],
      edges: [{ from: 'dashboard', to: 'refunds', label: 'See the refunds' }],
      unresolved: [],
      screens: [
        { screenId: 'dashboard', surface: 'Dashboard', status: 'done' },
        { screenId: 'refunds', surface: 'Refunds', status: 'done' },
      ],
    };
    const html = `<main><button>Refunds</button><p>1 failed</p><button>See the refunds</button></main>`;
    const out = wireHtml(html, m, 'dashboard');
    expect(out).toMatch(/<a[^>]*href="refunds\.html"[^>]*>See the refunds<\/a>/);
    expect(out).toContain('<button>Refunds</button>');
  });

  it('wires a labelled link into an entry screen to its label, not to a back arrow', () => {
    const m: Manifest = {
      entry: ['sign-in'],
      edges: [{ from: 'profile', to: 'sign-in', label: 'Sign out' }],
      unresolved: [],
      screens: [
        { screenId: 'profile', surface: 'Profile', status: 'done' },
        { screenId: 'sign-in', surface: 'Sign in', status: 'done' },
      ],
    };
    const html = `<header><button data-icon="arrow_back">arrow_back</button><nav><button>Sign out</button></nav></header>`;
    const out = wireHtml(html, m, 'profile');
    expect(out).toMatch(/<a[^>]*href="sign-in\.html"[^>]*>Sign out<\/a>/);
    expect(out).toContain('<button data-icon="arrow_back">arrow_back</button>');
  });

  it('matches a label across typographic differences (an ellipsis, a curly apostrophe)', () => {
    const m: Manifest = {
      entry: ['detail'],
      edges: [{ from: 'detail', to: 'changes', label: 'Correct the player’s details…' }],
      unresolved: [],
      screens: [
        { screenId: 'detail', surface: 'Detail', status: 'done' },
        { screenId: 'changes', surface: 'Registration actions', status: 'done' },
      ],
    };
    const html = `<main><button>Correct the player's details...</button></main>`;
    expect(wireHtml(html, m, 'detail')).toContain('href="changes.html"');
  });
});

describe('wireRunFolder (unwired-edge reporting)', () => {
  it('reports an IA edge that did not become a live link (no silent failure)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-unwired-'));
    try {
      writeFileSync(join(dir, 'a.html'), '<html><body><p>no nav here</p></body></html>');
      writeFileSync(join(dir, 'b.html'), '<html><body>screen</body></html>');
      const m: Manifest = {
        entry: ['a'],
        edges: [{ from: 'a', to: 'b' }],
        unresolved: [],
        screens: [
          { screenId: 'a', status: 'done', htmlPath: 'a.html' },
          { screenId: 'b', status: 'done', htmlPath: 'b.html' },
        ],
      };
      writeManifest(dir, m);
      expect(wireRunFolder(dir).unwired).toEqual([{ from: 'a', to: 'b' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
