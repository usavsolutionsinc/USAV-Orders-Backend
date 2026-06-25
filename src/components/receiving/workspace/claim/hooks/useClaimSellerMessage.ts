import { useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { copySellerClaimMessageWithPersist } from '@/lib/receiving-claim-seller-copy';
import { sellerDraftMatchesTicket } from '@/lib/receiving-claim-seller-ticket-match';
import type { ClaimType } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { ClaimModalMode, FiledTicket } from '../claim-types';

export interface UseClaimSellerMessage {
  sellerMessage: string;
  setSellerMessage: (v: string) => void;
  sellerMessageId: number | null;
  aiModel: string;
  aiLoading: boolean;
  /** (Re)generate the seller-facing message with AI for the filed ticket. */
  draftSellerMessage: (ticket?: FiledTicket) => Promise<void>;
  /** Copy the message to the clipboard and persist it to the header history. */
  handleCopySellerMessage: () => Promise<void>;
  /** Persist the (possibly edited) message and close the modal. */
  finishSellerStep: () => Promise<void>;
  /** DELETE the persisted draft (best-effort) — used when unlinking. */
  clearPersistedSellerDraft: () => Promise<void>;
  /** Clear local draft state + the bootstrap guard. */
  resetDraftState: () => void;
  /** Clear ONLY the bootstrap guard so the next render re-restores/drafts. */
  resetBootstrap: () => void;
}

interface Params {
  open: boolean;
  mode: ClaimModalMode;
  /** True only while the seller step is the active step (either mode). */
  sellerActive: boolean;
  filedTicket: FiledTicket | null;
  receivingId: number | null | undefined;
  lineId: number | null | undefined;
  claimType: ClaimType;
  reason: string;
  /** Latest subject/body, read lazily so payloads include in-flight edits. */
  readSubject: () => string;
  readDescription: () => string;
  onClose: () => void;
}

/**
 * Owns the seller-message step: restoring a saved draft, AI-generating one that
 * references the filed ticket #, copy-to-clipboard with header persistence, and
 * the final PATCH-then-close. A bootstrap guard keyed on the ticket id/number
 * ensures we only auto-draft once per ticket.
 */
export function useClaimSellerMessage({
  open,
  mode,
  sellerActive,
  filedTicket,
  receivingId,
  lineId,
  claimType,
  reason,
  readSubject,
  readDescription,
  onClose,
}: Params): UseClaimSellerMessage {
  const [sellerMessage, setSellerMessage] = useState('');
  const [sellerMessageId, setSellerMessageId] = useState<number | null>(null);
  const [aiModel, setAiModel] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  /** Last ticket id/number we bootstrapped the seller step for. */
  const sellerBootstrapKey = useRef<string | null>(null);

  const resetDraftState = () => {
    setSellerMessage('');
    setSellerMessageId(null);
    setAiModel('');
    sellerBootstrapKey.current = null;
  };

  // Reset transient draft state each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setSellerMessage('');
    setSellerMessageId(null);
    setAiModel('');
    sellerBootstrapKey.current = null;
  }, [open, receivingId, lineId]);

  const draftSellerMessage = async (ticket: FiledTicket | undefined = filedTicket ?? undefined) => {
    // '#TEST' is the "Continue test" sentinel — never hit the assist endpoint
    // (which would persist a seller-message row) for it.
    if (aiLoading || !receivingId || !ticket?.number || ticket.number === 'pending' || ticket.number === '#TEST') return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/receiving/zendesk-claim/assist-seller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId,
          lineId,
          claimType,
          reason: reason.trim(),
          subject: readSubject().trim(),
          description: readDescription().trim(),
          zendeskTicketNumber: ticket.number,
          zendeskTicketId: ticket.id,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not draft seller message');
        return;
      }
      setSellerMessage(typeof data.sellerMessage === 'string' ? data.sellerMessage : '');
      if (typeof data.sellerMessageId === 'number' && data.sellerMessageId > 0) {
        setSellerMessageId(data.sellerMessageId);
      }
      setAiModel(typeof data.model === 'string' ? data.model : '');
      if (data.linksStripped) {
        toast.warning('Links were removed from the seller message (marketplace TOS)', { duration: 6000 });
      }
      if (!data.degraded) {
        toast.success('Seller message drafted');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not draft seller message');
    } finally {
      setAiLoading(false);
    }
  };

  // Step 2: restore saved draft or auto-generate (includes the filed ticket #).
  useEffect(() => {
    if (!open || !sellerActive || !filedTicket || !receivingId) return;
    // Test sentinel: leave the pre-filled preview in place, fetch/draft nothing.
    if (filedTicket.number === '#TEST') return;

    const bootstrapKey = `${filedTicket.id ?? ''}:${filedTicket.number}`;
    if (sellerBootstrapKey.current === bootstrapKey) return;
    sellerBootstrapKey.current = bootstrapKey;

    const ctrl = new AbortController();
    const bootstrap = async () => {
      const sp = new URLSearchParams({ receivingId: String(receivingId) });
      if (lineId != null) sp.set('lineId', String(lineId));
      try {
        const res = await fetch(`/api/receiving/zendesk-claim/seller-message?${sp}`, {
          cache: 'no-store',
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => null);
        const saved = data?.message?.sellerMessage;
        const savedTicketId = data?.message?.zendeskTicketId;
        const matchesTicket = sellerDraftMatchesTicket(
          savedTicketId,
          filedTicket.id,
          filedTicket.number,
        );
        if (typeof saved === 'string' && saved.trim() && matchesTicket) {
          setSellerMessage(saved.trim());
          const savedId = data?.message?.id;
          if (typeof savedId === 'number' && savedId > 0) setSellerMessageId(savedId);
          const savedModel = data?.message?.model;
          if (typeof savedModel === 'string' && savedModel.trim()) setAiModel(savedModel.trim());
          return;
        }
      } catch {
        /* fall through to AI draft */
      }
      if (!ctrl.signal.aborted) {
        await draftSellerMessage(filedTicket);
      }
    };
    void bootstrap();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, sellerActive, filedTicket, receivingId, lineId]);

  const handleCopySellerMessage = async () => {
    const text = sellerMessage.trim();
    if (!text || !receivingId) return;
    const { ok, messageId } = await copySellerClaimMessageWithPersist({
      text,
      messageId: sellerMessageId,
      receivingId,
      lineId: lineId ?? null,
      subjectSnapshot: readSubject().trim(),
    });
    if (messageId != null) setSellerMessageId(messageId);
    if (ok) {
      toast.success(
        messageId != null
          ? `Copied · Seller msg #${messageId} (header clipboard)`
          : 'Copied to clipboard',
      );
    } else {
      toast.error('Could not copy');
    }
  };

  const clearPersistedSellerDraft = async () => {
    if (!receivingId) return;
    const sp = new URLSearchParams({ receivingId: String(receivingId) });
    if (lineId != null) sp.set('lineId', String(lineId));
    try {
      await fetch(`/api/receiving/zendesk-claim/seller-message?${sp}`, { method: 'DELETE' });
    } catch {
      /* best-effort */
    }
  };

  const finishSellerStep = async () => {
    // Test sentinel: close without persisting the PATCH.
    if (filedTicket?.number === '#TEST') {
      onClose();
      return;
    }
    const text = sellerMessage.trim();
    if (text && receivingId) {
      try {
        await fetch('/api/receiving/zendesk-claim/seller-message', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receivingId,
            lineId: lineId ?? null,
            sellerMessage: text,
            subjectSnapshot: readSubject().trim(),
          }),
        });
      } catch {
        /* best-effort — assist-seller may have already saved */
      }
    }
    onClose();
  };

  return {
    sellerMessage,
    setSellerMessage,
    sellerMessageId,
    aiModel,
    aiLoading,
    draftSellerMessage,
    handleCopySellerMessage,
    finishSellerStep,
    clearPersistedSellerDraft,
    resetDraftState,
    resetBootstrap: () => {
      sellerBootstrapKey.current = null;
    },
  };
}
