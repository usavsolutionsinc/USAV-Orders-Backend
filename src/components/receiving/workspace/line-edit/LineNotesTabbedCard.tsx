'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { FileText, Download, ClipboardList, Check, Loader2, Pencil, Tag, History, DollarSign } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { toast } from '@/lib/toast';
import { LineChecklistTab } from './LineChecklistTab';

/**
 * Tabbed notes card for the receiving workspace. Four surfaces:
 *
 *   • Label     — ephemeral label-face composer (NOT `receiving_lines.notes`).
 *                 Top-right icon buttons insert ticket subject, unit price,
 *                 product title, internal notes, or sync (Zoho PO) notes.
 *                 Bottom-right: save label text to Internal, or push label text
 *                 into the Zoho PO note.
 *   • Sync      — overall Zoho PO header note (carton-level); editable, with its
 *                 own Save-to-Zoho push.
 *   • Internal  — operator-editable (`receiving_lines.notes`); plain textarea,
 *                 saves on blur. Pushed to Zoho on receive.
 *   • Checklist — fill-in receiving checklist (global to start; per-SKU later).
 *
 * Label and Internal are separate buffers — DB `notes` hydrates Internal only.
 *
 * The per-line Zoho item description is no longer surfaced here (it is edited
 * inline on the PO-items row).
 *
 * Tab selection is ephemeral local UI state (a within-pane toggle, not URL).
 */
type NotesTab = 'label' | 'notes' | 'po' | 'checklist';

function focusTextEnd(el: HTMLTextAreaElement | HTMLInputElement | null) {
  if (!el) return;
  const len = el.value.length;
  el.focus();
  el.setSelectionRange(len, len);
  if ('scrollTop' in el) el.scrollTop = el.scrollHeight;
}

function appendNoteLine(current: string, addition: string): string {
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) return current;
  const trimmedCurrent = current.trimEnd();
  return trimmedCurrent ? `${trimmedCurrent}\n${trimmedAddition}` : trimmedAddition;
}

/** Zoho PO unit cost — same `$88.77` shape as {@link UnitPriceChip}. */
function formatUnitPriceForNotes(unitPrice: string | number | null | undefined): string | null {
  if (unitPrice == null || unitPrice === '') return null;
  const n = Number(unitPrice);
  if (!Number.isFinite(n)) return null;
  return `$${n.toFixed(2)}`;
}

