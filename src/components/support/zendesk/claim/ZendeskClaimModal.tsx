'use client';

import { AlertCircle, ExternalLink, Image as ImageIcon, MessageSquare, Paperclip, Plus, Reply, Send, X } from '@/components/Icons';
import { MediaLibraryPickerContent } from '@/components/photos/MediaLibraryPickerContent';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { Button, IconButton } from '@/design-system/primitives';
import { ClaimComposer } from './ClaimComposer';
import { ClaimSuccessView } from './ClaimSuccessView';
import { useZendeskClaimController } from './useZendeskClaimController';
import type { ZendeskClaimModalProps } from './claim-types';

const MODE_ITEMS: HorizontalSliderItem[] = [
  { id: 'update', label: 'Update existing', icon: Reply },
  { id: 'create', label: 'New ticket', icon: Plus },
];

/**
 * Reusable Zendesk claim modal. Step 1 selects library photos; step 2 turns them
 * into a new ticket or a reply on an existing one. Uses the same
 * {@link RightPaneOverlay} shell as the receiving claim modal.
 */
export function ZendeskClaimModal(props: ZendeskClaimModalProps) {
  const c = useZendeskClaimController(props);
  const submitLabel = c.mode === 'create' ? 'Create ticket' : c.replyPublic ? 'Send reply' : 'Add note';
  const lockedToTicket = Boolean(props.defaultTicketId);
  const onPickStep = c.wizardStep === 'pick';

  return (
    <RightPaneOverlay
      open={c.open}
      onClose={c.onClose}
      align="center"
      resizable
      storageKey="zendesk-claim-modal-size"
      minWidth={480}
      minHeight={520}
      className="flex h-[min(88vh,46rem)] w-[min(94vw,40rem)] -mt-6 flex-col"
      aria-label="Create or update a support ticket"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-100">
            {onPickStep ? <ImageIcon className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
          </span>
          <div>
            <p className="text-micro font-black uppercase tracking-widest text-rose-500">
              {onPickStep ? 'Step 1 · Photos' : 'Support'}
            </p>
            <h2 className="text-[15px] font-bold tracking-tight text-gray-900">
              {c.result
                ? 'Done'
                : onPickStep
                  ? 'Select photos to attach'
                  : c.mode === 'create'
                    ? 'New support ticket'
                    : 'Update ticket'}
            </h2>
          </div>
        </div>
        <IconButton
          icon={<X className="h-4 w-4" />}
          ariaLabel="Close"
          onClick={c.onClose}
          className="-mr-1 -mt-1 rounded-lg p-1.5 hover:bg-gray-100"
        />
      </div>

      {c.result ? (
        <ClaimSuccessView result={c.result} onClose={c.onClose} />
      ) : onPickStep ? (
        <>
          <MediaLibraryPickerContent
            ticketId={props.defaultTicketId ?? undefined}
            selected={c.libraryPhotos}
            onSelectedChange={c.setLibraryPhotos}
            showScopeToggle={Boolean(props.defaultTicketId)}
          />
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-5 py-3.5">
            <a
              href="/ops/photos"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-caption font-semibold text-blue-600 hover:text-blue-800"
            >
              Open full library <ExternalLink className="h-3 w-3" />
            </a>
            <div className="flex items-center gap-2">
              <span className="text-caption text-gray-500">{c.libraryPhotos.length} selected</span>
              <Button variant="ghost" onClick={c.onClose}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!c.canContinuePick} onClick={c.continueFromPick}>
                Continue
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          {!lockedToTicket ? (
            <div className="shrink-0 overflow-visible border-b border-gray-100 px-5 pb-3 pt-3">
              <HorizontalButtonSlider
                items={MODE_ITEMS}
                value={c.mode}
                onChange={(v) => c.setMode(v as typeof c.mode)}
                variant="nav"
                dense
                overlay
                aria-label="Ticket mode"
              />
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <ClaimComposer c={c} />
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 px-5 py-3.5">
            <div className="flex items-center gap-1.5 text-caption font-semibold text-gray-400">
              <Paperclip className="h-3.5 w-3.5" />
              {c.totalAttach} attachment{c.totalAttach === 1 ? '' : 's'}
            </div>
            <div className="flex items-center gap-2">
              {c.error ? (
                <span className="hidden items-center gap-1 text-caption font-semibold text-rose-600 sm:flex">
                  <AlertCircle className="h-3.5 w-3.5" /> {c.error}
                </span>
              ) : null}
              <Button variant="ghost" onClick={() => c.setWizardStep('pick')}>
                Back
              </Button>
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
