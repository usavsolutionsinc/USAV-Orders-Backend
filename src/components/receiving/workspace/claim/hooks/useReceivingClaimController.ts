import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import {
  CLAIM_TYPE_OPTIONS,
  type ClaimType,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  claimWizardStepStates,
  type ClaimModalMode,
  type CreateClaimStep,
  type FiledTicket,
  type LinkCandidate,
} from '../claim-types';
import { useClaimPhotos } from './useClaimPhotos';
import { useClaimTicketSearch } from './useClaimTicketSearch';
import { useClaimTemplate } from './useClaimTemplate';
import { useClaimSellerMessage } from './useClaimSellerMessage';

export interface ClaimModalProps {
  open: boolean;
  row: ReceivingLineRow;
  /** Seeds the "What happened?" note when the modal opens (RETURN match CTA). */
  prefillReason?: string;
  onClose: () => void;
  /** Called with the formatted ticket number on success ("#12345"). */
  onTicketCreated: (ticketNumber: string) => void;
  /** Called after a committed ticket link is removed (clears Support chip). */
  onTicketUnlinked?: () => void;
}

/**
 * The make-a-claim controller. Owns the wizard/mode state and the create/link
 * submit flows, and composes the four single-responsibility sub-hooks
 * ({@link useClaimPhotos}, {@link useClaimTicketSearch}, {@link useClaimTemplate},
 * {@link useClaimSellerMessage}). Returns one bag consumed by the presentational
 * sections so the modal file itself stays a thin composition layer.
 */
