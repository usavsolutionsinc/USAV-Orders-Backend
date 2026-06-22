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
      className={`${microBadge} rounded px-2 py-1 transition-colors ${
        active
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-500 hover:bg-gray-100'
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
        className="flex w-full items-center gap-3 border-b border-gray-50 px-3 py-2 text-left transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {/* Thumbnail */}
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-gray-100 bg-gray-50">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image_url}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-micro text-gray-300">
              —
            </div>
          )}
        </div>

        {/* Title + SKU + platform chips */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-900">
            {item.product_title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className="font-mono text-micro tracking-wide text-gray-500">
              {displaySku}
            </span>
            {showOrderMeta && item.order_id ? (
              <span className="text-micro font-semibold normal-case text-sky-600">
                Order #{item.order_id}
              </span>
            ) : null}
            {platforms.slice(0, 4).map((p, i) => (
              <span
                key={`${p.platform}-${i}`}
                className={`${microBadge} rounded bg-gray-100 px-1.5 py-0.5 text-gray-600`}
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
