/**
 * Label layer — the effective-value resolver.
 *
 * `resolveLabel()` layers most-specific-wins, mirroring the Settings Registry's
 * `resolveSetting` (`src/lib/settings/resolve.ts`):
 *   1. org override (from ctx.overrides, loaded from `reason_codes` in Phase 2)
 *   2. system default (the seeded `LABEL_DEFAULTS` row)
 * The stable `code` is never overridable — only the presentation (label / tone /
 * description / order). Tone resolves to its safelisted class pair.
 *
 * Pure — give it the override bag; no DB here (the bag is loaded once per
 * request upstream, exactly like `orgSettings` in the settings resolver).
 */
import type {
  LabelKind,
  LabelResolveContext,
  ResolvedLabel,
} from './types';
import { LABEL_DEFAULTS, TONE_CLASSES } from './registry';

/** Resolve one (kind, code) to its effective, render-ready label. */
export function resolveLabel(
  kind: LabelKind,
  code: string,
  ctx?: LabelResolveContext,
): ResolvedLabel {
  const base = LABEL_DEFAULTS[kind]?.[code];
  const override = ctx?.overrides?.[kind]?.[code];

  // A code with no seeded default is a programming error in this layer, but we
  // degrade rather than crash (mirrors get-title-by-sku's degrade-not-fail): an
  // unknown code renders as a neutral slate chip titled by its raw code.
  if (!base) {
    const tone = override?.tone ?? 'slate';
    return {
      code,
      label: override?.label ?? code,
      description: override?.description ?? '',
      tone,
      source: override ? 'org' : 'default',
      pill: TONE_CLASSES[tone].pill,
      dot: TONE_CLASSES[tone].dot,
    };
  }

  const tone = override?.tone ?? base.tone;
  const overridden = Boolean(
    override && (override.label !== undefined || override.tone !== undefined || override.description !== undefined),
  );

  return {
    code,
    label: override?.label ?? base.label,
    description: override?.description ?? base.description,
    tone,
    source: overridden ? 'org' : 'default',
    pill: TONE_CLASSES[tone].pill,
    dot: TONE_CLASSES[tone].dot,
  };
}

/** Resolve every code in a kind, in seed (pipeline) order. The legend feed. */
export function resolveKind(kind: LabelKind, ctx?: LabelResolveContext): ResolvedLabel[] {
  return Object.keys(LABEL_DEFAULTS[kind]).map((code) => resolveLabel(kind, code, ctx));
}

/** Presentation shape the legacy `*_STATE_META` maps expose. */
interface StateMetaEntry {
  label: string;
  description: string;
  pill: string;
  dot: string;
}

/**
 * Build the `{ code → { label, description, pill, dot } }` map a `*_STATE_META`
 * consumer expects, from the resolved labels of a kind. This is the bridge that
 * lets `unshipped-state.ts` / `outbound-state.ts` keep their stable export shape
 * while the data now flows from the one label registry (+ tenant overrides).
 */
export function buildStateMeta(
  kind: LabelKind,
  ctx?: LabelResolveContext,
): Record<string, StateMetaEntry> {
  const out: Record<string, StateMetaEntry> = {};
  for (const code of Object.keys(LABEL_DEFAULTS[kind])) {
    const r = resolveLabel(kind, code, ctx);
    out[code] = { label: r.label, description: r.description, pill: r.pill, dot: r.dot };
  }
  return out;
}
