import { ChevronDown, ChevronUp } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import type { PreviewResponse } from './po-mailbox-types';
import { ScanControls } from './mailbox-shared';

/** Raw-preview mode: regex PO# extraction only (the legacy dry-run endpoint). */
export function RawMode({
  response, loading, query, setQuery, limit, setLimit, onRun, expanded, setExpanded,
}: {
  response: PreviewResponse | null;
  loading: boolean;
  query: string; setQuery: (s: string) => void;
  limit: number; setLimit: (n: number) => void;
  onRun: () => void;
  expanded: Record<string, boolean>;
  setExpanded: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border-soft bg-surface-card p-3 shadow-sm">
      <ScanControls query={query} setQuery={setQuery} limit={limit} setLimit={setLimit} onRun={onRun} loading={loading} actionLabel="Scan" />

      {response && (
        <div className="space-y-2">
          <div className="text-label text-text-soft">{response.count} messages · {response.elapsedMs}ms · regex extraction only</div>
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
                        ariaLabel={isOpen ? 'Collapse message' : 'Expand message'}
                        onClick={() => setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }))}
                        className="mt-0.5 shrink-0 rounded-md p-0.5 hover:bg-surface-sunken"
                        icon={isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                          <span className="truncate text-sm font-medium text-text-default">{item.subject || '(no subject)'}</span>
                          <span className="truncate text-label text-text-soft">{item.from}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-text-soft">
                          <span>{item.date || new Date(Number(item.internalDate)).toLocaleString()}</span>
                          {item.extracted.all.length === 0 ? (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">no PO# detected</span>
                          ) : (
                            item.extracted.all.map((n) => (
                              <span key={n} className={`rounded px-1.5 py-0.5 font-mono ${item.extracted.labeled.includes(n) ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-sunken text-text-muted'}`}>
                                {n}
                              </span>
                            ))
                          )}
                        </div>
                        {isOpen && (
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-soft bg-surface-canvas px-2.5 py-2 text-[11.5px] text-text-muted">
                            {item.bodyPreview || '(empty body)'}
                            {item.bodyTruncated && (
                              <span className="block pt-2 text-text-faint">… truncated at 800 chars (full body is {item.bodyLength} chars)</span>
                            )}
                          </pre>
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
