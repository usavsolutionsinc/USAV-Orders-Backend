import { microBadge } from '@/design-system/tokens/typography/presets';
import type { SearchItem } from './ecwid-search-shared';

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
}

export function ModeButton({ active, onClick, label }: ModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ds-raw-button ${microBadge} rounded px-2 py-1 transition-colors ${
        active
          ? 'bg-blue-100 text-blue-700'
          : 'text-text-soft hover:bg-surface-sunken'
      }`}
    >
      {label}
    </button>
  );
}

interface ResultRowProps {
  item: SearchItem;
  showOrderMeta?: boolean;
  isSubmitting: boolean;
  disabled: boolean;
  onSelect: (item: SearchItem) => void;
}

export function ResultRow({ item, showOrderMeta, isSubmitting, disabled, onSelect }: ResultRowProps) {
  const platforms = item.platform_ids?.filter((p) => p?.platform) ?? [];
  const displaySku = item.sku ?? item.zoho_sku ?? '—';

  return (
    <li role="option" aria-selected={false}>
      <button
        type="button"
        disabled={disabled || isSubmitting}
        onClick={() => onSelect(item)}
        className="ds-raw-button flex w-full items-center gap-3 border-b border-border-hairline px-3 py-2 text-left transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {/* Thumbnail */}
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-border-hairline bg-surface-canvas">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image_url}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-micro text-text-faint">
              —
            </div>
          )}
        </div>

        {/* Title + SKU + platform chips */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text-default">
            {item.product_title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className="font-mono text-micro tracking-wide text-text-soft">
              {displaySku}
            </span>
            {showOrderMeta && item.order_id ? (
              <span className="text-micro font-semibold normal-case text-sky-600">
                Order #{item.order_id}
              </span>
            ) : null}
            {!showOrderMeta &&
              platforms.slice(0, 4).map((p, i) => (
                <span
                  key={`${p.platform}-${i}`}
                  className={`${microBadge} rounded bg-surface-sunken px-1.5 py-0.5 text-text-muted`}
                >
                  {p.platform}
                </span>
              ))}
          </div>
        </div>

        {isSubmitting && (
          <span className="text-micro font-bold uppercase tracking-wider text-blue-600">
            Adding…
          </span>
        )}
      </button>
    </li>
  );
}
