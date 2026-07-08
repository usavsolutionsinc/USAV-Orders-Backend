import type { ReactNode } from 'react';
import { cn } from '@/utils/_cn';
import { FLOW_SECTION_LABEL } from '@/components/sidebar/receiving/receiving-sidebar-shared';

/** Card-level section eyebrow inside the unbox workspace (Label, Auto-match, PO items). */
export const WORKSPACE_SECTION_TITLE_CLASS =
  'text-eyebrow font-black uppercase tracking-widest text-text-faint';

/** Field label above inline editors (PO number, tracking, listing URL). */
export const WORKSPACE_FIELD_LABEL_CLASS = FLOW_SECTION_LABEL;

export function WorkspaceSectionTitle({
  children,
  className,
  as: Tag = 'span',
}: {
  children: ReactNode;
  className?: string;
  as?: 'span' | 'p' | 'h3';
}) {
  return <Tag className={cn(WORKSPACE_SECTION_TITLE_CLASS, className)}>{children}</Tag>;
}

export function WorkspaceFieldLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn(WORKSPACE_FIELD_LABEL_CLASS, 'mb-0 leading-none', className)}>{children}</span>;
}
