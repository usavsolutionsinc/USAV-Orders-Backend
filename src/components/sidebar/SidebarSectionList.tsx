'use client';

import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import type { ReactNode } from 'react';

export interface SidebarSection<TId extends string = string> {
  id: TId;
  label: string;
  description?: string;
  icon?: ReactNode;
  /** Optional group label — rows are rendered grouped, with the label shown as a small uppercase heading above the first row of each group. */
  group?: string;
  /** Permission string required to see this row. Filtering is done by the caller. */
  requires?: string;
}

interface SidebarSectionListProps<TId extends string = string> {
  sections: SidebarSection<TId>[];
  active: TId | null;
  onSelect: (id: TId) => void;
  /** Optional aria-label for the nav landmark. */
  ariaLabel?: string;
  /**
   * Horizontal padding for rows + group headers. Defaults to the shared
   * {@link SIDEBAR_GUTTER}. Override (e.g. `px-3`) to line rows up with a
   * MasterNavHeader above the panel.
   */
  gutterClassName?: string;
}

interface RenderItem<TId extends string> {
  type: 'group' | 'section';
  group?: string;
  section?: SidebarSection<TId>;
}

function buildRenderList<TId extends string>(sections: SidebarSection<TId>[]): RenderItem<TId>[] {
  const out: RenderItem<TId>[] = [];
  let lastGroup: string | undefined = undefined;
  for (const s of sections) {
    if (s.group && s.group !== lastGroup) {
      out.push({ type: 'group', group: s.group });
      lastGroup = s.group;
    } else if (!s.group) {
      // Reset so a later un-grouped row doesn't suppress a subsequent group header.
      lastGroup = undefined;
    }
    out.push({ type: 'section', section: s });
  }
  return out;
}

export function SidebarSectionList<TId extends string = string>({
  sections,
  active,
  onSelect,
  ariaLabel,
  gutterClassName = SIDEBAR_GUTTER,
}: SidebarSectionListProps<TId>) {
  const items = buildRenderList(sections);

  return (
    <nav className="h-full overflow-y-auto" aria-label={ariaLabel}>
      {items.map((item, idx) => {
        if (item.type === 'group') {
          return (
            <div
              key={`group:${item.group}:${idx}`}
              className={`border-b border-border-hairline bg-surface-canvas ${gutterClassName} py-1.5 text-micro font-semibold uppercase tracking-wide text-text-soft`}
            >
              {item.group}
            </div>
          );
        }
        const s = item.section!;
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-current={isActive ? 'page' : undefined}
            className={`ds-raw-button group flex w-full items-start gap-3 border-b border-border-hairline ${gutterClassName} py-3 text-left transition ${
              isActive ? 'bg-blue-50 text-blue-700' : 'text-text-default hover:bg-surface-hover'
            }`}
          >
            {s.icon && (
              // w-5 box (= the MasterNavHeader icon width) with the glyph centered
              // so the row icon's center lines up under the header icon, not its left edge.
              <span className={`mt-0.5 flex w-5 shrink-0 justify-center ${isActive ? 'text-blue-600' : 'text-text-faint'}`}>
                {s.icon}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{s.label}</span>
              {s.description && (
                <span className="block truncate text-caption font-medium text-text-soft">
                  {s.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
