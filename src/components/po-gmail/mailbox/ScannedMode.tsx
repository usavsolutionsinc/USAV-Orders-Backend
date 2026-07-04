import { ChevronDown, ChevronUp } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import type { ReconcileResponse } from './po-mailbox-types';
import { ReconcileStatusChip, ScanControls, SummaryRow } from './mailbox-shared';

/** All-scanned mode: reconcile run + per-email PO match table + body preview. */
export function ScannedMode({
  response, loading, query, setQuery, limit, setLimit, onRun, expanded, setExpanded,
}: {
  response: ReconcileResponse | null;
  loading: boolean;
  query: string; setQuery: (s: string) => void;
  limit: number; setLimit: (n: number) => void;
  onRun: () => void;
  expanded: Record<string, boolean>;
  setExpanded: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border-soft bg-surface-card p-3 shadow-sm">
      <ScanControls query={query} setQuery={setQuery} limit={limit} setLimit={setLimit} onRun={onRun} loading={loading} actionLabel="Reconcile" />

      {response && (
        <div className="space-y-2">
          <SummaryRow
            elapsedMs={response.elapsedMs}
            counts={response.counts}
            extra={response.persisted ? `· wrote ${response.persisted.upserted}, resolved ${response.persisted.resolved}` : ''}
          />
          {response.items.length === 0 ? (
            <p className="text-sm text-text-soft">No messages matched.</p>
          ) : (
            <ul className="divide-y divide-border-hairline rounded-md border border-border-soft">
              {response.items.map((item) => {
                const isOpen = !!expanded[item.id];
                return (
                  <li key={item.id} className="px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <IconButton
                        type="button"
                        onClick={() => setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }))}
                        ariaLabel={isOpen ? 'Collapse' : 'Expand'}
                        icon={isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        className="mt-0.5 shrink-0 rounded-md p-0.5 hover:bg-surface-sunken"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                          <span className="truncate text-sm font-medium text-text-default">{item.subject || '(no subject)'}</span>
                          <span className="truncate text-label text-text-soft">{item.from}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-text-soft">
                          <span>{item.date || new Date(Number(item.internalDate)).toLocaleString()}</span>
                          <span aria-hidden>·</span>
                          <ReconcileStatusChip status={item.status} />
                          {item.extracted.all.length === 0 ? (
                            <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-text-muted">no PO# extracted</span>
                          ) : (
                            item.extracted.all.map((n) => {
                              const matched = item.matchedPoNumbers.some(
                                (p) => p.replace(/[^A-Z0-9]/gi, '').toUpperCase() === n.replace(/[^A-Z0-9]/gi, '').toUpperCase(),
                              );
                              return (
                                <span key={n} className={`rounded px-1.5 py-0.5 font-mono ${matched ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                  {n}
                                </span>
                              );
                            })
                          )}
                        </div>
                        {isOpen && (
                          <div className="mt-2 space-y-2">
                            {item.matches.length > 0 && (
                              <table className="w-full border-collapse text-[11.5px]">
                                <thead className="bg-surface-canvas text-text-soft">
                                  <tr>
                                    <th className="px-2 py-1 text-left font-medium">PO#</th>
                                    <th className="px-2 py-1 text-left font-medium">Status</th>
                                    <th className="px-2 py-1 text-left font-medium">SKU / Item</th>
                                    <th className="px-2 py-1 text-right font-medium">Qty exp</th>
                                    <th className="px-2 py-1 text-right font-medium">Qty recv</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {item.matches.map((m, i) => (
                                    <tr key={`${m.zoho_purchaseorder_id}-${i}`} className="border-t border-border-hairline">
                                      <td className="px-2 py-1 font-mono">{m.zoho_purchaseorder_number ?? '—'}</td>
                                      <td className="px-2 py-1">{m.workflow_status}</td>
                                      <td className="px-2 py-1 truncate">{m.sku ?? m.item_name ?? '—'}</td>
                                      <td className="px-2 py-1 text-right">{m.quantity_expected ?? '—'}</td>
                                      <td className="px-2 py-1 text-right">{m.quantity_received ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-soft bg-surface-canvas px-2.5 py-2 text-[11.5px] text-text-muted">
                              {item.bodyPreview || '(empty body)'}
                              {item.bodyTruncated && (
                                <span className="block pt-2 text-text-faint">… truncated at 800 chars (full body is {item.bodyLength} chars)</span>
                              )}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
