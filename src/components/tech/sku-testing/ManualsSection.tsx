import { useCallback, useState } from 'react';
import { ExternalLink, FileText, Plus, Printer, Unlink } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { toast } from '@/lib/toast';
import { unpairManual } from './sku-testing-api';
import { EYEBROW, SECTION, type Bundle } from './sku-testing-types';
import { ManualPicker } from './ManualPicker';

/** Paired SKU manuals — open/print, unpair, and pair a new one from the library. */
export function ManualsSection({
  receivingLineId,
  bundle,
  onChanged,
  embedded = false,
}: {
  receivingLineId: number;
  bundle: Bundle;
  onChanged: () => Promise<void>;
  /** Bare body for tab panels — drops the card chrome + section eyebrow. */
  embedded?: boolean;
}) {
  const [pairing, setPairing] = useState(false);
  const manuals = bundle.manuals;

  const unpair = useCallback(
    async (manualId: number) => {
      try {
        await unpairManual(receivingLineId, manualId);
        await onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not unpair manual');
      }
    },
    [receivingLineId, onChanged],
  );

  const Wrapper = embedded ? 'div' : 'section';

  return (
    <Wrapper className={embedded ? undefined : SECTION}>
      <div className={`mb-3 flex items-center ${embedded ? 'justify-end' : 'justify-between'}`}>
        {!embedded ? <h3 className={EYEBROW}>Manuals</h3> : null}
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus />}
          onClick={() => setPairing((v) => !v)}
          className="text-blue-600 hover:bg-blue-50 hover:text-blue-700"
        >
          Pair
        </Button>
      </div>

      {pairing ? (
        <ManualPicker
          receivingLineId={receivingLineId}
          onPaired={async () => {
            setPairing(false);
            await onChanged();
          }}
        />
      ) : null}

      {manuals.length === 0 ? (
        <p className="text-caption text-text-faint">No manuals paired to this SKU yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {manuals.map((m) => {
            const name = m.display_name || m.file_name || `Manual #${m.id}`;
            return (
              <li key={m.id} className="flex items-center gap-3 rounded-lg border border-border-soft/70 bg-surface-card px-3 py-2">
                {m.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.thumbnail_url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-border-soft" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-text-faint">
                    <FileText className="h-4 w-4" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-caption font-semibold text-text-default">{name}</span>
                  {m.type ? (
                    <span className="block text-micro font-medium uppercase tracking-wide text-text-faint">{m.type}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {m.source_url ? (
                    <HoverTooltip label="Open / print manual" asChild>
                      <a
                        href={m.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open / print manual"
                        className="rounded-md p-1.5 text-text-soft hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Printer className="h-4 w-4" />
                      </a>
                    </HoverTooltip>
                  ) : null}
                  {m.source_url ? (
                    <HoverTooltip label="Open in new tab" asChild>
                      <a
                        href={m.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open in new tab"
                        className="rounded-md p-1.5 text-text-faint hover:bg-surface-sunken hover:text-text-muted"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </HoverTooltip>
                  ) : null}
                  <HoverTooltip label="Unpair manual" asChild>
                    <IconButton
                      icon={<Unlink className="h-4 w-4" />}
                      onClick={() => void unpair(m.id)}
                      ariaLabel="Unpair manual"
                      className="rounded-md p-1.5 text-text-faint hover:bg-rose-50 hover:text-rose-600"
                    />
                  </HoverTooltip>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Wrapper>
  );
}
