'use client';

/**
 * Config Sheet — Source / Display / Actions, opened on add and on ⚙.
 * Nothing in it is bespoke per block: every control renders from the three
 * registries (the block's roles + configSchema, the source's filters + shape,
 * the action registry's compatibility matching).
 */

import { useEffect, useMemo, useState } from 'react';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { Button } from '@/design-system/primitives';
import { useAuth } from '@/contexts/AuthContext';
import { getBlock, listDataSourceMeta, getDataSource, actionsForSource } from '@/lib/stations';
import type { BlockInstanceConfig, DataSourceMeta } from '@/lib/stations/contract';
import { StationIcon } from './station-icons';

type Tab = 'source' | 'display' | 'actions';

interface BlockConfigSheetProps {
  open: boolean;
  instance: BlockInstanceConfig | null;
  onClose: () => void;
  onApply: (updated: BlockInstanceConfig) => void;
}

const selectClass =
  'h-8 w-full cursor-pointer appearance-none rounded-md border border-gray-200 bg-white px-2 text-caption font-semibold text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
const labelClass = 'mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500';

/** Pre-fill role→field mapping by kind match, falling back to the first field. */
function autoMapping(blockType: string, source: DataSourceMeta): Record<string, string> {
  const block = getBlock(blockType);
  if (!block) return {};
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const role of block.roles) {
    const byKind = role.kind ? source.shape.find((f) => f.kind === role.kind && !used.has(f.key)) : undefined;
    const pick = byKind ?? source.shape.find((f) => !used.has(f.key));
    if (pick) {
      mapping[role.key] = pick.key;
      used.add(pick.key);
    }
  }
  return mapping;
}

