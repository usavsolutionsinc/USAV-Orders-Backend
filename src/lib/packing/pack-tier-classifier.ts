export type PackTier = 'SMALL' | 'MEDIUM' | 'LARGE';

export const DEFAULT_TIER_MINUTES: Record<PackTier, number> = {
  SMALL: 5,
  MEDIUM: 13,
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

const LARGE_RE = /\b(lifestyle|home\s*theater|home\s*cinema|cinemate|surround|5\.1|7\.1|acoustimass)\b/i;
const MEDIUM_RE = /\b(wave(\s*radio)?|sounddock|soundtouch|console|receiver|equalizer|\beq\b|amplifier|small\s*speaker)\b/i;
const SMALL_RE = /\b(remote|cable|adapter|bracket|knob|fuse|battery|power\s*supply)\b/i;

export type PackTierClassification = {
  packTier: PackTier;
  estimatedMinutes: number;
  tierSource: 'rules';
  rule: 'LARGE_RE' | 'MEDIUM_RE' | 'SMALL_RE' | 'DEFAULT';
};

export function classifyPackTier(input: ClassifyInput): PackTierClassification {
  const haystack = [input.productTitle, input.category, input.sku].map(norm).filter(Boolean).join(' ');

  if (LARGE_RE.test(haystack)) {
    return { packTier: 'LARGE', estimatedMinutes: DEFAULT_TIER_MINUTES.LARGE, tierSource: 'rules', rule: 'LARGE_RE' };
  }
  if (MEDIUM_RE.test(haystack)) {
    return { packTier: 'MEDIUM', estimatedMinutes: DEFAULT_TIER_MINUTES.MEDIUM, tierSource: 'rules', rule: 'MEDIUM_RE' };
  }
  if (SMALL_RE.test(haystack)) {
    return { packTier: 'SMALL', estimatedMinutes: DEFAULT_TIER_MINUTES.SMALL, tierSource: 'rules', rule: 'SMALL_RE' };
  }
  // Default to MEDIUM: matches the most common “mixed day” assumption.
  return { packTier: 'MEDIUM', estimatedMinutes: DEFAULT_TIER_MINUTES.MEDIUM, tierSource: 'rules', rule: 'DEFAULT' };
}