export function useReceivingClaimController({
  open,
  row,
  prefillReason,
  onClose,
  onTicketCreated,
  onTicketUnlinked,
}: ClaimModalProps) {
  const receivingId = row.receiving_id;
  const lineId = row.id;
  // Auto-select 'unfound' when the carton has no Zoho match — support routes
  // unmatched-tracking claims differently from damage/missing.
  const initialClaimType: ClaimType = row.receiving_source === 'unmatched' ? 'unfound' : 'damage';

  // ── Wizard / mode state ──────────────────────────────────────────────────
  const [claimType, setClaimType] = useState<ClaimType>(initialClaimType);
  const [mode, setMode] = useState<ClaimModalMode>('create');
  const [createStep, setCreateStep] = useState<CreateClaimStep>('internal');
  const [filedTicket, setFiledTicket] = useState<FiledTicket | null>(null);
  const [reason, setReason] = useState('');

  // ── Create-flow submit state ─────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [draftBody, setDraftBody] = useState<string | null>(null);
  // Stable per-submission idempotency key — generated on open and reused across
  // retries so a failed-then-retried submit never files two tickets.
  const idempotencyKey = useRef('');

  // ── Link-flow submit state ───────────────────────────────────────────────
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [linkCommitted, setLinkCommitted] = useState(false);

  // ── Composed sub-hooks ───────────────────────────────────────────────────
  const photos = useClaimPhotos(open, receivingId);
  const template = useClaimTemplate({
    open,
    active: mode === 'create' && createStep === 'internal',
    receivingId,
    lineId,
    claimType,
    reason,
  });
  const search = useClaimTicketSearch({
    open,
    enabled: mode === 'link',
    receivingId,
    lineId,
  });
  const seller = useClaimSellerMessage({
    open,
    mode,
    createStep,
    filedTicket,
    receivingId,
    lineId,
    claimType,
    reason,
    readSubject: template.readSubject,
    readDescription: template.readDescription,
    onClose,
  });

  // Reset the controller-owned cells each time the modal opens. Sub-hooks reset
  // their own state on `open`.
  useEffect(() => {
    if (!open) return;
    setReason(prefillReason ?? '');
    setDraftBody(null);
    setClaimType(row.receiving_source === 'unmatched' ? 'unfound' : 'damage');
    idempotencyKey.current = crypto.randomUUID();
    setMode('create');
    setCreateStep('internal');
    setFiledTicket(null);
    setLinkCommitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, receivingId, lineId, row.receiving_source, prefillReason]);

  // ── Derived view-model ───────────────────────────────────────────────────
  const claimTypeItems = useMemo<HorizontalSliderItem[]>(
    () => CLAIM_TYPE_OPTIONS.map((opt) => ({ id: opt.value, label: opt.label })),
    [],
  );
  const claimStepStates = useMemo(
    () => claimWizardStepStates(createStep, filedTicket, mode),
    [createStep, filedTicket, mode],
  );
  const sellerStepReady = !!filedTicket || mode === 'link';

  // ── Wizard navigation ────────────────────────────────────────────────────
  const handleModeChange = (next: ClaimModalMode) => {
    setMode(next);
    if (next === 'link') {
      setCreateStep('seller');
      seller.resetBootstrap();
    } else {
      setCreateStep('internal');
      setLinkCommitted(false);
    }
  };

  const handleClaimStepClick = (key: string) => {
    if (key === 'internal') {
      if (mode === 'link' && !filedTicket) setMode('create');
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
    seller.resetBootstrap();
  };

  const selectLinkTicket = (t: LinkCandidate | null) => {
    if (!t) {
      search.setSelectedTicket(null);
      if (mode === 'link') {
        setFiledTicket(null);
        setLinkCommitted(false);
        seller.resetDraftState();
      }
      return;
    }
    const ticketChanged = search.selectedTicket?.id !== t.id;
    search.setSelectedTicket(t);
    if (mode === 'link') {
      setFiledTicket({ number: `#${t.id}`, url: t.url, id: t.id });
      setLinkCommitted(false);
      if (ticketChanged) seller.resetDraftState();
    }
  };

  const deselectLinkedTicket = () => {
    search.setSelectedTicket(null);
    setFiledTicket(null);
    setLinkCommitted(false);
    seller.resetDraftState();
  };

  const handleBannerUnlink = () => {
    if (linkCommitted) {
      void unlinkCommittedTicket();
      return;
    }
    void seller.clearPersistedSellerDraft();
    deselectLinkedTicket();
  };

  // ── Create flow: file a fresh internal ticket ────────────────────────────
  const submitInternal = async () => {
    if (submitting || !receivingId || filedTicket) return;
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
          receivingId,
          lineId,
          claimType,
          reason: reason.trim(),
          subject: template.readSubject().trim(),
          description: template.readDescription().trim(),
          attachPhotoIds: [...photos.selectedPhotoIds],
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

  // ── Link flow: attach an existing ticket to this carton/line ─────────────
  const submitLink = async () => {
    if (linking || !search.selectedTicket || !receivingId) return;
    const selected = search.selectedTicket;
    setLinking(true);
    try {
      const res = await fetch('/api/receiving/zendesk-claim/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivingId, lineId, ticketId: selected.id }),
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
      setFiledTicket({ number: String(data.ticketNumber), url, id: selected.id });
      if (createStep !== 'seller') {
        advanceToSellerStep({ number: String(data.ticketNumber), url, id: selected.id });
      } else {
        seller.resetBootstrap();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLinking(false);
    }
  };

  const unlinkCommittedTicket = async () => {
    if (unlinking || !filedTicket?.id || !receivingId) return;
    setUnlinking(true);
    try {
      const sp = new URLSearchParams({
        receivingId: String(receivingId),
        ticketId: String(filedTicket.id),
      });
      if (lineId != null) sp.set('lineId', String(lineId));
      const res = await fetch(`/api/receiving/zendesk-claim/link?${sp}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not unlink the ticket');
        return;
      }
      await seller.clearPersistedSellerDraft();
      deselectLinkedTicket();
      onTicketUnlinked?.();
      toast.success('Ticket unlinked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unlink the ticket');
    } finally {
      setUnlinking(false);
    }
  };

  return {
    // props passthrough
    row,
    open,
    onClose,
    // wizard
    mode,
    createStep,
    setCreateStep,
    filedTicket,
    claimType,
    setClaimType,
    reason,
    setReason,
    claimTypeItems,
    claimStepStates,
    sellerStepReady,
    handleModeChange,
    handleClaimStepClick,
    selectLinkTicket,
    handleBannerUnlink,
    // create flow
    submitting,
    draftBody,
    submitInternal,
    // link flow
    linking,
    unlinking,
    linkCommitted,
    submitLink,
    // sub-hooks
    photos,
    template,
    search,
    seller,
  };
}

export type ReceivingClaimController = ReturnType<typeof useReceivingClaimController>;
