import { Loader2, Unlink } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import type { ClaimModalMode, FiledTicket } from '../claim-types';

interface Props {
  filedTicket: FiledTicket;
  mode: ClaimModalMode;
  linkCommitted: boolean;
  unlinking: boolean;
  onUnlink: () => void;
}

/** Ticket filed/linked row — flat section, no tinted card. */
export function ClaimFiledBanner({ filedTicket, mode, linkCommitted, unlinking, onUnlink }: Props) {
  return (
    <section className="relative space-y-1">
      {mode === 'link' ? (
        <HoverTooltip label={linkCommitted ? 'Unlink ticket' : 'Deselect ticket'} asChild>
          <IconButton
            onClick={onUnlink}
            disabled={unlinking}
            ariaLabel={linkCommitted ? 'Unlink ticket' : 'Deselect ticket'}
            icon={
              unlinking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
              ) : (
                <Unlink className="h-3.5 w-3.5 text-rose-600" />
              )
            }
            className="absolute right-0 top-0 rounded-md p-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
          />
        </HoverTooltip>
      ) : null}
      <p className="pr-8 text-micro font-black uppercase tracking-[0.14em] text-text-soft">
        {mode === 'link' && !linkCommitted
          ? 'Existing ticket selected'
          : mode === 'link'
            ? 'Ticket linked'
            : 'Internal ticket filed'}
      </p>
      <p className="text-label font-bold text-text-default">{filedTicket.number}</p>
      {filedTicket.url ? (
        <a
          href={filedTicket.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-micro font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900"
        >
          Open in Zendesk ↗
        </a>
      ) : null}
    </section>
  );
}
