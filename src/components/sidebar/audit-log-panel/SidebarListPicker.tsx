import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { fieldLabel } from '@/design-system/tokens/typography/presets';
import type { ListRow } from './audit-log-panel-shared';

export function SidebarListPicker({
  rows,
  selectedKey,
  onSelect,
  loading,
  error,
}: {
  rows: ListRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="m-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        ) : loading ? (
          <div className="p-4 text-center text-caption text-text-faint">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-center text-caption text-text-faint">Nothing here.</div>
        ) : (
          <ul className="divide-y divide-border-hairline">
            {rows.map((row) => {
              const isSelected = row.key === selectedKey;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.key)}
                    className={`ds-raw-button w-full ${SIDEBAR_GUTTER} py-2.5 text-left transition ${
                      isSelected
                        ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-200'
                        : 'hover:bg-surface-hover'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className={`truncate text-xs font-semibold ${fieldLabel} text-text-default`}>
                        {row.title}
                      </div>
                      {row.trailing && (
                        <div className="shrink-0 text-micro text-text-faint">{row.trailing}</div>
                      )}
                    </div>
                    {row.subtitle && (
                      <div className="truncate text-caption text-text-soft">{row.subtitle}</div>
                    )}
                    {row.meta && (
                      <div className="mt-1 text-micro text-text-soft">{row.meta}</div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
