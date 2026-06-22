// The Stitch adapter - implements the UIProvider port over the direct transport.
// createProject (1.3) · syncDesignSystem (1.4) · generateScreen/awaitScreen (1.5).

import { mcpToolCall, ProviderError } from './transport';
import type { McpTransportOptions } from './transport';
import { pollUntil, isConnectionError } from '../poll';
import type { ResolvedTheme } from '../types';
import type {
  UIProvider,
  ProviderCapabilities,
  DesignSystemResult,
  ScreenHandle,
  ScreenResult,
  EditResult,
  VariantOption,
  VariantGenOptions,
  GenerateOptions,
} from './uiprovider';

export interface StitchOptions extends McpTransportOptions {
  /** Explicit key (tests); otherwise read once from process.env.STITCH_API_KEY. */
  apiKey?: string;
}

const SCREEN_REF = /projects\/[^/"\s]+\/screens\/[0-9A-Za-z]+/g;

/** Find the newest `projects/{id}/screens/{id}` reference anywhere in a provider result. */
function findScreenRef(result: unknown): string | undefined {
  const matches = JSON.stringify(result ?? {}).match(SCREEN_REF);
  return matches ? matches[matches.length - 1] : undefined;
}

interface StitchTheme {
  namedColors?: Record<string, string>;
  customColor?: string;
  font?: string;
  roundness?: string;
  colorMode?: string;
}

/** Hex-valued tokens declared in DESIGN.md (name -> hex). */
function parseSourceColors(designMd: string): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const raw of designMd.split('\n')) {
    const m = raw
      .replace(/^[-*]\s+/, '')
      .trim()
      .match(/^([A-Za-z][\w-]*)\s*:\s*"?(#[0-9a-fA-F]{3,8})"?\s*$/);
    if (m && m[1] && m[2]) colors[m[1]] = m[2];
  }
  return colors;
}

/** Derive the REAL role remap by hex-matching DESIGN.md tokens to the resolved namedColors. */
function deriveRoleMap(
  source: Record<string, string>,
  namedColors: Record<string, string>,
): Record<string, string> {
  const norm = (h: string): string => h.replace('#', '').toLowerCase();
  const byHex = new Map<string, string[]>();
  for (const [role, hex] of Object.entries(namedColors)) {
    const key = norm(hex);
    const arr = byHex.get(key) ?? [];
    arr.push(role);
    byHex.set(key, arr);
  }
  const roleMap: Record<string, string> = {};
  for (const [name, hex] of Object.entries(source)) {
    const roles = byHex.get(norm(hex)) ?? [];
    if (roles.length > 2) continue; // shared color (white/black/etc.) -> not a meaningful remap
    if (roles.includes(name)) continue; // kept its name -> no remap
    const remapped = roles.find((r) => r.replace(/[_-]/g, '') !== name.replace(/[_-]/g, ''));
    if (remapped) roleMap[name] = remapped;
  }
  return roleMap;
}

export class StitchProvider implements UIProvider {
  readonly name = 'stitch';

  readonly capabilities: ProviderCapabilities = {
    supportsDesignMd: true,
    returnsCode: true,
    returnsScreenshot: true,
    supportsDelete: false,
  };

  // The secret is read in exactly ONE place and never logged.
  private readonly apiKey: string;
  private readonly transportOpts: McpTransportOptions;

  constructor(opts: StitchOptions = {}) {
    const key = opts.apiKey ?? process.env.STITCH_API_KEY;
    if (!key) {
      throw new ProviderError('STITCH_API_KEY is not set', 'PROVIDER_NO_KEY');
    }
    this.apiKey = key;
    this.transportOpts = { fetchImpl: opts.fetchImpl, endpoint: opts.endpoint };
  }

  private get fetchImpl(): typeof fetch {
    return this.transportOpts.fetchImpl ?? fetch;
  }

