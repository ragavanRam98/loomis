// The manifest is the flat JSON "receipt": the sole agent<->core interface and the
// index over the local bytes. It is ajv-validated on every read AND write.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import schema from '../schema/manifest.schema.json';
import type { Manifest } from './types';

export const MANIFEST_FILE = 'manifest.json';

const ajv = new Ajv({ allErrors: true });
const validateManifest = ajv.compile<Manifest>(schema as object);

/** Thrown when a manifest fails schema validation; carries a machine-readable code. */
export class ManifestError extends Error {
  readonly code: string;
  constructor(message: string, code = 'MANIFEST_INVALID') {
    super(message);
    this.name = 'ManifestError';
    this.code = code;
  }
}

/** Validate arbitrary data as a Manifest; throws ManifestError on failure. */
export function validate(data: unknown): Manifest {
  if (!validateManifest(data)) {
    const detail = ajv.errorsText(validateManifest.errors, { separator: '; ' });
    throw new ManifestError(`manifest validation failed: ${detail}`);
  }
  return data as Manifest;
}

export function emptyManifest(): Manifest {
  return { entry: [], edges: [], unresolved: [], screens: [] };
}

export function readManifest(runFolder: string): Manifest {
  const raw = readFileSync(join(runFolder, MANIFEST_FILE), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ManifestError('manifest.json is not valid JSON', 'MANIFEST_PARSE');
  }
  return validate(parsed);
}

export function writeManifest(runFolder: string, manifest: Manifest): void {
  validate(manifest); // never write an invalid receipt
  writeFileSync(join(runFolder, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8');
}
