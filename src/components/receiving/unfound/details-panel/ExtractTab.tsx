import { useCallback, useEffect, useState } from 'react';
import { jsonOrThrow, useResourceMutation } from '@/hooks';
import { toast } from '@/lib/toast';
import { RefreshCw } from '@/components/Icons';
import {
  LLM_FIELD_KEYS,
  LLM_FIELD_LABEL,
  type LlmFieldKey,
  type TriageDetail,
  type TriageFieldState,
  type TriageRow,
} from '@/components/po-triage/types';
import { Section, Row, FieldRow } from './details-primitives';

interface ExtractTabProps {
  detail: TriageDetail;
  rowId: string;
  patchTriage: (body: Record<string, unknown>) => Promise<void>;
  onRowUpdated: (next: TriageRow) => void;
}

export function ExtractTab({ detail, rowId, patchTriage, onRowUpdated }: ExtractTabProps) {
  const [zohoUploaded, setZohoUploaded] = useState(
    detail.row.zoho_uploaded_po_number ?? '',
  );
  const [notes, setNotes] = useState(detail.row.notes ?? '');

  useEffect(() => {
    setZohoUploaded(detail.row.zoho_uploaded_po_number ?? '');
    setNotes(detail.row.notes ?? '');
  }, [detail.row.zoho_uploaded_po_number, detail.row.notes]);

  const extractMut = useResourceMutation(() =>
    fetch(`/api/admin/po-gmail/triage/${encodeURIComponent(rowId)}/extract`, { method: 'POST' })
      .then((r) => jsonOrThrow<{ row: TriageRow; extracted: Record<string, TriageFieldState> }>(r)),
  );
  const extracting = extractMut.isPending;

  const runExtract = useCallback(async () => {
    try {
      const data = await extractMut.mutateAsync();
      onRowUpdated(data.row);
      const n = Object.keys(data.extracted).length;
      toast.success(
        n > 0 ? `Extracted ${n} field${n === 1 ? '' : 's'}` : 'Nothing new to extract',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed');
    }
  }, [extractMut, onRowUpdated]);

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
