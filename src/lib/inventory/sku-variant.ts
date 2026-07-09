/**
 * SKU variant — COLOR axis decoder (sku-reconciliation plan, Step B).
 *
 * Owner-confirmed: the 1-letter stock suffixes encode **color**, NOT condition.
 * This is a NEW, separate axis from the condition grade (`src/lib/conditions.ts`
 * / `src/lib/condition-tone.ts`). Do NOT conflate the two — a color suffix on a
 * SKU string says nothing about the unit's condition grade, and vice-versa.
 *
 * This is a CONFIG-DRIVEN decoder, not a hardcoded guess. The map below is the
 * single source of truth for suffix → color. Only the two **confident** entries
 * are seeded; the ambiguous suffixes (`-N` / `-S` / `-SW`) are explicit
 * `UNCONFIRMED` placeholders so they decode to `null` and can NEVER mis-tag data
 * until the owner confirms their real color value.
 *
 * Guarded-pattern discipline (mirrors `strippableVariantBase` in
 * `resolve-sku-catalog.ts`): the decoder fires ONLY on a precise color-suffix
 * pattern. It will never decode a `-P-N` part index, a numeric counter suffix
 * (`00010-2`), or any non-color suffix — so it cannot collide with the listing
 * dedup strip or mis-classify a distinct product.
 */

/** A decoded color value, or the explicit UNCONFIRMED placeholder. */
interface SkuColorSuffixEntry {
  /** Stable color code (controlled vocabulary). `null` when unconfirmed. */
  code: string | null;
  /** Human-readable color label. `null` when unconfirmed. */
  label: string | null;
  /**
   * True ONLY for owner-confirmed entries. An unconfirmed suffix is in the map
   * for documentation/coverage but decodes to `null` so it can never tag a row.
   */
  confirmed: boolean;
}

/**
 * Suffix (without the leading dash, upper-cased) → color entry.
 *
 * SEED ONLY the confident entries. Leave `-N` / `-S` / `-SW` as explicit
 * `UNCONFIRMED` placeholders — do NOT guess Navy / Silver / Natural. The owner
 * must confirm the color value for each before it is allowed to tag data.
 */
export const SKU_COLOR_SUFFIX_MAP: Record<string, SkuColorSuffixEntry> = {
  // ── Confirmed ──────────────────────────────────────────────────────────────
  B: { code: 'BLACK', label: 'Black', confirmed: true },
  W: { code: 'WHITE', label: 'White', confirmed: true },

  // ── UNCONFIRMED — needs owner confirmation of the color value ───────────────
  // Do NOT guess. These decode to null (see decodeSkuColorSuffix) until the
  // owner supplies the real color, so they can never mis-tag a unit's color.
  // -N  → ? (e.g. Navy / Natural / "New"? — color value UNCONFIRMED)
  N: { code: null, label: null, confirmed: false },
  // -S  → ? (e.g. Silver / Sand? — color value UNCONFIRMED)
  S: { code: null, label: null, confirmed: false },
  // -SW → ? (e.g. Snow White / Stone White? — color value UNCONFIRMED)
  SW: { code: null, label: null, confirmed: false },
};

/** The decoded color variant of a SKU string. */
interface DecodedSkuColor {
  /** The bare base SKU with the color suffix removed (`00046-B` → `00046`). */
  base: string;
  /** The matched color code (controlled vocabulary, e.g. `BLACK`). */
  colorCode: string;
  /** The human-readable color label (e.g. `Black`). */
  colorLabel: string;
}

/**
 * A color suffix is a base (>= 1 char, not purely a part-index) + dash + one of
 * the known LETTER-ONLY suffix tokens. Letter-only is what keeps this from ever
 * matching the numeric counter form (`00010-2`) handled by the listing-dedup
 * strip, and the `-P-N` part index (the segment between dashes is `P`, numeric
 * tail) is explicitly guarded below.
 */
const COLOR_SUFFIX_RE = /^(.+)-([A-Z]+)$/i;
/** A protected multi-part component index — never treat as a color. */
const PROTECTED_PART_INDEX = /^.+-P-[0-9]+$/i;

/**
 * Decode the COLOR variant encoded in a SKU suffix.
 *
 * Returns `{ base, colorCode, colorLabel }` ONLY for an owner-confirmed color
 * suffix (`-B` → Black, `-W` → White). Returns `null` for:
 *   - an UNCONFIRMED suffix (`-N` / `-S` / `-SW`) — never guesses a value;
 *   - a non-color suffix (`-P-N` part index, `-2` numeric counter);
 *   - a bare base (`00046`) or empty input.
 *
 * The decode is additive and read-only: it derives a variant view of a SKU
 * string; it never mutates the SKU or its resolution.
 */
export function decodeSkuColorSuffix(sku: string | null | undefined): DecodedSkuColor | null {
  const s = String(sku ?? '').trim();
  if (!s) return null;

  // Never classify a protected -P-N part index as a color.
  if (PROTECTED_PART_INDEX.test(s)) return null;

  const m = COLOR_SUFFIX_RE.exec(s);
  if (!m) return null;

  const base = m[1].trim();
  const token = m[2].toUpperCase();
  if (!base) return null;

  const entry = SKU_COLOR_SUFFIX_MAP[token];
  // Unknown token OR an explicit UNCONFIRMED entry → decode to null (never tag).
  if (!entry || !entry.confirmed || !entry.code || !entry.label) return null;

  return { base, colorCode: entry.code, colorLabel: entry.label };
}

/** A SKU's optional color variant, exposed alongside a resolved catalog row. */
export interface SkuColorVariant {
  colorCode: string;
  colorLabel: string;
}

/**
 * Lightweight accessor for the color variant of a SKU string — `null` when the
 * SKU encodes no confirmed color. Thin wrapper over {@link decodeSkuColorSuffix}
 * for read paths that only want the color (not the base).
 */
export function skuColorVariant(sku: string | null | undefined): SkuColorVariant | null {
  const decoded = decodeSkuColorSuffix(sku);
  if (!decoded) return null;
  return { colorCode: decoded.colorCode, colorLabel: decoded.colorLabel };
}
