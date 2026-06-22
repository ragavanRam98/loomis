// Add a NEW screen to a live prototype - the additive sibling of `refine` (replace the selected
// screen) and `suggest` (alternative takes OF a screen). The studio can now GROW the app: clone a
// source screen's compiled spec, apply a modifier instruction, and generate it under a fresh
// surface + id. Non-destructive - the source screen is untouched, and the new screen shows up on
// the prototype index automatically (assemble bundles every `done` screen in the manifest).

import { readManifest, writeManifest } from './manifest';
import { compileScreen } from './compile';
import { generateOneScreen } from './generate';
import { slugify } from './slug';
import { appendLog, progress } from './log';
import type { Clock } from './log';
import type { UIProvider } from './provider/uiprovider';

export class AddScreenError extends Error {
  readonly code: string;
  constructor(message: string, code = 'ADD_SCREEN_ERROR') {
    super(message);
    this.name = 'AddScreenError';
    this.code = code;
  }
}

export interface AddScreenResult {
  screenId: string;
  surface: string;
}

// Short, recognisable qualifiers we can lift out of free text to name the new screen.
const QUALIFIERS = [
  'light',
  'dark',
  'compact',
  'expanded',
  'empty',
  'error',
  'loading',
  'success',
  'mobile',
  'desktop',
  'tablet',
  'minimal',
  'detailed',
  'onboarding',
];

function qualifier(instruction: string): string | null {
  const t = instruction.toLowerCase();
  for (const q of QUALIFIERS) {
    if (new RegExp('\\b' + q + '\\b').test(t)) return q.charAt(0).toUpperCase() + q.slice(1);
  }
  return null;
}

/** A clean, unique surface name for the new screen: "Profile (Light)", else "Profile 2". */
export function deriveSurface(baseSurface: string, instruction: string, taken: Set<string>): string {
  const q = qualifier(instruction);
  const make = (n: number): string =>
    q ? (n === 1 ? `${baseSurface} (${q})` : `${baseSurface} (${q} ${n})`) : `${baseSurface} ${n + 1}`;
  let n = 1;
  let name = make(n);
  while (taken.has(name.toLowerCase())) {
    n++;
    name = make(n);
  }
  return name;
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base || 'screen';
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n++;
  }
  return id;
}

/**
 * Generate a brand-new screen derived from `baseScreenId`, modified by `instruction`. The new
 * screen lands as its own surface/id in the manifest and is generated immediately. The source
 * screen is never touched. Returns the new screen's id + surface.
 */
export async function addScreen(
  runFolder: string,
  provider: UIProvider,
  experienceMd: string,
  baseScreenId: string,
  instruction: string,
  clock?: Clock,
): Promise<AddScreenResult> {
  const text = instruction.trim();
  if (!text) throw new AddScreenError('empty instruction - nothing to base the new screen on', 'EMPTY_INSTRUCTION');

  const manifest = readManifest(runFolder);
  if (!manifest.projectId) throw new AddScreenError('no projectId in manifest - sync first', 'NO_PROJECT');

  const base = manifest.screens.find((s) => s.screenId === baseScreenId);
  if (!base || !base.surface) {
    throw new AddScreenError(`unknown base screen: ${baseScreenId}`, 'UNKNOWN_SCREEN');
  }

  const takenSurfaces = new Set(manifest.screens.map((s) => (s.surface ?? s.screenId).toLowerCase()));
  const surface = deriveSurface(base.surface, text, takenSurfaces);
  const screenId = uniqueId(slugify(surface), new Set(manifest.screens.map((s) => s.screenId)));

  // Build the prompt from the SOURCE surface's compiled spec, then layer the modifier on top.
  const compiled = compileScreen(experienceMd, base.surface, manifest.designSystem?.assetId);
  const prompt =
    `${compiled.prompt}\n\nThis is a NEW, separate screen - a variation of "${base.surface}". ` +
    `Apply this change: ${text}. Keep the same overall structure, content, and navigation unless ` +
    `the change requires otherwise.`;

  // Insert the pending record BEFORE generating, so a live board sees it appear.
  manifest.screens.push({ screenId, surface, status: 'pending', ...(base.story ? { story: base.story } : {}) });
  writeManifest(runFolder, manifest);
  appendLog(
    runFolder,
    { event: 'add-screen', screenId, detail: { from: baseScreenId, surface, instruction: text } },
    clock,
  );

  progress(`Adding a new screen "${surface}" (from ${base.surface})…`);
  await generateOneScreen(
    runFolder,
    provider,
    {
      screenId,
      surface,
      prompt,
      expectedContent: compiled.expectedContent,
      ...(base.story ? { story: base.story } : {}),
    },
    clock ? { clock } : {},
  );

  progress(`Added "${surface}". It joins the prototype index; finish to wire + assemble.`);
  return { screenId, surface };
}
