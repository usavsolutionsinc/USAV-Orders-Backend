'use client';

/**
 * "Still unfound" teaching strip — shown at the bottom of a triage template for
 * an unmatched carton, cross-referencing the Unfound tab (§3.3/§3.8: unfound is
 * a cross-mode persistent todo, this strip just points at it from the workspace
 * so the operator doesn't have to remember it exists). Copy varies by intake
 * kind — see {@link PoTriageTemplate} / {@link ReturnTriageTemplate}.
 */

import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronRight } from '@/components/Icons';

export function UnfoundTodoStrip({ message }: { message: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <p className="truncate text-caption font-semibold text-amber-800">{message}</p>
      </div>
      <button
        type="button"
        onClick={() => router.push('/receiving?mode=triage&triview=unfound')}
        className="ds-raw-button inline-flex shrink-0 items-center gap-1 text-eyebrow font-black uppercase tracking-widest text-amber-700 hover:text-amber-900"
      >
        Unfound tab
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}
