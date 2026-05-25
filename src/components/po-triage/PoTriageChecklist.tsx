'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Send,
} from '@/components/Icons';
import {
  LLM_FIELD_KEYS,
  LLM_FIELD_LABEL,
  TRIAGE_PILES,
  TRIAGE_PILE_META,
  getFieldState,
  isFieldConfirmed,
  type LlmFieldKey,
  type TriageDetail,
  type TriageFieldState,
  type TriagePile,
  type TriageRow,
} from './types';

interface PoTriageChecklistProps {
  detail: TriageDetail;
  /** Called whenever the row's pile changes server-side. */
  onRowUpdated?: (row: TriageRow) => void;
  /** Optional dismiss button (back arrow). Hidden if not provided. */
  onClose?: () => void;
}

interface PatchBody {
  pile?: TriagePile;
  notes?: string;
  zoho_uploaded_po_number?: string | null;
  triage_state?: Record<string, unknown>;
}

export function PoTriageChecklist({ detail, onRowUpdated, onClose }: PoTriageChecklistProps) {
  const [row, setRow] = useState<TriageRow>(detail.row);
  const [notes, setNotes] = useState(row.notes ?? '');
  const [zohoUploaded, setZohoUploaded] = useState(row.zoho_uploaded_po_number ?? '');
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);

  // Sync local state when a fresh detail blob arrives (parent refetches).
  useEffect(() => {
    setRow(detail.row);
    setNotes(detail.row.notes ?? '');
    setZohoUploaded(detail.row.zoho_uploaded_po_number ?? '');
  }, [detail.row]);

  const patch = useCallback(
    async (body: PatchBody, successMsg?: string) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/admin/po-gmail/triage/${row.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = (await res.json()) as { row: TriageRow };
        setRow(data.row);
        setNotes(data.row.notes ?? '');
        setZohoUploaded(data.row.zoho_uploaded_po_number ?? '');
        onRowUpdated?.(data.row);
        if (successMsg) toast.success(successMsg);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Update failed');
      } finally {
        setSaving(false);
      }
    },
    [row.id, onRowUpdated],
  );

  const toggleFieldConfirmed = useCallback(
    (fieldKey: string, value: string | number, defaultSource: TriageFieldState['source'] = 'regex_labeled') => {
      const currentlyConfirmed = isFieldConfirmed(row.triage_state, fieldKey);
      const current = getFieldState(row.triage_state, fieldKey) ?? {};
      // Confirming flips source to 'user' so future re-extractions don't
      // clobber the value (the extract endpoint preserves source='user').
      const next: Record<string, unknown> = {
        fields: {
          [fieldKey]: currentlyConfirmed
            ? { ...current, value, confirmed_at: null }
            : {
                ...current,
                value,
                source: current.source ?? defaultSource,
                confirmed_at: new Date().toISOString(),
              },
        },
      };
      void patch({ triage_state: next });
    },
    [row.triage_state, patch],
  );

  const runExtract = useCallback(async () => {
    setExtracting(true);
    try {
      const res = await fetch(`/api/admin/po-gmail/triage/${row.id}/extract`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as {
        row: TriageRow;
        extracted: Record<string, TriageFieldState>;
      };
      setRow(data.row);
      onRowUpdated?.(data.row);
      const n = Object.keys(data.extracted).length;
      toast.success(n > 0 ? `Extracted ${n} field${n === 1 ? '' : 's'}` : 'Nothing new to extract');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }, [row.id, onRowUpdated]);

  const createZohoDraft = useCallback(async () => {
    setCreatingDraft(true);
    const toastId = toast.loading('Creating draft PO in Zoho…');
    try {
      const res = await fetch(
        `/api/admin/po-gmail/create-zoho-draft/${row.id}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        already_drafted?: boolean;
        purchaseorder_number?: string;
        zohoUrl?: string;
        error?: string;
        code?: string;
        candidates?: Array<{ contact_id: string; contact_name: string }>;
      };
      if (!res.ok || !data.success) {
        // VENDOR_AMBIGUOUS / VENDOR_NOT_FOUND / VENDOR_MISSING get a helpful
        // toast pointing the operator at the fix (create the vendor in Zoho,
        // re-extract, etc.) rather than a generic error.
        if (data.code === 'VENDOR_NOT_FOUND') {
          toast.error(data.error ?? 'Vendor not found in Zoho', { id: toastId });
        } else if (data.code === 'VENDOR_AMBIGUOUS') {
          toast.error(
            `${data.error ?? 'Multiple vendors matched.'} (${(data.candidates ?? []).map((c) => c.contact_name).join(', ')})`,
            { id: toastId },
          );
        } else if (data.code === 'VENDOR_MISSING') {
          toast.error(
            data.error ?? 'No vendor extracted. Run "Extract with AI" first.',
            { id: toastId },
          );
        } else {
          throw new Error(data.error ?? `create failed (${res.status})`);
        }
        return;
      }
      const poNum = data.purchaseorder_number || '(unknown #)';
      setZohoUploaded(poNum);
      toast.success(
        data.already_drafted
          ? `Already drafted as ${poNum}`
          : `Draft ${poNum} created in Zoho — open to add line items + publish`,
        {
          id: toastId,
          duration: 8000,
          action: data.zohoUrl
            ? {
                label: 'Open in Zoho',
                onClick: () => window.open(data.zohoUrl, '_blank', 'noopener'),
              }
            : undefined,
        },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create draft failed', {
        id: toastId,
      });
    } finally {
      setCreatingDraft(false);
    }
  }, [row.id]);

  const setPile = useCallback((pile: TriagePile) => {
    void patch({ pile }, `Moved to ${pile}`);
  }, [patch]);

  const markUploaded = useCallback(() => {
    const trimmed = zohoUploaded.trim();
    if (!trimmed) {
      toast.error('Enter the Zoho PO# you uploaded first');
      return;
    }
    void patch(
      { pile: 'done', zoho_uploaded_po_number: trimmed },
      'Marked uploaded — will auto-close when Zoho sync confirms',
    );
  }, [zohoUploaded, patch]);

  const copyZohoPayload = useCallback(async () => {
    const lines: string[] = [];
    lines.push(`Subject: ${row.email_subject ?? ''}`);
    lines.push(`From:    ${row.email_from ?? ''}`);
    if (row.email_received) lines.push(`Date:    ${new Date(row.email_received).toLocaleString()}`);
    if (row.po_numbers.length > 0) lines.push(`PO #s:   ${row.po_numbers.join(', ')}`);
    if (detail.zohoCompare.matchedVendor?.vendor_name) {
      lines.push(`Vendor:  ${detail.zohoCompare.matchedVendor.vendor_name}`);
    }
    if (detail.body.text) {
      lines.push('');
      lines.push('--- Email body ---');
      lines.push(detail.body.text);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Clipboard unavailable');
    }
  }, [row, detail]);

  const saveNotes = useCallback(() => {
    if ((notes || '') === (row.notes ?? '')) return;
    void patch({ notes }, 'Notes saved');
  }, [notes, row.notes, patch]);

  const saveZohoUploaded = useCallback(() => {
    const trimmed = zohoUploaded.trim() || null;
    if (trimmed === (row.zoho_uploaded_po_number ?? null)) return;
    void patch({ zoho_uploaded_po_number: trimmed });
  }, [zohoUploaded, row.zoho_uploaded_po_number, patch]);

  const gmailUrl = useMemo(
    () => (row.gmail_msg_id ? `https://mail.google.com/mail/u/0/#all/${row.gmail_msg_id}` : null),
    [row.gmail_msg_id],
  );

  // The Create-draft button needs at least an extracted vendor name to send
  // to Zoho — otherwise the endpoint returns VENDOR_MISSING. Disable until
  // Extract with AI has populated it.
  const hasExtractedVendor = useMemo(() => {
    const state = (row.triage_state ?? {}) as Record<string, unknown>;
    const fields = state.fields;
    if (!fields || typeof fields !== 'object') return false;
    const vendor = (fields as Record<string, unknown>).vendor;
    if (!vendor || typeof vendor !== 'object') return false;
    const value = (vendor as { value?: unknown }).value;
    return typeof value === 'string' && value.trim().length > 0;
  }, [row.triage_state]);

  const existingPo = detail.zohoCompare.existingPos[0] ?? null;
  const poAlreadyInZoho = detail.zohoCompare.existingPos.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close detail"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-gray-900">
            {row.email_subject || '(no subject)'}
          </h1>
          <p className="truncate text-label text-gray-500">{row.email_from}</p>
        </div>
        <PileBadge pile={row.pile} />
      </header>

      {/* Two-column layout on md+, stacked on mobile */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* Checklist column */}
        <section className="min-h-0 flex-1 overflow-y-auto px-4 py-3 md:max-w-md md:border-r md:border-gray-100">
          {/* PO# confirmation rows */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-caption font-semibold uppercase tracking-wider text-gray-500">
                Extracted fields
              </h2>
              <button
                type="button"
                onClick={runExtract}
                disabled={extracting || saving}
                className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10.5px] font-medium text-purple-700 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Extract vendor, date, total, line items, ship-to with Claude"
              >
                {extracting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Extract with AI
              </button>
            </div>

            {row.po_numbers.length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-200 px-3 py-3 text-label text-gray-500">
                No PO numbers extracted. Read the email body, then type the right Zoho PO#
                below and Mark uploaded if you handled it manually.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                {row.po_numbers.map((po, i) => {
                  const fieldKey = `po_number_${i}`;
                  const confirmed = isFieldConfirmed(row.triage_state, fieldKey);
                  return (
                    <li key={`${po}-${i}`} className="flex items-center gap-2 px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => toggleFieldConfirmed(fieldKey, po)}
                        disabled={saving}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                          confirmed
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-gray-300 bg-white text-transparent hover:border-emerald-400'
                        }`}
                        aria-label={confirmed ? 'Unconfirm PO#' : 'Confirm PO#'}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <span className="flex-1 font-mono text-[12.5px] text-gray-900">{po}</span>
                      <ConfidenceDot level="high" />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* LLM-extracted fields (only shown once Extract has populated them) */}
          <LlmFieldList
            triageState={row.triage_state}
            disabled={saving}
            onToggle={toggleFieldConfirmed}
          />

          {/* Zoho compare card */}
          <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            <h3 className="text-caption font-semibold uppercase tracking-wider text-gray-500">
              Zoho compare
            </h3>
            <dl className="mt-1.5 space-y-1 text-label">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-gray-500">PO# already in Zoho?</dt>
                <dd className={poAlreadyInZoho ? 'font-medium text-amber-700' : 'font-medium text-gray-900'}>
                  {poAlreadyInZoho
                    ? `Yes — ${existingPo?.zoho_purchaseorder_number}${existingPo?.status ? ` (${existingPo.status})` : ''}`
                    : 'No'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-gray-500">Matched vendor</dt>
                <dd className="font-medium text-gray-900">
                  {detail.zohoCompare.matchedVendor?.vendor_name ?? '—'}
                </dd>
              </div>
              {detail.zohoCompare.openPoCountForVendor != null && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-gray-500">Open POs from vendor</dt>
                  <dd className="font-medium text-gray-900 tabular-nums">
                    {detail.zohoCompare.openPoCountForVendor}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Zoho-uploaded input */}
          <div className="mt-3">
            <label className="block">
              <span className="block text-caption font-semibold uppercase tracking-wider text-gray-500">
                Zoho PO# I uploaded
              </span>
              <input
                type="text"
                value={zohoUploaded}
                onChange={(e) => setZohoUploaded(e.target.value)}
                onBlur={saveZohoUploaded}
                placeholder="e.g. PO-44821"
                className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
              />
            </label>
            {row.zoho_uploaded_at && (
              <p className="mt-1 text-[10.5px] text-gray-400">
                Marked uploaded {new Date(row.zoho_uploaded_at).toLocaleString()}
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="mt-3">
            <label className="block">
              <span className="block text-caption font-semibold uppercase tracking-wider text-gray-500">
                Notes
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveNotes}
                rows={2}
                placeholder="Anything the next reviewer needs to know…"
                className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-[12.5px] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
              />
            </label>
          </div>
        </section>

        {/* Email body column */}
        <section className="min-h-0 flex-1 overflow-y-auto bg-gray-50 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-caption font-semibold uppercase tracking-wider text-gray-500">
              Email body
            </h2>
            {detail.body.hasAttachments && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-micro text-amber-700">
                has attachments
              </span>
            )}
          </div>
          {detail.body.error ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-label text-amber-800">
              Couldn&apos;t load body: {detail.body.error}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-white px-3 py-2 font-sans text-[12.5px] leading-relaxed text-gray-800">
              {detail.body.text || '(empty body)'}
            </pre>
          )}
        </section>
      </div>

      {/* Action bar */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white px-4 py-2.5">
        <button
          type="button"
          onClick={copyZohoPayload}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-label text-gray-700 hover:bg-gray-50"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy details
        </button>
        {gmailUrl && (
          <a
            href={gmailUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-label text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in Gmail
          </a>
        )}

        <PilePicker currentPile={row.pile} onPick={setPile} disabled={saving} />

        <div className="ml-auto flex items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
          <button
            type="button"
            onClick={createZohoDraft}
            disabled={
              creatingDraft ||
              saving ||
              row.pile === 'done' ||
              Boolean(row.zoho_uploaded_po_number)
            }
            title={
              row.zoho_uploaded_po_number
                ? `Already drafted as ${row.zoho_uploaded_po_number}`
                : !hasExtractedVendor
                  ? 'Run "Extract with AI" first so we have a vendor to send'
                  : 'Create a draft PO in Zoho from extracted fields'
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-label font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creatingDraft ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            {creatingDraft ? 'Creating…' : 'Create draft in Zoho'}
          </button>
          <button
            type="button"
            onClick={markUploaded}
            disabled={saving || !zohoUploaded.trim() || row.pile === 'done'}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-label font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Mark uploaded
          </button>
        </div>
      </footer>
    </div>
  );
}

function PileBadge({ pile }: { pile: TriagePile }) {
  const meta = TRIAGE_PILE_META[pile];
  const chrome: Record<TriagePile, string> = {
    inbox:  'bg-amber-50 text-amber-700',
    upload: 'bg-blue-50 text-blue-700',
    ignore: 'bg-gray-100 text-gray-600',
    done:   'bg-emerald-50 text-emerald-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${chrome[pile]}`}>
      {meta.label}
    </span>
  );
}

function PilePicker({
  currentPile,
  onPick,
  disabled,
}: {
  currentPile: TriagePile;
  onPick: (pile: TriagePile) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-label text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        <Send className="h-3.5 w-3.5" />
        Move to…
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
            {TRIAGE_PILES.map((p) => {
              const meta = TRIAGE_PILE_META[p];
              const active = p === currentPile;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={active}
                  onClick={() => {
                    onPick(p);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-label ${
                    active
                      ? 'cursor-default text-gray-400'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span>{meta.label}</span>
                  {active && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ConfidenceDot({ level }: { level: 'high' | 'medium' | 'low' }) {
  const tone =
    level === 'high'
      ? 'bg-emerald-500'
      : level === 'medium'
        ? 'bg-amber-400'
        : 'bg-red-500';
  return <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} title={`${level} confidence`} />;
}

function SourceChip({ source }: { source: TriageFieldState['source'] }) {
  if (source === 'llm') {
    return (
      <span className="rounded bg-purple-50 px-1 py-0.5 font-mono text-eyebrow font-semibold uppercase text-purple-700">
        AI
      </span>
    );
  }
  if (source === 'user') {
    return (
      <span className="rounded bg-emerald-50 px-1 py-0.5 font-mono text-eyebrow font-semibold uppercase text-emerald-700">
        You
      </span>
    );
  }
  return null;
}

function LlmFieldList({
  triageState,
  disabled,
  onToggle,
}: {
  triageState: Record<string, unknown>;
  disabled: boolean;
  onToggle: (fieldKey: string, value: string | number, defaultSource?: TriageFieldState['source']) => void;
}) {
  const present = LLM_FIELD_KEYS.filter((k) => getFieldState(triageState, k));
  if (present.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      <h3 className="text-caption font-semibold uppercase tracking-wider text-gray-500">
        AI-extracted
      </h3>
      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {present.map((key) => {
          const field = getFieldState(triageState, key);
          if (!field) return null;
          const confirmed = Boolean(field.confirmed_at);
          const confidence = (field.confidence ?? 'low') as 'high' | 'medium' | 'low';
          return (
            <li key={key} className="flex items-center gap-2 px-2.5 py-2">
              <button
                type="button"
                onClick={() => onToggle(key as LlmFieldKey, field.value ?? '', 'llm')}
                disabled={disabled}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                  confirmed
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-gray-300 bg-white text-transparent hover:border-emerald-400'
                }`}
                aria-label={confirmed ? `Unconfirm ${key}` : `Confirm ${key}`}
              >
                <Check className="h-3 w-3" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[10.5px] uppercase tracking-wider text-gray-500">
                    {LLM_FIELD_LABEL[key as LlmFieldKey]}
                  </span>
                  <SourceChip source={field.source} />
                </div>
                <div className="truncate text-[12.5px] text-gray-900">
                  {String(field.value ?? '—')}
                </div>
              </div>
              <ConfidenceDot level={confidence} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
