import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleBundle, vendorAssets } from '../src/assemble';
import { syncDesignSystem } from '../src/design-system';
import { batchGenerate } from '../src/batch';
import { writeNavGraph } from '../src/nav-graph';
import { wireRunFolder } from '../src/wire';
import { FakeProvider } from '../src/provider/fake';

const SAMPLE = `## Information Architecture
| Surface | Reached from | Purpose |
|---|---|---|
| Today | App open | a |
| Projects | Today | b |`;

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'loomis-asm-'));
}

describe('assembleBundle (FR-9/10, NFR-2)', () => {
  it('assembles a runnable bundle with index.html linking the entry surface', async () => {
    const dir = tmp();
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md');
      await batchGenerate(dir, provider, SAMPLE);
      writeNavGraph(dir, SAMPLE);
      wireRunFolder(dir);

      const r = await assembleBundle(dir, { vendor: false });
      expect(r.screens).toBe(2);
      expect(existsSync(join(dir, 'out', 'today.html'))).toBe(true);
      expect(existsSync(join(dir, 'out', 'projects.html'))).toBe(true);

      const idx = readFileSync(join(dir, 'out', 'index.html'), 'utf8');
      expect(idx).toContain('href="today.html"'); // entry surface linked
      expect(idx.toLowerCase()).not.toContain('react'); // no framework runtime
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function fakeNet(map: Record<string, { body: string | Uint8Array; type?: string }>): typeof fetch {
  return (async (url: unknown) => {
    const entry = map[String(url)];
    if (!entry) return { ok: false, status: 404 } as unknown as Response;
    const bytes = typeof entry.body === 'string' ? new TextEncoder().encode(entry.body) : entry.body;
    return {
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? entry.type ?? '' : null) },
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('vendorAssets (offline, NFR-2)', () => {
  it('fetches external refs into out/assets and rewrites them to relative paths', async () => {
    const dir = tmp();
    try {
      const url = 'https://cdn.example/logo.png';
      const fetchImpl = fakeNet({ [url]: { body: new Uint8Array([1, 2, 3]), type: 'image/png' } });
      const html = `<html><body><img src="${url}"></body></html>`;

      const r = await vendorAssets(html, join(dir, 'assets'), fetchImpl);
      expect(r.count).toBe(1);
      expect(r.html).not.toContain('https://cdn.example');
      expect(r.html).toMatch(/assets\/[a-f0-9]{8}-logo\.png/);
      expect(readdirSync(join(dir, 'assets')).some((f) => f.endsWith('-logo.png'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the copy an earlier assemble vendored when the asset's URL no longer answers", async () => {
    const dir = tmp();
    try {
      // A provider's image URL, with no extension in its path, that later expires (HTTP 403).
      const url = 'https://images.example/aida/AEtjO1VfBceQfcL6kkoBXhn5HZ5d9JcF';
      const html = `<html><body><img src="${url}"></body></html>`;
      const first = await vendorAssets(html, join(dir, 'assets'), fakeNet({ [url]: { body: new Uint8Array([7, 7]), type: 'image/jpeg' } }));
      const local = /src="(assets\/[^"]+)"/.exec(first.html)?.[1];
      expect(local).toMatch(/\.jpg$/);

      const expired = (async () => ({ ok: false, status: 403 }) as unknown as Response) as unknown as typeof fetch;
      const again = await vendorAssets(html, join(dir, 'assets'), expired);
      expect(again.html).not.toContain('https://images.example');
      expect(again.html).toContain(`src="${local}"`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recurses into CSS @font-face url() and keeps extensions (true offline)', async () => {
    const dir = tmp();
    try {
      const cssUrl = 'https://fonts.googleapis.com/css2?family=Roboto';
      const fontUrl = 'https://fonts.gstatic.com/s/roboto/v1/abc.woff2';
      const fetchImpl = fakeNet({
        [cssUrl]: { body: `@font-face{font-family:Roboto;src:url(${fontUrl}) format('woff2')}`, type: 'text/css' },
        [fontUrl]: { body: new Uint8Array([1, 2, 3, 4]), type: 'font/woff2' },
      });
      const html = `<html><head><link rel="stylesheet" href="${cssUrl}"></head><body></body></html>`;

      const r = await vendorAssets(html, join(dir, 'assets'), fetchImpl);
      expect(r.count).toBe(2); // the CSS AND the font it references
      expect(r.html).not.toContain('googleapis');

      const files = readdirSync(join(dir, 'assets'));
      const cssFile = files.find((f) => f.endsWith('.css'));
      expect(cssFile).toBeTruthy();
      expect(files.some((f) => f.endsWith('.woff2'))).toBe(true);
      const cssContent = readFileSync(join(dir, 'assets', cssFile!), 'utf8');
      expect(cssContent).not.toContain('gstatic'); // font rewritten to a local sibling
      expect(cssContent).toContain('.woff2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops connection hints to remote hosts, which an offline bundle never uses', async () => {
    const dir = tmp();
    try {
      const html =
        '<html><head><link rel="preconnect" href="https://fonts.googleapis.com">' +
        '<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect">' +
        '<link rel="dns-prefetch" href="//cdn.example"></head><body><p>hi</p></body></html>';
      const r = await vendorAssets(html, join(dir, 'assets'), fakeNet({}));
      expect(r.html).not.toContain('preconnect');
      expect(r.html).not.toContain('dns-prefetch');
      expect(r.html).not.toMatch(/(https?:)?\/\/(fonts|cdn)\./);
      expect(r.html).toContain('<p>hi</p>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when there are no external assets', async () => {
    const html = `<html><body><p>local only</p></body></html>`;
    const r = await vendorAssets(html, join(tmpdir(), 'loomis-never-created'));
    expect(r).toEqual({ html, count: 0 });
  });
});
