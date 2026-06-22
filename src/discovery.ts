// Robust discovery of the bmad-ux inputs (NFR-5). DESIGN.md / EXPERIENCE.md are written by
// bmad-ux into a ux-{project}-{date}/ folder under those EXACT filenames (no "ux" in the
// filename - only the parent folder). So we match by exact filename recursively, NOT a
// whole-file *ux*.md glob.

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface DiscoveredInputs {
  designMd: string;
  experienceMd: string;
  stories: string[];
}

export class DiscoveryError extends Error {
  readonly code: string;
  constructor(message: string, code = 'INPUT_NOT_FOUND') {
    super(message);
    this.name = 'DiscoveryError';
    this.code = code;
  }
}

function walk(root: string, visit: (path: string, name: string, dir: string) => void): void {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(path, visit);
    } else {
      visit(path, entry.name, root);
    }
  }
}

function findByName(root: string, target: string): string[] {
  const out: string[] = [];
  walk(root, (path, name) => {
    if (name.toLowerCase() === target.toLowerCase()) out.push(path);
  });
  return out;
}

function findStories(root: string): string[] {
  const out: string[] = [];
  walk(root, (path, name, dir) => {
    if (/\.md$/i.test(name) && (/stor(y|ies)/i.test(name) || /[\\/]stories([\\/]|$)/i.test(dir))) {
      out.push(path);
    }
  });
  return out;
}

export function discoverInputs(inputDir: string): DiscoveredInputs {
  const designs = findByName(inputDir, 'DESIGN.md');
  if (designs.length === 0) {
    throw new DiscoveryError(`DESIGN.md not found under ${inputDir}`, 'NO_DESIGN_MD');
  }
  const experiences = findByName(inputDir, 'EXPERIENCE.md');
  if (experiences.length === 0) {
    throw new DiscoveryError(`EXPERIENCE.md not found under ${inputDir}`, 'NO_EXPERIENCE_MD');
  }
  return { designMd: designs[0]!, experienceMd: experiences[0]!, stories: findStories(inputDir) };
}
