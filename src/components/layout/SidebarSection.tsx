import type { ElementType, ReactNode } from 'react';
import { cn } from '@/utils/_cn';
import { SIDEBAR_GUTTER, sidebarHeaderPillRowClass } from './header-shell';

export interface SidebarSectionProps {
  children: ReactNode;
  /**
   * Render as the shared 40px header band (pill rows, search rows): fixed
   * height + hairline divider + the gutter. Omit for a plain gutter-only row
   * (content, legends, lists).
   */
  band?: boolean;
  /** Extra classes — layout/visuals only. Never re-set the left padding here. */
  className?: string;
  as?: ElementType;
}

/**
 * The single source of the sidebar left gutter. Wrap EVERY sidebar section in
 * this instead of hand-writing `px-2`/`px-3` — the left edge is owned in one
 * place ({@link SIDEBAR_GUTTER}), so pills, search bars, eyebrows, and rows all
 * align on the same column across every sidebar with zero duplicated padding.
 *
 * Change the gutter once in `header-shell.ts` and every `<SidebarSection>`
 * follows. Decorative leads (icons, status dots) inset *within* their own
 * container — they never add to this gutter.
 */
export function SidebarSection({
  children,
  band = false,
  className,
  as: Tag = 'div',
}: SidebarSectionProps) {
  return (
    <Tag className={cn(band ? sidebarHeaderPillRowClass : SIDEBAR_GUTTER, className)}>
      {children}
    </Tag>
  );
}
