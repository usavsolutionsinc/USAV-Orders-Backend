'use client';

import { useEffect, useState } from 'react';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { Button, IconButton } from '@/design-system/primitives';
import { X, Send } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { useClaimTicketSearch } from './claim/hooks/useClaimTicketSearch';
import { ClaimTicketPicker } from './claim/components/ClaimTicketPicker';
import { useClaimPhotos } from './claim/hooks/useClaimPhotos';
import { ClaimPhotoPicker } from './claim/components/ClaimPhotoPicker';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

/**
 * Send-photos-as-internal-note modal. Lets the operator forward photos already
 * captured on THIS purchase order to a DIFFERENT Zendesk ticket as a private
 * internal note (never emailed to the customer) — e.g. attaching condition
 * photos to a related support thread.
 *
 * Reuses the claim flow's ticket picker (`useClaimTicketSearch` / `ClaimTicketPicker`)
 * and PO photo grid (`useClaimPhotos` / `ClaimPhotoPicker`), and posts to the
 * shared `/api/zendesk/photo-ticket` route in `update` mode (`isPublic: false`)
 * — the same chokepoint the Support console uses to attach library photos.
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
  const [sending, setSending] = useState(false);

  // Reset the composed note + ticket selection each time the modal opens.
  useEffect(() => {
    if (open) {
      setNote('');
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
      toast.error('Add an internal note');
      return;
    }
    setSending(true);
    try {
      const fd = new FormData();
      fd.append(
        'meta',
        JSON.stringify({
          mode: 'update',
          ticketId: selectedTicket.id,
          comment: note.trim(),
          isPublic: false,
          photoIds: [...photos.selectedPhotoIds],
        }),
      );
      const res = await fetch('/api/zendesk/photo-ticket', { method: 'POST', body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || `Could not send note (HTTP ${res.status})`);
        return;
      }
      toast.success(
        `Internal note${photoCount ? ` + ${photoCount} photo${photoCount === 1 ? '' : 's'}` : ''} sent to #${selectedTicket.id}`,
      );
      onClose();
    } catch {
      toast.error('Could not send note');
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
      aria-label="Send photos as an internal note"
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

        <div>
          <label
            htmlFor="photo-note-body"
            className="mb-1.5 block text-micro font-black uppercase tracking-[0.14em] text-text-soft"
          >
            Internal note
          </label>
          <textarea
            id="photo-note-body"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="Add an internal note for the team (private — not emailed to the customer)…"
            className="block w-full resize-y rounded-lg border border-border-soft bg-surface-card px-3 py-2 text-label font-medium text-text-default outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border-soft px-4 py-3">
        <p className="min-w-0 text-micro font-medium text-text-faint">
          Posts as an internal note (private).
          {selectedTicket ? ` → #${selectedTicket.id}` : ' Pick a ticket.'}
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
          Send internal note
        </Button>
      </div>
    </RightPaneOverlay>
  );
}

export default SendPhotoNoteModal;
