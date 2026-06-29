'use client';

import { useCallback, useMemo, useState } from 'react';
import { SkuGraphCanvas } from '../SkuGraphCanvas';
import { usePartsGraph } from './usePartsGraph';
import { toPartsElements } from './partsGraphTransform';
import { PartsDetailPanel } from './PartsDetailPanel';

/**
 * Derived parts overview (Zoho `items`, classified by the `-P` suffix). Reuses
 * the shared Cytoscape `SkuGraphCanvas` in `tree` layout: base units → their
 * logical parts. Read-only; no parent pairing is asserted here.
 */
export function PartsGraphWorkspace() {
  const { data, isLoading, isError, error } = usePartsGraph();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { elements, metaById } = useMemo(
    () => toPartsElements(data?.bases ?? []),
    [data],
  );

  const selectedMeta = selectedId != null ? metaById[selectedId] ?? null : null;
  // Parts have no focus model — selection is the only interaction.
  const noop = useCallback(() => {}, []);

  const summary = data?.summary;

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-200 bg-white px-4 py-2.5 text-label">
        <span className="font-semibold text-gray-900">Parts (Zoho items · derived from “-P”)</span>
        {summary && (
          <span className="text-gray-500">
            {summary.baseCount} base units · {summary.logicalPartCount} logical parts ·{' '}
            {summary.partSkuCount} part SKUs
          </span>
        )}
        {summary && (
          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-caption font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
            {summary.reviewedCount}/{summary.logicalPartCount} reviewed
          </span>
        )}
        <span className="ml-auto text-caption text-gray-400">
          Parent pairing is a later manual phase — links here are not asserted.
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {isError ? (
            <div className="flex h-full items-center justify-center p-6">
              <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-label text-rose-700">
                Could not load the parts graph.
                <div className="mt-1 text-rose-400">{(error as Error)?.message}</div>
              </div>
            </div>
          ) : !isLoading && elements.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center">
              <p className="max-w-xs text-[13px] text-gray-400">
                No “-P” part SKUs found in the Zoho items mirror for this org. Run an items sync,
                or confirm parts use the <span className="font-mono">{'<base>-P-<n>'}</span> convention.
              </p>
            </div>
          ) : (
            <>
              <SkuGraphCanvas
                elements={elements}
                mode="tree"
                selectedId={selectedId != null ? String(selectedId) : null}
                onNodeSelect={setSelectedId}
                onNodeRecenter={noop}
              />
              {isLoading && (
                <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-white/90 px-2 py-1 text-caption text-gray-400 shadow-sm">
                  Loading…
                </div>
              )}
            </>
          )}
        </div>

        <PartsDetailPanel meta={selectedMeta} />
      </div>
    </div>
  );
}
