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
  CREATE_STEP_ORDER,
  type ArchiveState,
  type ClaimModalMode,
  type CreateClaimStep,
  type FiledTicket,
  type LinkCandidate,
} from '../claim-types';
import { useClaimPhotos } from './useClaimPhotos';
import { useClaimTicketSearch } from './useClaimTicketSearch';
import { useClaimTemplate } from './useClaimTemplate';
import { useClaimSellerMessage } from './useClaimSellerMessage';
import { useClaimTicketReply } from './useClaimTicketReply';

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
  // A real PO# (number or id) — when present, 'unfound' is neither defaulted nor
  // offered, even if the carton came in as an unmatched scan.
  const hasPo = !!(row.zoho_purchaseorder_number || row.zoho_purchaseorder_id);
  // RETURN intake (per-line receiving_type, else carton default, else line
  // intake_type) auto-selects the 'return' claim type.
  const isReturnIntake =
    row.receiving_type === 'RETURN' ||
    row.carton_intake_type === 'RETURN' ||
    row.intake_type === 'return';
  // Default: return → 'return'; unmatched w/o PO → 'unfound'; otherwise 'damage'.
  const initialClaimType: ClaimType = isReturnIntake
    ? 'return'
    : row.receiving_source === 'unmatched' && !hasPo
      ? 'unfound'
      : 'damage';

  // ── Wizard / mode state ──────────────────────────────────────────────────
  const [claimType, setClaimType] = useState<ClaimType>(initialClaimType);
  const [mode, setMode] = useState<ClaimModalMode>('create');
  const [createStep, setCreateStep] = useState<CreateClaimStep>('photos');
  const [filedTicket, setFiledTicket] = useState<FiledTicket | null>(null);
  const [reason, setReason] = useState('');

  // ── Create-flow submit state ─────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [draftBody, setDraftBody] = useState<string | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);

  // ── Dry-run test state (no Zendesk ticket / NAS / DB side-effects) ────────
  // True once the operator filed via the dry-run path: the confirm/seller steps
  // render against the '#TEST' sentinel and suppress any real side-effect.
  const [isDryRun, setIsDryRun] = useState(false);
  const [testCreating, setTestCreating] = useState(false);
  const [testResult, setTestResult] = useState<{
    subject: string;
    description: string;
    attachCount: number;
  } | null>(null);
  const [testSellerLoading, setTestSellerLoading] = useState(false);
  const [testSellerPreview, setTestSellerPreview] = useState<{ message: string; model: string } | null>(
    null,
  );
  // NAS backup result — set by both the auto-archive on ticket creation and the
  // manual "Archive to NAS" action, so the seller step can DISPLAY whether the
  // backup landed (and offer a retry when it failed/was partial).
  const [archiveState, setArchiveState] = useState<ArchiveState | null>(null);
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
    // Keep the preview warm across every pre-file step so Review can render it.
    active:
      mode === 'create' &&
      (createStep === 'photos' || createStep === 'compose' || createStep === 'review'),
    receivingId,
    lineId,
    claimType,
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
  const reply = useClaimTicketReply({ open, ticketId: filedTicket?.id ?? null });

  // Reset the controller-owned cells each time the modal opens. Sub-hooks reset
  // their own state on `open`.
  useEffect(() => {
    if (!open) return;
    setReason(prefillReason ?? '');
    setDraftBody(null);
    setClaimType(initialClaimType);
    idempotencyKey.current = crypto.randomUUID();
    setMode('create');
    setCreateStep('photos');
    setFiledTicket(null);
    setLinkCommitted(false);
    setTestResult(null);
    setTestSellerPreview(null);
    setArchiveState(null);
    setIsDryRun(false);
  }, [open, receivingId, lineId, initialClaimType, prefillReason]);

  // ── Derived view-model ───────────────────────────────────────────────────
  // Hide 'unfound' once a real PO# is present — an order with a PO can't be
  // "unfound". Every other claim type (incl. 'return') stays available.
  const claimTypeItems = useMemo<HorizontalSliderItem[]>(
    () =>
      CLAIM_TYPE_OPTIONS.filter((opt) => opt.value !== 'unfound' || !hasPo).map((opt) => ({
        id: opt.value,
        label: opt.label,
      })),
    [hasPo],
  );
  const claimStepStates = useMemo(
    () => claimWizardStepStates(createStep, filedTicket, mode),
    [createStep, filedTicket, mode],
  );
  const sellerStepReady = !!filedTicket || mode === 'link';
  // The compose draft must be complete before Review/Submit are reachable.
  const composeComplete = !!template.subject.trim() && !!template.description.trim();

  // ── Linear wizard navigation (create mode) ───────────────────────────────
  // A step is reachable when every step before it is satisfied: confirm/seller
  // require a filed ticket; review requires a complete compose draft.
  const isCreateStepDisabled = (key: string): boolean => {
    const target = key as CreateClaimStep;
    if (target === 'confirm' || target === 'seller') return !filedTicket;
    if (target === 'review') return !composeComplete && !filedTicket;
    return false;
  };

  const goToStep = (next: CreateClaimStep) => {
    if (isCreateStepDisabled(next)) return;
    setCreateStep(next);
  };

  /** Footer "Back" — one step left in the create order (no-op on the first). */
  const goBack = () => {
    const idx = CREATE_STEP_ORDER.indexOf(createStep);
    if (idx > 0) setCreateStep(CREATE_STEP_ORDER[idx - 1]);
  };

  /** Footer "Next" — photos → compose → review (Submit lives on review). */
  const goNext = () => {
    if (createStep === 'photos') {
      setCreateStep('compose');
    } else if (createStep === 'compose') {
      if (composeComplete) setCreateStep('review');
    }
  };

  // ── Wizard navigation ────────────────────────────────────────────────────
  const handleModeChange = (next: ClaimModalMode) => {
    setMode(next);
    if (next === 'link') {
      setCreateStep('seller');
      seller.resetBootstrap();
    } else {
      setCreateStep(filedTicket ? 'confirm' : 'photos');
      setLinkCommitted(false);
    }
  };

  const handleClaimStepClick = (key: string) => {
    if (mode === 'link') {
      // Link mode has no linear create stepper; clicking the picker returns to
      // create from a deselected link.
      if (key === 'photos' && !filedTicket) setMode('create');
      return;
    }
    goToStep(key as CreateClaimStep);
  };

  /**
   * Confirmation → seller. In a real flow the seller hook auto-bootstraps on
   * `createStep`; for a dry run ('#TEST') the hook deliberately skips its fetch,
   * so we draft a throwaway preview here instead.
   */
  const continueToSeller = () => {
    setCreateStep('seller');
    if (filedTicket?.number === '#TEST') void draftTestSellerMessage();
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
      // Capture the auto-archive result so the seller step DISPLAYS the NAS
      // backup status — and a retry when it failed/was partial.
      const archiveWarning = data.archiveWarning ? String(data.archiveWarning) : null;
      setArchiveState({
        ok: data.archiveOk === true && !archiveWarning,
        copied: Number(data.archiveCopied ?? 0),
        total: Number(data.archiveTotal ?? 0),
        folder:
          typeof data.archiveFolder === 'string' && data.archiveFolder
            ? data.archiveFolder
            : ticketNumber.replace(/^#/, '') || null,
        warning: archiveWarning,
      });
      if (archiveWarning) {
        toast.warning(archiveWarning, { duration: 8000 });
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

      // Land on the confirmation step — the operator reviews the ticket result
      // AND the NAS backup result there before continuing to the seller message.
      setFiledTicket({
        number: ticketNumber || 'pending',
        url: ticketUrl,
        id: ticketId,
      });
      setCreateStep('confirm');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  // Archive the carton's photos to a NAS folder via the office agent. The
  // folder is the filed/linked ticket # when we have one, else the PO#, else a
  // receiving fallback — so the operator can publish to NAS before OR after a
  // ticket exists. No free-text target.
  const archiveToNas = async () => {
    if (archiveSubmitting || submitting || !receivingId) return;
    const folder =
      filedTicket?.number?.replace(/^#/, '').trim() ||
      String(row.zoho_purchaseorder_number || '').trim() ||
      `RCV-${receivingId}`;
    setArchiveSubmitting(true);
    try {
      const res = await fetch('/api/receiving/zendesk-claim/archive-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId,
          lineId,
          ticketNumber: folder,
          claimType,
          reason: reason.trim(),
          subject: template.readSubject().trim(),
          description: template.readDescription().trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Could not archive claim photos');
        return;
      }
      // Display the backup result on the seller step (folder + counts), and a
      // retry affordance when it was partial.
      const warning = data.archiveWarning ? String(data.archiveWarning) : null;
      setArchiveState({
        ok: !warning,
        copied: Number(data.copied ?? 0),
        total: Number(data.total ?? 0),
        folder: typeof data.folderName === 'string' ? data.folderName : null,
        warning,
      });
      if (warning) toast.warning(warning, { duration: 8000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setArchiveSubmitting(false);
    }
  };

  // ── Dry-run tests: rehearse the flow without filing/saving anything ───────
  const submitTestCreate = async () => {
    if (testCreating || submitting || !receivingId) return;
    setTestCreating(true);
    try {
      const res = await fetch('/api/receiving/zendesk-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun: true,
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
        toast.error(data?.error || 'Test create failed');
        return;
      }
      setTestResult({
        subject: String(data.subject ?? ''),
        description: String(data.description ?? ''),
        attachCount: Number(data.attachCount ?? 0),
      });
      toast.success('Test create OK — no ticket was filed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setTestCreating(false);
    }
  };

  const submitTestSeller = async () => {
    if (testSellerLoading || !receivingId) return;
    const subject = template.readSubject().trim();
    const description = template.readDescription().trim();
    if (!subject || !description) {
      toast.error('Add a subject and body before testing the seller message');
      return;
    }
    setTestSellerLoading(true);
    try {
      const res = await fetch('/api/receiving/zendesk-claim/assist-seller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun: true,
          receivingId,
          lineId,
          claimType,
          reason: reason.trim(),
          subject,
          description,
          zendeskTicketNumber: '#TEST',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Test seller message failed');
        return;
      }
      setTestSellerPreview({
        message: typeof data.sellerMessage === 'string' ? data.sellerMessage : '',
        model: typeof data.model === 'string' ? data.model : '',
      });
      if (data.linksStripped) {
        toast.warning('Links were removed (marketplace TOS)', { duration: 5000 });
      }
      toast.success('Test seller message drafted — not saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setTestSellerLoading(false);
    }
  };

  const clearTestOutputs = () => {
    setTestResult(null);
    setTestSellerPreview(null);
  };

  // Dry-run "File ticket": exercise the REAL Review → Confirm → Seller arc with
  // zero side-effects. The endpoint short-circuits on `dryRun` (returns the
  // assembled subject/body + a '#TEST' ticket; no Zendesk/NAS/DB writes), so we
  // land on the confirm step with a synthetic ticket + NAS result to inspect.
  const submitDryRun = async () => {
    if (testCreating || submitting || !receivingId) return;
    const subject = template.readSubject().trim();
    const description = template.readDescription().trim();
    if (!subject || !description) return;
    setTestCreating(true);
    try {
      const res = await fetch('/api/receiving/zendesk-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun: true,
          receivingId,
          lineId,
          claimType,
          reason: reason.trim(),
          subject,
          description,
          attachPhotoIds: [...photos.selectedPhotoIds],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || 'Dry run failed');
        return;
      }
      const attachCount = Number(data.attachCount ?? photos.selectedPhotoIds.size);
      setIsDryRun(true);
      setFiledTicket({ number: '#TEST', url: null, id: null });
      // Synthesise the NAS result the real archive would have produced, so the
      // confirmation's backup card renders exactly as it would in production.
      setArchiveState({
        ok: true,
        copied: photos.photos.length,
        total: photos.photos.length,
        folder: 'TEST',
        warning: null,
      });
      setCreateStep('confirm');
      toast.success(`Dry run OK — no ticket filed (${attachCount} would attach)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setTestCreating(false);
    }
  };

  // Draft a seller-message PREVIEW for the '#TEST' sentinel via Hermes dry-run.
  // Nothing is persisted (the seller hook also recognises '#TEST'); this just
  // fills the seller step so the operator can rehearse it end-to-end.
  const draftTestSellerMessage = async () => {
    if (!receivingId) return;
    const subject = template.readSubject().trim();
    const description = template.readDescription().trim();
    if (!subject || !description) return;
    setTestSellerLoading(true);
    try {
      const res = await fetch('/api/receiving/zendesk-claim/assist-seller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun: true,
          receivingId,
          lineId,
          claimType,
          reason: reason.trim(),
          subject,
          description,
          zendeskTicketNumber: '#TEST',
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && typeof data.sellerMessage === 'string') {
        seller.setSellerMessage(data.sellerMessage);
      }
    } catch {
      /* best-effort preview — the step still renders without a draft */
    } finally {
      setTestSellerLoading(false);
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
    archiveSubmitting,
    claimTypeItems,
    claimStepStates,
    sellerStepReady,
    composeComplete,
    handleModeChange,
    handleClaimStepClick,
    isCreateStepDisabled,
    goToStep,
    goBack,
    goNext,
    continueToSeller,
    selectLinkTicket,
    handleBannerUnlink,
    // create flow
    submitting,
    draftBody,
    submitInternal,
    archiveToNas,
    // dry-run tests
    isDryRun,
    testCreating,
    testResult,
    testSellerLoading,
    testSellerPreview,
    submitTestCreate,
    submitTestSeller,
    clearTestOutputs,
    submitDryRun,
    archiveState,
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
    reply,
  };
}

export type ReceivingClaimController = ReturnType<typeof useReceivingClaimController>;
