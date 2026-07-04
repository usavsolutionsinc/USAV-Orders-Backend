import { Copy as CopyIcon } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { copyValue } from './incoming-details-shared';

// ── Tab subcomponents ──────────────────────────────────────────────────────
export function Row({ label, value, copyValue: cv }: { label: string; value: React.ReactNode; copyValue?: string | null }) {
  return (
    <div className="flex items-start gap-3 border-b border-border-hairline py-2 last:border-b-0">
      <span className="w-36 shrink-0 text-eyebrow font-black uppercase tracking-wider text-text-soft">
        {label}
      </span>
      <div className="min-w-0 flex-1 break-words text-caption font-semibold text-text-default">
        {value}
      </div>
      {cv ? (
        <HoverTooltip label={`Copy ${label}`} asChild>
          <IconButton
            onClick={() => copyValue(cv, label)}
            className="shrink-0"
            ariaLabel={`Copy ${label}`}
            icon={<CopyIcon className="h-3 w-3" />}
          />
        </HoverTooltip>
      ) : null}
    </div>
  );
}

export function Empty({ msg }: { msg: string }) {
  return (
    <div className="flex h-32 items-center justify-center px-4 text-center text-caption font-medium text-text-faint">
      {msg}
    </div>
  );
}
