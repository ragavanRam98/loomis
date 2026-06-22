// The Provider Boundary - the ONLY seam to an external AI-UI generator.
// Stitch is the first adapter (Story 1.3); the FAKE adapter (Story 1.2) is the test oracle.
// There is deliberately NO delete method on the port: Stitch has no delete_project (FR-17),
// so the boundary cannot express a destructive operation.

import type { ResolvedTheme } from '../types';

export interface ProviderCapabilities {
  /** Provider ingests a design.md-style document to instantiate a design system. */
  supportsDesignMd: boolean;
  /** awaitScreen returns real HTML code (not just an image). */
  returnsCode: boolean;
  /** awaitScreen returns a screenshot. */
  returnsScreenshot: boolean;
  /** Provider can delete server-side resources. Stitch: false. */
  supportsDelete: boolean;
}

export interface DesignSystemResult {
  /** The pinned design-system asset id, reused for all generation in the run. */
  assetId: string;
  /** Token role remaps the provider applied (e.g. deal -> deal-yellow), derived from the readback. */
  roleMap: Record<string, string>;
  /** The provider's actual resolved theme (read back), when available. */
  resolved?: ResolvedTheme;
}

export interface ScreenHandle {
  projectId: string;
  /** The provider-side screen id. */
  screenId: string;
  /** Opaque reference used to poll/recover a long-running generation. */
  jobRef?: string;
}

export interface ScreenResult {
  /** The generated standalone HTML content. */
  html: string;
  /** Screenshot bytes (PNG), already fetched by the provider; omitted if none. */
  screenshot?: Uint8Array;
  meta: Record<string, unknown>;
}

export interface GenerateOptions {
  /** Pin generation to a design-system asset id for consistency. */
  designSystemId?: string;
  device?: 'mobile' | 'desktop' | 'tablet' | 'agnostic';
}

/** Result of a directed edit - the finished bytes plus the (possibly re-versioned) screen id. */
export interface EditResult extends ScreenResult {
  /** The provider-side screen id of the edited screen (may differ if the provider versions it). */
  screenId: string;
}

/** One alternative design option produced by generateVariants. */
export interface VariantOption {
  /** The provider-side screen id for this option. */
  screenId: string;
  html: string;
  screenshot?: Uint8Array;
}

export interface VariantGenOptions {
  /** How many options to generate (the provider clamps to its own range; Stitch allows 1–5). */
  count?: number;
  /** Creative range: subtle 'refine', balanced 'explore' (default), bold 'reimagine'. */
  creativeRange?: 'refine' | 'explore' | 'reimagine';
  /** Restrict variation to certain aspects (e.g. 'layout', 'color-scheme'); provider-specific. */
  aspects?: string[];
  device?: 'mobile' | 'desktop' | 'tablet' | 'agnostic';
}

/**
 * Every Provider interaction goes through this port (FR-15). Assembly/provenance code
 * depends only on this interface, never on a concrete adapter.
 */
export interface UIProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  createProject(title?: string): Promise<string>;
  syncDesignSystem(projectId: string, designMd: string): Promise<DesignSystemResult>;
  generateScreen(projectId: string, prompt: string, opts?: GenerateOptions): Promise<ScreenHandle>;
  awaitScreen(handle: ScreenHandle): Promise<ScreenResult>;
  /**
   * Apply free-text feedback to an EXISTING screen (directed edit), not a blind re-roll.
   * Returns the finished bytes; the design system stays pinned so the edit is on-theme.
   */
  editScreen(
    projectId: string,
    screenId: string,
    feedback: string,
    opts?: GenerateOptions,
  ): Promise<EditResult>;
  /**
   * Generate N alternative designs of an existing screen for the developer to pick from
   * (the design system stays pinned so every option is on-theme).
   */
  generateVariants(
    projectId: string,
    sourceScreenId: string,
    prompt: string,
    opts?: VariantGenOptions,
  ): Promise<VariantOption[]>;
}
