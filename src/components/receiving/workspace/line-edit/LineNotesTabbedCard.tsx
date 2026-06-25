'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { FileText, ClipboardList, Check, ChevronDown } from '@/components/Icons';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import {
  useMotionPresence,
  useMotionTransition,
} from '@/design-system/foundations/motion-framer-hooks';
import { LineChecklistTab } from './LineChecklistTab';

/**
 * Notes card for the receiving workspace. Two surfaces:
 *
 *   • Notes     — operator-editable (`receiving_lines.notes`); plain textarea,
 *                 no floating label; saves on blur. This is the field pushed to
 *                 the Zoho PO notes on Print · receive (server `after()` patch).
 *   • Checklist — fill-in receiving checklist (global to start; per-SKU later).
 *
 * The overall Zoho PO note (carton-level header note) is tucked behind a small
 * bottom-right expander under the Notes field — its own Save-to-Zoho push,
 * kept out of the way until needed. The per-line Zoho item description is no
 * longer surfaced here (it is edited inline on the PO-items row).
 *
 * Tab selection is ephemeral local UI state (a within-pane toggle, not URL).
 */
type NotesTab = 'notes' | 'checklist';

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
  /** Overall Zoho PO note (PO header `notes`, carton-level) — behind the expander. */
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

  // House collapse motion for the PO-note expander (height:auto is the one
  // sanctioned layout animation; reduced-motion → opacity fade via the hook).
  const collapse = useMotionPresence(framerPresence.collapseHeight);
  const collapseTransition = useMotionTransition(framerTransition.stationCollapse);

  // Overall PO note is editable behind a bottom-right expander; the green check
  // pushes the update to the Zoho PO field.
  const [poNoteOpen, setPoNoteOpen] = useState(false);
  const [overallDraft, setOverallDraft] = useState(overallZohoNotes ?? '');
  const [savingOverall, setSavingOverall] = useState(false);
  useEffect(() => {
    setOverallDraft(overallZohoNotes ?? '');
  }, [overallZohoNotes, lineId]);
  const overallDirty = overallDraft.trim() !== (overallZohoNotes ?? '').trim();
  const hasPoNote = !!(overallZohoNotes && overallZohoNotes.trim());
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
        <div className="space-y-2">
          {/* Operator notes — no floating label. Pushed to Zoho on Print · receive. */}
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            placeholder="Add a note…"
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-caption text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />

          {/* Bottom-right expander → overall PO note (Zoho header note). */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setPoNoteOpen((v) => !v)}
              aria-expanded={poNoteOpen}
              title="Overall PO note (Zoho)"
              className="-my-0.5 inline-flex items-center gap-1 rounded text-[10px] font-black uppercase tracking-widest text-gray-400 transition-colors hover:text-gray-600"
            >
              {hasPoNote ? (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              ) : null}
              PO note
              <ChevronDown
                className={`h-3 w-3 transition-transform duration-150 ${poNoteOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          <AnimatePresence initial={false}>
            {poNoteOpen ? (
              <motion.div
                key="po-note"
                initial={collapse.initial}
                animate={collapse.animate}
                exit={collapse.exit}
                transition={collapseTransition}
                className="overflow-hidden"
              >
                <div className="space-y-1">
                  <textarea
                    rows={2}
                    value={overallDraft}
                    onChange={(e) => setOverallDraft(e.target.value)}
                    placeholder="PO note pushed to Zoho…"
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-caption text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
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
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : (
        <LineChecklistTab lineId={lineId} sku={sku} />
      )}
    </section>
  );
}
