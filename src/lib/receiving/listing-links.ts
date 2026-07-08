/**
 * Collect every openable listing URL for a receiving carton — manual paste,
 * catalog platform rows (Zoho / inventory mirror), and SKU-derived storefront
 * fallbacks. Dedupes by normalized href and orders manual → platform-matched
 * catalog → other catalog → derived.
 */

import { sourcePlatformLabel } from '@/lib/source-platform';
import { parseListingLinksFromSyncNotes } from '@/lib/zoho-po-prefill';
import {
  getExternalUrlByItemNumber,
  getExternalUrlByPlatform,
} from '@/utils/external-item-url';

export interface CartonListingLink {
  href: string;
  label: string;
  source: 'manual' | 'sync_notes' | 'catalog' | 'derived';
}

export interface CatalogPlatformLinkInput {
  platform: string;
  platformSku?: string | null;
  platformItemId?: string | null;
  accountName?: string | null;
  listingUrl?: string | null;
}

function normalizeHref(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function platformRowLabel(p: CatalogPlatformLinkInput): string {
  const base = sourcePlatformLabel(p.platform) || p.platform;
  return p.accountName?.trim() ? `${base} · ${p.accountName.trim()}` : base;
}

function catalogRowHref(p: CatalogPlatformLinkInput): string | null {
  const stored = (p.listingUrl || '').trim();
  if (stored) return normalizeHref(stored);
  const id = (p.platformItemId || p.platformSku || '').trim();
  if (!id) return null;
  return getExternalUrlByPlatform(p.platform, id);
}

function sortKey(
  link: CartonListingLink,
  sourcePlatform: string | null | undefined,
  platformOrder: Map<string, string>,
): number {
  if (link.source === 'manual') return 0;
  if (link.source === 'catalog') {
    const platform = [...platformOrder.entries()].find(([, href]) => href === link.href)?.[0];
    if (platform && platform === (sourcePlatform || '').trim().toLowerCase()) return 1;
    return 2;
  }
  return 3;
}

/**
 * Returns unique listing links for the carton context chip. The first entry is
 * the primary open target (explicit URL wins, then catalog row for the carton's
 * platform, then remaining catalog rows, then SKU-derived storefront search).
 */
export function collectCartonListingLinks(args: {
  listingLink: string;
  syncNotes?: string | null;
  sku: string | null | undefined;
  sourcePlatform: string | null | undefined;
  isUnmatched: boolean;
  platforms?: CatalogPlatformLinkInput[];
}): CartonListingLink[] {
  const seen = new Set<string>();
  const candidates: CartonListingLink[] = [];
  const platformOrder = new Map<string, string>();

  const push = (href: string | null, label: string, source: CartonListingLink['source']) => {
    if (!href) return;
    const key = href.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ href, label, source });
  };

  const manual = normalizeHref(args.listingLink);
  if (manual) push(manual, 'Listing', 'manual');

  const syncNoteLinks = parseListingLinksFromSyncNotes(args.syncNotes);
  if (syncNoteLinks.length > 0) {
    for (const l of syncNoteLinks) {
      push(l.href, l.title ?? 'Listing', 'sync_notes');
    }
    return candidates;
  }

  for (const p of args.platforms ?? []) {
    const href = catalogRowHref(p);
    const platformKey = p.platform.trim().toLowerCase();
    if (href && !platformOrder.has(platformKey)) platformOrder.set(platformKey, href);
    push(href, platformRowLabel(p), 'catalog');
  }

  if (!args.isUnmatched) {
    const sku = (args.sku || '').trim();
    if (sku) {
      const derived = getExternalUrlByItemNumber(sku);
      push(derived, 'Storefront', 'derived');
    }
  }

  const sourcePlatform = (args.sourcePlatform || '').trim().toLowerCase();
  return [...candidates].sort((a, b) => {
    const da = sortKey(a, sourcePlatform, platformOrder);
    const db = sortKey(b, sourcePlatform, platformOrder);
    if (da !== db) return da - db;
    return a.label.localeCompare(b.label);
  });
}

export interface ListingLinkMenuOption {
  href: string;
  label: string;
  title: string;
}

/** 1-indexed menu rows for the listing chip hover menu (only when count > 1). */
export function formatListingLinkMenuOptions(
  links: CartonListingLink[],
): ListingLinkMenuOption[] | undefined {
  if (links.length <= 1) return undefined;
  const total = links.length;
  return links.map((l, i) => ({
    href: l.href,
    label: `Listing ${i + 1}/${total}`,
    title: l.href,
  }));
}
