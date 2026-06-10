'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { Loader2, X } from '@/components/Icons';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import {
  CLAIM_TYPE_OPTIONS,
  CLAIM_SEVERITY_OPTIONS,
  type ClaimType,
  type ClaimSeverity,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { priorityBadge, statusBadge } from '@/components/support/zendesk/badges';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

// Small preview for the selection grid. NAS-dev URLs support ?thumb (a tiny
// webp); other URLs (Blob) are shown as-is.
function claimThumb(url: string): string {
  if (url.startsWith('/api/nas-dev/')) {
    return url + (url.includes('?') ? '&' : '?') + 'thumb=96';
  }
  return url;
}

type ClaimModalMode = 'create' | 'link';

const MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'create', label: 'New ticket' },
  { id: 'link', label: 'Link existing' },
];

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
export function ReceivingClaimModal({ open, row, prefillReason, onClose, onTicketCreated }: Props) {
  // Auto-select 'unfound' when the carton has no Zoho match — support's
  // routing for unmatched-tracking claims is different from damage/missing.
  const initialClaimType: ClaimType =
    row.receiving_source === 'unmatched' ? 'unfound' : 'damage';
  const [claimType, setClaimType] = useState<ClaimType>(initialClaimType);
  const [severity, setSeverity] = useState<ClaimSeverity>('medium');
  // 'create' files a fresh ticket; 'link' attaches an existing Zendesk ticket
  // to this carton/line instead (search → pick → POST .../link).
  const [mode, setMode] = useState<ClaimModalMode>('create');
  const [ticketQuery, setTicketQuery] = useState('');
  const [ticketResults, setTicketResults] = useState<LinkCandidate[]>([]);
  // Tickets already linked to OTHER items are excluded server-side; we only
  // get the count back so the operator knows why a search came up short.
  const [hiddenLinked, setHiddenLinked] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<LinkCandidate | null>(null);
  const [linking, setLinking] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [draftBody, setDraftBody] = useState<string | null>(null);
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
    setReason(prefillReason ?? '');
    setDraftBody(null);
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
          .map((p: { id: number; photoUrl: string }) => ({ id: p.id, url: p.photoUrl }));
        setPhotos(list);
        // Start with none selected — the operator picks exactly which photos go
        // to Zendesk. (All PO photos are still archived to the ticket folder.)
        setSelectedPhotoIds(new Set());
      })
      .catch(() => {
        /* best-effort — claim can still be filed without photos */
      });
    return () => ctrl.abort();
  }, [open, row.receiving_id]);

  // Fetch the server-rendered template whenever inputs change. Debounced so
  // typing in "reason" doesn't hammer the endpoint.
  useEffect(() => {
    if (!open || mode !== 'create' || !row.receiving_id) return;
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
          severity,
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
  }, [open, mode, row.receiving_id, row.id, claimType, severity, reason]);

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
  const severityItems = useMemo<HorizontalSliderItem[]>(
    () => CLAIM_SEVERITY_OPTIONS.map((opt) => ({ id: opt.value, label: opt.label })),
    [],
  );

  const submit = async () => {
    if (submitting || !row.receiving_id) return;
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
          severity,
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
      if (data.ticketNumber) {
        const url = typeof data.ticketUrl === 'string' ? data.ticketUrl : null;
        toast.success(`Claim ${data.ticketNumber} created`, {
          action: url
            ? { label: 'Open', onClick: () => window.open(url, '_blank', 'noopener') }
            : undefined,
        });
        onTicketCreated(String(data.ticketNumber));
      } else {
        toast.success('Claim filed — paste the Zendesk # back when assigned');
      }
      // Surface a NAS-archive problem so a claim whose photos didn't archive
      // isn't silently treated as fully done.
      if (data.archiveWarning) {
        toast.warning(String(data.archiveWarning), { duration: 8000 });
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
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
      onClose();
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
      align="center"
      aria-label="File a claim"
      className="w-[min(92%,42rem)] rounded-2xl border-0 shadow-2xl ring-1 ring-gray-200"
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
              <HorizontalButtonSlider
                items={MODE_ITEMS}
                value={mode}
                onChange={(id) => setMode(id as ClaimModalMode)}
                variant="nav"
                size="md"
                aria-label="New ticket or link existing"
              />

              {mode === 'create' ? (
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
                <p className="mb-1.5 text-micro font-black uppercase tracking-[0.14em] text-gray-500">
                  Severity
                </p>
                <HorizontalButtonSlider
                  items={severityItems}
                  value={severity}
                  onChange={(id) => setSeverity(id as ClaimSeverity)}
                  variant="nav"
                  size="md"
                  aria-label="Severity"
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
                            src={claimThumb(p.url)}
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
                  <p className="text-micro font-black uppercase tracking-[0.14em] text-gray-500">
                    Ticket preview {previewLoading ? '(updating…)' : '(editable)'}
                  </p>
                  <div className="flex items-center gap-2">
                    {(subjectTouched.current || descriptionTouched.current) ? (
                      <button
                        type="button"
                        onClick={() => {
                          subjectTouched.current = false;
                          descriptionTouched.current = false;
                          // Nudge the preview effect to re-run with current inputs.
                          setReason((r) => r);
                        }}
                        className="text-micro font-bold uppercase tracking-wider text-gray-500 hover:text-gray-900"
                      >
                        Reset to template
                      </button>
                    ) : null}
                  </div>
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
                The template auto-fills from PO, tracking, photos, and the active line. Edit either
                field above before posting. A ticket # will be filed back into the Support section
                automatically.
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
                  <div>
                    <label
                      htmlFor="claim-ticket-search"
                      className="mb-1.5 block text-micro font-black uppercase tracking-[0.14em] text-gray-500"
                    >
                      Find the ticket
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
                        {ticketQuery.trim() ? 'Results' : 'Recent tickets'} — click to expand
                      </p>
                      {searchLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                      ) : null}
                    </div>
                    {/* Fixed TALL height no matter the state (loading / results /
                        empty) so the modal doesn't jump while tickets load —
                        stale results stay visible, dimmed, during a refetch. */}
                    <div className="h-[min(60vh,520px)] overflow-y-auto rounded-xl border border-gray-200 bg-white">
                      {ticketResults.length > 0 ? (
                        <div className={searchLoading ? 'opacity-50' : ''}>
                        {ticketResults.map((t) => {
                          const isSel = selectedTicket?.id === t.id;
                          const badge = statusBadge(t.status);
                          const prio = priorityBadge(t.priority);
                          return (
                            <div key={t.id} className="border-b border-gray-100 last:border-b-0">
                              <button
                                type="button"
                                onClick={() => setSelectedTicket(isSel ? null : t)}
                                disabled={t.linkedToThis}
                                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
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
                                {t.linkedToThis ? (
                                  <span className="shrink-0 text-eyebrow font-black uppercase tracking-wider text-emerald-600">
                                    Linked to this item
                                  </span>
                                ) : null}
                              </button>
                              {isSel ? (
                                <div className="space-y-2 border-t border-rose-100 bg-rose-50/50 px-3 py-2.5">
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro font-semibold text-gray-500">
                                    <span>Created {ticketDate(t.createdAt)}</span>
                                    <span>Updated {ticketDate(t.updatedAt)}</span>
                                    {prio ? (
                                      <span
                                        className={`rounded-full px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider ${prio.className}`}
                                      >
                                        {prio.label}
                                      </span>
                                    ) : null}
                                    {t.url ? (
                                      <a
                                        href={t.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-bold uppercase tracking-wider text-rose-700 hover:text-rose-900"
                                      >
                                        Open in Zendesk ↗
                                      </a>
                                    ) : null}
                                  </div>
                                  {t.description ? (
                                    <p className="line-clamp-4 whitespace-pre-line text-caption font-medium leading-snug text-gray-600">
                                      {t.description}
                                    </p>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={submitLink}
                                    disabled={linking}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-micro font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                    {linking ? 'Linking…' : `Link ticket #${t.id} to this item`}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                        </div>
                      ) : (
                        <div className="grid h-full place-items-center px-4 text-center">
                          {searchLoading ? (
                            <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                          ) : (
                            <p className="text-micro font-semibold text-gray-400">
                              {ticketQuery.trim()
                                ? 'No linkable tickets found.'
                                : 'No recent tickets to show.'}
                            </p>
                          )}
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

                  <p className="text-micro font-semibold leading-snug text-gray-500">
                    Linking files the ticket # back into the Support section and connects the
                    ticket to this carton's photos and history in the support workspace.
                  </p>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting || linking}
                className="inline-flex h-10 items-center rounded-xl border border-gray-200 bg-white px-4 text-caption font-bold uppercase tracking-widest text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              {mode === 'create' ? (
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting || !row.receiving_id || !subject.trim() || !description.trim()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {submitting ? 'Creating…' : 'Create Zendesk ticket'}
                </button>
              ) : (
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
                      ? `Link ticket #${selectedTicket.id}`
                      : 'Link ticket'}
                </button>
              )}
            </div>
    </RightPaneOverlay>
  );
}
