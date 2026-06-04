'use client';

/**
 * Right-side slide-in details panel for an unfound-queue row.
 *
 * Tabs mirror the receiving-side ReceivingDetailsStack 3-tab pattern:
 *   • Overview — identity, Zendesk handoff, team notes, timing
 *   • Extract  — LLM-extracted fields editor + Zoho compare + Zoho PO# I
 *                uploaded + free-form notes (email_po only)
 *   • Email    — full Gmail body (email_po only)
 *
 * For non-email_po kinds the panel renders only Overview (no tabs).
 *
 * Serial numbers were intentionally cut from this surface — they belong
 * on the receiving workspace where the operator scans them during the
 * unbox step. Surfacing them here implied they were editable from the
 * queue, which they aren't.
 *
 * Delete behavior unchanged from prior version (two-step confirm; hidden
 * for unmatched_receiving with a guidance hint).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  ExternalLink,
  Loader2,
  Mail,
  Package,
  RefreshCw,
  Trash2,
  X,
} from '@/components/Icons';
import { toast } from '@/lib/toast';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import { copyToClipboard } from '@/utils/_dom';
import { formatDateTimePST } from '@/utils/date';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';
import {
  PaneHeader,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderTabs,
} from '@/components/ui/pane-header';
import { PoChip, TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import {
  LLM_FIELD_KEYS,
  LLM_FIELD_LABEL,
  type LlmFieldKey,
  type TriageDetail,
  type TriageFieldState,
  type TriageRow,
} from '@/components/po-triage/types';

// ─── Types ───────────────────────────────────────────────────────────────────

type QueueKind = 'email_po' | 'unmatched_receiving' | 'station_exception';

export interface UnfoundQueueDetailsRow {
  kind: QueueKind;
  source_id: string;
  organization_id: string;
  product_title: string | null;
  serial_numbers: string | null;
  context: string | null;
  created_at: string;
  zendesk_ticket_id: string | null;
  zendesk_synced_at: string | null;
  usa_team_note: string | null;
  vietnam_team_note: string | null;
  follow_up_at: string | null;
  checked: boolean;
  checked_at: string | null;
}

interface UnfoundQueueDetailsPanelProps {
  row: UnfoundQueueDetailsRow;
  onClose: () => void;
  onDeleted: (row: UnfoundQueueDetailsRow) => void;
  onPushedToZendesk?: (row: UnfoundQueueDetailsRow, ticketNumber: string) => void;
}

type DetailsTab = 'overview' | 'extract' | 'email';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const KIND_META: Record<QueueKind, { label: string; Icon: typeof Mail; bg: string }> = {
  email_po: { label: 'PO Mailbox', Icon: Mail, bg: 'bg-blue-600' },
  unmatched_receiving: {
    label: 'Unmatched Receiving',
    Icon: Package,
    bg: 'bg-emerald-600',
  },
  station_exception: {
    label: 'Station Exception',
    Icon: Package,
    bg: 'bg-amber-600',
  },
};

const PO_SUFFIX_RE = / · PO:\s*(.+?)\s*$/;
function splitPoContext(context: string | null): {
  prefix: string;
  poNumbers: string[];
} {
  if (!context) return { prefix: '', poNumbers: [] };
  const match = context.match(PO_SUFFIX_RE);
  if (!match) return { prefix: context, poNumbers: [] };
  const prefix = context.slice(0, match.index).trim();
  const poNumbers = match[1]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { prefix, poNumbers };
}

const CONFIDENCE_DOT: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-gray-300',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function UnfoundQueueDetailsPanel({
  row,
  onClose,
  onDeleted,
  onPushedToZendesk,
}: UnfoundQueueDetailsPanelProps) {
  const meta = KIND_META[row.kind];
  const Icon = meta.Icon;
  const { prefix: subjectPrefix, poNumbers } = useMemo(
    () => splitPoContext(row.context),
    [row.context],
  );

  // Email-specific detail (body + Zoho compare + the full triage row). Only
  // fetched for kind === 'email_po'; other kinds get a single-tab view.
  const [detail, setDetail] = useState<TriageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<DetailsTab>('overview');
  const [pushing, setPushing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEmailPo = row.kind === 'email_po';
  const canHardDelete = row.kind !== 'unmatched_receiving';

  useEffect(() => {
    if (!isEmailPo) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/po-gmail/triage/${encodeURIComponent(row.source_id)}/detail`,
          { cache: 'no-store' },
        );
        if (!res.ok)
          throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = (await res.json()) as TriageDetail;
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled)
          setDetailError(err instanceof Error ? err.message : 'load failed');
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEmailPo, row.source_id]);

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const updateTriageRow = useCallback((next: TriageRow) => {
    setDetail((prev) => (prev ? { ...prev, row: next } : prev));
  }, []);

  const patchTriage = useCallback(
    async (body: Record<string, unknown>) => {
      if (!detail) return;
      try {
        const res = await fetch(
          `/api/admin/po-gmail/triage/${encodeURIComponent(row.source_id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok)
          throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = (await res.json()) as { row: TriageRow };
        updateTriageRow(data.row);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Update failed');
      }
    },
    [detail, row.source_id, updateTriageRow],
  );

  const handlePushToZendesk = useCallback(async () => {
    if (pushing || row.zendesk_ticket_id) return;
    setPushing(true);
    const toastId = toast.loading('Pushing to Zendesk…');
    try {
      const res = await fetch(
        `/api/receiving/unfound-queue/${row.kind}/${encodeURIComponent(row.source_id)}/push-to-zendesk`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        ticketNumber?: string;
        ticketUrl?: string | null;
        error?: string;
      };
      if (!res.ok || !body.success || !body.ticketNumber) {
        throw new Error(body.error ?? `push failed (${res.status})`);
      }
      toast.success(`Zendesk ticket ${body.ticketNumber} created`, {
        id: toastId,
        action: body.ticketUrl
          ? { label: 'Open', onClick: () => window.open(body.ticketUrl!, '_blank', 'noopener') }
          : undefined,
      });
      onPushedToZendesk?.(row, body.ticketNumber);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Push failed', { id: toastId });
    } finally {
      setPushing(false);
    }
  }, [pushing, row, onPushedToZendesk]);

  const handleDelete = useCallback(async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    if (deleting) return;
    setDeleting(true);
    const toastId = toast.loading('Deleting row…');
    try {
      const res = await fetch(
        `/api/receiving/unfound-queue/${row.kind}/${encodeURIComponent(row.source_id)}`,
        { method: 'DELETE' },
      );
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `delete failed (${res.status})`);
      }
      toast.success('Row deleted', { id: toastId });
      onDeleted(row);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed', { id: toastId });
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }, [confirmingDelete, deleting, row, onDeleted, onClose]);

  const handleCopyAll = useCallback(async () => {
    const lines = [
      `Kind: ${meta.label}`,
      `Source id: ${row.source_id}`,
      poNumbers.length > 0 ? `PO #s: ${poNumbers.join(', ')}` : null,
      subjectPrefix ? `Subject: ${subjectPrefix}` : null,
      row.product_title ? `Product: ${row.product_title}` : null,
      row.zendesk_ticket_id ? `Zendesk: ${row.zendesk_ticket_id}` : null,
      row.usa_team_note ? `USA: ${row.usa_team_note}` : null,
      row.vietnam_team_note ? `VN: ${row.vietnam_team_note}` : null,
      `Created: ${formatDateTimePST(row.created_at)}`,
    ]
      .filter(Boolean)
      .join('\n');
    const ok = await copyToClipboard(lines);
    if (ok) toast.success('Copied details');
    else toast.error('Could not copy');
  }, [
    meta.label,
    poNumbers,
    row.created_at,
    row.product_title,
    row.source_id,
    row.usa_team_note,
    row.vietnam_team_note,
    row.zendesk_ticket_id,
    subjectPrefix,
  ]);

  const externalUrl = useMemo<string | null>(() => {
    if (row.kind === 'email_po')
      return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(row.source_id)}`;
    if (row.kind === 'unmatched_receiving')
      return `/receiving?id=${encodeURIComponent(row.source_id)}`;
    return null;
  }, [row.kind, row.source_id]);

  const externalLabel =
    row.kind === 'email_po'
      ? 'Open in Gmail'
      : row.kind === 'unmatched_receiving'
        ? 'Open in workspace'
        : null;

  const identityLabel =
    row.kind === 'email_po' && poNumbers.length > 0
      ? `PO ${poNumbers.length === 1 ? poNumbers[0] : `${poNumbers[0]} +${poNumbers.length - 1}`}`
      : row.kind === 'unmatched_receiving' && row.context
        ? `Tracking ${getLast4(row.context)}`
        : row.kind === 'station_exception' && row.context
          ? `Tracking ${getLast4(row.context.split(' · ')[0])}`
          : row.product_title || row.source_id;

  return (
    <>
      <SlideOverBackdrop onClose={onClose} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
        className="fixed right-0 top-0 z-[100] flex h-screen w-[420px] flex-col border-l border-gray-200 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.05)]"
      >
        <PaneHeader
          className="border-gray-100 bg-white/90 backdrop-blur-xl"
          rowClassName="px-6"
          leftSlot={
            <>
              <PaneHeaderIconBadge Icon={Icon} bg={meta.bg} tint="text-white" />
              <PaneHeaderLabel
                eyebrow={
                  <>
                    {meta.label.toUpperCase()}{' '}
                    <span className="text-gray-500">
                      · {formatDateTimePST(row.created_at)}
                    </span>
                  </>
                }
                value={identityLabel}
                valueTitle={identityLabel}
              />
            </>
          }
          rightSlot={
            <button
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          }
          belowSlot={
            isEmailPo ? (
              <PaneHeaderTabs<DetailsTab>
                tabs={[
                  { value: 'overview', label: 'Overview' },
                  { value: 'extract', label: 'Extract' },
                  { value: 'email', label: 'Email' },
                ]}
                value={activeTab}
                onChange={setActiveTab}
                className="px-6"
              />
            ) : undefined
          }
        />

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!isEmailPo || activeTab === 'overview' ? (
            <OverviewTab
              row={row}
              subjectPrefix={subjectPrefix}
              poNumbers={poNumbers}
              pushing={pushing}
              onPushToZendesk={handlePushToZendesk}
              detail={detail}
            />
          ) : null}

          {isEmailPo && activeTab === 'extract' ? (
            detailLoading && !detail ? (
              <LoadingBlock />
            ) : detailError ? (
              <ErrorBlock message={detailError} />
            ) : detail ? (
              <ExtractTab
                detail={detail}
                rowId={row.source_id}
                patchTriage={patchTriage}
                onRowUpdated={updateTriageRow}
              />
            ) : null
          ) : null}

          {isEmailPo && activeTab === 'email' ? (
            detailLoading && !detail ? (
              <LoadingBlock />
            ) : detailError ? (
              <ErrorBlock message={detailError} />
            ) : detail ? (
              <EmailTab detail={detail} />
            ) : null
          ) : null}
        </div>

        {/* Footer — actions row + sticky destructive */}
        <div className="border-t border-gray-100 px-6 py-3">
          <div className="mb-2 flex flex-wrap gap-2">
            {externalUrl && externalLabel && (
              <a
                href={externalUrl}
                target={row.kind === 'email_po' ? '_blank' : undefined}
                rel={row.kind === 'email_po' ? 'noreferrer' : undefined}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-50"
              >
                <ExternalLink className="h-3 w-3" />
                {externalLabel}
              </a>
            )}
            <button
              type="button"
              onClick={() => void handleCopyAll()}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-50"
            >
              Copy details
            </button>
          </div>
          {canHardDelete ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl text-micro font-black uppercase tracking-wider text-white transition-colors disabled:opacity-50 ${
                confirmingDelete
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              {deleting
                ? 'Deleting…'
                : confirmingDelete
                  ? 'Click again to confirm delete'
                  : 'Delete Row'}
            </button>
          ) : (
            <p className="rounded-xl bg-gray-50 px-3 py-3 text-center text-micro text-gray-500">
              Unmatched receiving rows can have attached lines. Use the{' '}
              <span className="font-bold text-gray-700">Check</span> toggle
              to clear from the queue, or open the workspace to delete carefully.
            </p>
          )}
        </div>
      </motion.div>
    </>
  );
}

