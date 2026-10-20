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

/** Per-call responses as `responsesFetch` gives them, recording each JSON-RPC request's body (none for downloads). */
function recordingResponsesFetch(seq: Array<{ json?: unknown; text?: string; bytes?: Uint8Array }>): {
  fetchImpl: typeof fetch;
  bodies: Array<{ params?: { name?: string; arguments?: Record<string, unknown> } } | undefined>;
} {
  const bodies: Array<{ params?: { name?: string; arguments?: Record<string, unknown> } } | undefined> = [];
  let i = 0;
  const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
    bodies.push(init?.body ? JSON.parse(init.body) : undefined);
    const r = seq[Math.min(i, seq.length - 1)]!;
    i += 1;
    return {
      ok: true,
      status: 200,
      json: async () => r.json,
      text: async () => r.text ?? '',
      arrayBuffer: async () => (r.bytes ?? new Uint8Array()).buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

/** The arguments of every get_screen request recorded. */
function getScreenArguments(bodies: ReturnType<typeof recordingResponsesFetch>['bodies']): unknown[] {
  return bodies.filter((b) => b?.params?.name === 'get_screen').map((b) => b?.params?.arguments);
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

  // Stitch can name a screen it reused, such as a logo, beside the new page: the page is the one with a device type.
  it('generateScreen takes the page when its answer also names an asset', async () => {
    const { fetchImpl, bodies } = recordingResponsesFetch([
      {
        json: envelope({
          outputComponents: [
            { design: { name: 'projects/12345/screens/page1' } },
            { image: { name: 'projects/12345/screens/logo1' } },
          ],
        }),
      },
      { json: envelope({ name: 'projects/12345/screens/logo1', title: 'Logo' }) },
      { json: envelope({ name: 'projects/12345/screens/page1', title: 'Checkout', deviceType: 'MOBILE' }) },
    ]);
    const p = new StitchProvider({ apiKey: 'k', fetchImpl });
    const handle = await p.generateScreen('12345', 'PROMPT');
    expect(handle).toMatchObject({ screenId: 'page1', jobRef: 'projects/12345/screens/page1' });
    expect(getScreenArguments(bodies)).toEqual([
      { name: 'projects/12345/screens/logo1' },
      { name: 'projects/12345/screens/page1' },
    ]);
  });

  it('generateScreen asks nothing more when its answer names one screen', async () => {
    const { fetchImpl, bodies } = recordingResponsesFetch([
      { json: envelope({ outputComponents: [{ design: { name: 'projects/12345/screens/only' } }] }) },
    ]);
    const p = new StitchProvider({ apiKey: 'k', fetchImpl });
    const handle = await p.generateScreen('12345', 'PROMPT');
    expect(handle.screenId).toBe('only');
    expect(bodies).toHaveLength(1);
  });

  it('generateScreen takes the last screen when none it names is a page', async () => {
    const { fetchImpl } = recordingResponsesFetch([
      {
        json: envelope({
          outputComponents: [{ image: { name: 'projects/12345/screens/a1' } }, { image: { name: 'projects/12345/screens/a2' } }],
        }),
      },
      { json: envelope({ name: 'projects/12345/screens/a2' }) },
      { json: envelope({ name: 'projects/12345/screens/a1' }) },
    ]);
    const p = new StitchProvider({ apiKey: 'k', fetchImpl });
    const handle = await p.generateScreen('12345', 'PROMPT');
    expect(handle.screenId).toBe('a2');
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

  // Stitch's get_screen takes the screen's resource name alone, and refuses a request with any other field.
  it('awaitScreen asks get_screen for the screen by its resource name alone', async () => {
    const { fetchImpl, bodies } = recordingResponsesFetch([
      { json: envelope({ htmlCode: { downloadUrl: 'https://x/html' } }) },
      { text: '<html></html>' },
    ]);
    const p = new StitchProvider({ apiKey: 'k', fetchImpl });
    await p.awaitScreen({ projectId: '12345', screenId: 'abc', jobRef: 'projects/12345/screens/abc' });
    expect(getScreenArguments(bodies)).toEqual([{ name: 'projects/12345/screens/abc' }]);
  });

  it('editScreen asks get_screen by the resource name alone, before the edit and while it lands', async () => {
    const { fetchImpl, bodies } = recordingResponsesFetch([
      { json: envelope({ htmlCode: { name: 'files/before', downloadUrl: 'https://x/before' } }) },
      { json: envelope({ outputComponents: [{ design: { name: 'projects/12345/screens/abc' } }] }) },
      { json: envelope({ htmlCode: { name: 'files/after', downloadUrl: 'https://x/after' } }) },
      { text: '<html>edited</html>' },
    ]);
    const p = new StitchProvider({ apiKey: 'k', fetchImpl });
    const result = await p.editScreen('12345', 'abc', 'make it calmer');
    expect(result.html).toContain('edited');
    expect(getScreenArguments(bodies)).toEqual([
      { name: 'projects/12345/screens/abc' },
      { name: 'projects/12345/screens/abc' },
    ]);
  });

  it('generateVariants asks get_screen for each new option by its resource name alone', async () => {
    const { fetchImpl, bodies } = recordingResponsesFetch([
      { json: envelope({ screens: [{ name: 'projects/12345/screens/abc' }] }) },
      { json: envelope({}) },
      { json: envelope({ screens: [{ name: 'projects/12345/screens/abc' }, { name: 'projects/12345/screens/v1' }] }) },
      { json: envelope({ htmlCode: { downloadUrl: 'https://x/v1' } }) },
      { text: '<html>v1</html>' },
    ]);
    const p = new StitchProvider({ apiKey: 'k', fetchImpl });
    const options = await p.generateVariants('12345', 'abc', 'try another layout', { count: 1 });
    expect(options.map((o) => o.screenId)).toEqual(['v1']);
    expect(getScreenArguments(bodies)).toEqual([{ name: 'projects/12345/screens/v1' }]);
  });

  // A tool that ran but failed answers HTTP 200 with isError and its message: an error at once, not an answer to wait on.
  it('throws a tool error with its message at once rather than polling until the wait runs out', async () => {
    const { fetchImpl } = recordingFetch({
      jsonrpc: '2.0',
      id: 1,
      result: { isError: true, content: [{ type: 'text', text: 'Request contains an invalid argument.' }] },
    });
    const p = new StitchProvider({ apiKey: 'k', fetchImpl });
    await expect(p.awaitScreen({ projectId: '12345', screenId: 'abc' })).rejects.toMatchObject({
      code: 'PROVIDER_TOOL_ERROR',
      message: 'provider tool error for get_screen: Request contains an invalid argument.',
    });
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
