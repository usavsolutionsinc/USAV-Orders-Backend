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

/** Emerald confirmation banner shown once a ticket is selected/filed/linked. */
export function ClaimFiledBanner({ filedTicket, mode, linkCommitted, unlinking, onUnlink }: Props) {
  return (
    <div className="relative rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2.5">
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
            className="absolute right-2 top-2 rounded-md p-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
          />
        </HoverTooltip>
      ) : null}
      <p className="pr-8 text-micro font-black uppercase tracking-[0.14em] text-emerald-800">
        {mode === 'link' && !linkCommitted
          ? 'Existing ticket selected'
          : mode === 'link'
            ? 'Ticket linked'
            : 'Internal ticket filed'}
      </p>
      <p className="mt-1 text-label font-bold text-emerald-900">{filedTicket.number}</p>
      {filedTicket.url ? (
        <a
          href={filedTicket.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-micro font-bold uppercase tracking-wider text-emerald-700 hover:text-emerald-900"
        >
          Open in Zendesk ↗
        </a>
      ) : null}
      <p className="mt-1.5 text-micro font-medium text-emerald-800/80">
        The seller message below will reference this case # for full context.
      </p>
    </div>
  );
}
