'use client';

import { useEffect, useState } from 'react';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { Button, IconButton } from '@/design-system/primitives';
import { X, Send } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { cn } from '@/utils/_cn';
import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { useClaimTicketSearch } from './claim/hooks/useClaimTicketSearch';
import { ClaimTicketPicker } from './claim/components/ClaimTicketPicker';
import { useClaimPhotos } from './claim/hooks/useClaimPhotos';
import { ClaimPhotoPicker } from './claim/components/ClaimPhotoPicker';
import { CcEmailField } from './claim/components/CcEmailField';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

/**
 * Send-photos-to-ticket modal. Forwards photos already captured on THIS purchase
 * order to a DIFFERENT Zendesk ticket — either as a private internal note (never
 * emailed) or as a public reply that emails the customer plus any CC'd
 * collaborators (e.g. looping a vendor in on condition photos).
 *
 * Reuses the claim flow's ticket picker (`useClaimTicketSearch` / `ClaimTicketPicker`)
 * and PO photo grid (`useClaimPhotos` / `ClaimPhotoPicker`), and posts to the
 * shared `/api/zendesk/photo-ticket` route in `update` mode — the same chokepoint
 * the Support console uses to attach library photos (which already threads
 * `isPublic` + `emailCcs` to Zendesk).
 *
 * Presented as a centered overlay, identical chrome to {@link ReceivingClaimModal}.
 */
export function SendPhotoNoteModal({
  open,
  row,
  onClose,
}: {
  open: boolean;
  row: ReceivingLineRow;
  onClose: () => void;
}) {
  const receivingId = row.receiving_id ?? null;
  const lineId = row.id ?? null;
  const search = useClaimTicketSearch({ open, enabled: open, receivingId, lineId });
  const photos = useClaimPhotos(open, receivingId);
  const [note, setNote] = useState('');
  // Internal-first: a public reply (which emails the customer) is the deliberate
  // opt-in, matching the Support chat composer.
  const [isPublic, setIsPublic] = useState(false);
  const [ccs, setCcs] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  // Reset the composed note, mode, CCs, and ticket selection each time it opens.
  useEffect(() => {
    if (open) {
      setNote('');
      setIsPublic(false);
      setCcs([]);
      search.reset();
    }
    // search.reset is stable enough; only re-run on open toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedTicket = search.selectedTicket;
  const photoCount = photos.selectedPhotoIds.size;
  const canSend = !!selectedTicket && note.trim().length > 0 && !sending;

  const poLabel =
    (row.zoho_purchaseorder_number || '').trim() ||
    (receivingId != null ? `Package #${receivingId}` : 'This package');

  const handleSend = async () => {
    if (!selectedTicket) {
      toast.error('Pick the ticket to send to first');
      return;
    }
    if (!note.trim()) {
      toast.error(isPublic ? 'Add a reply' : 'Add an internal note');
      return;
    }
    setSending(true);
    try {
      // CCs only make sense on a public reply — the route ignores them on a note.
      const emailCcs = isPublic && ccs.length ? ccs : undefined;
      const fd = new FormData();
      fd.append(
        'meta',
        JSON.stringify({
          mode: 'update',
          ticketId: selectedTicket.id,
          comment: note.trim(),
          isPublic,
          ...(emailCcs ? { emailCcs } : {}),
          photoIds: [...photos.selectedPhotoIds],
        }),
      );
      const res = await fetch('/api/zendesk/photo-ticket', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || `Could not send (HTTP ${res.status})`);
        return;
      }
      const photoSuffix = photoCount ? ` + ${photoCount} photo${photoCount === 1 ? '' : 's'}` : '';
      toast.success(
        isPublic
          ? `Public reply${photoSuffix} sent to #${selectedTicket.id}${emailCcs ? ` · ${emailCcs.length} cc'd` : ''}`
          : `Internal note${photoSuffix} sent to #${selectedTicket.id}`,
      );
      onClose();
    } catch {
      toast.error('Could not send');
    } finally {
      setSending(false);
    }
  };

  return (
    <RightPaneOverlay
      open={open}
      onClose={onClose}
      align="center"
      resizable
      storageKey="receiving-photo-note-size"
      minWidth={460}
      minHeight={420}
      className="-mt-8 h-[min(86vh,44rem)] w-[min(94vw,52rem)]"
      aria-label="Send photos to a ticket"
    >
      <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
        <div className="min-w-0">
          <p className="text-micro font-black uppercase tracking-[0.16em] text-text-soft">
            Send photos to ticket
          </p>
          <p className="truncate text-xs font-semibold text-text-default">{poLabel}</p>
        </div>
        <IconButton
          onClick={onClose}
          ariaLabel="Close"
          icon={<X className="h-4 w-4" />}
          className="rounded p-1 text-text-faint hover:bg-surface-sunken hover:text-text-muted"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13px]">
        <ClaimTicketPicker search={search} onSelect={search.setSelectedTicket} />

        <ClaimPhotoPicker photos={photos} receivingId={receivingId} />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="photo-note-body"
              className="text-micro font-black uppercase tracking-[0.14em] text-text-soft"
            >
              {isPublic ? 'Public reply' : 'Internal note'}
            </label>
            <VisibilityToggle
              value={isPublic}
              onChange={setIsPublic}
              internalLabel="Internal"
              publicLabel="Public + CC"
            />
          </div>

          {isPublic ? (
            <CcEmailField
              emails={ccs}
              onChange={setCcs}
              placeholder="Add vendor / teammate email to CC…"
            />
          ) : null}

          <textarea
            id="photo-note-body"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder={
              isPublic
                ? 'Reply the customer will receive by email…'
                : 'Add an internal note for the team (private — not emailed to the customer)…'
            }
            className={cn(
              'block w-full resize-y rounded-lg border bg-surface-card px-3 py-2 text-label font-medium text-text-default outline-none focus:ring-2',
              isPublic
                ? 'border-blue-200 focus:border-blue-500 focus:ring-blue-500/20'
                : 'border-border-soft focus:border-border-emphasis focus:ring-text-soft/20',
            )}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border-soft px-4 py-3">
        <p className="min-w-0 text-micro font-medium text-text-faint">
          {isPublic ? 'Emails the customer' : 'Posts as an internal note (private)'}.
          {selectedTicket ? ` → #${selectedTicket.id}` : ' Pick a ticket.'}
          {isPublic && ccs.length ? ` · ${ccs.length} cc` : ''}
          {photoCount ? ` · ${photoCount} photo${photoCount === 1 ? '' : 's'}` : ''}
        </p>
        <Button
          variant="primary"
          size="md"
          icon={<Send />}
          loading={sending}
          onClick={handleSend}
          disabled={!canSend}
          className="shrink-0"
        >
          {isPublic ? 'Send reply' : 'Send internal note'}
        </Button>
      </div>
    </RightPaneOverlay>
  );
}

export default SendPhotoNoteModal;
