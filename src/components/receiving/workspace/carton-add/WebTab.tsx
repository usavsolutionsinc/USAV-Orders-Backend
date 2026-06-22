import { useCallback, useState } from 'react';
import { SearchBar } from '@/components/ui/SearchBar';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { type CartonAddSelection, type WebHit } from './carton-add-types';
import { HintBanner, ResultRow } from './carton-add-primitives';

// ─── Web tab — eBay Browse (external) ────────────────────────────────────────

export function WebTab({
  onAddLine,
  hint,
}: {
  onAddLine: (sel: CartonAddSelection) => Promise<void>;
  hint?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<WebHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await fetch('/api/sourcing/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, limit: 20 }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        results?: WebHit[];
        error?: string;
      };
      if (!res.ok || !body.success) throw new Error(body.error ?? `search failed (${res.status})`);
      setHits(body.results ?? []);
    } catch (err) {
      setHits([]);
      setError(err instanceof Error ? err.message : 'search failed');
    } finally {
      setLoading(false);
    }
  }, [query, loading]);

  const pick = useCallback(
    async (hit: WebHit, idx: number) => {
      if (submitting != null) return;
      const key = hit.externalId ?? `idx-${idx}`;
      setSubmitting(key);
      try {
        // Web hits have no internal SKU — add as a title-only line (image kept).
        await onAddLine({
          sku_platform_id_row: null,
          sku_catalog_id: null,
          sku: '',
          item_name: hit.title,
          image_url: hit.imageUrl,
        });
      } finally {
        setSubmitting(null);
      }
    },
    [onAddLine, submitting],
  );

  return (
    <>
      {hint ? <HintBanner text={hint} /> : null}
      <div className="border-b border-gray-50 px-2 pb-2 pt-2">
        <span className={`${microBadge} mb-1.5 block px-1 text-gray-400`}>eBay / web</span>
        <SearchBar
          value={query}
          onChange={setQuery}
          onSearch={() => void runSearch()}
          placeholder="Search the web for this product…"
          autoFocus
          isSearching={loading}
          variant="purple"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-label text-amber-800">{error}</div>
        ) : hits.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {hits.map((hit, idx) => (
              <li key={hit.externalId ?? idx}>
                <ResultRow
                  title={hit.title}
                  subtitle={[
                    hit.condition ? hit.condition.replace('_', ' ') : null,
                    hit.priceCents != null ? `$${(hit.priceCents / 100).toFixed(2)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  imageUrl={hit.imageUrl}
                  busy={submitting === (hit.externalId ?? `idx-${idx}`)}
                  disabled={submitting != null}
                  onClick={() => void pick(hit, idx)}
                />
              </li>
            ))}
          </ul>
        ) : searched && !loading ? (
          <p className="px-2 py-3 text-label text-gray-400">No web results.</p>
        ) : (
          <p className="px-2 py-3 text-label text-gray-400">Type a query and press Enter to search eBay.</p>
        )}
      </div>
    </>
  );
}
