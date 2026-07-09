/**
 * Label layer — types. The presentation seam that turns a stable lifecycle
 * `code` into a tenant‑facing label, mirroring the Settings Registry's resolver
 * shape (`src/lib/settings/resolve.ts`) and stored (Phase 2) in the generalized
 * `reason_codes` vocabulary table.
 *
 * The invariant: a `code` is stable + semantic (the engine, analytics, and
 * audit key on it and it is NEVER renamed); the LABEL (text / tone / order /
 * icon) is presentation and is freely tenant‑customizable. See
 * `docs/operations-studio/HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md`.
 */

/**
 * A label vocabulary namespace. One `kind` = one ordered/flat vocabulary the
 * customer can relabel. Lifecycle kinds today; flat vocabularies (reason codes,
 * grades) fold in as more kinds when Phase 2 generalizes `reason_codes`.
 */
export type LabelKind = 'unshipped' | 'outbound';

/**
 * Semantic tone token — the customizable color identity. Maps to a fixed,
 * Tailwind‑safelisted class pair (`TONE_CLASSES`); a tenant picks a token, never
 * a raw class string (raw classes can't be content‑scanned — see the Tailwind
 * content‑globs gotcha), which is exactly why customization is token‑based.
 */
export type LabelTone =
  | 'slate'
  | 'yellow'
  | 'teal'
  | 'amber'
  | 'red'
  | 'blue'
  | 'indigo'
  | 'emerald'
  | 'rose'
  | 'orange'
  | 'pink';

/**
 * The default presentation for one code within a kind (the seeded system row).
 * This is the LABEL identity only — text / meaning / tone. Board layout
 * (lane order, icon binding) stays in the board descriptors; it is a different
 * axis and must not be duplicated here.
 */
export interface LabelPresentation {
  /** Display text — tenant‑overridable. */
  label: string;
  /** One‑line plain‑English meaning (hover tooltip) — tenant‑overridable. */
  description: string;
  /** Semantic tone token — tenant‑overridable; resolves to pill/dot classes. */
  tone: LabelTone;
}

/** The subset a tenant may override per (kind, code). The stable code is fixed. */
export interface LabelOverride {
  label?: string;
  description?: string;
  tone?: LabelTone;
}

/** A fully‑resolved label ready to render. */
export interface ResolvedLabel {
  code: string;
  label: string;
  description: string;
  tone: LabelTone;
  /** Where the value came from — `'default'` (system) or `'org'` (tenant override). */
  source: 'default' | 'org';
  /** Tailwind classes derived from the resolved tone. */
  pill: string;
  dot: string;
}

/**
 * Resolution context. `overrides` is the per‑org vocabulary bag (Phase 2 loads
 * it from `reason_codes`; Phase 1 leaves it undefined → pure defaults).
 * Shape: `overrides[kind][code]` → partial presentation.
 */
export interface LabelResolveContext {
  overrides?: Partial<Record<LabelKind, Record<string, LabelOverride>>>;
}
