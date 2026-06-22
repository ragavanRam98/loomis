import { describe, it, expect } from 'vitest';
import { FakeProvider } from '../src/provider/fake';
import type { UIProvider } from '../src/provider/uiprovider';

describe('UIProvider port + FakeProvider (test oracle)', () => {
  it('exposes the full port surface and capability flags (supportsDelete=false)', () => {
    const p: UIProvider = new FakeProvider();
    expect(typeof p.createProject).toBe('function');
    expect(typeof p.syncDesignSystem).toBe('function');
    expect(typeof p.generateScreen).toBe('function');
    expect(typeof p.awaitScreen).toBe('function');
    expect(p.capabilities).toMatchObject({
      supportsDesignMd: true,
      returnsCode: true,
      returnsScreenshot: true,
      supportsDelete: false,
    });
  });

  it('has NO destructive method on the port (FR-17 edge)', () => {
    const p = new FakeProvider() as unknown as Record<string, unknown>;
    expect(p.deleteProject).toBeUndefined();
    expect(p.delete).toBeUndefined();
    expect(p.destroy).toBeUndefined();
  });

  it('drives a full create->sync->generate->await cycle deterministically, no network', async () => {
    const p = new FakeProvider();
    const projectId = await p.createProject('test');
    expect(projectId).toBe('fake-project-1');

    const ds = await p.syncDesignSystem(projectId, '# DESIGN.md');
    expect(ds).toEqual({ assetId: 'fake-asset-1', roleMap: { primary: 'primary-container' } });

    const handle = await p.generateScreen(projectId, 'a prompt', { designSystemId: ds.assetId });
    expect(handle).toMatchObject({ projectId: 'fake-project-1', screenId: 'fake-screen-1' });

    const result = await p.awaitScreen(handle);
    expect(result.html).toContain('data-nav');
    expect(result.html).toContain('fake-screen-1');
    expect(result.screenshot).toBeInstanceOf(Uint8Array);
    expect(result.meta).toMatchObject({ provider: 'fake' });
  });

  it('counts calls so later stories can assert provider interactions', async () => {
    const p = new FakeProvider();
    await p.createProject();
    await p.generateScreen('fake-project-1', 'a');
    await p.generateScreen('fake-project-1', 'b');
    expect(p.calls).toMatchObject({ createProject: 1, generateScreen: 2, syncDesignSystem: 0 });
  });

  it('is deterministic across fresh instances for stable ids', async () => {
    const a = new FakeProvider();
    const b = new FakeProvider();
    expect(await a.createProject()).toBe(await b.createProject());
    const ha = await a.generateScreen('p', 'x');
    const hb = await b.generateScreen('p', 'x');
    expect(ha.screenId).toBe(hb.screenId);
  });
});
