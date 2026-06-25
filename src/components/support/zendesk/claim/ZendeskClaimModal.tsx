'use client';

import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { AlertCircle, MessageSquare, Paperclip, Send, X } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { ClaimComposer } from './ClaimComposer';
import { ClaimSuccessView } from './ClaimSuccessView';
import { useZendeskClaimController } from './useZendeskClaimController';
import type { ZendeskClaimModalProps } from './claim-types';

const MODE_ITEMS = [
  { id: 'create', label: 'New ticket' },
  { id: 'update', label: 'Update existing' },
];

/**
 * Reusable Zendesk claim modal. Turns a selection of library photos into a new
 * ticket or a reply on an existing one, attaching them as real Zendesk
 * attachments. Reuses the `RightPaneOverlay` shell (drag-to-resize + persisted
 * size) — the same primitive the receiving claim modal uses.
 */
export function ZendeskClaimModal(props: ZendeskClaimModalProps) {
  const c = useZendeskClaimController(props);
  const submitLabel = c.mode === 'create' ? 'Create ticket' : c.replyPublic ? 'Send reply' : 'Add note';
  const lockedToTicket = Boolean(props.defaultTicketId);

  return (
    <RightPaneOverlay
      open={c.open}
      onClose={c.onClose}
      align="center"
      resizable
      storageKey="zendesk-claim-modal-size"
      minWidth={480}
      minHeight={520}
      className="h-[min(88vh,46rem)] w-[min(94vw,40rem)] -mt-6"
      aria-label="Create or update a Zendesk ticket"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-100">
            <MessageSquare className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-500">Zendesk</p>
            <h2 className="text-[15px] font-bold tracking-tight text-gray-900">
              {c.result ? 'Done' : c.mode === 'create' ? 'New support ticket' : 'Update ticket'}
            </h2>
          </div>
        </div>
        <button
          type="button"
          onClick={c.onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {c.result ? (
        <ClaimSuccessView result={c.result} onClose={c.onClose} />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!lockedToTicket ? (
              <HorizontalButtonSlider
                items={MODE_ITEMS}
                value={c.mode}
                onChange={(v) => c.setMode(v as typeof c.mode)}
                variant="segmented"
                className="mb-5"
                aria-label="Ticket mode"
              />
            ) : null}
            <ClaimComposer c={c} />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400">
              <Paperclip className="h-3.5 w-3.5" />
              {c.totalAttach} attachment{c.totalAttach === 1 ? '' : 's'}
            </div>
            <div className="flex items-center gap-2">
              {c.error ? (
                <span className="hidden items-center gap-1 text-[11px] font-semibold text-rose-600 sm:flex">
                  <AlertCircle className="h-3.5 w-3.5" /> {c.error}
                </span>
              ) : null}
              <Button variant="ghost" onClick={c.onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={c.submitting}
                disabled={!c.canSubmit}
                onClick={c.submit}
                icon={<Send className="h-4 w-4" />}
              >
                {submitLabel}
              </Button>
            </div>
          </div>
        </>
      )}
    </RightPaneOverlay>
  );
}
