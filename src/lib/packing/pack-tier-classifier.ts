export type PackTier = 'SMALL' | 'MEDIUM' | 'LARGE';

/** Operational defaults aligned with USAV refurb pack lanes (minutes per box). */
export const DEFAULT_TIER_MINUTES: Record<PackTier, number> = {
  SMALL: 5,
  MEDIUM: 14,
  LARGE: 45,
};

type ClassifyInput = {
  productTitle?: string | null;
  category?: string | null;
  sku?: string | null;
};

function norm(s: string | null | undefined): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Full-size / heavy systems — cleaning, multi-component prep, padding, double-box.
 * ~40–50 min per system.
 */
const LARGE_RE =
  /\b(lifestyle|home\s*theater|home\s*cinema|cinemate|acoustimass\s*(?:10|15|\d+)?|surround\s*sound|5\.1|7\.1|speaker\s*system|subwoofer\s*system|home\s*entertainment\s*system)\b/i;

/**
 * Semi-complete units — cleaning, accessories, PSU, remote, careful pack.
 * ~12–15 min. Not full Lifestyle / CineMate stacks.
 */
const MEDIUM_RE =
  /\b(wave(\s*(?:radio|music\s*system|sound\s*system))?|sounddock|soundtouch|media\s*center|entertainment\s*center|console|receiver|equalizer|\beq\b|amplifier|\bamp\b|small\s*speaker|bookshelf\s*speaker|component\s*system|mini\s*system)\b/i;

/**
 * Pack-and-label items — little/no cleaning or prep.
 * ~5 min.
 */
const SMALL_RE =
  /\b(pcb|printed\s*circuit|board|bluetooth|bt\s*adapter|adapter|dongle|cable|cord|wire|connector|harness|ribbon|part|parts|accessory|accessories|small\s*part|oem|spare|replacement|module|chip|component\s*board|bracket|mount|knob|fuse|battery|power\s*supply|psu|remote|ir\s*blaster|antenna|link\s*cable|audio\s*cable|video\s*cable|hdmi|optical\s*cable|rca)\b/i;

/** Title still looks like a system/unit but did not match MEDIUM_RE tightly. */
const SYSTEMISH_RE =
  /\b(system|unit|speaker|speakers|subwoofer|receiver|amplifier|player|dock|stereo|theater|bundle|kit)\b/i;

export type PackTierClassification = {
  packTier: PackTier;
  estimatedMinutes: number;
  tierSource: 'rules';
  rule: 'LARGE_RE' | 'MEDIUM_RE' | 'SMALL_RE' | 'DEFAULT_MEDIUM' | 'DEFAULT_SMALL';
};

export function classifyPackTier(input: ClassifyInput): PackTierClassification {
  const haystack = [input.productTitle, input.category, input.sku].map(norm).filter(Boolean).join(' ');

  if (!haystack) {
    return {
      packTier: 'SMALL',
      estimatedMinutes: DEFAULT_TIER_MINUTES.SMALL,
      tierSource: 'rules',
      rule: 'DEFAULT_SMALL',
    };
  }

  if (LARGE_RE.test(haystack)) {
    return { packTier: 'LARGE', estimatedMinutes: DEFAULT_TIER_MINUTES.LARGE, tierSource: 'rules', rule: 'LARGE_RE' };
  }
  if (MEDIUM_RE.test(haystack)) {
    return { packTier: 'MEDIUM', estimatedMinutes: DEFAULT_TIER_MINUTES.MEDIUM, tierSource: 'rules', rule: 'MEDIUM_RE' };
  }
  if (SMALL_RE.test(haystack)) {
    return { packTier: 'SMALL', estimatedMinutes: DEFAULT_TIER_MINUTES.SMALL, tierSource: 'rules', rule: 'SMALL_RE' };
  }

  // Residual: only assume Medium when the title still sounds like a system.
  // Most unlabeled SKUs in refurb are pack-and-label parts → Small.
  if (SYSTEMISH_RE.test(haystack)) {
    return {
      packTier: 'MEDIUM',
      estimatedMinutes: DEFAULT_TIER_MINUTES.MEDIUM,
      tierSource: 'rules',
      rule: 'DEFAULT_MEDIUM',
    };
  }

  return {
    packTier: 'SMALL',
    estimatedMinutes: DEFAULT_TIER_MINUTES.SMALL,
    tierSource: 'rules',
    rule: 'DEFAULT_SMALL',
  };
}
