'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Barcode, DollarSign, Download, FileText, Pencil, Tag, User } from '@/components/Icons';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/design-system/primitives';
import { toast } from '@/lib/toast';
import { NoteComposerInsertRail, type NoteComposerInsertAction } from '../../NoteComposerInsertRail';
import {
  appendNoteLine,
  buildStaffStampText,
  focusTextEnd,
  formatSerialsForNotes,
  formatUnitPriceForNotes,
  NOTE_CLEAR_BTN,
  NOTE_COMPOSER_OVERLAY_PAD,
  NOTE_COMPOSER_OVERLAY_PAD_BOTTOM_ACTIONS,
  NOTE_DOWNLOAD_INSERT_BTN,
  NOTE_OVERLAY_ICON,
  NOTE_OVERLAY_ICON_BTN,
  NOTE_SERIAL_INSERT_BTN,
  NOTE_STAFF_STAMP_BTN,
  NOTE_TAG_BTN,
  NOTE_UNIT_PRICE_BTN,
  parseZendeskTicketId,
} from '../../note-composer-helpers';
import type { FiledTicket } from '../claim-types';
import type { UseClaimTemplate } from '../hooks/useClaimTemplate';

interface Props {
  template: UseClaimTemplate;
  filedTicket: FiledTicket | null;
  row: ReceivingLineRow;
}

/**
 * Editable Zendesk subject + body, populated from the server preview. Once the
 * operator edits a field we stop overwriting it; "Reset to template" refetches.
 * Body textarea mirrors the label-notes insert rail — staff stamp, serial, and
 * the same context inserts (internal notes, title, price, sync notes, ticket subject).
 */
