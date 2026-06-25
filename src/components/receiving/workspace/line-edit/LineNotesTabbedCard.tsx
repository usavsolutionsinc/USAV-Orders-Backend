'use client';

import { useEffect, useState } from 'react';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { FileText, Download, ClipboardList, Check } from '@/components/Icons';
import { LineChecklistTab } from './LineChecklistTab';

/**
 * Tabbed notes card for the receiving workspace. Three surfaces:
 *
 *   • Notes     — operator-editable (`receiving_lines.notes`); plain textarea,
 *                 no floating label; saves on blur. This is the field pushed to
 *                 the Zoho PO notes on Print · receive (server `after()` patch).
 *   • PO note   — overall Zoho PO header note (carton-level); editable, with its
 *                 own Save-to-Zoho push.
 *   • Checklist — fill-in receiving checklist (global to start; per-SKU later).
 *
 * The per-line Zoho item description is no longer surfaced here (it is edited
 * inline on the PO-items row).
 *
 * Tab selection is ephemeral local UI state (a within-pane toggle, not URL).
 */
type NotesTab = 'notes' | 'po' | 'checklist';

export function LineNotesTabbedCard({
  notes,
  overallZohoNotes,
  lineId,
  sku,
  onChange,
  onBlur,
  onSaveOverallNote,
}: {
  notes: string;
  /** Overall Zoho PO note (PO header `notes`, carton-level) — the PO-note tab. */
  overallZohoNotes: string | null;
  /** Active line id — keys the checklist's per-line fill state. */
  lineId: number;
  /** Line SKU — reserved for the per-SKU checklist swap. */
  sku?: string | null;
  onChange: (next: string) => void;
  onBlur: () => void;
  /** Persist the edited overall PO note (carton-level) + push to the Zoho PO field. */
  onSaveOverallNote: (text: string) => void | Promise<void>;
}) {
  const [tab, setTab] = useState<NotesTab>('notes');

  // Overall PO note is editable; the green check pushes the update to Zoho.
  const [overallDraft, setOverallDraft] = useState(overallZohoNotes ?? '');
  const [savingOverall, setSavingOverall] = useState(false);
  useEffect(() => {
    setOverallDraft(overallZohoNotes ?? '');
  }, [overallZohoNotes, lineId]);
  const overallDirty = overallDraft.trim() !== (overallZohoNotes ?? '').trim();
  const handleSaveOverall = async () => {
    if (!overallDirty || savingOverall) return;
    setSavingOverall(true);
    try {
      await onSaveOverallNote(overallDraft.trim());
    } finally {
      setSavingOverall(false);
    }
  };

  const items: HorizontalSliderItem[] = [
    { id: 'notes', label: 'Notes', icon: FileText },
    { id: 'po', label: 'PO note', icon: Download },
    { id: 'checklist', label: 'Checklist', icon: ClipboardList },
  ];

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60 space-y-3">
      {/* `overlay` skips the horizontal scroller so the active pill's blue glow
          isn't clipped at the bottom (overflow-x-auto forces overflow-y:auto). */}
      <HorizontalButtonSlider
        variant="nav"
        dense
        overlay
        items={items}
        value={tab}
        onChange={(id) => setTab(id as NotesTab)}
        aria-label="Notes tabs"
      />

      {tab === 'notes' ? (
        // Operator notes — no floating label, no placeholder. Pushed to Zoho on
        // Print · receive.
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-caption text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
        />
      ) : tab === 'po' ? (
        <div className="space-y-1">
          <textarea
            rows={2}
            value={overallDraft}
            onChange={(e) => setOverallDraft(e.target.value)}
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-caption text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleSaveOverall()}
              disabled={!overallDirty || savingOverall}
              title="Save the note to the Zoho PO field"
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white ring-1 ring-inset ring-emerald-700 transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              {savingOverall ? 'Saving…' : 'Save to Zoho'}
            </button>
          </div>
        </div>
      ) : (
        <LineChecklistTab lineId={lineId} sku={sku} />
      )}
    </section>
  );
}
