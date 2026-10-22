// Assemble the runnable bundle (FR-9/10, NFR-2): write each done screen + an index.html
// into out/, vendoring external assets into out/assets/ so the site runs fully offline.

import * as cheerio from 'cheerio';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readManifest } from './manifest';
import { wireHtml } from './wire';
import { appendLog, progress } from './log';
import type { Clock } from './log';

export interface AssembleOptions {
  fetchImpl?: typeof fetch;
  /** Vendor external assets locally (default true). */
  vendor?: boolean;
}

const CONTENT_TYPE_EXT: Record<string, string> = {
  'text/css': '.css',
  'application/javascript': '.js',
  'text/javascript': '.js',
  'font/woff2': '.woff2',
  'font/woff': '.woff',
  'font/ttf': '.ttf',
  'application/font-woff2': '.woff2',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const ASSET_EXTS = new Set([
  '.css', '.js', '.mjs', '.woff2', '.woff', '.ttf', '.otf', '.eot',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico', '.json',
]);

function extensionFor(url: string, contentType?: string): string {
  const path = url.split('?')[0] ?? url;
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  const urlExt = dot > 0 && base.length - dot <= 6 ? base.slice(dot).toLowerCase() : '';
  if (ASSET_EXTS.has(urlExt)) return urlExt; // a real asset extension in the URL path
  const ct = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return CONTENT_TYPE_EXT[ct] ?? urlExt; // else prefer content-type (fixes …tailwindcss.com -> .js)
}

function localNameFor(url: string, contentType?: string): string {
  const path = url.split('?')[0] ?? url;
  let cleaned = ((path.split('/').pop() ?? 'asset').replace(/[^a-zA-Z0-9._-]/g, '')) || 'asset';
  const ext = extensionFor(url, contentType);
  if (ext) cleaned = cleaned.replace(/\.[a-zA-Z0-9]{1,6}$/, ''); // drop any existing extension; re-appended below
  // Cap the readable part - the hash prefix guarantees uniqueness; some CDN tokens are 200+ chars.
  if (cleaned.length > 24) cleaned = cleaned.slice(0, 24);
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
  return `${hash}-${cleaned || 'asset'}${ext}`;
}

interface VendorContext {
  assetsDir: string;
  fetchImpl: typeof fetch;
  /** absolute url -> relative path from the out/ root ("assets/<name>") */
  cache: Map<string, string>;
}

function isCssUrl(url: string, contentType?: string): boolean {
  return (
    (contentType ?? '').toLowerCase().includes('text/css') ||
    /\.css($|\?)/i.test(url) ||
    /fonts\.googleapis\.com\/css/i.test(url)
  );
}

/** Rewrite http url()/@import refs inside CSS to vendored paths (recursing into each). */
async function rewriteCssUrls(ctx: VendorContext, css: string, inAssetsDir: boolean): Promise<string> {
  const refs = new Set<string>();
  const patterns = [
    /url\(\s*['"]?(https?:\/\/[^'")]+)['"]?\s*\)/gi,
    /@import\s+(?:url\(\s*)?['"]?(https?:\/\/[^'")\s]+)['"]?/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      if (m[1]) refs.add(m[1]);
    }
  }
  let out = css;
  for (const ref of refs) {
    const rel = await vendorOne(ctx, ref);
    if (rel) {
      // A CSS file in assets/ references siblings by basename; an inline <style> uses assets/<name>.
      const replacement = inAssetsDir ? rel.replace(/^assets\//, '') : rel;
      out = out.split(ref).join(replacement);
    }
  }
  return out;
}

/**
 * The copy an earlier assemble vendored for a URL that no longer answers: a provider's image URLs expire,
 * and the bundle keeps the copy rather than a link that is now broken. Its name is the one `localNameFor`
 * gave it, whatever extension the content type added.
 */
function previouslyVendored(ctx: VendorContext, url: string): string | undefined {
  if (!existsSync(ctx.assetsDir)) return undefined;
  const stem = localNameFor(url).replace(/\.[a-zA-Z0-9]{1,6}$/, '');
  const name = readdirSync(ctx.assetsDir).find((f) => f === stem || f.startsWith(`${stem}.`));
  if (!name) return undefined;
  const rel = `assets/${name}`;
  ctx.cache.set(url, rel);
  return rel;
}

/** Fetch one external URL into assets/, recursing into CSS. Returns its relative path. */
async function vendorOne(ctx: VendorContext, url: string): Promise<string | undefined> {
  const cached = ctx.cache.get(url);
  if (cached) return cached;
  try {
    const res = await ctx.fetchImpl(url);
    if (!res.ok) return previouslyVendored(ctx, url);

    const contentType = res.headers?.get?.('content-type') ?? undefined;
    const buffer = new Uint8Array(await res.arrayBuffer());
    const name = localNameFor(url, contentType);
    const rel = `assets/${name}`;
    ctx.cache.set(url, rel); // set before recursing to break cycles
    mkdirSync(ctx.assetsDir, { recursive: true });

    if (isCssUrl(url, contentType)) {
      const css = await rewriteCssUrls(ctx, new TextDecoder().decode(buffer), true);
      writeFileSync(join(ctx.assetsDir, name), css, 'utf8');
    } else {
      writeFileSync(join(ctx.assetsDir, name), buffer);
    }
    return rel;
  } catch {
    ctx.cache.delete(url); // never let one bad asset crash the bundle
    return previouslyVendored(ctx, url);
  }
}

/**
 * Fetch external (http) assets into assetsDir and rewrite refs to relative paths so the
 * bundle runs fully offline. Recurses into CSS (@font-face/url/@import) and inline <style>.
 */
export async function vendorAssets(
  html: string,
  assetsDir: string,
  fetchImpl?: typeof fetch,
): Promise<{ html: string; count: number }> {
  if (!/https?:\/\//i.test(html) && !/preconnect|dns-prefetch/i.test(html)) return { html, count: 0 };

  const $ = cheerio.load(html);
  const ctx: VendorContext = { assetsDir, fetchImpl: fetchImpl ?? fetch, cache: new Map() };

  // Connection hints (preconnect, dns-prefetch) only warm up remote hosts, such as Google
  // Fonts', which the bundle never calls once its assets are local: they go, so the offline
  // bundle names no remote host at all.
  let dropped = 0;
  for (const el of $('link[rel][href]').toArray()) {
    const rels = ($(el).attr('rel') ?? '').toLowerCase().split(/\s+/);
    const remote = /^(https?:)?\/\//i.test($(el).attr('href') ?? '');
    if (remote && (rels.includes('preconnect') || rels.includes('dns-prefetch'))) {
      $(el).remove();
      dropped += 1;
    }
  }

  for (const el of $('link[href], script[src], img[src]').toArray()) {
    const $el = $(el);
    const attr = $el.is('link') ? 'href' : 'src';
    const url = $el.attr(attr);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const rel = await vendorOne(ctx, url);
    if (rel) $el.attr(attr, rel);
  }

  // Inline <style> blocks may carry @font-face / url() refs.
  for (const el of $('style').toArray()) {
    const css = $(el).html() ?? '';
    if (/https?:\/\//i.test(css)) {
      $(el).text(await rewriteCssUrls(ctx, css, false));
    }
  }

  // Inline style="" attributes may carry url() refs (e.g. a hero background-image).
  for (const el of $('[style]').toArray()) {
    const style = $(el).attr('style') ?? '';
    if (/url\(\s*['"]?https?:\/\//i.test(style)) {
      $(el).attr('style', await rewriteCssUrls(ctx, style, false));
    }
  }

  const count = ctx.cache.size;
  if (count === 0 && dropped === 0) return { html, count: 0 };
  return { html: $.html(), count };
}

function buildIndexHtml(builtIds: string[], entryIds: string[]): string {
  const entry = new Set(entryIds);
  const ordered = [...builtIds].sort((a, b) => Number(entry.has(b)) - Number(entry.has(a)));
  const cap = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const cards = ordered
    .map(
      (id) => `      <a class="card${entry.has(id) ? ' entry' : ''}" href="${id}.html">
        <span class="nm">${cap(id)}</span>
        ${entry.has(id) ? '<span class="badge">start</span>' : '<span class="arrow">&#8250;</span>'}
      </a>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Prototype - Loomis</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #0d1117; color: #e8e6ea;
         font: 15px/1.5 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
         display: flex; align-items: center; justify-content: center; padding: 40px 20px; }
  .wrap { width: 100%; max-width: 560px; }
  h1 { font-size: 26px; font-weight: 700; letter-spacing: -.02em; margin: 0 0 4px; display: flex; align-items: center; gap: 10px; }
  h1 .spark { color: #a855f7; }
  .sub { color: #8a97a6; margin: 0 0 26px; font-size: 14px; }
  .grid { display: grid; gap: 12px; }
  .card { display: flex; align-items: center; justify-content: space-between; text-decoration: none; color: #e8e6ea;
          background: #161b22; border: 1px solid #262d36; border-radius: 12px; padding: 16px 18px; transition: border-color .15s, transform .15s; }
  .card:hover { border-color: #3a424d; transform: translateY(-2px); }
  .card.entry { border-color: rgba(168,85,247,.45); box-shadow: 0 0 22px rgba(168,85,247,.10); }
  .nm { font-weight: 600; font-size: 16px; text-transform: capitalize; }
  .badge { font: 600 11px/1 'Inter', sans-serif; text-transform: uppercase; letter-spacing: .06em; color: #c4b5fd;
           background: rgba(168,85,247,.14); border: 1px solid rgba(168,85,247,.3); border-radius: 999px; padding: 5px 9px; }
  .arrow { color: #6e7681; font-size: 20px; }
</style>
</head>
<body>
  <div class="wrap">
    <h1><span class="spark">&#10022;</span> Prototype</h1>
    <p class="sub">${ordered.length} screen${ordered.length === 1 ? '' : 's'}, woven by Loomis &middot; connected &amp; offline</p>
    <div class="grid">
${cards}
    </div>
  </div>
</body>
</html>
`;
}

export async function assembleBundle(
  runFolder: string,
  opts: AssembleOptions = {},
  clock?: Clock,
): Promise<{ out: string; screens: number; assets: number }> {
  const manifest = readManifest(runFolder);
  const outDir = join(runFolder, 'out');
  mkdirSync(outDir, { recursive: true });
  const assetsDir = join(outDir, 'assets');

  const builtIds: string[] = [];
  let assets = 0;
  progress(opts.vendor === false ? 'Assembling bundle…' : 'Assembling bundle + vendoring assets for offline…');

  for (const s of manifest.screens) {
    if (s.status !== 'done' || !s.htmlPath) continue;
    const srcPath = join(runFolder, s.htmlPath);
    if (!existsSync(srcPath)) continue;

    let html = wireHtml(readFileSync(srcPath, 'utf8'), manifest, s.screenId);
    if (opts.vendor !== false) {
      const v = await vendorAssets(html, assetsDir, opts.fetchImpl);
      html = v.html;
      assets += v.count;
    }
    writeFileSync(join(outDir, `${s.screenId}.html`), html, 'utf8');
    builtIds.push(s.screenId);
  }

  const entry = (manifest.entry ?? []).filter((id) => builtIds.includes(id));
  writeFileSync(join(outDir, 'index.html'), buildIndexHtml(builtIds, entry), 'utf8');

  appendLog(runFolder, { event: 'assemble', detail: { screens: builtIds.length, assets } }, clock);
  progress(`Bundle ready: ${builtIds.length} screen(s), ${assets} asset(s) vendored locally.`);
  return { out: outDir, screens: builtIds.length, assets };
}
