'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { ChevronDown, FileText, Download, ClipboardList, Check, Loader2, Pencil, Tag, History, DollarSign, User } from '@/components/Icons';
import type { ReceivingStepKey } from '../ReceivingProgressStepper';
import { Button } from '@/design-system/primitives';
import { WorkspaceCard } from '@/design-system/components';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import { NoteComposerInsertRail, type NoteComposerInsertAction } from '../NoteComposerInsertRail';
import { WorkspaceSectionTitle } from '../WorkspaceSectionLabel';
import { LineChecklistTab } from './LineChecklistTab';
import {
  appendNoteLine,
  buildStaffStampText,
  focusTextEnd,
  formatUnitPriceForNotes,
  NOTE_DOWNLOAD_INSERT_BTN,
  NOTE_DOWNLOAD_SYNC_BTN,
  NOTE_COMPOSER_OVERLAY_PAD,
  NOTE_COMPOSER_OVERLAY_PAD_BOTTOM_ACTIONS,
  NOTE_OVERLAY_ICON,
  NOTE_OVERLAY_ICON_BTN,
  NOTE_SAVE_BTN,
  NOTE_STAFF_STAMP_BTN,
  NOTE_TAG_BTN,
  NOTE_UNIT_PRICE_BTN,
  parseZendeskTicketId,
} from '../note-composer-helpers';

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

