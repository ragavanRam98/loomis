import { describe, it, expect } from 'vitest';
import { StitchProvider } from '../src/provider/stitch';
import type { UIProvider } from '../src/provider/uiprovider';

interface CapturedCall {
  url: unknown;
  init: { headers: Record<string, string>; body: string };
}

function recordingFetch(payload: unknown, ok = true, status = 200): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    calls.push({ url, init: init as CapturedCall['init'] });
    return { ok, status, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function sequencedFetch(payloads: unknown[]): { fetchImpl: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  let i = 0;
  const fetchImpl = (async (url: unknown, init: unknown) => {
    calls.push({ url, init: init as CapturedCall['init'] });
    const payload = payloads[Math.min(i, payloads.length - 1)];
    i += 1;
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** Per-call responses with json/text/bytes (for raw download fetches). */
function responsesFetch(
  seq: Array<{ json?: unknown; text?: string; bytes?: Uint8Array; ok?: boolean; status?: number }>,
): typeof fetch {
  let i = 0;
  return (async () => {
    const r = seq[Math.min(i, seq.length - 1)]!;
    i += 1;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.json,
      text: async () => r.text ?? '',
      arrayBuffer: async () => (r.bytes ?? new Uint8Array()).buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function throwThenFetch(error: Error, then: unknown): typeof fetch {
  let first = true;
  return (async () => {
    if (first) {
      first = false;
      throw error;
    }
    return { ok: true, status: 200, json: async () => then } as unknown as Response;
  }) as unknown as typeof fetch;
}

function envelope(obj: unknown): unknown {
  return { jsonrpc: '2.0', id: 1, result: { content: [{ text: JSON.stringify(obj) }] } };
}

describe('StitchProvider (direct transport)', () => {
  it('implements UIProvider and has no destructive method', () => {
    const p: UIProvider = new StitchProvider({ apiKey: 'k', fetchImpl: recordingFetch({}).fetchImpl });
    expect(p.capabilities.supportsDelete).toBe(false);
    const asRec = p as unknown as Record<string, unknown>;
    expect(asRec.deleteProject).toBeUndefined();
    expect(asRec.destroy).toBeUndefined();
  });

  it('createProject sends X-Goog-Api-Key and returns the stripped projectId', async () => {
    const { fetchImpl, calls } = recordingFetch(envelope({ name: 'projects/12345', title: 't' }));
    const p = new StitchProvider({ apiKey: 'secret-key', fetchImpl });
    const projectId = await p.createProject('My App');
    expect(projectId).toBe('12345');
    expect(calls[0]!.init.headers['X-Goog-Api-Key']).toBe('secret-key');
    expect(JSON.parse(calls[0]!.init.body)).toMatchObject({
      params: { name: 'create_project', arguments: { title: 'My App' } },
    });
  });

  it('syncDesignSystem uploads, instantiates, and reads back the REAL resolved theme', async () => {
    const { fetchImpl, calls } = sequencedFetch([
      envelope({ id: 'inst-1', sourceScreen: 'projects/p/screens/s' }),
      envelope({ assetId: 'asset-xyz' }),
      envelope({
        designSystems: [
          {
            name: 'assets/asset-xyz',
            designSystem: {
              theme: {
                namedColors: { 'deal-yellow': '#FFE11B', primary: '#0056c3' },
                customColor: '#2874f0',
                font: 'INTER',
              },
            },
          },
        ],
      }),
    ]);
    const p = new StitchProvider({ apiKey: 'k', fetchImpl });
    const ds = await p.syncDesignSystem('12345', 'primary: "#2874F0"\ndeal: "#FFE11B"');

    expect(ds.assetId).toBe('asset-xyz');
    expect(ds.resolved?.namedColors?.['deal-yellow']).toBe('#FFE11B');
    expect(ds.resolved?.customColor).toBe('#2874f0');
    // Real remap derived by hex-match: DESIGN.md `deal:#FFE11B` -> resolved role `deal-yellow`.
    expect(ds.roleMap).toMatchObject({ deal: 'deal-yellow' });

    expect(JSON.parse(calls[0]!.init.body).params.name).toBe('upload_design_md');
    expect(JSON.parse(calls[1]!.init.body).params.name).toBe('create_design_system_from_design_md');
    expect(JSON.parse(calls[2]!.init.body).params.name).toBe('list_design_systems');
  });

  it('generateScreen calls generate_screen_from_text and returns the screen handle', async () => {
    const { fetchImpl, calls } = recordingFetch(
      envelope({ projectId: '12345', outputComponents: [{ design: { name: 'projects/12345/screens/deadbeef' } }] }),
    );
    const p = new StitchProvider({ apiKey: 'k', fetchImpl });
    const handle = await p.generateScreen('12345', 'PROMPT', { designSystemId: 'assets/abc' });
    expect(handle).toMatchObject({ projectId: '12345', screenId: 'deadbeef' });
    const body = JSON.parse(calls[0]!.init.body);
    expect(body.params.name).toBe('generate_screen_from_text');
    expect(body.params.arguments.designSystem).toBe('assets/abc');
    expect(body.params.arguments.deviceType).toBe('DESKTOP');
  });

  it('generateScreen reconciles on a dropped connection (never re-issues generate)', async () => {
    const listEnv = envelope({ screens: [{ name: 'projects/12345/screens/recovered' }] });
    const fetchImpl = throwThenFetch(new Error('fetch failed'), listEnv);
    const p = new StitchProvider({ apiKey: 'k', fetchImpl });
    const handle = await p.generateScreen('12345', 'x');
    expect(handle.screenId).toBe('recovered');
  });

  it('awaitScreen polls get_screen then fetches the html + screenshot bytes', async () => {
    const fetchImpl = responsesFetch([
      { json: envelope({ htmlCode: { downloadUrl: 'https://x/html' }, screenshot: { downloadUrl: 'https://x/shot' } }) },
      { text: '<html><a data-nav="next" href="#">hi</a></html>' },
      { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    ]);
    const p = new StitchProvider({ apiKey: 'k', fetchImpl });
    const result = await p.awaitScreen({ projectId: '12345', screenId: 'abc' });
    expect(result.html).toContain('data-nav');
    expect(result.screenshot).toBeInstanceOf(Uint8Array);
    expect(result.screenshot?.length).toBe(4);
  });

  it('throws PROVIDER_NO_KEY when no key is configured', () => {
    const saved = process.env.STITCH_API_KEY;
    delete process.env.STITCH_API_KEY;
    try {
      expect(() => new StitchProvider({})).toThrowError(/STITCH_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.STITCH_API_KEY = saved;
    }
  });

  it('never leaks the api key in a thrown transport error', async () => {
    const { fetchImpl } = recordingFetch({}, false, 403);
    const p = new StitchProvider({ apiKey: 'super-secret-123', fetchImpl });
    try {
      await p.createProject('x');
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('super-secret-123');
    }
  });
});
