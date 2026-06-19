'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { Copy, Loader2, MessageSquare, Sparkles, Unlink, X } from '@/components/Icons';
import { copySellerClaimMessageWithPersist } from '@/lib/receiving-claim-seller-copy';
import {
  parseZendeskTicketId,
  sellerDraftMatchesTicket,
} from '@/lib/receiving-claim-seller-ticket-match';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import {
  CLAIM_TYPE_OPTIONS,
  type ClaimType,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { PaneHeaderTabs } from '@/components/ui/pane-header';
import { SkeletonBase } from '@/design-system/components/Skeletons';
import {
  LinearWorkflowStepper,
  type LinearStepState,
} from '@/components/receiving/workspace/ReceivingProgressStepper';
import { priorityBadge, statusBadge } from '@/components/support/zendesk/badges';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { normalizePhotoDisplayUrl } from '@/lib/nas-photo-url';
import { resolvePhotoThumbUrl } from '@/lib/photos/display-url';

// Small preview for the selection grid. Dev proxy supports ?thumb; prod loads
// the full image through the same-origin /api/nas proxy (session cookie).
function claimThumb(url: string, photoId?: number): string {
  if (photoId != null && photoId > 0) {
    return resolvePhotoThumbUrl({ id: photoId, url }, normalizePhotoDisplayUrl);
  }
  const normalized = normalizePhotoDisplayUrl(url);
  if (normalized.startsWith('/api/nas-dev/')) {
    return normalized + (normalized.includes('?') ? '&' : '?') + 'thumb=96';
  }
  return normalized;
}

type ClaimModalMode = 'create' | 'link';
type CreateClaimStep = 'internal' | 'seller';

interface FiledTicket {
  number: string;
  url: string | null;
  id: number | null;
}


const SELLER_SKELETON_WIDTHS = ['92%', '88%', '76%', '84%', '68%', '56%'] as const;

function SellerMessageSkeleton() {
  return (
    <div className="space-y-2.5 rounded-lg border border-blue-100 bg-white px-3 py-3" aria-hidden>
      {SELLER_SKELETON_WIDTHS.map((width) => (
        <SkeletonBase key={width} width={width} height="0.75rem" />
      ))}
    </div>
  );
}

const CLAIM_WIZARD_STEPS = [
  { key: 'internal', label: 'Ticket Creation' },
  { key: 'seller', label: 'Seller Message' },
] as const;

function claimWizardStepStates(
  createStep: CreateClaimStep,
  filedTicket: FiledTicket | null,
  mode: ClaimModalMode,
): Record<string, LinearStepState> {
  const ticketStepDone = !!filedTicket || mode === 'link';
  if (createStep === 'seller' && ticketStepDone) {
    return { internal: 'done', seller: 'active' };
  }
  if (ticketStepDone) {
    return { internal: 'done', seller: 'pending' };
  }
  return { internal: 'active', seller: 'pending' };
}

/** Slim ticket shape returned by GET /api/receiving/zendesk-claim/link. */
interface LinkCandidate {
  id: number;
  subject: string | null;
  /** First-comment snippet for the expanded detail view (server-capped). */
  description: string | null;
  status: string;
  priority: string | null;
  createdAt: string;
  updatedAt: string;
  url: string | null;
  linkedToThis: boolean;
}

function ticketDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface Props {
  open: boolean;
  row: ReceivingLineRow;
  /**
   * Seeds the "What happened?" note when the modal opens. Used by the RETURN
   * serial-match CTA to pre-populate the matched order + serial context so the
   * operator only has to review and submit.
   */
  prefillReason?: string;
  onClose: () => void;
  /** Called with the formatted ticket number on success ("#12345"). */
  onTicketCreated: (ticketNumber: string) => void;
  /** Called after a committed ticket link is removed (clears Support chip). */
  onTicketUnlinked?: () => void;
}

/**
 * Make-a-claim modal. Filed against the current receiving carton (and
 * optionally the active line). Posts to /api/receiving/zendesk-claim which
 * creates the ticket directly via the Zendesk REST API. A second mode links
 * an EXISTING Zendesk ticket instead (/api/receiving/zendesk-claim/link);
 * tickets already linked to other items are hidden from that picker.
 *
 * On success, the ticket # is handed to `onTicketCreated`, which the parent
 * uses to auto-fill the existing `zendesk` field in the Support FlowSection.
 * Operator can still manually paste a # via the existing affordance if the
 * bridge fails or returns no number.
 */
export function ReceivingClaimModal({ open, row, prefillReason, onClose, onTicketCreated, onTicketUnlinked }: Props) {
  // Auto-select 'unfound' when the carton has no Zoho match — support's
  // routing for unmatched-tracking claims is different from damage/missing.
  const initialClaimType: ClaimType =
    row.receiving_source === 'unmatched' ? 'unfound' : 'damage';
  const [claimType, setClaimType] = useState<ClaimType>(initialClaimType);
  // 'create' files a fresh ticket; 'link' attaches an existing Zendesk ticket
  // to this carton/line instead (search → pick → POST .../link).
  const [mode, setMode] = useState<ClaimModalMode>('create');
  const [createStep, setCreateStep] = useState<CreateClaimStep>('internal');
  const [filedTicket, setFiledTicket] = useState<FiledTicket | null>(null);
  /** Last ticket id/number we bootstrapped seller step for — re-run when it changes. */
  const sellerBootstrapKey = useRef<string | null>(null);
  const [ticketQuery, setTicketQuery] = useState('');
  const [ticketResults, setTicketResults] = useState<LinkCandidate[]>([]);
  // Tickets already linked to OTHER items are excluded server-side; we only
  // get the count back so the operator knows why a search came up short.
  const [hiddenLinked, setHiddenLinked] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<LinkCandidate | null>(null);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [linkCommitted, setLinkCommitted] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [draftBody, setDraftBody] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [sellerMessage, setSellerMessage] = useState('');
  const [sellerMessageId, setSellerMessageId] = useState<number | null>(null);
  const [aiModel, setAiModel] = useState('');
  // Photos to attach to the Zendesk ticket as real files (default: none — pick
  // the ones to send; all PO photos are archived to the ticket folder regardless).
  const [photos, setPhotos] = useState<{ id: number; url: string }[]>([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<number>>(new Set());

  // Editable ticket template — populated from the server preview endpoint so
  // it reflects exactly what the ticket will contain (PO #, tracking,
  // photo URLs, line summary). The operator can edit either field before
  // posting; once they touch it we stop overwriting from the preview.
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const subjectTouched = useRef(false);
  const descriptionTouched = useRef(false);
  // Stable per-submission idempotency key — generated when the modal opens and
  // reused across retries so a failed-then-retried submit never files two tickets.
  const idempotencyKey = useRef('');

  // Reset transient state each time the modal opens so reopening on a
  // different row doesn't show stale template text.
  useEffect(() => {
    if (!open) return;
    // Seed the operator note from a return-match prefill when present so the
    // claim opens populated; otherwise start blank.
    setLinkCommitted(false);
    setReason(prefillReason ?? '');
    setDraftBody(null);
    setSellerMessage('');
    setSellerMessageId(null);
    setAiModel('');
    setSubject('');
    setDescription('');
    setClaimType(
      row.receiving_source === 'unmatched' ? 'unfound' : 'damage',
    );
    subjectTouched.current = false;
    descriptionTouched.current = false;
    idempotencyKey.current = crypto.randomUUID();
    setPhotos([]);
    setSelectedPhotoIds(new Set());
    setMode('create');
    setCreateStep('internal');
    setFiledTicket(null);
    sellerBootstrapKey.current = null;
    setTicketQuery('');
    setTicketResults([]);
    setHiddenLinked(0);
    setSelectedTicket(null);
  }, [open, row.receiving_id, row.id, row.receiving_source, prefillReason]);

  // Load the carton's photos so the operator can pick which to attach. Defaults
  // to all selected — attaching everything is the common case; deselect to trim.
  useEffect(() => {
    if (!open || !row.receiving_id) return;
    const ctrl = new AbortController();
    fetch(`/api/receiving-photos?receivingId=${row.receiving_id}`, {
      cache: 'no-store',
      signal: ctrl.signal,
    })
      .then((r) => r.json().catch(() => null))
      .then((data) => {
        const list: { id: number; url: string }[] = (data?.photos ?? [])
          .filter((p: { photoUrl?: string }) => !!p.photoUrl?.trim())
          .map((p: { id: number; photoUrl: string }) => ({
            id: p.id,
            url: normalizePhotoDisplayUrl(p.photoUrl),
          }));
        setPhotos(list);
        setSelectedPhotoIds(new Set(list.map((p) => p.id)));
      })
      .catch(() => {
        /* best-effort — claim can still be filed without photos */
      });
    return () => ctrl.abort();
  }, [open, row.receiving_id]);

  // Fetch the server-rendered template whenever inputs change. Debounced so
  // typing in "reason" doesn't hammer the endpoint.
  useEffect(() => {
    if (!open || mode !== 'create' || createStep !== 'internal' || !row.receiving_id) return;
    const ctrl = new AbortController();
    const handle = window.setTimeout(() => {
      setPreviewLoading(true);
      fetch('/api/receiving/zendesk-claim/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId: row.receiving_id,
          lineId: row.id,
          claimType,
          reason: reason.trim(),
        }),
        signal: ctrl.signal,
      })
        .then((r) => r.json().catch(() => null))
        .then((data) => {
          if (!data?.success) return;
          if (!subjectTouched.current && typeof data.subject === 'string') {
            setSubject(data.subject);
          }
          if (!descriptionTouched.current && typeof data.description === 'string') {
            setDescription(data.description);
          }
        })
        .catch((err) => {
          if ((err as Error)?.name !== 'AbortError') {
            // Preview is best-effort — operator can still type their own.
          }
        })
        .finally(() => setPreviewLoading(false));
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(handle);
    };
  }, [open, mode, createStep, row.receiving_id, row.id, claimType, reason]);

  // Link mode: fetch candidate tickets — the most recent ones when the search
  // box is empty (the common case: the related ticket was just filed), or a
  // Zendesk search/id lookup once the operator types. The endpoint hides
  // tickets already linked to a different item and flags ones linked to THIS
  // item, so everything shown is safe to pick. Debounced like the preview.
  useEffect(() => {
    if (!open || mode !== 'link' || !row.receiving_id) return;
    const query = ticketQuery.trim();
    const ctrl = new AbortController();
    const handle = window.setTimeout(() => {
      setSearchLoading(true);
      const params = new URLSearchParams({
        receivingId: String(row.receiving_id),
        lineId: String(row.id),
      });
      if (query) params.set('query', query);
      fetch(`/api/receiving/zendesk-claim/link?${params}`, {
        cache: 'no-store',
        signal: ctrl.signal,
      })
        .then((r) => r.json().catch(() => null))
        .then((data) => {
          if (!data?.success) return;
          setTicketResults(Array.isArray(data.tickets) ? data.tickets : []);
          setHiddenLinked(Number(data.hiddenLinked) || 0);
          // Drop a selection that fell out of the new result set.
          setSelectedTicket((prev) =>
            prev && (data.tickets as LinkCandidate[]).some((t) => t.id === prev.id) ? prev : null,
          );
        })
        .catch(() => {
          /* best-effort — operator can refine the query */
        })
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(handle);
    };
  }, [open, mode, row.receiving_id, row.id, ticketQuery]);

  const togglePhoto = (id: number) =>
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const claimTypeItems = useMemo<HorizontalSliderItem[]>(
    () => CLAIM_TYPE_OPTIONS.map((opt) => ({ id: opt.value, label: opt.label })),
    [],
  );

  const claimStepStates = useMemo(
    () => claimWizardStepStates(createStep, filedTicket, mode),
    [createStep, filedTicket, mode],
  );

  const sellerStepReady = !!filedTicket || mode === 'link';

  const resetSellerDraftState = () => {
    setSellerMessage('');
    setSellerMessageId(null);
    setAiModel('');
    sellerBootstrapKey.current = null;
  };

  const clearPersistedSellerDraft = async () => {
    if (!row.receiving_id) return;
    const sp = new URLSearchParams({ receivingId: String(row.receiving_id) });
    if (row.id != null) sp.set('lineId', String(row.id));
    try {
      await fetch(`/api/receiving/zendesk-claim/seller-message?${sp}`, { method: 'DELETE' });
    } catch {
      /* best-effort */
    }
  };

  const handleModeChange = (next: ClaimModalMode) => {
    setMode(next);
    if (next === 'link') {
      setCreateStep('seller');
      sellerBootstrapKey.current = null;
    } else {
      setCreateStep('internal');
      setLinkCommitted(false);
    }
  };

  const selectLinkTicket = (t: LinkCandidate | null) => {
    if (!t) {
      setSelectedTicket(null);
      if (mode === 'link') {
        setFiledTicket(null);
        setLinkCommitted(false);
        resetSellerDraftState();
      }
      return;
    }
    const ticketChanged = selectedTicket?.id !== t.id;
    setSelectedTicket(t);
    if (mode === 'link') {
      setFiledTicket({ number: `#${t.id}`, url: t.url, id: t.id });
      setLinkCommitted(false);
      if (ticketChanged) resetSellerDraftState();
    }
  };

  const handleClaimStepClick = (key: string) => {
    if (key === 'internal') {
      if (mode === 'link' && !filedTicket) {
        setMode('create');
      }
      setCreateStep('internal');
      return;
    }
    if (key === 'seller' && sellerStepReady) {
      setCreateStep('seller');
    }
  };

  const advanceToSellerStep = (ticket: FiledTicket) => {
    setFiledTicket(ticket);
    setCreateStep('seller');
    sellerBootstrapKey.current = null;
  };

  const submitInternal = async () => {
    if (submitting || !row.receiving_id || filedTicket) return;
    setSubmitting(true);
    setDraftBody(null);
    try {
      const res = await fetch('/api/receiving/zendesk-claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey.current,
        },
        body: JSON.stringify({
          receivingId: row.receiving_id,
          lineId: row.id,
          claimType,
          reason: reason.trim(),
          subject: subject.trim(),
          description: description.trim(),
          attachPhotoIds: [...selectedPhotoIds],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setDraftBody(data?.draftBody ?? null);
        toast.error(data?.error || 'Could not file the claim');
        return;
      }
      const ticketNumber = data.ticketNumber ? String(data.ticketNumber) : '';
      const ticketUrl = typeof data.ticketUrl === 'string' ? data.ticketUrl : null;
      const ticketId =
        ticketNumber && /^#?(\d+)$/.test(ticketNumber.replace(/\s+/g, ''))
          ? Number(ticketNumber.replace(/^#/, ''))
          : null;

      if (ticketNumber) {
        toast.success(`Internal ticket ${ticketNumber} filed`, {
          action: ticketUrl
            ? { label: 'Open', onClick: () => window.open(ticketUrl, '_blank', 'noopener') }
            : undefined,
        });
        onTicketCreated(ticketNumber);
      } else {
        toast.success('Claim filed — continue to seller message when the ticket # is assigned');
      }
      if (data.archiveWarning) {
        toast.warning(String(data.archiveWarning), { duration: 8000 });
      }
      if (typeof data.sharePackUrl === 'string' && data.sharePackUrl) {
        const shareUrl = data.sharePackUrl;
        toast.success('Share pack ready for vendor', {
          duration: 10000,
          action: {
            label: 'Copy link',
            onClick: () => void navigator.clipboard.writeText(shareUrl),
          },
        });
      }

      advanceToSellerStep({
        number: ticketNumber || 'pending',
        url: ticketUrl,
        id: ticketId,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const draftSellerMessage = async (ticket: FiledTicket = filedTicket!) => {
    if (aiLoading || !row.receiving_id || !ticket?.number || ticket.number === 'pending') return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/receiving/zendesk-claim/assist-seller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId: row.receiving_id,
          lineId: row.id,
          claimType,
          reason: reason.trim(),
          subject: subject.trim(),
          description: description.trim(),
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

  const handleCopySellerMessage = async () => {
    const text = sellerMessage.trim();
    if (!text || !row.receiving_id) return;
    const { ok, messageId } = await copySellerClaimMessageWithPersist({
      text,
      messageId: sellerMessageId,
      receivingId: row.receiving_id,
      lineId: row.id ?? null,
      subjectSnapshot: subject.trim(),
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

  const finishSellerStep = async () => {
    const text = sellerMessage.trim();
    if (text && row.receiving_id) {
      try {
        await fetch('/api/receiving/zendesk-claim/seller-message', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receivingId: row.receiving_id,
            lineId: row.id ?? null,
            sellerMessage: text,
            subjectSnapshot: subject.trim(),
          }),
        });
      } catch {
        /* best-effort — assist-seller may have already saved */
      }
    }
    onClose();
  };

  // Step 2: restore saved draft or auto-generate seller message (includes filed ticket #).
  useEffect(() => {
    if (!open || createStep !== 'seller' || !filedTicket || !row.receiving_id) return;

    const bootstrapKey = `${filedTicket.id ?? ''}:${filedTicket.number}`;
    if (sellerBootstrapKey.current === bootstrapKey) return;
    sellerBootstrapKey.current = bootstrapKey;

    const ctrl = new AbortController();
    const bootstrap = async () => {
      const sp = new URLSearchParams({ receivingId: String(row.receiving_id) });
      if (row.id != null) sp.set('lineId', String(row.id));
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
  }, [open, mode, createStep, filedTicket, row.receiving_id, row.id]);

  const deselectLinkedTicket = () => {
    setSelectedTicket(null);
    setFiledTicket(null);
    setLinkCommitted(false);
    resetSellerDraftState();
  };

  const unlinkCommittedTicket = async () => {
    if (unlinking || !filedTicket?.id || !row.receiving_id) return;
    setUnlinking(true);
    try {
      const sp = new URLSearchParams({
        receivingId: String(row.receiving_id),
        ticketId: String(filedTicket.id),
      });
      if (row.id != null) sp.set('lineId', String(row.id));
      const res = await fetch(`/api/receiving/zendesk-claim/link?${sp}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not unlink the ticket');
        return;
      }
      await clearPersistedSellerDraft();
      deselectLinkedTicket();
      onTicketUnlinked?.();
      toast.success('Ticket unlinked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unlink the ticket');
    } finally {
      setUnlinking(false);
    }
  };

  const handleBannerUnlink = () => {
    if (linkCommitted) {
      void unlinkCommittedTicket();
      return;
    }
    void clearPersistedSellerDraft();
    deselectLinkedTicket();
  };

  // Link mode submit: attach the picked existing ticket to this carton/line.
  // Reuses the parent's onTicketCreated path — from its point of view a linked
  // ticket and a freshly-created one land the same way (zendesk field + pill).
  const submitLink = async () => {
    if (linking || !selectedTicket || !row.receiving_id) return;
    setLinking(true);
    try {
      const res = await fetch('/api/receiving/zendesk-claim/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId: row.receiving_id,
          lineId: row.id,
          ticketId: selectedTicket.id,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not link the ticket');
        return;
      }
      const url = typeof data.ticketUrl === 'string' ? data.ticketUrl : null;
      toast.success(`Linked ${data.ticketNumber}`, {
        action: url
          ? { label: 'Open', onClick: () => window.open(url, '_blank', 'noopener') }
          : undefined,
      });
      onTicketCreated(String(data.ticketNumber));
      setLinkCommitted(true);
      setFiledTicket({
        number: String(data.ticketNumber),
        url,
        id: selectedTicket.id,
      });
      if (createStep !== 'seller') {
        advanceToSellerStep({
          number: String(data.ticketNumber),
          url,
          id: selectedTicket.id,
        });
      } else {
        sellerBootstrapKey.current = null;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLinking(false);
    }
  };

  return (
    <RightPaneOverlay
      open={open}
      onClose={onClose}
      align="right"
      width={672}
      aria-label="File a claim"
    >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-gradient-to-r from-rose-50 to-amber-50 px-5 py-4">
              <div>
                <p className="text-micro font-black uppercase tracking-[0.14em] text-rose-700">
                  File a claim
                </p>
                <p className="mt-0.5 text-base font-extrabold tracking-tight text-gray-900">
                  {row.receiving_source === 'unmatched'
                    ? 'Unfound'
                    : row.zoho_purchaseorder_number
                      ? `PO ${row.zoho_purchaseorder_number}`
                      : `Receiving #${row.receiving_id ?? '—'}`}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                aria-label="Cancel"
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white hover:text-gray-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div className="flex justify-center">
                <LinearWorkflowStepper
                  steps={CLAIM_WIZARD_STEPS}
                  states={claimStepStates}
                  ariaLabel="Claim filing steps"
                  size="compact"
                  className="w-full max-w-[15rem]"
                  onStepClick={handleClaimStepClick}
                  isStepDisabled={(key) => key === 'seller' && !sellerStepReady}
                />
              </div>

              <div className="flex justify-center border-b border-gray-100 pb-1">
                <PaneHeaderTabs<ClaimModalMode>
                  tabs={[
                    { value: 'create', label: 'New ticket' },
                    { value: 'link', label: 'Link existing' },
                  ]}
                  value={mode}
                  onChange={handleModeChange}
                />
              </div>

              {createStep === 'internal' && mode === 'create' ? (
                <>
              <div>
                <p className="mb-1.5 text-micro font-black uppercase tracking-[0.14em] text-gray-500">
                  Claim type
                </p>
                <HorizontalButtonSlider
                  items={claimTypeItems}
                  value={claimType}
                  onChange={(id) => setClaimType(id as ClaimType)}
                  variant="nav"
                  size="md"
                  aria-label="Claim type"
                />
              </div>

              <div>
                <label
                  htmlFor="claim-reason"
                  className="mb-1.5 block text-micro font-black uppercase tracking-[0.14em] text-gray-500"
                >
                  What happened?
                </label>
                <textarea
                  id="claim-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder={
                    claimType === 'damage'
                      ? 'Crushed packaging, dent on side panel…'
                      : claimType === 'missing'
                        ? '2 of 3 units missing from package…'
                        : claimType === 'wrong_item'
                          ? 'Received model XL2 instead of MX5…'
                          : 'Inconsistent QA, multiple units DOA…'
                  }
                  className="block w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-label font-medium leading-snug text-gray-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                />
              </div>

              {/* Photo selection — these upload to Zendesk as real file
                  attachments (only the ones checked). */}
              {photos.length > 0 ? (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-micro font-black uppercase tracking-[0.14em] text-gray-500">
                      Attach photos ({selectedPhotoIds.size}/{photos.length})
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedPhotoIds((prev) =>
                          prev.size === photos.length ? new Set() : new Set(photos.map((p) => p.id)),
                        )
                      }
                      className="text-micro font-bold uppercase tracking-wider text-gray-500 hover:text-gray-900"
                    >
                      {selectedPhotoIds.size === photos.length ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <div className="grid grid-cols-6 gap-1.5">
                    {photos.map((p) => {
                      const isSel = selectedPhotoIds.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => togglePhoto(p.id)}
                          className={`relative aspect-square overflow-hidden rounded-md ring-2 transition ${
                            isSel ? 'ring-rose-500' : 'ring-transparent hover:ring-gray-300'
                          }`}
                          title={isSel ? 'Selected — click to remove' : 'Click to attach'}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={claimThumb(p.url, p.id)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className={`h-full w-full bg-gray-100 object-cover ${isSel ? '' : 'opacity-70'}`}
                          />
                          {isSel ? (
                            <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-rose-600 text-[10px] font-black text-white">
                              ✓
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-micro font-medium text-gray-400">
                    Selected photos upload to Zendesk as files. All PO photos are also saved to a
                    local folder named after the ticket #.
                  </p>
                </div>
              ) : null}

              <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-micro font-black uppercase tracking-[0.14em] text-gray-500">
                      Zendesk ticket {previewLoading ? '(updating…)' : '(editable)'}
                    </p>
                    {filedTicket ? (
                      <p className="mt-0.5 text-[10px] font-semibold text-emerald-600">
                        Filed {filedTicket.number}
                      </p>
                    ) : null}
                  </div>
                  {(subjectTouched.current || descriptionTouched.current) ? (
                    <button
                      type="button"
                      onClick={() => {
                        subjectTouched.current = false;
                        descriptionTouched.current = false;
                        setReason((r) => r);
                      }}
                      className="text-micro font-bold uppercase tracking-wider text-gray-500 hover:text-gray-900"
                    >
                      Reset to template
                    </button>
                  ) : null}
                </div>

                <label
                  htmlFor="claim-subject"
                  className="mb-1 block text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400"
                >
                  Subject
                </label>
                <input
                  id="claim-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => {
                    subjectTouched.current = true;
                    setSubject(e.target.value);
                  }}
                  placeholder={previewLoading ? 'Generating…' : 'Subject'}
                  className="mb-3 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-label font-semibold text-gray-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                />

                <label
                  htmlFor="claim-body"
                  className="mb-1 block text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400"
                >
                  Body
                </label>
                <textarea
                  id="claim-body"
                  value={description}
                  onChange={(e) => {
                    descriptionTouched.current = true;
                    setDescription(e.target.value);
                  }}
                  rows={10}
                  placeholder={previewLoading ? 'Generating…' : 'Ticket body'}
                  className="block w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-caption leading-snug text-gray-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                />
              </div>

              <p className="text-micro font-semibold leading-snug text-gray-500">
                Auto-fills from PO, tracking, photos, and the active line. Filing creates the
                internal ticket, then step 2 drafts the external seller message with the ticket #.
              </p>

              {draftBody ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-micro font-black uppercase tracking-widest text-amber-700">
                    Zendesk unreachable — copy this body to Zendesk
                  </p>
                  <textarea
                    readOnly
                    value={draftBody}
                    rows={6}
                    className="mt-1.5 block w-full resize-none rounded border border-amber-200 bg-white px-2 py-1.5 font-mono text-micro text-gray-800 outline-none"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(draftBody).then(() => {
                        toast.success('Body copied to clipboard');
                      });
                    }}
                    className="mt-1.5 text-micro font-bold uppercase tracking-widest text-amber-700 hover:text-amber-900"
                  >
                    Copy to clipboard
                  </button>
                </div>
              ) : null}
                </>
              ) : (
                <>
              {mode === 'link' && !filedTicket ? (
                <>
                  <div>
                    <label
                      htmlFor="claim-ticket-search"
                      className="mb-1.5 block text-micro font-black uppercase tracking-[0.14em] text-gray-500"
                    >
                      Pick the existing ticket
                    </label>
                    <input
                      id="claim-ticket-search"
                      type="text"
                      value={ticketQuery}
                      onChange={(e) => setTicketQuery(e.target.value)}
                      placeholder="Search by subject, or paste a ticket # (e.g. #12345)"
                      autoFocus
                      className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-label font-medium text-gray-900 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center gap-2">
                      <p className="text-micro font-black uppercase tracking-[0.14em] text-gray-500">
                        {ticketQuery.trim() ? 'Results' : 'Recent tickets'} — click to select
                      </p>
                      {searchLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                      ) : null}
                    </div>
                    <div className="max-h-[280px] overflow-y-auto rounded-xl border border-gray-200 bg-white">
                      {ticketResults.length > 0 ? (
                        <div className={searchLoading ? 'opacity-50' : ''}>
                        {ticketResults.map((t) => {
                          const isSel = selectedTicket?.id === t.id;
                          const badge = statusBadge(t.status);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => selectLinkTicket(isSel ? null : t)}
                              disabled={t.linkedToThis}
                              className={`flex w-full items-center gap-2.5 border-b border-gray-100 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                                isSel ? 'bg-rose-50' : 'hover:bg-gray-50'
                              } ${t.linkedToThis ? 'cursor-default opacity-60' : ''}`}
                            >
                              <span className="shrink-0 font-mono text-caption font-bold text-gray-900">
                                #{t.id}
                              </span>
                              <span
                                className={`shrink-0 rounded-full px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-label font-medium text-gray-700">
                                {t.subject || '—'}
                              </span>
                              <span className="shrink-0 text-micro font-medium text-gray-400">
                                {ticketDate(t.updatedAt)}
                              </span>
                            </button>
                          );
                        })}
                        </div>
                      ) : searchLoading ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-micro font-semibold text-gray-400">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Searching…
                        </div>
                      ) : (
                        <div className="px-4 py-10 text-center text-micro font-medium text-gray-400">
                          {ticketQuery.trim()
                            ? 'No tickets found — try a different search or ticket #'
                            : 'Recent Zendesk tickets will appear here'}
                        </div>
                      )}
                    </div>
                  </div>

                  {hiddenLinked > 0 ? (
                    <p className="text-micro font-medium text-gray-400">
                      {hiddenLinked} matching ticket{hiddenLinked === 1 ? ' is' : 's are'} hidden —
                      already linked to other items.
                    </p>
                  ) : null}
                </>
              ) : null}
              {filedTicket ? (
                <div className="relative rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2.5">
                  {mode === 'link' ? (
                    <button
                      type="button"
                      onClick={handleBannerUnlink}
                      disabled={unlinking}
                      aria-label={linkCommitted ? 'Unlink ticket' : 'Deselect ticket'}
                      title={linkCommitted ? 'Unlink ticket' : 'Deselect ticket'}
                      className="absolute right-2 top-2 rounded-md p-1 text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                    >
                      {unlinking ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
                      ) : (
                        <Unlink className="h-3.5 w-3.5 text-rose-600" />
                      )}
                    </button>
                  ) : null}
                  <p className="pr-8 text-micro font-black uppercase tracking-[0.14em] text-emerald-800">
                    {mode === 'link' && !linkCommitted
                      ? 'Existing ticket selected'
                      : mode === 'link'
                        ? 'Ticket linked'
                        : 'Internal ticket filed'}
                  </p>
                  <p className="mt-1 text-label font-bold text-emerald-900">{filedTicket.number}</p>
                  {filedTicket.url ? (
                    <a
                      href={filedTicket.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-micro font-bold uppercase tracking-wider text-emerald-700 hover:text-emerald-900"
                    >
                      Open in Zendesk ↗
                    </a>
                  ) : null}
                  <p className="mt-1.5 text-micro font-medium text-emerald-800/80">
                    The seller message below will reference this case # for full context.
                  </p>
                </div>
              ) : null}

              <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <MessageSquare className="h-4 w-4 shrink-0 text-blue-600" />
                    <div>
                      <p className="text-micro font-black uppercase tracking-[0.14em] text-blue-700">
                        Seller message
                      </p>
                      {aiModel ? (
                        <p className="text-[10px] font-semibold text-blue-600/70">Drafted by {aiModel}</p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => filedTicket && void draftSellerMessage(filedTicket)}
                    disabled={aiLoading || !filedTicket || filedTicket.number === 'pending'}
                    title="Regenerate seller message with AI"
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2 text-micro font-black uppercase tracking-wider text-blue-700 shadow-sm transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {aiLoading ? 'Drafting…' : 'Redraft'}
                  </button>
                </div>
                {aiLoading && !sellerMessage ? (
                  <SellerMessageSkeleton />
                ) : (
                  <textarea
                    value={sellerMessage}
                    onChange={(e) => setSellerMessage(e.target.value)}
                    rows={12}
                    placeholder="Seller-facing message will appear here…"
                    className="block w-full resize-y rounded-lg border border-blue-100 bg-white px-3 py-2 text-caption font-medium leading-snug text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  />
                )}
                <p className="mt-1.5 text-micro font-medium text-blue-700/70">
                  Paste into eBay or the marketplace seller. Plain text only — no links. Includes
                  your Zendesk case # as a reference.
                </p>
              </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting || linking || unlinking}
                className="inline-flex h-10 items-center rounded-xl border border-gray-200 bg-white px-4 text-caption font-bold uppercase tracking-widest text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              {createStep === 'internal' && mode === 'create' ? (
                  <>
                    {filedTicket ? (
                      <button
                        type="button"
                        onClick={() => setCreateStep('seller')}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-700"
                      >
                        Continue to seller →
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={submitInternal}
                        disabled={submitting || !row.receiving_id || !subject.trim() || !description.trim()}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {submitting ? 'Creating…' : 'Create Zendesk ticket →'}
                      </button>
                    )}
                  </>
              ) : (
                  <>
                    {mode === 'link' && filedTicket && !linkCommitted ? (
                      <button
                        type="button"
                        onClick={submitLink}
                        disabled={linking || !row.receiving_id || !selectedTicket}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {linking
                          ? 'Linking…'
                          : selectedTicket
                            ? `Link ticket #${selectedTicket.id} →`
                            : 'Link ticket'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={!sellerMessage.trim()}
                      onClick={() => void handleCopySellerMessage()}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-4 text-caption font-bold uppercase tracking-widest text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Copy className="h-4 w-4" />
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => void finishSellerStep()}
                      disabled={aiLoading || (mode === 'link' && !linkCommitted)}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Done
                    </button>
                  </>
              )}
            </div>
    </RightPaneOverlay>
  );
}