const NOTES_TEXTAREA_FOCUS =
  'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

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
  activeStep = null,
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
  /** Active workflow step — auto-focuses label composer on print step. */
  activeStep?: ReceivingStepKey | null;
}) {
  const [tab, setTab] = useState<NotesTab>('label');
  const [moreNotesOpen, setMoreNotesOpen] = useState(false);
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

  // Collapse the secondary tabs back to the label-only composer, refocusing the
  // label field so the operator keeps composing without hunting for the cursor.
  const collapseMoreNotes = useCallback(() => {
    setMoreNotesOpen(false);
    setTab('label');
    requestAnimationFrame(() => focusTextEnd(labelTextareaRef.current));
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

  useEffect(() => {
    if (activeStep === 'print') {
      setTab('label');
      requestAnimationFrame(() => focusTextEnd(labelTextareaRef.current));
    }
  }, [activeStep, lineId, focusTabField]);

  // Each line starts label-first. The card is NOT remounted per line (the panel
  // switches siblings in place), so a stale "more notes" tab would otherwise
  // bleed across the station's line switches — reset it on line change.
  useEffect(() => {
    setMoreNotesOpen(false);
    setTab('label');
  }, [lineId]);

  const secondaryItems: HorizontalSliderItem[] = [
    ...(showZohoTab ? [{ id: 'po', label: 'Sync', icon: FileText } as HorizontalSliderItem] : []),
    { id: 'notes', label: 'Internal', icon: FileText },
    { id: 'checklist', label: 'Checklist', icon: ClipboardList },
  ];

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

  const formattedUnitPrice = formatUnitPriceForNotes(unitPrice);
  const trimmedSkuTitle = (skuTitle || '').trim();
  const trimmedPreviousNotes = (previousLineNotes || '').trim();
  const trimmedInternalNotes = internalNotes.trim();
  const trimmedSyncNotes = (overallZohoNotes ?? '').trim();
  const hasTicket = Boolean(resolvedTicketId);
  const { user } = useAuth();
  const staffStamp = buildStaffStampText({ name: user?.name, staffId: user?.staffId });

  const labelInsertActions = useMemo((): NoteComposerInsertAction[] => {
    const actions: NoteComposerInsertAction[] = [];

    if (staffStamp) {
      actions.push({
        id: 'staff-stamp',
        label: `Stamp: ${staffStamp}`,
        ariaLabel: 'Stamp staff name and time',
        icon: <User className={NOTE_OVERLAY_ICON} />,
        buttonClassName: NOTE_STAFF_STAMP_BTN,
        onClick: () => appendToLabelNotes(staffStamp),
      });
    }

    if (hasTicket) {
      actions.push({
        id: 'ticket-subject',
        label: 'Insert linked ticket subject',
        ariaLabel: 'Insert the linked Zendesk ticket subject',
        icon: <Tag className={NOTE_OVERLAY_ICON} />,
        buttonClassName: NOTE_TAG_BTN,
        onClick: () => void handlePrefillTicketSubject(),
        disabled: fetchingTicketSubject,
        loading: fetchingTicketSubject,
      });
    }

    if (trimmedInternalNotes) {
      actions.push({
        id: 'internal-notes',
        label: 'Insert internal notes into the label',
        ariaLabel: 'Insert internal notes into the label',
        icon: <FileText className={NOTE_OVERLAY_ICON} />,
        buttonClassName: `${NOTE_OVERLAY_ICON_BTN} text-text-faint transition hover:bg-surface-sunken/80 hover:text-text-muted hover:shadow-sm hover:ring-1 hover:ring-border-soft/80`,
        onClick: () => appendToLabelNotes(trimmedInternalNotes),
      });
    }

    if (formattedUnitPrice) {
      actions.push({
        id: 'unit-price',
        label: `Insert unit price: ${formattedUnitPrice}`,
        ariaLabel: 'Insert unit price',
        icon: <DollarSign className={NOTE_OVERLAY_ICON} />,
        buttonClassName: NOTE_UNIT_PRICE_BTN,
        onClick: () => appendToLabelNotes(formattedUnitPrice),
      });
    }

    if (showZohoTab && trimmedSyncNotes) {
      actions.push({
        id: 'sync-notes',
        label: 'Insert sync (Zoho PO) notes into the label',
        ariaLabel: 'Insert sync notes into the label',
        icon: <Download className={NOTE_OVERLAY_ICON} />,
        buttonClassName: NOTE_DOWNLOAD_INSERT_BTN,
        onClick: () => appendToLabelNotes(trimmedSyncNotes),
      });
    }

    if (trimmedSkuTitle) {
      actions.push({
        id: 'product-title',
        label: `Insert product title: "${trimmedSkuTitle}"`,
        ariaLabel: 'Insert product title',
        icon: <Pencil className={NOTE_OVERLAY_ICON} />,
        buttonClassName: `${NOTE_OVERLAY_ICON_BTN} text-yellow-600 transition hover:bg-yellow-100/60 hover:text-yellow-700 hover:shadow-sm hover:ring-1 hover:ring-yellow-200/80`,
        onClick: () => appendToLabelNotes(trimmedSkuTitle),
      });
    }

    return actions;
  }, [
    staffStamp,
    hasTicket,
    fetchingTicketSubject,
    handlePrefillTicketSubject,
    trimmedInternalNotes,
    formattedUnitPrice,
    showZohoTab,
    trimmedSyncNotes,
    trimmedSkuTitle,
    appendToLabelNotes,
  ]);

  return (
    // Glass workspace surface — matches the carton context / PO items cards so
    // the whole unbox column reads as one frosted worksheet.
    <WorkspaceCard variant="glass" overflow="visible" bodyClassName="space-y-3 p-4">
      <div className="flex min-w-0 items-center gap-2">
        <WorkspaceSectionTitle>Label</WorkspaceSectionTitle>
        {!moreNotesOpen ? (
          <button
            type="button"
            onClick={() => setMoreNotesOpen(true)}
            className="ml-auto flex items-center gap-0.5 text-eyebrow font-semibold uppercase tracking-widest text-text-faint transition-colors hover:text-text-muted"
          >
            More notes
            <ChevronDown className="h-3 w-3" />
          </button>
        ) : (
          <div className="ml-auto flex min-w-0 flex-1 items-center gap-1">
            <HorizontalButtonSlider
              variant="nav"
              dense
              overlay
              className="min-w-0 flex-1"
              items={secondaryItems}
              value={tab === 'label' ? 'notes' : tab}
              onChange={handleTabChange}
              aria-label="Additional notes tabs"
            />
            <HoverTooltip label="Collapse — back to label only" asChild>
              {/* ds-raw-button: compact chevron toggle, not a standalone DS Button */}
              <button
                type="button"
                onClick={collapseMoreNotes}
                aria-label="Collapse notes — back to label only"
                className="ds-raw-button -my-1 flex shrink-0 items-center justify-center rounded-md p-1 text-text-faint transition-colors hover:bg-surface-hover hover:text-text-muted"
              >
                <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden />
              </button>
            </HoverTooltip>
          </div>
        )}
      </div>

      {tab === 'label' || !moreNotesOpen ? (
        <div className="group relative">
          <textarea
            ref={labelTextareaRef}
            rows={3}
            aria-label="Label notes"
            value={labelNotes}
            onChange={(e) => onLabelNotesChange(e.target.value)}
            placeholder="Compose label notes"
            className={`w-full resize-none rounded-lg border border-border-soft px-3 text-caption text-text-default placeholder:text-text-faint ${NOTE_COMPOSER_OVERLAY_PAD} ${NOTE_COMPOSER_OVERLAY_PAD_BOTTOM_ACTIONS} ${NOTES_TEXTAREA_FOCUS}`}
          />

          {/* Top-left repeat-previous; top-right insert rail; bottom-right save actions. */}
          {trimmedPreviousNotes && (
            <div className="pointer-events-none absolute left-1.5 top-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <div className="pointer-events-auto">
                <HoverTooltip label="Repeat the previous line's notes" asChild>
                  {/* ds-raw-button */}
                  <button
                    type="button"
                    onClick={() => appendToLabelNotes(trimmedPreviousNotes)}
                    aria-label="Repeat the previous line's notes"
                    className={`${NOTE_OVERLAY_ICON_BTN} bg-surface-card/80 text-text-faint shadow-sm ring-1 ring-border-soft/60 transition hover:bg-surface-sunken hover:text-text-muted`}
                  >
                    <History className={NOTE_OVERLAY_ICON} />
                  </button>
                </HoverTooltip>
              </div>
            </div>
          )}

          <NoteComposerInsertRail actions={labelInsertActions} />

          <div className="pointer-events-none absolute bottom-2.5 right-1.5 flex items-center gap-0.5">
            {showZohoTab ? (
              <div className="pointer-events-auto">
                <HoverTooltip label="Sync to the inventory system (Zoho PO note)" asChild>
                  {/* ds-raw-button */}
                  <button
                    type="button"
                    onClick={() => void handleSyncToInventory()}
                    disabled={syncingToInventory}
                    aria-label="Sync to the inventory system"
                    className={`${NOTE_DOWNLOAD_SYNC_BTN} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {syncingToInventory ? (
                      <Loader2 className={`${NOTE_OVERLAY_ICON} animate-spin`} />
                    ) : (
                      <Download className={NOTE_OVERLAY_ICON} />
                    )}
                  </button>
                </HoverTooltip>
              </div>
            ) : null}
            <div className="pointer-events-auto">
              <HoverTooltip label="Save to internal notes" asChild>
                {/* ds-raw-button */}
                <button
                  type="button"
                  onClick={handleSaveInternal}
                  aria-label="Save to internal notes"
                  className={NOTE_SAVE_BTN}
                >
                  <Check className={NOTE_OVERLAY_ICON} />
                </button>
              </HoverTooltip>
            </div>
          </div>
        </div>
      ) : null}

      {moreNotesOpen && tab === 'notes' ? (
        // Operator notes — `receiving_lines.notes`; saves on blur.
        <textarea
          ref={notesTextareaRef}
          rows={2}
          aria-label="Internal notes"
          value={internalNotes}
          onChange={(e) => onInternalNotesChange(e.target.value)}
          onBlur={onInternalNotesBlur}
          placeholder="Internal notes for this line"
          className={`w-full resize-none rounded-lg border border-border-soft px-3 py-2 text-caption text-text-default placeholder:text-text-faint ${NOTES_TEXTAREA_FOCUS}`}
        />
      ) : moreNotesOpen && tab === 'po' ? (
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
            className={`min-h-[8rem] w-full resize-y rounded-lg border border-border-soft px-3 py-2 text-caption text-text-default ${NOTES_TEXTAREA_FOCUS}`}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro font-semibold uppercase tracking-wide text-text-faint">
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
                    className="h-auto gap-1 px-0 text-micro font-semibold uppercase tracking-wide text-text-faint hover:bg-transparent hover:text-text-muted"
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
      ) : moreNotesOpen && tab === 'checklist' ? (
        <LineChecklistTab lineId={lineId} sku={sku} />
      ) : null}
    </WorkspaceCard>
  );
}
