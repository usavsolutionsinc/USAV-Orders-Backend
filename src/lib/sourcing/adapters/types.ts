import type { BrowseCondition } from '@/lib/ebay/browse-client';
import type { CandidateSource, NormalizedCandidate } from '@/lib/sourcing/normalize';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * SourceAdapter — one secondary-market channel behind a uniform contract
 * (Sourcing Hub plan §4.1). The scour orchestrator (search.ts) fans a single
 * ScourRequest across every *enabled* adapter, dedupes, and persists. eBay is
 * the first impl; adding a channel = a new adapter + registry entry, no change
 * to callers.
 */

/** Condition filter — the same enum the candidate normalizer emits. */
export type SourceCondition = BrowseCondition;

export interface ScourRequest {
  query?: string | null;
  modelNumber?: string | null;
  partRole?: string | null;
  conditions?: SourceCondition[];
  maxPriceCents?: number | null;
  limit?: number;
  orgId?: OrgId;
}

export interface SourceAdapter {
  id: CandidateSource;
  label: string;
  /** True when this org has the credentials/config to use the channel. */
  enabled(orgId: OrgId): Promise<boolean>;
  /** One round trip → normalized candidates. Throws on upstream failure. */
  search(req: ScourRequest): Promise<NormalizedCandidate[]>;
}

/**
 * Build the text query from the most specific signal available — shared so every
 * adapter derives the same query string (prefer model number + part role, then
 * the free-text query / product title).
 */
export function buildScourQuery(req: ScourRequest): string {
  const parts: string[] = [];
  if (req.modelNumber?.trim()) parts.push(req.modelNumber.trim());
  if (req.partRole?.trim()) parts.push(req.partRole.trim().replace(/_/g, ' '));
  if (req.query?.trim()) parts.push(req.query.trim());
  return parts.join(' ').trim();
}