/** Numeric Zendesk id from "#9395", a bare id, or a ticket URL. */
function parseZendeskTicketId(raw: string | number | null | undefined): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isInteger(raw) && raw > 0 ? String(raw) : null;
  const fromUrl = raw.match(/tickets\/(\d+)/);
  const digits = (fromUrl ? fromUrl[1] : raw.replace(/^#/, '')).match(/\d+/);
  if (!digits) return null;
  const n = Number(digits[0]);
  return Number.isInteger(n) && n > 0 ? String(n) : null;
}

const NOTES_TEXTAREA_FOCUS =
  'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

/** Fixed square hit target — top-right inserts and bottom-right actions share one size. */
const LABEL_OVERLAY_ICON_BTN =
  'ds-raw-button inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded';

const LABEL_OVERLAY_ICON = 'h-3.5 w-3.5';

const LABEL_RAIL_SPACER_CLASS = 'inline-flex h-[22px] w-[22px] shrink-0';

const LABEL_TAG_BTN = `${LABEL_OVERLAY_ICON_BTN} text-orange-500 transition hover:bg-orange-100/60 hover:text-orange-600 hover:shadow-sm hover:ring-1 hover:ring-orange-200/80`;

const LABEL_DOWNLOAD_INSERT_BTN = `${LABEL_OVERLAY_ICON_BTN} text-blue-600 transition hover:bg-blue-100/60 hover:text-blue-700 hover:shadow-sm hover:ring-1 hover:ring-blue-200/80`;

const LABEL_DOWNLOAD_SYNC_BTN = `${LABEL_OVERLAY_ICON_BTN} text-gray-400 transition hover:bg-blue-100/60 hover:text-blue-600 hover:shadow-sm hover:ring-1 hover:ring-blue-200/80`;

const LABEL_SAVE_BTN = `${LABEL_OVERLAY_ICON_BTN} text-gray-400 transition hover:bg-emerald-100/60 hover:text-emerald-600 hover:shadow-sm hover:ring-1 hover:ring-emerald-200/80`;

export function LineNotesTabbedCard({
  internalNotes,
  labelNotes,
  overallZohoNotes,
  lineId,
  sku,
  skuTitle,
  unitPrice,
  zendeskTicket,
  zendeskProviderTicketId,
  zendeskTicketSubject,
  previousLineNotes,
  onInternalNotesChange,
  onInternalNotesBlur,
  onLabelNotesChange,
  onSaveLabelToInternal,
  onSaveOverallNote,
  onOverallDraftChange,
  onLoadZohoNotes,
  showZohoTab = true,
}: {
  /** `receiving_lines.notes` — Internal tab only. */
  internalNotes: string;
  /** Ephemeral label-face composer; not hydrated from the DB column. */
  labelNotes: string;
  /** Overall Zoho PO header note (carton-level) — the Sync tab. */
  overallZohoNotes: string | null;
  /** Active line id — keys the checklist's per-line fill state. */
  lineId: number;
  /** Line SKU — reserved for the per-SKU checklist swap. */
  sku?: string | null;
  /** Resolved product title — prefills the title button in the Label composer. */
  skuTitle?: string | null;
  /** Zoho PO line unit cost — prefills the price button in the Label composer. */
  unitPrice?: string | number | null;
  /** Linked Zendesk ticket label (#9395) — from ticket_links or receiving_lines. */
  zendeskTicket?: string | null;
  /** Provider-native Zendesk id for thread fetch (ticket_links). */
  zendeskProviderTicketId?: number | null;
  /** Cached subject from support_tickets — skips a live Zendesk round-trip when present. */
  zendeskTicketSubject?: string | null;
  /** Label notes from the previous line touched this session — repeat-previous source. */
  previousLineNotes?: string;
  onInternalNotesChange: (next: string) => void;
  onInternalNotesBlur: () => void;
  onLabelNotesChange: (next: string) => void;
  /** Copy label composer text into Internal notes and persist. */
  onSaveLabelToInternal: () => void;
  /** Persist the edited overall Zoho note (carton-level) + push to the Zoho PO field. */
  onSaveOverallNote: (text: string) => void | Promise<void>;
  /** Clears bottom feedback when the operator edits the Sync notes draft. */
  onOverallDraftChange?: () => void;
  /**
   * Pull the latest Zoho PO notes from Zoho (carton sync). Called when the Sync
   * tab is opened so the operator always edits the current Zoho value —
   * returns the fresh notes which seed the editable draft. No-op if absent.
   */
  onLoadZohoNotes?: () => Promise<string | null | undefined>;
  /**
   * Show the Sync tab. False for unfound/unmatched cartons — there is no
   * Zoho PO, so there is nothing to display or sync.
   */
  showZohoTab?: boolean;
}) {
  const [tab, setTab] = useState<NotesTab>('label');
  const labelTextareaRef = useRef<HTMLTextAreaElement>(null);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);
  const poTextareaRef = useRef<HTMLTextAreaElement>(null);

  const focusTabField = useCallback((next: NotesTab) => {
    if (next === 'checklist') return;
    const ref = next === 'label' ? labelTextareaRef : next === 'notes' ? notesTextareaRef : poTextareaRef;
    requestAnimationFrame(() => {
      focusTextEnd(ref.current);
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

  // On opening the Sync tab, pull the latest notes from Zoho so the operator
  // edits (and appends to) the current value — never a stale one. Skipped when
  // there are unsaved edits, so a sync never clobbers the draft.
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

  // Unfound cartons have no Zoho PO — drop the Sync tab entirely and never
  // leave it as the active tab.
  useEffect(() => {
    if (!showZohoTab && tab === 'po') setTab('label');
  }, [showZohoTab, tab]);

  // Label composer: append a source line into the ephemeral label buffer.
  const appendToLabelNotes = useCallback(
    (text: string) => {
      const next = appendNoteLine(labelNotes, text);
      if (next === labelNotes) return;
      onLabelNotesChange(next);
      requestAnimationFrame(() => focusTextEnd(labelTextareaRef.current));
    },
    [labelNotes, onLabelNotesChange],
  );

  const resolvedTicketId =
    zendeskProviderTicketId != null && zendeskProviderTicketId > 0
      ? String(zendeskProviderTicketId)
      : parseZendeskTicketId(zendeskTicket);

  const [fetchingTicketSubject, setFetchingTicketSubject] = useState(false);
  const handlePrefillTicketSubject = useCallback(async () => {
    const ticketId = resolvedTicketId;
    if (!ticketId || fetchingTicketSubject) return;

    const cachedSubject = (zendeskTicketSubject || '').trim();
    if (cachedSubject) {
      appendToLabelNotes(cachedSubject);
      return;
    }

    setFetchingTicketSubject(true);
    try {
      const res = await fetch(`/api/receiving/zendesk-claim/thread?ticketId=${ticketId}`);
      const data = (await res.json().catch(() => null)) as { ticket?: { subject?: string | null } } | null;
      const subject = data?.ticket?.subject?.trim();
      if (res.ok && subject) {
        appendToLabelNotes(subject);
      } else {
        toast.error('Could not load ticket subject');
      }
    } catch {
      toast.error('Could not load ticket subject');
    } finally {
      setFetchingTicketSubject(false);
    }
  }, [resolvedTicketId, zendeskTicketSubject, fetchingTicketSubject, appendToLabelNotes]);

  const handleSaveInternal = useCallback(() => {
    onSaveLabelToInternal();
  }, [onSaveLabelToInternal]);

  const [syncingToInventory, setSyncingToInventory] = useState(false);
  const handleSyncToInventory = useCallback(async () => {
    if (syncingToInventory || !showZohoTab) return;
    setSyncingToInventory(true);
    try {
      const combined = appendNoteLine(overallZohoNotes ?? '', labelNotes);
      await onSaveOverallNote(combined);
    } finally {
      setSyncingToInventory(false);
    }
  }, [syncingToInventory, showZohoTab, labelNotes, overallZohoNotes, onSaveOverallNote]);

  const items: HorizontalSliderItem[] = [
    { id: 'label', label: 'Label', icon: FileText },
    ...(showZohoTab ? [{ id: 'po', label: 'Sync', icon: FileText } as HorizontalSliderItem] : []),
    { id: 'notes', label: 'Internal', icon: FileText },
    { id: 'checklist', label: 'Checklist', icon: ClipboardList },
  ];

  const trimmedSkuTitle = (skuTitle || '').trim();
  const formattedUnitPrice = formatUnitPriceForNotes(unitPrice);
  const trimmedPreviousNotes = (previousLineNotes || '').trim();
  const trimmedInternalNotes = internalNotes.trim();
  const trimmedSyncNotes = (overallZohoNotes ?? '').trim();
  const hasTicket = Boolean(resolvedTicketId);

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

      {tab === 'label' ? (
        <div className="group relative">
          <textarea
            ref={labelTextareaRef}
            rows={3}
            aria-label="Label notes"
            value={labelNotes}
            onChange={(e) => onLabelNotesChange(e.target.value)}
            placeholder="Compose label notes"
            className={`w-full resize-none rounded-lg border border-gray-200 px-3 pb-11 pt-2 text-caption text-gray-900 placeholder:text-gray-400 ${NOTES_TEXTAREA_FOCUS}`}
          />

          {/* Top-left repeat-previous; top-right insert rail; bottom-right save actions.
              All overlay buttons share {@link LABEL_OVERLAY_ICON_BTN} sizing. */}
          {trimmedPreviousNotes && (
            <div className="pointer-events-none absolute left-1.5 top-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <div className="pointer-events-auto">
                <HoverTooltip label="Repeat the previous line's notes" asChild>
                  <button
                    type="button"
                    onClick={() => appendToLabelNotes(trimmedPreviousNotes)}
                    aria-label="Repeat the previous line's notes"
                    className={`${LABEL_OVERLAY_ICON_BTN} bg-white/80 text-gray-400 shadow-sm ring-1 ring-gray-200/60 transition hover:bg-gray-100 hover:text-gray-600`}
                  >
                    <History className={LABEL_OVERLAY_ICON} />
                  </button>
                </HoverTooltip>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-0.5">
            {hasTicket && (
              <div className="pointer-events-auto">
                <HoverTooltip label="Insert the linked Zendesk ticket's subject" asChild>
                  <button
                    type="button"
                    onClick={() => void handlePrefillTicketSubject()}
                    disabled={fetchingTicketSubject}
                    aria-label="Insert the linked Zendesk ticket's subject"
                    className={`${LABEL_TAG_BTN} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {fetchingTicketSubject ? (
                      <Loader2 className={`${LABEL_OVERLAY_ICON} animate-spin`} />
                    ) : (
                      <Tag className={LABEL_OVERLAY_ICON} />
                    )}
                  </button>
                </HoverTooltip>
              </div>
            )}
            {trimmedInternalNotes && (
              <div className="pointer-events-auto">
                <HoverTooltip label="Insert internal notes into the label" asChild>
                  <button
                    type="button"
                    onClick={() => appendToLabelNotes(trimmedInternalNotes)}
                    aria-label="Insert internal notes into the label"
                    className={`${LABEL_OVERLAY_ICON_BTN} text-gray-400 transition hover:bg-gray-100/80 hover:text-gray-700 hover:shadow-sm hover:ring-1 hover:ring-gray-200/80`}
                  >
                    <FileText className={LABEL_OVERLAY_ICON} />
                  </button>
                </HoverTooltip>
              </div>
            )}
            {formattedUnitPrice && (
              <div className="pointer-events-auto">
                <HoverTooltip label={`Insert unit price: ${formattedUnitPrice}`} asChild>
                  <button
                    type="button"
                    onClick={() => appendToLabelNotes(formattedUnitPrice)}
                    aria-label="Insert unit price"
                    className={`${LABEL_OVERLAY_ICON_BTN} text-emerald-600 transition hover:bg-emerald-100/60 hover:text-emerald-700 hover:shadow-sm hover:ring-1 hover:ring-emerald-200/80`}
                  >
                    <DollarSign className={LABEL_OVERLAY_ICON} />
                  </button>
                </HoverTooltip>
              </div>
            )}
            {showZohoTab && trimmedSyncNotes && (
              <div className="pointer-events-auto">
                <HoverTooltip label="Insert sync (Zoho PO) notes into the label" asChild>
                  <button
                    type="button"
                    onClick={() => appendToLabelNotes(trimmedSyncNotes)}
                    aria-label="Insert sync notes into the label"
                    className={LABEL_DOWNLOAD_INSERT_BTN}
                  >
                    <Download className={LABEL_OVERLAY_ICON} />
                  </button>
                </HoverTooltip>
              </div>
            )}
            {trimmedSkuTitle && (
              <div className="pointer-events-auto">
                <HoverTooltip label={`Insert product title: "${trimmedSkuTitle}"`} asChild>
                  <button
                    type="button"
                    onClick={() => appendToLabelNotes(trimmedSkuTitle)}
                    aria-label="Insert product title"
                    className={`${LABEL_OVERLAY_ICON_BTN} text-yellow-600 transition hover:bg-yellow-100/60 hover:text-yellow-700 hover:shadow-sm hover:ring-1 hover:ring-yellow-200/80`}
                  >
                    <Pencil className={LABEL_OVERLAY_ICON} />
                  </button>
                </HoverTooltip>
              </div>
            )}
          </div>

          <div className="pointer-events-none absolute bottom-2.5 right-1.5 flex items-center gap-0.5">
            {hasTicket ? <span className={LABEL_RAIL_SPACER_CLASS} aria-hidden /> : null}
            {trimmedInternalNotes ? <span className={LABEL_RAIL_SPACER_CLASS} aria-hidden /> : null}
            {formattedUnitPrice ? <span className={LABEL_RAIL_SPACER_CLASS} aria-hidden /> : null}
            {showZohoTab ? (
              <div className="pointer-events-auto">
                <HoverTooltip label="Sync to the inventory system (Zoho PO note)" asChild>
                  <button
                    type="button"
                    onClick={() => void handleSyncToInventory()}
                    disabled={syncingToInventory}
                    aria-label="Sync to the inventory system"
                    className={`${LABEL_DOWNLOAD_SYNC_BTN} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {syncingToInventory ? (
                      <Loader2 className={`${LABEL_OVERLAY_ICON} animate-spin`} />
                    ) : (
                      <Download className={LABEL_OVERLAY_ICON} />
                    )}
                  </button>
                </HoverTooltip>
              </div>
            ) : null}
            <div className="pointer-events-auto">
              <HoverTooltip label="Save to internal notes" asChild>
                <button
                  type="button"
                  onClick={handleSaveInternal}
                  aria-label="Save to internal notes"
                  className={LABEL_SAVE_BTN}
                >
                  <Check className={LABEL_OVERLAY_ICON} />
                </button>
              </HoverTooltip>
            </div>
          </div>
        </div>
      ) : tab === 'notes' ? (
        // Operator notes — `receiving_lines.notes`; saves on blur.
        <textarea
          ref={notesTextareaRef}
          rows={2}
          aria-label="Internal notes"
          value={internalNotes}
          onChange={(e) => onInternalNotesChange(e.target.value)}
          onBlur={onInternalNotesBlur}
          placeholder="Internal notes for this line"
          className={`w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-caption text-gray-900 placeholder:text-gray-400 ${NOTES_TEXTAREA_FOCUS}`}
        />
      ) : tab === 'po' ? (
        <div className="space-y-1">
          <textarea
            ref={poTextareaRef}
            rows={6}
            aria-label="Sync notes"
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
