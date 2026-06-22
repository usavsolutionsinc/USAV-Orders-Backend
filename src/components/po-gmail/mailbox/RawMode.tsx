import { ChevronDown, ChevronUp } from '@/components/Icons';
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
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <ScanControls query={query} setQuery={setQuery} limit={limit} setLimit={setLimit} onRun={onRun} loading={loading} actionLabel="Scan" />

      {response && (
        <div className="space-y-2">
          <div className="text-label text-gray-500">{response.count} messages · {response.elapsedMs}ms · regex extraction only</div>
          {response.items.length === 0 ? (
            <p className="text-sm text-gray-500">No messages matched.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {response.items.map((item) => {
                const isOpen = !!expanded[item.id];
                return (
                  <li key={item.id} className="px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }))}
                        className="mt-0.5 shrink-0 rounded-md p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                          <span className="truncate text-sm font-medium text-gray-900">{item.subject || '(no subject)'}</span>
                          <span className="truncate text-label text-gray-500">{item.from}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
                          <span>{item.date || new Date(Number(item.internalDate)).toLocaleString()}</span>
                          {item.extracted.all.length === 0 ? (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">no PO# detected</span>
                          ) : (
                            item.extracted.all.map((n) => (
                              <span key={n} className={`rounded px-1.5 py-0.5 font-mono ${item.extracted.labeled.includes(n) ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}>
                                {n}
                              </span>
                            ))
                          )}
                        </div>
                        {isOpen && (
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11.5px] text-gray-700">
                            {item.bodyPreview || '(empty body)'}
                            {item.bodyTruncated && (
                              <span className="block pt-2 text-gray-400">… truncated at 800 chars (full body is {item.bodyLength} chars)</span>
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
