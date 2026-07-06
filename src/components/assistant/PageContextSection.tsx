'use client';

/**
 * PageContextSection — the "recently active page details" readout at the top of
 * the context rail. Read-only (Monitor region per contextual-display.md): shows
 * the page the operator is on plus its station / mode / durable selection, from
 * the same context store the assistant sends with each turn. No edit
 * affordances — the rail observes, it never mutates the page.
 */

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Layers } from '@/components/Icons';
import { useActiveAssistantContext } from '@/hooks/useAssistantContext';

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-surface-canvas px-1.5 py-0.5 text-mini font-black uppercase tracking-widest text-text-muted ring-1 ring-inset ring-border-hairline">
      {children}
    </span>
  );
}

function pathPageLabel(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean)[0];
  if (!segment) return 'Home';
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
}

export function PageContextSection() {
  const ctx = useActiveAssistantContext();
  const pathname = usePathname();
  const pageLabel = ctx?.page ?? pathPageLabel(pathname);

  return (
    <div className="px-4 py-2.5">
      <p className="text-eyebrow font-black uppercase tracking-widest text-text-faint">This page</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-mini font-black uppercase tracking-widest text-blue-700 ring-1 ring-inset ring-blue-200">
          <Layers className="h-3 w-3" /> {pageLabel}
        </span>
        {ctx?.station ? <Chip>{ctx.station}</Chip> : null}
        {ctx?.mode ? <Chip>{ctx.mode}</Chip> : null}
        {ctx?.selection ? (
          <Chip>
            {ctx.selection.kind} · {String(ctx.selection.id)}
          </Chip>
        ) : null}
      </div>
    </div>
  );
}