export function BlockConfigSheet({ open, instance, onClose, onApply }: BlockConfigSheetProps) {
  const { has } = useAuth();
  const [tab, setTab] = useState<Tab>('source');
  const [work, setWork] = useState<BlockInstanceConfig | null>(null);

  useEffect(() => {
    if (open && instance) {
      setWork(structuredClone(instance));
      setTab('source');
    }
  }, [open, instance]);

  const block = work ? getBlock(work.block) : undefined;
  const sourceMeta = useMemo(
    () => listDataSourceMeta().find((s) => s.id === work?.source?.id),
    [work?.source?.id],
  );
  const compatibleActions = useMemo(
    () => (sourceMeta ? actionsForSource(sourceMeta) : []),
    [sourceMeta],
  );

  if (!work || !block) return null;

  const needsSource = block.accepts !== 'none';
  const tabs: Tab[] = needsSource ? ['source', 'display', 'actions'] : ['display'];

  const setSource = (id: string) => {
    const meta = listDataSourceMeta().find((s) => s.id === id);
    if (!meta) return;
    const defaults: Record<string, unknown> = {};
    for (const f of meta.filters ?? []) if (f.default !== undefined) defaults[f.key] = f.default;
    setWork({
      ...work,
      source: { id, filters: defaults, fields: autoMapping(work.block, meta) },
      // Bound actions don't survive a source swap — compatibility changes.
      actions: [],
      done_when: null,
    });
  };

  const setFilter = (key: string, value: unknown) =>
    setWork({
      ...work,
      source: work.source
        ? { ...work.source, filters: { ...(work.source.filters ?? {}), [key]: value } }
        : work.source,
    });

  const setField = (role: string, fieldKey: string) =>
    setWork({
      ...work,
      source: work.source
        ? { ...work.source, fields: { ...(work.source.fields ?? {}), [role]: fieldKey } }
        : work.source,
    });

  const setDisplay = (key: string, value: unknown) =>
    setWork({ ...work, display: { ...(work.display ?? {}), [key]: value } });

  const toggleAction = (id: string) => {
    const current = new Set(work.actions ?? []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    const actions = [...current];
    setWork({
      ...work,
      actions,
      done_when: work.done_when && actions.includes(work.done_when) ? work.done_when : null,
    });
  };

  const applyDisabled = needsSource && !work.source?.id;

  return (
    <RightPaneOverlay open={open} onClose={onClose} align="right" width={340} aria-label="Block configuration">
      <div className="flex h-full flex-col bg-white">
        <div className="border-b border-gray-200 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-gray-600">
              <StationIcon name={block.icon} className="h-4 w-4" />
            </span>
            <h2 className="text-label font-black uppercase tracking-wider text-gray-700">{block.label}</h2>
          </div>
          <div className="mt-2 flex gap-1">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-md px-2.5 py-1 text-caption font-bold capitalize transition-colors ${
                  tab === t ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-3">
          {tab === 'source' ? (
            <>
              <div>
                <span className={labelClass}>Data source</span>
                <select
                  value={work.source?.id ?? ''}
                  onChange={(e) => setSource(e.target.value)}
                  className={selectClass}
                >
                  <option value="" disabled>
                    Choose a feed…
                  </option>
                  {listDataSourceMeta().map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {sourceMeta && !has(sourceMeta.permission) ? (
                  <p className="mt-1 text-mini font-bold text-amber-600">
                    Heads up: you don&apos;t hold {sourceMeta.permission} yourself — this block will be blank for you.
                  </p>
                ) : null}
              </div>

              {(sourceMeta?.filters ?? []).length > 0 ? (
                <div>
                  <span className={labelClass}>Filters</span>
                  <div className="space-y-2">
                    {sourceMeta!.filters!.map((f) => {
                      const value = work.source?.filters?.[f.key] ?? f.default;
                      if (f.kind === 'boolean') {
                        return (
                          <label key={f.key} className="flex items-center justify-between gap-2 text-caption font-semibold text-gray-700">
                            {f.label}
                            <input
                              type="checkbox"
                              checked={value === true || value === 'true'}
                              onChange={(e) => setFilter(f.key, e.target.checked)}
                              className="h-4 w-4 accent-blue-600"
                            />
                          </label>
                        );
                      }
                      if (f.kind === 'select') {
                        return (
                          <label key={f.key} className="block">
                            <span className={labelClass}>{f.label}</span>
                            <select
                              value={String(value ?? '')}
                              onChange={(e) => setFilter(f.key, e.target.value)}
                              className={selectClass}
                            >
                              {(f.options ?? []).map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      }
                      return (
                        <label key={f.key} className="block">
                          <span className={labelClass}>{f.label}</span>
                          <input
                            value={String(value ?? '')}
                            onChange={(e) => setFilter(f.key, e.target.value)}
                            className={selectClass}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {sourceMeta && block.roles.length > 0 ? (
                <div>
                  <span className={labelClass}>Field mapping</span>
                  <div className="space-y-2">
                    {block.roles.map((role) => (
                      <label key={role.key} className="block">
                        <span className="mb-0.5 block text-mini font-bold text-gray-500">
                          {role.label}
                          {role.required ? ' *' : ''}
                        </span>
                        <select
                          value={work.source?.fields?.[role.key] ?? ''}
                          onChange={(e) => setField(role.key, e.target.value)}
                          className={selectClass}
                        >
                          <option value="">—</option>
                          {sourceMeta.shape.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label} ({f.kind})
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === 'display' ? (
            <div className="space-y-3">
              {block.configSchema.length === 0 ? (
                <p className="text-caption font-semibold text-gray-400">This block has no display options.</p>
              ) : (
                block.configSchema.map((field) => {
                  const value = work.display?.[field.key] ?? field.default;
                  if (field.kind === 'toggle') {
                    return (
                      <label key={field.key} className="flex items-center justify-between gap-2 text-caption font-semibold text-gray-700">
                        {field.label}
                        <input
                          type="checkbox"
                          checked={value === true}
                          onChange={(e) => setDisplay(field.key, e.target.checked)}
                          className="h-4 w-4 accent-blue-600"
                        />
                      </label>
                    );
                  }
                  if (field.kind === 'select') {
                    return (
                      <label key={field.key} className="block">
                        <span className={labelClass}>{field.label}</span>
                        <select
                          value={String(value ?? '')}
                          onChange={(e) => setDisplay(field.key, e.target.value)}
                          className={selectClass}
                        >
                          {(field.options ?? []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }
                  return (
                    <label key={field.key} className="block">
                      <span className={labelClass}>{field.label}</span>
                      <input
                        value={String(value ?? '')}
                        onChange={(e) => setDisplay(field.key, e.target.value)}
                        className={selectClass}
                      />
                    </label>
                  );
                })
              )}
            </div>
          ) : null}

          {tab === 'actions' ? (
            <div className="space-y-3">
              {!sourceMeta ? (
                <p className="text-caption font-semibold text-gray-400">Bind a data source first.</p>
              ) : compatibleActions.length === 0 ? (
                <p className="text-caption font-semibold text-gray-400">No registered actions match this source.</p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {compatibleActions.map((a) => {
                      const checked = (work.actions ?? []).includes(a.id);
                      const permitted = has(a.permission);
                      return (
                        <label
                          key={a.id}
                          className="flex items-start gap-2 rounded-lg border border-gray-200 px-2.5 py-2"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAction(a.id)}
                            className="mt-0.5 h-4 w-4 accent-blue-600"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-label font-bold text-gray-800">{a.label}</span>
                            <span className="mt-0.5 inline-flex rounded bg-gray-50 px-1 py-px font-mono text-mini font-bold text-gray-500 ring-1 ring-inset ring-gray-200">
                              {a.permission}
                            </span>
                            {!permitted ? (
                              <span className="mt-0.5 block text-mini font-bold text-amber-600">
                                Staff without this permission won&apos;t see the button (the builder never grants it).
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <label className="block">
                    <span className={labelClass}>Completed when</span>
                    <select
                      value={work.done_when ?? ''}
                      onChange={(e) => setWork({ ...work, done_when: e.target.value || null })}
                      className={selectClass}
                    >
                      <option value="">Manual tick</option>
                      {(work.actions ?? []).map((id) => {
                        const a = compatibleActions.find((c) => c.id === id);
                        return (
                          <option key={id} value={id}>
                            {a?.label ?? id} succeeds
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-3 py-2.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={applyDisabled}
            onClick={() => {
              onApply(work);
              onClose();
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </RightPaneOverlay>
  );
}
