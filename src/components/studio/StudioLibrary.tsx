'use client';

/**
 * StudioLibrary — the left pane. Registry-driven (never hard-codes a node
 * type): lists every registered engine node type grouped by category, plus
 * the operations-catalog stations as L0 reference. Read-only in ST1 —
 * drag-to-add unlocks with the editable canvas (ST4); at L2 this pane
 * switches to blocks (ST5).
 */

import { icons } from 'lucide-react';
import { STATIONS } from '@/components/admin/workflow/operations-catalog';
import type { Diagnostic, StudioGraphResponse } from './studio-types';

const SEVERITY_GLYPH: Record<Diagnostic['severity'], { glyph: string; cls: string }> = {
  error: { glyph: '✖', cls: 'text-rose-600' },
  warning: { glyph: '⚠', cls: 'text-amber-600' },
  info: { glyph: 'ⓘ', cls: 'text-slate-400' },
};

const CATEGORY_ORDER = ['intake', 'process', 'fulfill', 'logic', 'custom'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  intake: 'Intake',
  process: 'Process',
  fulfill: 'Fulfill',
  logic: 'Logic',
  custom: 'Custom',
};

export function StudioLibrary({
  palette,
  diagnostics,
  editable = false,
  onAddNode,
  onFocusIssue,
}: {
  palette: StudioGraphResponse['palette'];
  diagnostics: Diagnostic[];
  /** Draft edit mode: palette items become click-to-add. */
  editable?: boolean;
  onAddNode?: (type: string) => void;
  onFocusIssue: (nodeId: string) => void;
}) {
  const issues = diagnostics.filter((d) => d.severity !== 'info');
  return (
    <div className="space-y-5 p-4">
      <section>
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Node types</h3>
        {palette.length === 0 ? (
          <p className="text-xs text-slate-400">No node types registered.</p>
        ) : (
          <div className="space-y-3">
            {CATEGORY_ORDER.filter((cat) => palette.some((p) => p.category === cat)).map((cat) => (
              <div key={cat}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                  {CATEGORY_LABELS[cat]}
                </p>
                <ul className="space-y-1">
                  {palette
                    .filter((p) => p.category === cat)
                    .map((p) => {
                      const Icon =
                        (icons as Record<string, React.ComponentType<{ className?: string }>>)[p.icon] || icons.Box;
                      const row = (
                        <>
                          <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                          <span className="truncate text-xs font-semibold text-slate-700">{p.label}</span>
                          <span className="ml-auto truncate font-mono text-[9px] text-slate-400">
                            {editable ? '+ add' : p.type}
                          </span>
                        </>
                      );
                      return (
                        <li key={p.type} title={`Ports: ${p.outputs.map((o) => o.id).join(', ') || '—'}`}>
                          {editable && onAddNode ? (
                            <button
                              onClick={() => onAddNode(p.type)}
                              className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50"
                            >
                              {row}
                            </button>
                          ) : (
                            <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-1.5">
                              {row}
                            </div>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] text-slate-300">
          {editable ? 'Click a type to add it to the draft.' : 'Adding nodes unlocks on a draft.'}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Stations</h3>
        <ul className="space-y-1">
          {STATIONS.map((s) => (
            <li key={s.key} className="flex items-center gap-2 px-1 py-0.5" title={s.blurb}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="truncate text-xs font-medium text-slate-600">{s.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── Issues rail (ST3) — the operation's linter output ─── */}
      <section className="border-t border-slate-100 pt-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Issues
          <span
            className={[
              'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
              issues.some((d) => d.severity === 'error')
                ? 'bg-rose-100 text-rose-700'
                : issues.length
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-emerald-100 text-emerald-700',
            ].join(' ')}
          >
            {issues.length}
          </span>
        </h3>
        {issues.length === 0 ? (
          <p className="text-xs text-emerald-600">No gaps — the flow lints clean.</p>
        ) : (
          <ul className="space-y-1.5">
            {issues.map((d) => {
              const g = SEVERITY_GLYPH[d.severity];
              return (
                <li key={d.id}>
                  <button
                    onClick={() => d.nodeId && onFocusIssue(d.nodeId)}
                    className="w-full rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-1.5 text-left transition-colors hover:border-slate-200 hover:bg-slate-100"
                  >
                    <span className={`mr-1.5 text-[11px] font-bold ${g.cls}`}>{g.glyph}</span>
                    <span className="text-[11px] leading-tight text-slate-600">{d.message}</span>
                    {d.fix && <span className="mt-0.5 block text-[10px] text-slate-400">↳ {d.fix}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
