'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { FileText, Download, ClipboardList, Check, Loader2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { LineChecklistTab } from './LineChecklistTab';

/**
 * Tabbed notes card for the receiving workspace. Three surfaces:
 *
 *   • Notes      — operator-editable (`receiving_lines.notes`); plain textarea,
 *                  no floating label; saves on blur. Pushed to Zoho on receive.
 *   • Zoho notes — overall Zoho PO header note (carton-level); editable, with its
 *                  own Save-to-Zoho push.
 *   • Checklist  — fill-in receiving checklist (global to start; per-SKU later).
 *
 * The per-line Zoho item description is no longer surfaced here (it is edited
 * inline on the PO-items row).
 *
 * Tab selection is ephemeral local UI state (a within-pane toggle, not URL).
 */
type NotesTab = 'notes' | 'po' | 'checklist';

function focusTextEnd(el: HTMLTextAreaElement | HTMLInputElement | null) {
  if (!el) return;
  const len = el.value.length;
  el.focus();
  el.setSelectionRange(len, len);
  if ('scrollTop' in el) el.scrollTop = el.scrollHeight;
}

const NOTES_TEXTAREA_FOCUS =
  'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

export function LineNotesTabbedCard({
  notes,
  overallZohoNotes,
  lineId,
  sku,
  onChange,
  onBlur,
  onSaveOverallNote,
  onOverallDraftChange,
  onLoadZohoNotes,
  showZohoTab = true,
}: {
  notes: string;
  /** Overall Zoho PO header note (carton-level) — the Zoho notes tab. */
  overallZohoNotes: string | null;
  /** Active line id — keys the checklist's per-line fill state. */
  lineId: number;
  /** Line SKU — reserved for the per-SKU checklist swap. */
  sku?: string | null;
  onChange: (next: string) => void;
  onBlur: () => void;
  /** Persist the edited overall Zoho note (carton-level) + push to the Zoho PO field. */
  onSaveOverallNote: (text: string) => void | Promise<void>;
  /** Clears bottom feedback when the operator edits the Zoho notes draft. */
  onOverallDraftChange?: () => void;
  /**
   * Pull the latest Zoho PO notes from Zoho (carton sync). Called when the Zoho
   * notes tab is opened so the operator always edits the current Zoho value —
   * returns the fresh notes which seed the editable draft. No-op if absent.
   */
  onLoadZohoNotes?: () => Promise<string | null | undefined>;
  /**
   * Show the Zoho notes tab. False for unfound/unmatched cartons — there is no
   * Zoho PO, so there is nothing to display or sync.
   */
  showZohoTab?: boolean;
}) {
  const [tab, setTab] = useState<NotesTab>('notes');
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);
  const poTextareaRef = useRef<HTMLTextAreaElement>(null);

  const focusTabField = useCallback((next: NotesTab) => {
    if (next === 'checklist') return;
    requestAnimationFrame(() => {
      focusTextEnd((next === 'notes' ? notesTextareaRef : poTextareaRef).current);
    });
  }, []);

  // Overall Zoho note is editable; the green check pushes the update to Zoho.
  const [overallDraft, setOverallDraft] = useState(overallZohoNotes ?? '');
  const [savingOverall, setSavingOverall] = useState(false);
  const [loadingZoho, setLoadingZoho] = useState(false);
  useEffect(() => {
    setOverallDraft(overallZohoNotes ?? '');
  }, [overallZohoNotes, lineId]);
  const overallDirty = overallDraft.trim() !== (overallZohoNotes ?? '').trim();

  // On opening the Zoho notes tab, pull the latest notes from Zoho so the
  // operator edits (and appends to) the current value — never a stale one.
  // Skipped when there are unsaved edits, so a sync never clobbers the draft.
  const loadZohoNotes = useCallback(async () => {
    if (!onLoadZohoNotes || loadingZoho) return;
    if (overallDraft.trim() !== (overallZohoNotes ?? '').trim()) return;
    setLoadingZoho(true);
    try {
      const fresh = await onLoadZohoNotes();
      if (fresh !== undefined) setOverallDraft(fresh ?? '');
    } finally {
      setLoadingZoho(false);
    }
  }, [onLoadZohoNotes, loadingZoho, overallDraft, overallZohoNotes]);

  const handleTabChange = useCallback(
    (id: string) => {
      const next = id as NotesTab;
      setTab(next);
      focusTabField(next);
      if (next === 'po') void loadZohoNotes();
    },
    [focusTabField, loadZohoNotes],
  );
  const handleSaveOverall = async () => {
    if (!overallDirty || savingOverall) return;
    setSavingOverall(true);
    try {
      await onSaveOverallNote(overallDraft.trim());
    } finally {
      setSavingOverall(false);
    }
  };

  // Unfound cartons have no Zoho PO — drop the Zoho notes tab entirely and never
  // leave it as the active tab.
  useEffect(() => {
    if (!showZohoTab && tab === 'po') setTab('notes');
  }, [showZohoTab, tab]);

  const items: HorizontalSliderItem[] = [
    { id: 'notes', label: 'Notes', icon: FileText },
    ...(showZohoTab
      ? [{ id: 'po', label: 'Zoho notes', icon: Download } as HorizontalSliderItem]
      : []),
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
        onChange={handleTabChange}
        aria-label="Notes tabs"
      />

      {tab === 'notes' ? (
        // Operator notes — pushed to label + Zoho PO on print · receive.
        <textarea
          ref={notesTextareaRef}
          rows={2}
          aria-label="Notes"
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder="Add notes to label and PO"
          className={`w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-caption text-gray-900 placeholder:text-gray-400 ${NOTES_TEXTAREA_FOCUS}`}
        />
      ) : tab === 'po' ? (
        <div className="space-y-1">
          <textarea
            ref={poTextareaRef}
            rows={6}
            aria-label="Zoho notes"
            value={overallDraft}
            onChange={(e) => {
              setOverallDraft(e.target.value);
              onOverallDraftChange?.();
            }}
            className={`min-h-[8rem] w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-caption text-gray-900 ${NOTES_TEXTAREA_FOCUS}`}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro font-semibold uppercase tracking-wide text-gray-400">
              {loadingZoho ? (
                <span className="inline-flex items-center gap-1 text-blue-500">
                  <Loader2 className="h-3 w-3 animate-spin" /> Syncing from Zoho…
                </span>
              ) : onLoadZohoNotes ? (
                <HoverTooltip
                  label={overallDirty ? 'Save or discard edits first' : 'Reload the latest notes from Zoho'}
                  asChild
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Download className="h-3 w-3" />}
                    onClick={() => void loadZohoNotes()}
                    disabled={overallDirty}
                    aria-label={overallDirty ? 'Save or discard edits first' : 'Reload the latest notes from Zoho'}
                    className="h-auto gap-1 px-0 text-micro font-semibold uppercase tracking-wide text-gray-400 hover:bg-transparent hover:text-gray-600"
                  >
                    Sync from Zoho
                  </Button>
                </HoverTooltip>
              ) : null}
            </span>
            <HoverTooltip label="Append the edited note to the Zoho PO field" asChild>
              <button
                type="button"
                onClick={() => void handleSaveOverall()}
                disabled={!overallDirty || savingOverall || loadingZoho}
                aria-label="Append the edited note to the Zoho PO field"
                className="ds-raw-button inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-caption font-bold uppercase tracking-wide text-white ring-1 ring-inset ring-emerald-700 transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                {savingOverall ? 'Saving…' : 'Save to Zoho'}
              </button>
            </HoverTooltip>
          </div>
        </div>
      ) : (
        <LineChecklistTab lineId={lineId} sku={sku} />
      )}
    </section>
  );
}
