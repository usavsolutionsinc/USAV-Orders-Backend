/**
 * eBay "repaired unit" listing draft (Phase 6) — DRAFT ONLY.
 *
 * Assembles a refurbished-listing payload from a repaired warranty claim for a
 * human to review/publish. We never auto-publish (confirmed decision); this is a
 * pure builder so it is unit-testable and free of eBay-API coupling.
 */

import type { WarrantyClaimDetail } from './types';

/** eBay conditionId 2500 = "Seller refurbished". */
export const EBAY_SELLER_REFURBISHED_CONDITION_ID = '2500';

const EBAY_TITLE_MAX = 80;

export interface EbayRefurbDraft {
  /** Suggested SKU (serial-based when available). */
  sku: string | null;
  title: string;
  conditionId: string;
  conditionDescription: string;
  /** Plain-text description body (repair summary). */
  description: string;
  /** Item specifics eBay aspects. */
  aspects: Record<string, string[]>;
  /** NAS photo refs aggregated from repair attempts — for the seller to attach. */
  photoAttachmentIds: string[];
  /** True when the claim isn't in a sellable (repaired/closed) state. */
  warning?: string;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function buildEbayRefurbDraft(claim: WarrantyClaimDetail): EbayRefurbDraft {
  const base = claim.productTitle || claim.sku || 'Refurbished unit';
  const title = truncate(`${base} (Refurbished)`, EBAY_TITLE_MAX);

  const fixedAttempts = claim.repairAttempts.filter((a) => a.outcome === 'FIXED');
  const repairLines = claim.repairAttempts
    .map((a) => {
      const parts = [`Attempt #${a.attemptNo}`];
      if (a.diagnosis) parts.push(`diagnosis: ${a.diagnosis}`);
      if (a.outcome) parts.push(`outcome: ${a.outcome}`);
      return parts.join(' — ');
    })
    .join('\n');

  const conditionDescription = truncate(
    fixedAttempts.length > 0
      ? 'Professionally refurbished and tested. Repaired under warranty workflow; fully functional.'
      : 'Refurbished unit, tested and verified functional.',
    1000,
  );

  const description = [
    `${base} — professionally refurbished.`,
    '',
    'Repair history:',
    repairLines || 'Inspected, cleaned, and tested.',
    '',
    'Sold as a refurbished unit. See photos for condition.',
  ].join('\n');

  const photoAttachmentIds = Array.from(
    new Set(
      claim.repairAttempts.flatMap((a) =>
        Array.isArray(a.photoAttachmentIds) ? (a.photoAttachmentIds as unknown[]).map((x) => String(x)) : [],
      ),
    ),
  );

  const aspects: Record<string, string[]> = {};
  if (claim.sku) aspects['MPN'] = [claim.sku];

  const sellable = claim.status === 'REPAIRED' || claim.status === 'CLOSED';

  return {
    sku: claim.serialNumber || claim.sku || null,
    title,
    conditionId: EBAY_SELLER_REFURBISHED_CONDITION_ID,
    conditionDescription,
    description,
    aspects,
    photoAttachmentIds,
    ...(sellable ? {} : { warning: `Claim is ${claim.status}; draft generated but unit may not be ready to list.` }),
  };
}
