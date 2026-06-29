'use client';

import { useMemo } from 'react';
import { useReasonVocabulary } from './useReasonVocabulary';
import {
  SUBSTITUTION_REASONS,
  mergeSubstitutionReasons,
  type SubstitutionReason,
} from '@/lib/fulfillment/substitution-reasons';

/**
 * Tenant substitution reasons (reason_codes rows, flow_context='substitution'),
 * with the built-in vocabulary as a degrade-not-fail fallback. The DB owns code +
 * label so an org can rename or add reasons; tone + hint stay built-in display
 * metadata via mergeSubstitutionReasons. Shares the cached fetch in
 * useReasonVocabulary. See HARDCODED-STATUS-ENGINE-MIGRATION-PLAN.md D1.
 */
export function useSubstitutionReasons(): readonly SubstitutionReason[] {
  const rows = useReasonVocabulary('substitution');
  return useMemo(() => {
    if (!rows || rows.length === 0) return SUBSTITUTION_REASONS;
    const merged = mergeSubstitutionReasons(rows);
    return merged.length > 0 ? merged : SUBSTITUTION_REASONS;
  }, [rows]);
}