  async createProject(title?: string): Promise<string> {
    const args = title ? { title } : {};
    const result = (await mcpToolCall(this.apiKey, 'create_project', args, this.transportOpts)) as {
      name?: string;
    };
    if (!result?.name) {
      throw new ProviderError('create_project returned no project name', 'PROVIDER_BAD_RESPONSE');
    }
    return result.name.replace(/^projects\//, '');
  }

  async syncDesignSystem(projectId: string, designMd: string): Promise<DesignSystemResult> {
    const designMdBase64 = Buffer.from(designMd, 'utf8').toString('base64');
    const instance = (await mcpToolCall(
      this.apiKey,
      'upload_design_md',
      { projectId, designMdBase64 },
      this.transportOpts,
    )) as { id?: string; sourceScreen?: string };
    if (!instance?.id || !instance?.sourceScreen) {
      throw new ProviderError('upload_design_md returned no screen instance', 'PROVIDER_BAD_RESPONSE');
    }
    const ds = (await mcpToolCall(
      this.apiKey,
      'create_design_system_from_design_md',
      { projectId, selectedScreenInstance: { id: instance.id, sourceScreen: instance.sourceScreen } },
      this.transportOpts,
    )) as { assetId?: string };
    if (!ds?.assetId) {
      throw new ProviderError(
        'create_design_system_from_design_md returned no assetId',
        'PROVIDER_BAD_RESPONSE',
      );
    }
    const assetId = ds.assetId;

    // Read back the REAL resolved theme so the design-gate shows the truth (best-effort).
    let resolved: ResolvedTheme | undefined;
    let roleMap: Record<string, string> = {};
    try {
      const list = (await mcpToolCall(this.apiKey, 'list_design_systems', { projectId }, this.transportOpts)) as {
        designSystems?: Array<{ name?: string; designSystem?: { theme?: StitchTheme } }>;
      };
      const systems = list.designSystems ?? [];
      const match = systems.find((s) => (s.name ?? '').includes(assetId)) ?? systems[systems.length - 1];
      const theme = match?.designSystem?.theme;
      if (theme) {
        resolved = {
          ...(theme.namedColors ? { namedColors: theme.namedColors } : {}),
          ...(theme.customColor ? { customColor: theme.customColor } : {}),
          ...(theme.font ? { font: theme.font } : {}),
          ...(theme.roundness ? { roundness: theme.roundness } : {}),
          ...(theme.colorMode ? { colorMode: theme.colorMode } : {}),
        };
        roleMap = deriveRoleMap(parseSourceColors(designMd), theme.namedColors ?? {});
      }
    } catch {
      // readback is best-effort; an empty roleMap is honest (better than a fabricated one).
    }

    return { assetId, roleMap, ...(resolved ? { resolved } : {}) };
  }

  async generateScreen(
    projectId: string,
    prompt: string,
    opts?: GenerateOptions,
  ): Promise<ScreenHandle> {
    const args: Record<string, unknown> = {
      projectId,
      prompt,
      deviceType: (opts?.device ?? 'desktop').toUpperCase(),
    };
    if (opts?.designSystemId) args.designSystem = opts.designSystemId;

    let result: unknown;
    try {
      result = await mcpToolCall(this.apiKey, 'generate_screen_from_text', args, this.transportOpts);
    } catch (e) {
      if (!isConnectionError(e)) throw e;
      // Dropped connection: generation may have SILENTLY SUCCEEDED. Reconcile by listing
      // screens - never re-issue generate (which would orphan a duplicate, no delete API).
      result = await mcpToolCall(this.apiKey, 'list_screens', { projectId }, this.transportOpts);
    }

    let ref = findScreenRef(result);
    if (!ref) {
      // The generate response may not embed the screen ref; recover the newest screen.
      const listed = await mcpToolCall(this.apiKey, 'list_screens', { projectId }, this.transportOpts);
      ref = findScreenRef(listed);
    }
    if (!ref) {
      throw new ProviderError('generate_screen_from_text returned no screen', 'PROVIDER_BAD_RESPONSE');
    }
    const screenId = ref.split('/').pop() ?? ref;
    return { projectId, screenId, jobRef: ref };
  }

  async editScreen(
    projectId: string,
    screenId: string,
    feedback: string,
    opts?: GenerateOptions,
  ): Promise<EditResult> {
    // Capture the current file ref so we can tell when the edit has actually landed
    // (get_screen keeps returning the PRE-edit html until generation finishes).
    let priorFile: string | undefined;
    try {
      const cur = (await mcpToolCall(
        this.apiKey,
        'get_screen',
        { name: `projects/${projectId}/screens/${screenId}`, projectId, screenId },
        this.transportOpts,
      )) as { htmlCode?: { name?: string } };
      priorFile = cur.htmlCode?.name;
    } catch {
      // best-effort; if we can't read the prior ref we just poll for html presence
    }

    const args: Record<string, unknown> = {
      projectId,
      selectedScreenIds: [screenId],
      prompt: feedback,
      deviceType: (opts?.device ?? 'desktop').toUpperCase(),
    };

    let result: unknown;
    try {
      result = await mcpToolCall(this.apiKey, 'edit_screens', args, this.transportOpts);
    } catch (e) {
      if (!isConnectionError(e)) throw e;
      // Dropped connection: the edit may have SILENTLY SUCCEEDED - reconcile, never re-issue.
      result = await mcpToolCall(this.apiKey, 'list_screens', { projectId }, this.transportOpts);
    }

    // The edit may version into a NEW screen id; otherwise it edits in place.
    const ref = findScreenRef(result);
    const targetId = ref ? (ref.split('/').pop() ?? screenId) : screenId;
    const name = `projects/${projectId}/screens/${targetId}`;
    const inPlace = targetId === screenId;

    const screen = (await pollUntil(
      () =>
        mcpToolCall(
          this.apiKey,
          'get_screen',
          { name, projectId, screenId: targetId },
          this.transportOpts,
        ),
      (s) => {
        const sc = s as { htmlCode?: { downloadUrl?: string; name?: string } } | null;
        if (typeof sc?.htmlCode?.downloadUrl !== 'string') return false;
        // Editing in place: wait until the file ref differs from the pre-edit one.
        if (inPlace && priorFile && sc.htmlCode?.name === priorFile) return false;
        return true;
      },
    )) as { htmlCode?: { downloadUrl?: string }; screenshot?: { downloadUrl?: string } };

    const htmlUrl = screen.htmlCode?.downloadUrl;
    if (!htmlUrl) {
      throw new ProviderError('edit_screens produced no htmlCode download url', 'PROVIDER_BAD_RESPONSE');
    }
    const html = await (await this.fetchImpl(htmlUrl)).text();

    let screenshot: Uint8Array | undefined;
    const shotUrl = screen.screenshot?.downloadUrl;
    if (shotUrl) {
      const buf = await (await this.fetchImpl(shotUrl)).arrayBuffer();
      screenshot = new Uint8Array(buf);
    }

    return { html, screenshot, meta: { screenId: targetId, edited: true }, screenId: targetId };
  }

  async generateVariants(
    projectId: string,
    sourceScreenId: string,
    prompt: string,
    opts?: VariantGenOptions,
  ): Promise<VariantOption[]> {
    const count = Math.min(Math.max(opts?.count ?? 3, 1), 5);
    // Snapshot existing screens so we can identify the NEW ones the variants create.
    const before = new Set(await this.listScreenIds(projectId));

    const variantOptions: Record<string, unknown> = { variantCount: count };
    if (opts?.creativeRange) variantOptions.creativeRange = opts.creativeRange.toUpperCase();
    if (opts?.aspects?.length) variantOptions.aspects = opts.aspects.map((a) => a.toUpperCase().replace(/-/g, '_'));

    const args: Record<string, unknown> = {
      projectId,
      selectedScreenIds: [sourceScreenId],
      prompt,
      variantOptions,
      deviceType: (opts?.device ?? 'desktop').toUpperCase(),
    };

    try {
      await mcpToolCall(this.apiKey, 'generate_variants', args, this.transportOpts);
    } catch (e) {
      if (!isConnectionError(e)) throw e;
      // Dropped connection: the variants may still be generating - fall through and poll.
    }

    // Poll until the new options materialise (variants take minutes; never re-issue).
    const newIds = await pollUntil(
      async () => (await this.listScreenIds(projectId)).filter((id) => !before.has(id)),
      (ids) => ids.length >= count,
      { maxMs: 300000 },
    );

    const options: VariantOption[] = [];
    for (const id of newIds.slice(0, count)) {
      const res = await this.fetchScreenBytes(projectId, id);
      options.push({ screenId: id, html: res.html, ...(res.screenshot ? { screenshot: res.screenshot } : {}) });
    }
    if (options.length === 0) {
      throw new ProviderError('generate_variants produced no new screens', 'PROVIDER_BAD_RESPONSE');
    }
    return options;
  }

  private async listScreenIds(projectId: string): Promise<string[]> {
    const res = (await mcpToolCall(this.apiKey, 'list_screens', { projectId }, this.transportOpts)) as {
      screens?: Array<{ name?: string }>;
    };
    return (res.screens ?? []).map((s) => (s.name ?? '').split('/').pop() ?? '').filter((x) => x.length > 0);
  }

  private async fetchScreenBytes(projectId: string, screenId: string): Promise<ScreenResult> {
    const name = `projects/${projectId}/screens/${screenId}`;
    const screen = (await pollUntil(
      () => mcpToolCall(this.apiKey, 'get_screen', { name, projectId, screenId }, this.transportOpts),
      (s) => typeof (s as { htmlCode?: { downloadUrl?: string } } | null)?.htmlCode?.downloadUrl === 'string',
    )) as { htmlCode?: { downloadUrl?: string }; screenshot?: { downloadUrl?: string } };
    const htmlUrl = screen.htmlCode?.downloadUrl;
    if (!htmlUrl) throw new ProviderError('get_screen returned no htmlCode download url', 'PROVIDER_BAD_RESPONSE');
    const html = await (await this.fetchImpl(htmlUrl)).text();
    let screenshot: Uint8Array | undefined;
    const shotUrl = screen.screenshot?.downloadUrl;
    if (shotUrl) {
      const buf = await (await this.fetchImpl(shotUrl)).arrayBuffer();
      screenshot = new Uint8Array(buf);
    }
    return { html, screenshot, meta: { screenId } };
  }

  async awaitScreen(handle: ScreenHandle): Promise<ScreenResult> {
    const name = handle.jobRef ?? `projects/${handle.projectId}/screens/${handle.screenId}`;

    const screen = (await pollUntil(
      () =>
        mcpToolCall(
          this.apiKey,
          'get_screen',
          { name, projectId: handle.projectId, screenId: handle.screenId },
          this.transportOpts,
        ),
      (s) => typeof (s as { htmlCode?: { downloadUrl?: string } } | null)?.htmlCode?.downloadUrl === 'string',
    )) as { htmlCode?: { downloadUrl?: string }; screenshot?: { downloadUrl?: string } };

    const htmlUrl = screen.htmlCode?.downloadUrl;
    if (!htmlUrl) {
      throw new ProviderError('get_screen returned no htmlCode download url', 'PROVIDER_BAD_RESPONSE');
    }
    const html = await (await this.fetchImpl(htmlUrl)).text();

    let screenshot: Uint8Array | undefined;
    const shotUrl = screen.screenshot?.downloadUrl;
    if (shotUrl) {
      const buf = await (await this.fetchImpl(shotUrl)).arrayBuffer();
      screenshot = new Uint8Array(buf);
    }

    return { html, screenshot, meta: { screenId: handle.screenId } };
  }
}