export function ClaimTemplateEditor({ template, filedTicket, row }: Props) {
  const {
    subject,
    description,
    previewLoading,
    edited,
    onSubjectChange,
    onDescriptionChange,
    resetTemplate,
  } = template;

  const { user } = useAuth();
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [fetchingTicketSubject, setFetchingTicketSubject] = useState(false);

  const appendToBody = useCallback(
    (text: string) => {
      const next = appendNoteLine(description, text);
      if (next === description) return;
      onDescriptionChange(next);
      requestAnimationFrame(() => focusTextEnd(bodyTextareaRef.current));
    },
    [description, onDescriptionChange],
  );

  const staffStamp = buildStaffStampText({ name: user?.name, staffId: user?.staffId });

  const serialNumbers = (row.serials ?? [])
    .map((s) => s.serial_number?.trim())
    .filter((s): s is string => Boolean(s));
  const serialInsertText = formatSerialsForNotes(serialNumbers);

  const trimmedInternalNotes = (row.notes || '').trim();
  const trimmedSkuTitle = (
    row.zoho_item_title ||
    row.catalog_product_title ||
    row.item_name ||
    ''
  ).trim();
  const formattedUnitPrice = formatUnitPriceForNotes(row.unit_price);
  const trimmedSyncNotes = (row.receiving_zoho_notes ?? '').trim();
  const resolvedTicketId = parseZendeskTicketId(row.zendesk_ticket);

  const handlePrefillTicketSubject = useCallback(async () => {
    const ticketId = resolvedTicketId;
    if (!ticketId || fetchingTicketSubject) return;

    setFetchingTicketSubject(true);
    try {
      const res = await fetch(`/api/receiving/zendesk-claim/thread?ticketId=${ticketId}`);
      const data = (await res.json().catch(() => null)) as { ticket?: { subject?: string | null } } | null;
      const ticketSubject = data?.ticket?.subject?.trim();
      if (res.ok && ticketSubject) {
        appendToBody(ticketSubject);
      } else {
        toast.error('Could not load ticket subject');
      }
    } catch {
      toast.error('Could not load ticket subject');
    } finally {
      setFetchingTicketSubject(false);
    }
  }, [resolvedTicketId, fetchingTicketSubject, appendToBody]);

  const handleResetTemplate = useCallback(() => {
    resetTemplate();
    toast.info('Reset to server template');
  }, [resetTemplate]);

  const insertActions = useMemo((): NoteComposerInsertAction[] => {
    const actions: NoteComposerInsertAction[] = [];

    if (staffStamp) {
      actions.push({
        id: 'staff-stamp',
        label: `Stamp: ${staffStamp}`,
        ariaLabel: 'Stamp staff name and time',
        icon: <User className={NOTE_OVERLAY_ICON} />,
        buttonClassName: NOTE_STAFF_STAMP_BTN,
        onClick: () => appendToBody(staffStamp),
      });
    }

    if (serialInsertText) {
      actions.push({
        id: 'serial',
        label:
          serialNumbers.length === 1
            ? `Insert serial: SN: ${serialNumbers[0]}`
            : `Insert serials: SNs: ${serialNumbers.join(', ')}`,
        ariaLabel: 'Insert serial number',
        icon: <Barcode className={NOTE_OVERLAY_ICON} />,
        buttonClassName: NOTE_SERIAL_INSERT_BTN,
        onClick: () => appendToBody(serialInsertText),
      });
    }

    if (resolvedTicketId) {
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
        label: 'Insert internal notes',
        ariaLabel: 'Insert internal notes',
        icon: <FileText className={NOTE_OVERLAY_ICON} />,
        buttonClassName: `${NOTE_OVERLAY_ICON_BTN} text-text-faint transition hover:bg-surface-sunken/80 hover:text-text-muted hover:shadow-sm hover:ring-1 hover:ring-border-soft/80`,
        onClick: () => appendToBody(trimmedInternalNotes),
      });
    }

    if (formattedUnitPrice) {
      actions.push({
        id: 'unit-price',
        label: `Insert unit price: ${formattedUnitPrice}`,
        ariaLabel: 'Insert unit price',
        icon: <DollarSign className={NOTE_OVERLAY_ICON} />,
        buttonClassName: NOTE_UNIT_PRICE_BTN,
        onClick: () => appendToBody(formattedUnitPrice),
      });
    }

    if (trimmedSyncNotes) {
      actions.push({
        id: 'sync-notes',
        label: 'Insert sync (Zoho PO) notes',
        ariaLabel: 'Insert sync notes',
        icon: <Download className={NOTE_OVERLAY_ICON} />,
        buttonClassName: NOTE_DOWNLOAD_INSERT_BTN,
        onClick: () => appendToBody(trimmedSyncNotes),
      });
    }

    if (trimmedSkuTitle) {
      actions.push({
        id: 'product-title',
        label: `Insert product title`,
        ariaLabel: 'Insert product title',
        icon: <Pencil className={NOTE_OVERLAY_ICON} />,
        buttonClassName: `${NOTE_OVERLAY_ICON_BTN} text-yellow-600 transition hover:bg-yellow-100/60 hover:text-yellow-700 hover:shadow-sm hover:ring-1 hover:ring-yellow-200/80`,
        onClick: () => appendToBody(trimmedSkuTitle),
      });
    }

    return actions;
  }, [
    staffStamp,
    serialInsertText,
    serialNumbers,
    resolvedTicketId,
    fetchingTicketSubject,
    handlePrefillTicketSubject,
    trimmedInternalNotes,
    formattedUnitPrice,
    trimmedSyncNotes,
    trimmedSkuTitle,
    appendToBody,
  ]);

  const handleClearBody = useCallback(() => {
    if (!description.trim()) return;
    onDescriptionChange('');
    requestAnimationFrame(() => focusTextEnd(bodyTextareaRef.current));
  }, [description, onDescriptionChange]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-micro font-black uppercase tracking-[0.14em] text-text-soft">
            Zendesk ticket {previewLoading ? '(updating…)' : '(editable)'}
          </p>
          {filedTicket ? (
            <p className="mt-0.5 text-micro font-semibold text-emerald-600">Filed {filedTicket.number}</p>
          ) : null}
        </div>
        {edited ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetTemplate}
            className="text-text-soft hover:text-text-default"
          >
            Reset to template
          </Button>
        ) : null}
      </div>

      <label
        htmlFor="claim-subject"
        className="mb-1 block text-eyebrow font-black uppercase tracking-[0.14em] text-text-faint"
      >
        Subject
      </label>
      <input
        id="claim-subject"
        type="text"
        value={subject}
        onChange={(e) => onSubjectChange(e.target.value)}
        placeholder={previewLoading ? 'Generating…' : 'Subject'}
        className="mb-3 block h-10 w-full rounded-lg border border-border-default bg-surface-card px-3 text-label font-medium text-text-default outline-none focus:border-border-emphasis focus:ring-2 focus:ring-text-soft/20"
      />

      <div>
        <label
          htmlFor="claim-body"
          className="mb-1 block text-eyebrow font-black uppercase tracking-[0.14em] text-text-faint"
        >
          Body
        </label>

        <div className="group relative">
          <textarea
            ref={bodyTextareaRef}
            id="claim-body"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={8}
            placeholder={previewLoading ? 'Generating…' : 'Ticket body'}
            className={`block min-h-[14rem] w-full resize-y rounded-lg border border-border-default bg-surface-card px-4 text-label font-medium leading-5 tracking-[0.01em] text-text-default outline-none focus:border-border-emphasis focus:ring-2 focus:ring-text-soft/20 ${NOTE_COMPOSER_OVERLAY_PAD} ${NOTE_COMPOSER_OVERLAY_PAD_BOTTOM_ACTIONS}`}
          />

          <NoteComposerInsertRail actions={insertActions} />

          <div className="pointer-events-none absolute bottom-2 left-2">
            <div className="pointer-events-auto">
              <button
                type="button"
                onClick={handleClearBody}
                disabled={!description.trim()}
                aria-label="Clear ticket body"
                className={`${NOTE_CLEAR_BTN} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
