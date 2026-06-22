// Design-system gate - human-gated on identity. After sync, surface the RESOLVED theme
// (colours, fonts, tone, and the provider's token remap) as a reviewable preview so the
// developer approves or edits the brand BEFORE any screen is generated. Loomis stays
// autonomous on layout/screens; the human owns identity.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from './manifest';
import { appendLog } from './log';
import type { Clock } from './log';

export interface DesignTokens {
  name?: string;
  colors: Record<string, string>;
  fonts: Record<string, string>;
  radius?: string;
  tone?: string;
}

export function parseDesignTokens(designMd: string): DesignTokens {
  const tokens: DesignTokens = { colors: {}, fonts: {} };
  for (const rawLine of designMd.split('\n')) {
    const line = rawLine.replace(/^[-*]\s+/, '').trim();
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*"?([^"]+?)"?\s*$/);
    if (!m || !m[1]) continue;
    const key = m[1];
    const val = (m[2] ?? '').trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(val)) tokens.colors[key] = val;
    else if (/font/i.test(key)) tokens.fonts[key] = val;
    else if (key.toLowerCase() === 'radius') tokens.radius = val;
    else if (key.toLowerCase() === 'tone') tokens.tone = val;
    else if (key.toLowerCase() === 'name') tokens.name = val;
  }
  return tokens;
}

export function buildDesignPreviewHtml(
  tokens: DesignTokens,
  roleMap: Record<string, string> = {},
): string {
  const swatches = Object.entries(tokens.colors)
    .map(
      ([name, hex]) =>
        `      <div class="swatch"><span class="chip" style="background:${hex}"></span><span class="lbl"><b>${name}</b> <code>${hex}</code></span></div>`,
    )
    .join('\n');
  const fonts = Object.entries(tokens.fonts)
    .map(
      ([name, fam]) =>
        `      <li><b>${name}:</b> <span style="font-family:'${fam}',system-ui,sans-serif;font-size:1.25rem">${fam} - The quick brown fox jumps</span></li>`,
    )
    .join('\n');
  const remaps = Object.entries(roleMap)
    .map(([from, to]) => `      <li><code>${from}</code> &rarr; <code>${to}</code></li>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Loomis - Design System</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #0f172a; }
      h1 { margin: 0 0 .25rem; } .tone { color: #64748b; margin-bottom: 1.5rem; }
      .swatch { display: flex; align-items: center; gap: .75rem; margin: .4rem 0; }
      .chip { width: 42px; height: 42px; border-radius: 8px; border: 1px solid #e2e8f0; display: inline-block; }
      code { background: #f1f5f9; padding: .1rem .35rem; border-radius: 4px; }
      ul { padding-left: 1.1rem; }
    </style>
  </head>
  <body>
    <h1>${tokens.name ?? 'Design System'}</h1>
    <div class="tone">${tokens.tone ? `Tone: ${tokens.tone}` : ''}${tokens.radius ? ` &middot; Radius: ${tokens.radius}` : ''}</div>
    <h2>Colors</h2>
${swatches || '      <p>(none)</p>'}
    <h2>Type</h2>
    <ul>
${fonts || '      <li>(none)</li>'}
    </ul>
    <h2>Provider remaps</h2>
    <ul>
${remaps || '      <li>(none recorded)</li>'}
    </ul>
    <p><em>Approve to weave the screens, or edit DESIGN.md and re-sync.</em></p>
  </body>
</html>
`;
}

export interface DesignSummary {
  name?: string;
  colors: Record<string, string>;
  fonts: string[];
  remaps: Array<{ from: string; to: string }>;
  tone?: string;
  device?: string;
  /** Where `colors` came from: the provider's real resolved theme, or the DESIGN.md tokens. */
  paletteSource: 'provider-resolved' | 'design-md';
  preview: string;
}

export function writeDesignPreview(runFolder: string, designMd: string, clock?: Clock): DesignSummary {
  const manifest = readManifest(runFolder);
  const tokens = parseDesignTokens(designMd);
  const roleMap = manifest.designSystem?.roleMap ?? {};
  const resolved = manifest.designSystem?.resolved;

  // Prefer the provider's ACTUAL resolved palette when we have it (truthful gate).
  const hasResolved = !!(resolved?.namedColors && Object.keys(resolved.namedColors).length);
  const colors = hasResolved ? resolved!.namedColors! : tokens.colors;
  const effectiveTokens = { ...tokens, colors };

  const dir = join(runFolder, 'out', '_design');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), buildDesignPreviewHtml(effectiveTokens, roleMap), 'utf8');
  appendLog(runFolder, { event: 'design-gate', detail: { colors: Object.keys(colors).length } }, clock);

  return {
    ...(tokens.name ? { name: tokens.name } : {}),
    colors,
    fonts: Object.values(tokens.fonts),
    remaps: Object.entries(roleMap).map(([from, to]) => ({ from, to })),
    ...(tokens.tone ? { tone: tokens.tone } : {}),
    ...(manifest.designSystem?.device ? { device: manifest.designSystem.device } : {}),
    paletteSource: hasResolved ? 'provider-resolved' : 'design-md',
    preview: join('out', '_design', 'index.html'),
  };
}