// ─── Overview tab ────────────────────────────────────────────────────────────

interface OverviewTabProps {
  row: UnfoundQueueDetailsRow;
  subjectPrefix: string;
  poNumbers: string[];
  pushing: boolean;
  onPushToZendesk: () => void;
  detail: TriageDetail | null;
}

function OverviewTab({
  row,
  subjectPrefix,
  poNumbers,
  pushing,
  onPushToZendesk,
  detail,
}: OverviewTabProps) {
  return (
    <div className="space-y-5">
      {row.kind === 'email_po' && poNumbers.length > 0 && (
        <Section title="PO numbers">
          <div className="flex flex-wrap items-center gap-1.5">
            {poNumbers.map((po) => (
              <PoChip key={po} value={po} display={getLast4(po)} />
            ))}
          </div>
        </Section>
      )}

      {row.kind !== 'email_po' && row.context && (
        <Section title="Tracking">
          <TrackingChip
            value={
              row.kind === 'station_exception'
                ? row.context.split(' · ')[0]!
                : row.context
            }
            display={getLast4(
              row.kind === 'station_exception'
                ? row.context.split(' · ')[0]!
                : row.context,
            )}
          />
          {row.kind === 'station_exception' && (
            <p className="mt-1 text-micro text-gray-500">{row.context}</p>
          )}
        </Section>
      )}

      {subjectPrefix && row.kind === 'email_po' && (
        <Section title="Subject">
          <p className="text-label text-gray-700">{subjectPrefix}</p>
          {detail?.row.email_from && (
            <p className="mt-0.5 text-micro text-gray-500">
              {detail.row.email_from}
            </p>
          )}
        </Section>
      )}

      {row.product_title && row.kind !== 'email_po' && (
        <Section title="Product">
          <p className="text-label font-semibold text-gray-900">
            {row.product_title}
          </p>
        </Section>
      )}

      <Section title="Zendesk">
        {row.zendesk_ticket_id ? (
          <div className="space-y-0.5">
            {(() => {
              const url = zendeskTicketUrl(row.zendesk_ticket_id);
              return url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-label font-bold text-emerald-700 underline-offset-2 hover:underline"
                >
                  {row.zendesk_ticket_id}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <p className="font-mono text-label font-bold text-emerald-700">
                  {row.zendesk_ticket_id}
                </p>
              );
            })()}
            {row.zendesk_synced_at && (
              <p className="text-micro text-gray-500">
                synced {formatDateTimePST(row.zendesk_synced_at)}
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onPushToZendesk}
            disabled={pushing}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pushing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ExternalLink className="h-3 w-3" />
            )}
            {pushing ? 'Pushing…' : 'Push to Zendesk'}
          </button>
        )}
      </Section>

      {(row.usa_team_note || row.vietnam_team_note) && (
        <Section title="Team notes">
          {row.usa_team_note && (
            <div className="mb-2">
              <p className="text-eyebrow font-black uppercase tracking-widest text-gray-400">
                USA
              </p>
              <p className="whitespace-pre-wrap text-label text-gray-700">
                {row.usa_team_note}
              </p>
            </div>
          )}
          {row.vietnam_team_note && (
            <div>
              <p className="text-eyebrow font-black uppercase tracking-widest text-gray-400">
                Vietnam
              </p>
              <p className="whitespace-pre-wrap text-label text-gray-700">
                {row.vietnam_team_note}
              </p>
            </div>
          )}
        </Section>
      )}

      <Section title="Timing">
        <dl className="space-y-1 text-label">
          <Row label="Created" value={formatDateTimePST(row.created_at)} />
          <Row
            label="Follow-up"
            value={row.follow_up_at ? formatDateTimePST(row.follow_up_at) : '—'}
          />
          <Row
            label="Checked"
            value={row.checked_at ? formatDateTimePST(row.checked_at) : '—'}
          />
        </dl>
      </Section>
    </div>
  );
}

