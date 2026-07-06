import { getLast4, getLast4Serial } from '@/lib/copy-chip-format';
import { sellerClaimClipboardLabel } from '@/lib/receiving-claim-seller-copy';
import type { ClipboardEntry } from '@/lib/clipboard-history';

/** Human labels for {@link ClipboardEntry.kind} — mirrors CopyChip tone semantics. */
export const CLIPBOARD_KIND_LABELS: Record<string, string> = {
  id: 'Order ID',
  tracking: 'Tracking',
  serial: 'Serial',
  sku: 'SKU',
  fnsku: 'FNSKU',
  ticket: 'Ticket',
  price: 'Unit cost',
  seller_claim: 'Seller message',
};

function kindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return CLIPBOARD_KIND_LABELS[kind] ?? kind.replace(/_/g, ' ');
}

function isRedundantDisplay(value: string, display: string, kind?: string): boolean {
  const v = value.trim();
  const d = display.trim();
  if (!d || d === v || d === '----' || d === '---') return true;
  if (d.length <= 4 && v.endsWith(d)) return true;
  if (kind === 'serial' && d === getLast4Serial(v)) return true;
  if (kind !== 'serial' && d === getLast4(v)) return true;
  return false;
}

/**
 * Secondary linkage captured at copy time — platform name, seller msg id label,
 * ticket ref, etc. Omits chip last-4 previews that duplicate the full value.
 */
export function clipboardEntryLinkage(entry: ClipboardEntry): string | null {
  if (typeof entry.sellerMessageId === 'number' && entry.sellerMessageId > 0) {
    return sellerClaimClipboardLabel(entry.sellerMessageId);
  }
  const display = entry.display?.trim();
  if (!display || isRedundantDisplay(entry.value, display, entry.kind)) return null;
  return display;
}

/** Eyebrow meta for a clipboard row — time first, then type/linkage tags. */
export interface ClipboardEntryMeta {
  time: string;
  tags: string[];
}

export function resolveClipboardEntryMeta(
  entry: ClipboardEntry,
  timeAgo: (ts: number) => string,
): ClipboardEntryMeta {
  const tags: string[] = [];
  const type = kindLabel(entry.kind);
  if (type) tags.push(type);
  const linkage = clipboardEntryLinkage(entry);
  if (linkage && linkage !== type) tags.push(linkage);
  return { time: timeAgo(entry.ts), tags };
}
