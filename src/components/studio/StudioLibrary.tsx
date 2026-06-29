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
import { Button } from '@/design-system/primitives/Button';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { Diagnostic, StudioGraphResponse, StudioTemplateSummary } from './studio-types';

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
  templates = [],
  canManage = false,
  importingTemplateId = null,
  onImportTemplate,
}: {
  palette: StudioGraphResponse['palette'];
  diagnostics: Diagnostic[];
  /** Draft edit mode: palette items become click-to-add. */
  editable?: boolean;
  onAddNode?: (type: string) => void;
  onFocusIssue: (nodeId: string) => void;
  /** System-owned blueprints to clone (ST6 / Phase E4). */
  templates?: StudioTemplateSummary[];
  /** studio.manage: shows the Import action (cloning creates a draft). */
  canManage?: boolean;
  /** The template whose import is in flight (its card shows a spinner). */
  importingTemplateId?: number | null;
  onImportTemplate?: (templateId: number) => void;
}) {
  const issues = diagnostics.filter((d) => d.severity !== 'info');
  return (
    <div className="space-y-5 p-4">
      <section>
        <h3 className="mb-2 text-micro font-bold uppercase tracking-wider text-slate-400">Node types</h3>
        {palette.length === 0 ? (
          <p className="text-xs text-slate-400">No node types registered.</p>
        ) : (
          <div className="space-y-3">
            {CATEGORY_ORDER.filter((cat) => palette.some((p) => p.category === cat)).map((cat) => (
              <div key={cat}>
                <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-slate-300">
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
                          <span className="ml-auto truncate font-mono text-eyebrow text-slate-400">
                            {editable ? '+ add' : p.type}
                          </span>
                        </>
                      );
                      return (
                        <HoverTooltip key={p.type} label={`Ports: ${p.outputs.map((o) => o.id).join(', ') || '—'}`} asChild>
                        <li>
                          {editable && onAddNode ? (
                            <button
                              onClick={() => onAddNode(p.type)}
                              className="ds-raw-button flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50"
                            >
                              {row}
                            </button>
                          ) : (
                            <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-1.5">
                              {row}
                            </div>
                          )}
                        </li>
                        </HoverTooltip>
                      );
                    })}
                </ul>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-micro text-slate-300">
          {editable ? 'Click a type to add it to the draft.' : 'Adding nodes unlocks on a draft.'}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-micro font-bold uppercase tracking-wider text-slate-400">Stations</h3>
        <ul className="space-y-1">
          {STATIONS.map((s) => (
            <HoverTooltip key={s.key} label={s.blurb} asChild>
              <li className="flex items-center gap-2 px-1 py-0.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="truncate text-xs font-medium text-slate-600">{s.label}</span>
              </li>
            </HoverTooltip>
          ))}
        </ul>
      </section>

      {/* ─── Templates (ST6 / Phase E4) — system blueprints to clone ─── */}
      {templates.length > 0 && (
        <section className="border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-micro font-bold uppercase tracking-wider text-slate-400">Templates</h3>
          <ul className="space-y-1.5">
            {templates.map((t) => {
              const importing = importingTemplateId === t.id;
              return (
                <li
                  key={t.id}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm"
                >
                  <div className="flex items-start gap-2">
                    <icons.LayoutTemplate className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-700">{t.name}</p>
                      {t.description && (
                        <p className="mt-0.5 line-clamp-2 text-micro leading-snug text-slate-400">
                          {t.description}
                        </p>
                      )}
                      <p className="mt-1 font-mono text-eyebrow text-slate-400">
                        {t.nodeCount} step{t.nodeCount === 1 ? '' : 's'} · {t.edgeCount} link
                        {t.edgeCount === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                  {canManage && onImportTemplate && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => onImportTemplate(t.id)}
                      disabled={importingTemplateId !== null}
                      loading={importing}
                      icon={<icons.Plus />}
                      className="mt-1.5 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-caption font-semibold text-violet-700 hover:bg-violet-100"
                    >
                      {importing ? 'Importing…' : 'Import as draft'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {!canManage && (
            <p className="mt-1.5 text-micro text-slate-300">
              Importing a template needs the manage permission.
            </p>
          )}
        </section>
      )}

      {/* ─── Issues rail (ST3) — the operation's linter output ─── */}
      <section className="border-t border-slate-100 pt-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-micro font-bold uppercase tracking-wider text-slate-400">
          Issues
          <span
            className={[
              'rounded-full px-1.5 py-0.5 text-micro font-bold',
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
                    className="ds-raw-button w-full rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-1.5 text-left transition-colors hover:border-slate-200 hover:bg-slate-100"
                  >
                    <span className={`mr-1.5 text-caption font-bold ${g.cls}`}>{g.glyph}</span>
                    <span className="text-caption leading-tight text-slate-600">{d.message}</span>
                    {d.fix && <span className="mt-0.5 block text-micro text-slate-400">↳ {d.fix}</span>}
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
