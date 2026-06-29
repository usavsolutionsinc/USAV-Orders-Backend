/**
 * Part-SKU grammar — the single source of truth for classifying a Zoho `items`
 * SKU as a "part" and decomposing its suffix tokens.
 *
 * Convention (confirmed with the business):
 *
 *     <BASE> - P - <STOCK_INDEX> [ - <COLOR> ] [ - <CONDITION> ]
 *
 *   - BASE          zero-padded numeric code of the whole unit the part belongs
 *                   to (e.g. `00007`).
 *   - P             the PART FLAG. Its presence (immediately after the base) is
 *                   what makes a SKU "a part".
 *   - STOCK_INDEX   a DEDUP STOCK COUNTER, not a part discriminator. `00007-P-1`
 *                   and `00007-P-3` are the *same exact SKU item* — two stock
 *                   instances. The index collapses; it never splits a part.
 *   - COLOR         variant: BK/WH/GR/GY (GR and GY both = Gray).
 *   - CONDITION     variant: N (New) / U (Used).
 *
 * The LOGICAL PART IDENTITY (the grouping key) is `BASE + COLOR + CONDITION`
 * (with the index collapsed). Color and condition DO distinguish separate parts;
 * the index does not.
 *
 * Parsing is deliberately tokenized and lenient: an unrecognized trailing token
 * is captured as an `unknown` variant rather than causing a mis-parse, so a new
 * suffix code never silently merges two different parts or drops a real part.
 *
 * NOTE: this operates only on the Zoho `items` SKU scheme. Never cross it with
 * `sku_catalog` — the two are independent SKU numbering schemes that collide on
 * the same string (see `.claude/rules/source-of-truth.md`).
 */

/** Canonical color codes → labels. GR and GY both mean Gray. */
export const PART_COLORS = {
  BK: 'Black',
  WH: 'White',
  GR: 'Gray',
  GY: 'Gray',
} as const;

/** Canonical condition codes → labels. */
export const PART_CONDITIONS = {
  N: 'New',
  U: 'Used',
} as const;

export type PartColorCode = keyof typeof PART_COLORS;
export type PartConditionCode = keyof typeof PART_CONDITIONS;

export interface ParsedPartSku {
  /** The trimmed input, as given. */
  raw: string;
  /** True when the SKU carries the `-P` part flag. */
  isPart: boolean;
  /** Whole-unit base code, e.g. `00007` (null when not a part). */
  base: string | null;
  /** Dedup stock counter — NOT a part discriminator. */
  stockIndex: number | null;
  /** Raw color code (BK/WH/GR/GY) or null. */
  color: PartColorCode | null;
  /** Display color (Black/White/Gray) or null. */
  colorLabel: string | null;
  /** Raw condition code (N/U) or null. */
  condition: PartConditionCode | null;
  /** Display condition (New/Used) or null. */
  conditionLabel: string | null;
  /** Suffix tokens we don't recognize (kept so unknowns never merge parts). */
  unknownTokens: string[];
  /**
   * Logical part identity: base + color + condition (+ unknowns), with the
   * stock index collapsed. GR/GY normalize together. Null when not a part.
   */
  logicalKey: string | null;
  /** Human label for the logical part, e.g. `00007 · Part · Black · New`. */
  logicalLabel: string | null;
}

function notAPart(raw: string): ParsedPartSku {
  return {
    raw,
    isPart: false,
    base: null,
    stockIndex: null,
    color: null,
    colorLabel: null,
    condition: null,
    conditionLabel: null,
    unknownTokens: [],
    logicalKey: null,
    logicalLabel: null,
  };
}

/**
 * Parse a raw SKU string into its part components. Returns `isPart: false` for
 * any SKU that is not a `<BASE>-P-...` part.
 */
export function parsePartSku(rawInput: string | null | undefined): ParsedPartSku {
  const raw = (rawInput ?? '').trim();
  if (!raw) return notAPart(raw);

  const tokens = raw.toUpperCase().split('-').map((t) => t.trim()).filter(Boolean);
  // Need at least `<BASE>` and `P`.
  if (tokens.length < 2) return notAPart(raw);

  const base = tokens[0];
  // Base must be all digits; the part flag `P` must sit immediately after it.
  if (!/^\d+$/.test(base) || tokens[1] !== 'P') return notAPart(raw);

  let stockIndex: number | null = null;
  let color: PartColorCode | null = null;
  let condition: PartConditionCode | null = null;
  const unknownTokens: string[] = [];

  for (const tok of tokens.slice(2)) {
    if (stockIndex === null && /^\d+$/.test(tok)) {
      stockIndex = Number(tok);
      continue;
    }
    if (color === null && tok in PART_COLORS) {
      color = tok as PartColorCode;
      continue;
    }
    if (condition === null && tok in PART_CONDITIONS) {
      condition = tok as PartConditionCode;
      continue;
    }
    unknownTokens.push(tok);
  }

  const colorLabel = color ? PART_COLORS[color] : null;
  const conditionLabel = condition ? PART_CONDITIONS[condition] : null;

  // Normalize the two Gray spellings so GR and GY collapse into one part.
  const normColor = color === 'GY' ? 'GR' : color;
  const logicalKey = [base, 'P', normColor ?? '', condition ?? '', ...unknownTokens].join('|');

  const variantBits = ['Part', colorLabel, conditionLabel, ...unknownTokens].filter(Boolean);
  const logicalLabel = `${base} · ${variantBits.join(' · ')}`;

  return {
    raw,
    isPart: true,
    base,
    stockIndex,
    color,
    colorLabel,
    condition,
    conditionLabel,
    unknownTokens,
    logicalKey,
    logicalLabel,
  };
}

/** Convenience predicate. */
export function isPartSku(rawInput: string | null | undefined): boolean {
  return parsePartSku(rawInput).isPart;
}

/**
 * Normalize a base/whole-unit SKU for matching a part's base against a non-part
 * "candidate parent" item, leading-zero tolerant (mirrors the repo's SKU
 * matching elsewhere). `00007` and `7` normalize to the same value.
 */
export function normalizeBase(sku: string | null | undefined): string {
  return (sku ?? '').trim().toUpperCase().replace(/^0+/, '');
}
