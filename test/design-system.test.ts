import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncDesignSystem } from '../src/design-system';
import { generateOneScreen } from '../src/generate';
import { FakeProvider } from '../src/provider/fake';
import { readManifest } from '../src/manifest';
import type { GenerateOptions, ScreenHandle } from '../src/provider/uiprovider';

/** Captures the device option passed to generateScreen. */
class DeviceCapturingProvider extends FakeProvider {
  lastDevice: string | undefined;
  override async generateScreen(p: string, prompt: string, o?: GenerateOptions): Promise<ScreenHandle> {
    this.lastDevice = o?.device;
    return super.generateScreen(p, prompt, o);
  }
}

/** Captures the title passed to createProject. */
class NameCapturingProvider extends FakeProvider {
  lastTitle: string | undefined;
  override async createProject(title?: string): Promise<string> {
    this.lastTitle = title;
    return super.createProject(title);
  }
}

describe('syncDesignSystem (FR-1/2/3)', () => {
  it('creates a project, instantiates a pinned design system, records assetId + roleMap (FR-1/2)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-ds-'));
    try {
      const provider = new FakeProvider();
      const m = await syncDesignSystem(dir, provider, '# DESIGN.md\nname: Test');

      expect(m.projectId).toBe('fake-project-1');
      expect(m.designSystem).toMatchObject({
        assetId: 'fake-asset-1',
        source: 'DESIGN.md',
        roleMap: { primary: 'primary-container' },
      });
      expect(typeof m.designSystem?.designMdHash).toBe('string');

      const reread = readManifest(dir);
      expect(reread.designSystem?.assetId).toBe('fake-asset-1');
      expect(provider.calls).toMatchObject({ createProject: 1, syncDesignSystem: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-instantiates on a subsequent run, reusing the project (FR-3, no blob diff)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-ds2-'));
    try {
      const provider = new FakeProvider();
      await syncDesignSystem(dir, provider, '# v1');
      await syncDesignSystem(dir, provider, '# v2 changed');

      // Project created once (reused); design system synced twice (re-instantiate, not diff).
      expect(provider.calls).toMatchObject({ createProject: 1, syncDesignSystem: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records DESIGN.md `device:` and passes it through to generation (device intent)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-dev-'));
    try {
      const provider = new DeviceCapturingProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md\ndevice: mobile\nprimary: "#ffffff"');
      expect(readManifest(dir).designSystem?.device).toBe('mobile');

      await generateOneScreen(dir, provider, { screenId: 'x', prompt: 'p' });
      expect(provider.lastDevice).toBe('mobile');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the provider project after the app (DESIGN.md name:)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'loomis-name-'));
    try {
      const provider = new NameCapturingProvider();
      await syncDesignSystem(dir, provider, '# DESIGN.md\nname: Acme Tasks\nprimary: "#ffffff"');
      expect(provider.lastTitle).toBe('Acme Tasks');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