// ─── Extract tab ─────────────────────────────────────────────────────────────

interface ExtractTabProps {
  detail: TriageDetail;
  rowId: string;
  patchTriage: (body: Record<string, unknown>) => Promise<void>;
  onRowUpdated: (next: TriageRow) => void;
}

function ExtractTab({ detail, rowId, patchTriage, onRowUpdated }: ExtractTabProps) {
  const [extracting, setExtracting] = useState(false);
  const [zohoUploaded, setZohoUploaded] = useState(
    detail.row.zoho_uploaded_po_number ?? '',
  );
  const [notes, setNotes] = useState(detail.row.notes ?? '');

  useEffect(() => {
    setZohoUploaded(detail.row.zoho_uploaded_po_number ?? '');
    setNotes(detail.row.notes ?? '');
  }, [detail.row.zoho_uploaded_po_number, detail.row.notes]);

  const runExtract = useCallback(async () => {
    setExtracting(true);
    try {
      const res = await fetch(
        `/api/admin/po-gmail/triage/${encodeURIComponent(rowId)}/extract`,
        { method: 'POST' },
      );
      if (!res.ok)
        throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as {
        row: TriageRow;
        extracted: Record<string, TriageFieldState>;
      };
      onRowUpdated(data.row);
      const n = Object.keys(data.extracted).length;
      toast.success(
        n > 0 ? `Extracted ${n} field${n === 1 ? '' : 's'}` : 'Nothing new to extract',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }, [rowId, onRowUpdated]);

  const toggleFieldConfirmed = useCallback(
    (field: LlmFieldKey | string) => {
      const state = (detail.row.triage_state ?? {}) as Record<string, unknown>;
      const fields = (state.fields ?? {}) as Record<string, TriageFieldState>;
      const cur = fields[field] ?? { value: '' };
      const confirmed = Boolean(cur.confirmed_at);
      const nextField: TriageFieldState = confirmed
        ? { ...cur, confirmed_at: null, confirmed_by: null }
        : { ...cur, confirmed_at: new Date().toISOString(), confirmed_by: 'user' };
      void patchTriage({
        triage_state: {
          ...state,
          fields: { ...fields, [field]: nextField },
        },
      });
    },
    [detail.row.triage_state, patchTriage],
  );

  const onZohoBlur = useCallback(() => {
    const trimmed = zohoUploaded.trim();
    if (trimmed === (detail.row.zoho_uploaded_po_number ?? '')) return;
    void patchTriage({ zoho_uploaded_po_number: trimmed || null });
  }, [zohoUploaded, detail.row.zoho_uploaded_po_number, patchTriage]);

  const onNotesBlur = useCallback(() => {
    if (notes === (detail.row.notes ?? '')) return;
    void patchTriage({ notes });
  }, [notes, detail.row.notes, patchTriage]);

  const triageState = (detail.row.triage_state ?? {}) as Record<string, unknown>;
  const stateFields = (triageState.fields ?? {}) as Record<string, TriageFieldState>;
  const compare = detail.zohoCompare;
  const existingPo = compare.existingPos[0] ?? null;

  return (
    <div className="space-y-5">
      <Section
        title="Extracted fields"
        action={
          <button
            type="button"
            onClick={() => void runExtract()}
            disabled={extracting}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-micro font-bold uppercase tracking-wider text-gray-600 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-3 w-3 ${extracting ? 'animate-spin' : ''}`} />
            {extracting ? 'Extracting…' : 'Extract with AI'}
          </button>
        }
      >
        {/* PO numbers as confirmable rows (the regex-extracted ones) */}
        {detail.row.po_numbers.map((po) => (
          <FieldRow
            key={`po:${po}`}
            label="PO #"
            value={po}
            field={stateFields[po]}
            onToggle={() => toggleFieldConfirmed(po)}
          />
        ))}
        {/* LLM-extracted summary fields */}
        {LLM_FIELD_KEYS.map((key) => (
          <FieldRow
            key={`llm:${key}`}
            label={LLM_FIELD_LABEL[key]}
            value={stateFields[key]?.value != null ? String(stateFields[key]!.value) : null}
            field={stateFields[key]}
            onToggle={() => toggleFieldConfirmed(key)}
          />
        ))}
      </Section>

      <Section title="Zoho compare">
        <dl className="space-y-1 text-label">
          <Row
            label="PO# already in Zoho?"
            value={existingPo ? `Yes — ${existingPo.zoho_purchaseorder_number}` : 'No'}
          />
          <Row
            label="Matched vendor"
            value={compare.matchedVendor?.vendor_name ?? '—'}
          />
          {compare.openPoCountForVendor != null && (
            <Row
              label="Open POs from vendor"
              value={String(compare.openPoCountForVendor)}
            />
          )}
        </dl>
      </Section>

      <Section title="Zoho PO# I uploaded">
        <input
          type="text"
          value={zohoUploaded}
          onChange={(e) => setZohoUploaded(e.target.value)}
          onBlur={onZohoBlur}
          placeholder="e.g. PO-44821"
          className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-label outline-none focus:border-blue-500"
        />
      </Section>

      <Section title="Notes">
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={onNotesBlur}
          placeholder="Anything the next reviewer needs to know…"
          className="w-full resize-none rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-label outline-none focus:border-blue-500"
        />
      </Section>
    </div>
  );
}

// ─── Email tab ───────────────────────────────────────────────────────────────

function EmailTab({ detail }: { detail: TriageDetail }) {
  const { html, text, error } = detail.body;
  return (
    <div className="space-y-3">
      <dl className="space-y-1 text-label">
        <Row label="From" value={detail.row.email_from ?? '—'} />
        <Row label="Subject" value={detail.row.email_subject ?? '—'} />
        <Row
          label="Received"
          value={
            detail.row.email_received
              ? formatDateTimePST(detail.row.email_received)
              : '—'
          }
        />
        {detail.body.hasAttachments && (
          <Row label="Attachments" value="present (see Gmail)" />
        )}
      </dl>
      {error ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-caption text-amber-800">
          {error}
        </div>
      ) : html ? (
        <EmailHtmlFrame html={html} />
      ) : (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <pre className="whitespace-pre-wrap break-words font-sans text-caption leading-relaxed text-gray-700">
            {text || '(empty body)'}
          </pre>
        </div>
      )}
    </div>
  );
}

// Sandboxed iframe that renders the DOMPurify-sanitized email HTML. The
// iframe sandbox attribute (no allow-scripts, no allow-same-origin) keeps
// any residual inline content isolated from the host app. The iframe
// auto-sizes to its content so the email reads as a flowing block inside
// the details panel instead of a fixed-height scrollbox.
function EmailHtmlFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(320);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">` +
        `<style>` +
        `html,body{margin:0;padding:0;background:transparent;color:#1f2937;` +
        `font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;` +
        `word-wrap:break-word;overflow-wrap:anywhere;}` +
        `img{max-width:100%;height:auto;}` +
        `table{max-width:100%;border-collapse:collapse;}` +
        `a{color:#2563eb;}` +
        `</style></head><body>${html}</body></html>`,
    );
    doc.close();

    const resize = () => {
      const next = doc.documentElement?.scrollHeight ?? doc.body?.scrollHeight ?? 0;
      if (next > 0) setHeight(next + 16);
    };
    resize();
    // Late-loading images change layout — observe and resize once they paint.
    const observer = new ResizeObserver(resize);
    if (doc.body) observer.observe(doc.body);
    return () => observer.disconnect();
  }, [html]);

  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
      <iframe
        ref={ref}
        sandbox=""
        title="Email body"
        className="block w-full"
        style={{ height, border: 'none' }}
      />
    </div>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-eyebrow font-black uppercase tracking-widest text-gray-400">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-micro font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </dt>
      <dd className="text-label text-gray-800 text-right">{value}</dd>
    </div>
  );
}

function FieldRow({
  label,
  value,
  field,
  onToggle,
}: {
  label: string;
  value: string | null;
  field: TriageFieldState | undefined;
  onToggle: () => void;
}) {
  const confidence = field?.confidence ?? 'low';
  const confirmed = Boolean(field?.confirmed_at);
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1.5 hover:bg-gray-50">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={confirmed}
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          confirmed
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-gray-300 bg-white'
        }`}
      >
        {confirmed ? <Check className="h-3 w-3" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-micro font-bold uppercase tracking-wider text-gray-500">
            {label}
          </span>
          {value != null && (
            <span
              className={`h-1.5 w-1.5 rounded-full ${CONFIDENCE_DOT[confidence]}`}
              title={`Confidence: ${confidence}`}
              aria-hidden
            />
          )}
        </div>
        <p className="truncate text-label text-gray-800">{value ?? '—'}</p>
      </div>
    </label>
  );
}

function LoadingBlock() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-label text-amber-800">
      {message}
    </div>
  );
}
