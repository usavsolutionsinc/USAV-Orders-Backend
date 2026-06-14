import type { OrgId } from '@/lib/tenancy/constants';
import type { CandidateSource } from '@/lib/sourcing/normalize';
import type { SourceAdapter } from './types';
import { ebayAdapter } from './ebay';

/**
 * The registered secondary-market adapters. Add a channel by appending its
 * adapter here (Sourcing Hub plan §4.1, §6). Order is the default scour order.
 */
export const SOURCE_ADAPTERS: SourceAdapter[] = [ebayAdapter];

export function getAdapter(id: CandidateSource): SourceAdapter | undefined {
  return SOURCE_ADAPTERS.find((a) => a.id === id);
}

/**
 * The adapters this org can actually use right now, optionally narrowed to a
 * requested subset. enabled() failures are treated as "disabled" so one
 * misconfigured channel never blocks the others.
 */
export async function getEnabledAdapters(
  orgId: OrgId,
  only?: CandidateSource[],
): Promise<SourceAdapter[]> {
  const candidates = only?.length
    ? SOURCE_ADAPTERS.filter((a) => only.includes(a.id))
    : SOURCE_ADAPTERS;
  const flags = await Promise.all(candidates.map((a) => a.enabled(orgId).catch(() => false)));
  return candidates.filter((_, i) => flags[i]);
}

export type { SourceAdapter, ScourRequest } from './types';
