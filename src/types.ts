// Core domain types for the Loomis manifest "receipt" and the agent-core envelope.
// Field names are camelCase and MUST match schema/manifest.schema.json exactly.

export type Status = 'pending' | 'in-flight' | 'done' | 'failed';

export interface Edge {
  from: string;
  to: string;
  /** The label the first Nav line declaring this link gives it. */
  label?: string;
  /** Every label, in order, when several Nav lines declare the same link. */
  labels?: string[];
  region?: string;
}

export interface ScreenReview {
  verdict?: string;
  reason?: string;
}

/** One stored design option from `suggest`, promotable to the live screen. */
export interface SuggestionRef {
  option: number;
  providerScreen: string;
  htmlPath: string;
  screenshotPath?: string;
}

export interface ScreenRecord {
  screenId: string;
  story?: string;
  surface?: string;
  status: Status;
  inputHash?: string;
  providerScreen?: string;
  htmlPath?: string;
  screenshotPath?: string;
  links?: string[];
  omissions?: string[];
  /** Free-text directed-edit feedback applied to this screen, in order (the refine provenance trail). */
  refinements?: string[];
  /** Alternative design options from `suggest`, awaiting a `promote` choice. */
  suggestions?: SuggestionRef[];
  regenCount?: number;
  review?: ScreenReview;
}

/** The provider's actual resolved theme (read back), so the gate can show the truth. */
export interface ResolvedTheme {
  namedColors?: Record<string, string>;
  customColor?: string;
  font?: string;
  roundness?: string;
  colorMode?: string;
}

export interface DesignSystemRef {
  assetId: string;
  source: string;
  roleMap?: Record<string, string>;
  /** The provider's actual resolved theme (read back from the provider). */
  resolved?: ResolvedTheme;
  /** Hash of the DESIGN.md content, so a DESIGN.md edit invalidates every screen's cache. */
  designMdHash?: string;
  /** Set once the developer approves the resolved theme at the design-system gate. */
  approved?: boolean;
  /** Target device for generation (mobile/desktop/tablet/agnostic), from DESIGN.md. */
  device?: string;
}

export interface Manifest {
  projectId?: string;
  entry?: string[];
  edges: Edge[];
  unresolved: string[];
  screens: ScreenRecord[];
  designSystem?: DesignSystemRef;
}

/** The single JSON envelope every core verb prints on stdout. */
export type Envelope =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; error: string; code: string };
