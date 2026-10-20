// In-memory FAKE provider - the deterministic test oracle. No network, stable ids.
// Every later story exercises provider behaviour against this instead of live Stitch.

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
  EditOptions,
} from './uiprovider';

export interface ProviderCallCounts {
  createProject: number;
  syncDesignSystem: number;
  generateScreen: number;
  awaitScreen: number;
  editScreen: number;
  generateVariants: number;
}

export class FakeProvider implements UIProvider {
  readonly name = 'fake';

  readonly capabilities: ProviderCapabilities = {
    supportsDesignMd: true,
    returnsCode: true,
    returnsScreenshot: true,
    supportsDelete: false,
  };

  /** Call counters so later stories can assert provider interactions (e.g. zero calls on skip). */
  readonly calls: ProviderCallCounts = {
    createProject: 0,
    syncDesignSystem: 0,
    generateScreen: 0,
    awaitScreen: 0,
    editScreen: 0,
    generateVariants: 0,
  };

  private seq = 0;

  /** The options the last editScreen call was given, so tests can check what an edit was handed. */
  lastEditOptions?: EditOptions;

  async createProject(_title?: string): Promise<string> {
    this.calls.createProject += 1;
    return 'fake-project-1';
  }

  async syncDesignSystem(_projectId: string, _designMd: string): Promise<DesignSystemResult> {
    this.calls.syncDesignSystem += 1;
    return { assetId: 'fake-asset-1', roleMap: { primary: 'primary-container' } };
  }

  async generateScreen(
    projectId: string,
    _prompt: string,
    _opts?: GenerateOptions,
  ): Promise<ScreenHandle> {
    this.calls.generateScreen += 1;
    this.seq += 1;
    const screenId = `fake-screen-${this.seq}`;
    return { projectId, screenId, jobRef: `job-${screenId}` };
  }

  async awaitScreen(handle: ScreenHandle): Promise<ScreenResult> {
    this.calls.awaitScreen += 1;
    const html =
      '<!doctype html>\n<html><body>\n' +
      '<a data-nav="next" href="#">Next</a>\n' +
      `<main>${handle.screenId}</main>\n` +
      '</body></html>\n';
    return {
      html,
      // Fake PNG bytes (PNG magic) - enough for ingest to persist a file in tests.
      screenshot: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      meta: { provider: 'fake', screenId: handle.screenId },
    };
  }

  async editScreen(
    _projectId: string,
    screenId: string,
    feedback: string,
    opts?: EditOptions,
  ): Promise<EditResult> {
    this.calls.editScreen += 1;
    this.lastEditOptions = opts;
    // Deterministically reflect the feedback so tests can assert the edit actually landed.
    const html =
      '<!doctype html>\n<html><body>\n' +
      '<a data-nav="next" href="#">Next</a>\n' +
      `<main>${screenId}</main>\n` +
      `<p data-edit>${feedback}</p>\n` +
      '</body></html>\n';
    return {
      html,
      screenshot: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      meta: { provider: 'fake', screenId, edited: true },
      screenId,
    };
  }

  async generateVariants(
    _projectId: string,
    sourceScreenId: string,
    prompt: string,
    opts?: VariantGenOptions,
  ): Promise<VariantOption[]> {
    this.calls.generateVariants += 1;
    const count = Math.min(Math.max(opts?.count ?? 3, 1), 5);
    const options: VariantOption[] = [];
    for (let i = 1; i <= count; i += 1) {
      options.push({
        screenId: `${sourceScreenId}-variant-${i}`,
        html:
          '<!doctype html>\n<html><body>\n' +
          '<a data-nav="next" href="#">Next</a>\n' +
          `<main>${sourceScreenId} option ${i}</main>\n` +
          `<p data-variant="${i}">${prompt}</p>\n` +
          '</body></html>\n',
        screenshot: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      });
    }
    return options;
  }
}
