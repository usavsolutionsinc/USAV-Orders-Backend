import { FileText, Loader2, Plus, Search } from '@/components/Icons';
import { useManualPicker } from './useManualPicker';

/** Inline manuals-library search + pair picker. */
export function ManualPicker({
  receivingLineId,
  onPaired,
}: {
  receivingLineId: number;
  onPaired: () => Promise<void>;
}) {
  const { query, setQuery, results, searching, pairingId, pair } = useManualPicker(receivingLineId, onPaired);

  return (
    <div className="mb-3 rounded-lg border border-border-soft/70 bg-surface-canvas/60 p-2">
      <div className="flex items-center gap-2 rounded-md border border-border-soft bg-surface-card px-2 py-1.5">
        <Search className="h-4 w-4 shrink-0 text-text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="Search manuals library…"
          className="w-full bg-transparent text-caption font-medium text-text-default placeholder:text-text-faint focus:outline-none"
        />
        {searching ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-faint" /> : null}
      </div>
      {results.length > 0 ? (
        <ul className="mt-1.5 flex max-h-56 flex-col gap-1 overflow-y-auto">
          {results.map((m) => {
            const name = m.display_name || m.file_name || `Manual #${m.id}`;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => void pair(m.id)}
                  disabled={pairingId === m.id}
                  className="ds-raw-button flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-card"
                >
                  <FileText className="h-4 w-4 shrink-0 text-text-faint" />
                  <span className="min-w-0 flex-1 truncate text-caption font-medium text-text-default">{name}</span>
                  {pairingId === m.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-faint" />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-blue-500" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : query.trim() && !searching ? (
        <p className="mt-2 px-2 text-caption text-text-faint">No matches.</p>
      ) : null}
    </div>
  );
}
