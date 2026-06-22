// Review board (FR-11): a PURE projection of the manifest - one row per screen with exactly
// one badge (CLEAN / REVIEW / FAILED), each linking to the rendered screen. board() adds no
// state of its own and never mutates the manifest.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from './manifest';
import { appendLog } from './log';
import type { Clock } from './log';
import type { Manifest, ScreenRecord } from './types';

export type Badge = 'CLEAN' | 'REVIEW' | 'FAILED';

export function badgeFor(s: ScreenRecord): Badge {
  if (s.status === 'failed') return 'FAILED';
  if (s.status !== 'done') return 'REVIEW'; // pending / in-flight
  if ((s.omissions?.length ?? 0) > 0 || s.review?.verdict === 'rejected') return 'REVIEW';
  return 'CLEAN';
}

export function buildBoard(manifest: Manifest): string {
  const rows = manifest.screens
    .map((s) => {
      const badge = badgeFor(s);
      const cell =
        s.status === 'done' && s.htmlPath
          ? `<a href="../${s.screenId}.html">${s.screenId}</a>`
          : s.screenId;
      return `      <tr class="badge-${badge.toLowerCase()}"><td>${cell}</td><td>${badge}</td><td>${s.story ?? ''}</td></tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Loomis - Review Board</title>
  </head>
  <body>
    <h1>Review Board</h1>
    <table>
      <thead><tr><th>Screen</th><th>Status</th><th>Story</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </body>
</html>
`;
}

export function writeBoard(runFolder: string, clock?: Clock): string {
  const manifest = readManifest(runFolder);
  const boardDir = join(runFolder, 'out', '_board');
  mkdirSync(boardDir, { recursive: true });
  const html = buildBoard(manifest);
  writeFileSync(join(boardDir, 'index.html'), html, 'utf8');
  appendLog(runFolder, { event: 'board', detail: { screens: manifest.screens.length } }, clock);
  return html;
}
