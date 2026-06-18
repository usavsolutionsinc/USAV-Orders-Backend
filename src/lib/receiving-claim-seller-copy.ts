'use client';

import { copyToClipboard } from '@/utils/_dom';

/** Clipboard-history tone for seller claim messages (header popover dot color). */
export const SELLER_CLAIM_CLIPBOARD_KIND = 'seller_claim';

export function sellerClaimClipboardLabel(messageId: number): string {
  return `Seller msg #${messageId}`;
}

/**
 * Copy seller-facing claim text to the system clipboard AND the header
 * clipboard history (GlobalHeader → clipboard icon). When `messageId` is
 * known, the history row shows the compact DB id label; send-to-staff uses
 * `seller_claim_message` so the recipient's inbox shows the id, not the wall
 * of text.
 */
export async function copySellerClaimMessage(opts: {
  text: string;
  messageId?: number | null;
}): Promise<boolean> {
  const text = String(opts.text ?? '').trim();
  if (!text) return false;

  const messageId =
    typeof opts.messageId === 'number' && Number.isFinite(opts.messageId) && opts.messageId > 0
      ? opts.messageId
      : undefined;

  return copyToClipboard(text, {
    historyKind: SELLER_CLAIM_CLIPBOARD_KIND,
    historyDisplay: messageId != null ? sellerClaimClipboardLabel(messageId) : 'Seller message',
    historySellerMessageId: messageId,
  });
}

/** Upsert draft so copy/send can reference receiving_claim_seller_messages.id. */
export async function persistSellerClaimMessageDraft(opts: {
  receivingId: number;
  lineId?: number | null;
  sellerMessage: string;
  subjectSnapshot?: string;
}): Promise<number | null> {
  const text = String(opts.sellerMessage ?? '').trim();
  if (!text) return null;
  try {
    const res = await fetch('/api/receiving/zendesk-claim/seller-message', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receivingId: opts.receivingId,
        lineId: opts.lineId ?? null,
        sellerMessage: text,
        subjectSnapshot: opts.subjectSnapshot,
      }),
    });
    const data = await res.json().catch(() => null);
    const id = data?.message?.id;
    return typeof id === 'number' && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Copy seller text to clipboard + header history. Persists first when no row id
 * yet (skipped in demo mode when persist is omitted).
 */
export async function copySellerClaimMessageWithPersist(opts: {
  text: string;
  messageId?: number | null;
  receivingId?: number | null;
  lineId?: number | null;
  subjectSnapshot?: string;
  skipPersist?: boolean;
}): Promise<{ ok: boolean; messageId: number | null }> {
  let messageId = opts.messageId ?? null;
  if (!messageId && !opts.skipPersist && opts.receivingId) {
    messageId = await persistSellerClaimMessageDraft({
      receivingId: opts.receivingId,
      lineId: opts.lineId,
      sellerMessage: opts.text,
      subjectSnapshot: opts.subjectSnapshot,
    });
  }
  const ok = await copySellerClaimMessage({ text: opts.text, messageId });
  return { ok, messageId };
}
