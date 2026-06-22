/** Pure types + fuzzy product-search helpers for the favorites workspace. */

export interface EcwidSearchProduct {
  id: string;
  name: string;
  sku: string;
  price: number | null;
  thumbnailUrl: string | null;
  enabled: boolean;
  inStock: boolean;
}

export interface FavoriteDraft {
  label: string;
  issueTemplate: string;
  notes: string;
}

export const EMPTY_DRAFT: FavoriteDraft = { label: '', issueTemplate: '', notes: '' };

export function normalizeSearchText(value: string | null | undefined): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Expand a query into prefix/token variants so Ecwid's exact-ish search returns hits. */
export function buildSearchQueries(
  query: string,
  fuzzyTitleSearch: boolean,
  searchSkuSuffixFilter?: string,
): string[] {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];
  if (!fuzzyTitleSearch) return [trimmed];

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const queries = new Set<string>();
  const addQuery = (value: string | null | undefined) => {
    const next = String(value || '').trim();
    if (next.length >= 2) queries.add(next);
  };

  addQuery(trimmed);
  addQuery(tokens.slice(0, 2).join(' '));
  addQuery(tokens.join(' '));
  addQuery(tokens[0]);

  for (const token of tokens) {
    addQuery(token);
    if (token.length >= 3) addQuery(token.slice(0, 3));
    if (token.length >= 4) addQuery(token.slice(0, 4));
    if (token.length >= 5) addQuery(token.slice(0, 5));
  }

  if (trimmed.length >= 3) addQuery(trimmed.slice(0, 3));
  if (trimmed.length >= 4) addQuery(trimmed.slice(0, 4));
  if (trimmed.length >= 5) addQuery(trimmed.slice(0, 5));

  if (searchSkuSuffixFilter) {
    const suffix = searchSkuSuffixFilter.toUpperCase();
    const strippedSuffix = suffix.replace(/[^A-Z0-9]/g, '');
    addQuery(suffix);
    addQuery(strippedSuffix);
    if (strippedSuffix.endsWith('RS')) addQuery('RS');
  }

  return Array.from(queries).slice(0, 12);
}

export function matchesSkuSuffix(sku: string | null | undefined, suffix?: string): boolean {
  const normalizedSku = String(sku || '').trim().toUpperCase();
  const normalizedSuffix = String(suffix || '').trim().toUpperCase();
  if (!normalizedSuffix) return true;
  return normalizedSku.endsWith(normalizedSuffix);
}

function fuzzySubsequenceScore(haystack: string, needle: string): number {
  let needleIndex = 0;
  let gaps = 0;
  let lastMatchIndex = -1;

  for (let i = 0; i < haystack.length && needleIndex < needle.length; i += 1) {
    if (haystack[i] === needle[needleIndex]) {
      if (lastMatchIndex >= 0) gaps += i - lastMatchIndex - 1;
      lastMatchIndex = i;
      needleIndex += 1;
    }
  }

  if (needleIndex !== needle.length) return Number.POSITIVE_INFINITY;
  return gaps;
}

function fuzzyScoreCandidate(candidate: string, query: string): number {
  const normalizedCandidate = normalizeSearchText(candidate);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;
  if (!normalizedCandidate) return Number.POSITIVE_INFINITY;
  if (normalizedCandidate === normalizedQuery) return 0;

  const containsIndex = normalizedCandidate.indexOf(normalizedQuery);
  if (containsIndex >= 0) {
    return 1 + containsIndex / 100 + (normalizedCandidate.length - normalizedQuery.length) / 1000;
  }

  const subsequencePenalty = fuzzySubsequenceScore(normalizedCandidate, normalizedQuery);
  if (Number.isFinite(subsequencePenalty)) {
    return 2 + subsequencePenalty / 30;
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  if (queryTokens.length > 0) {
    let tokenMatches = 0;
    for (const token of queryTokens) {
      if (normalizedCandidate.includes(token)) tokenMatches += 1;
    }
    if (tokenMatches > 0) {
      return 4 + (queryTokens.length - tokenMatches);
    }
  }

  return 10 + Math.abs(normalizedCandidate.length - normalizedQuery.length) / 20;
}

export function rankProductsByFuzzyQuery(products: EcwidSearchProduct[], query: string): EcwidSearchProduct[] {
  return [...products].sort((a, b) => {
    const aScore = Math.min(fuzzyScoreCandidate(a.name, query), fuzzyScoreCandidate(a.sku, query) + 0.5);
    const bScore = Math.min(fuzzyScoreCandidate(b.name, query), fuzzyScoreCandidate(b.sku, query) + 0.5);
    if (aScore !== bScore) return aScore - bScore;
    return a.name.localeCompare(b.name);
  });
}
