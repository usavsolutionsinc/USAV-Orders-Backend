import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { SearchBar } from '@/components/ui/SearchBar';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { DEBOUNCE_MS, type CartonAddSelection, type CatalogItem } from './carton-add-types';
import { HintBanner, ResultRow } from './carton-add-primitives';

// ─── Item tab — internal catalog (Zoho items) ────────────────────────────────

export function ItemTab({
  onAddLine,
  hint,
}: {
  onAddLine: (sel: CartonAddSelection) => Promise<void>;
  hint?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<number | 'manual' | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (manualMode) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setError(null);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      const url = new URL('/api/sku-catalog/search', window.location.origin);
      url.searchParams.set('q', trimmed);
      url.searchParams.set('searchField', 'zoho_catalog');
      url.searchParams.set('limit', '20');
      fetch(url.toString(), { signal: controller.signal })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as {
            success?: boolean;
            items?: CatalogItem[];
            error?: string;
          };
          if (!res.ok || !body.success) throw new Error(body.error ?? `search failed (${res.status})`);
          setItems(body.items ?? []);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'AbortError') return;
          setItems([]);
          setError(err instanceof Error ? err.message : 'search failed');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, manualMode]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pick = useCallback(
    async (item: CatalogItem) => {
      const displaySku = item.sku ?? item.zoho_sku ?? '';
      if (!displaySku && !item.product_title) return;
      setSubmitting(item.id);
      try {
        await onAddLine({
          sku_platform_id_row: null,
          sku_catalog_id: item.id,
          sku: displaySku,
          item_name: item.product_title,
          image_url: item.image_url,
        });
      } finally {
        setSubmitting(null);
      }
    },
    [onAddLine],
  );

  const submitManual = useCallback(async () => {
    const trimmed = manualTitle.trim();
    if (!trimmed || submitting != null) return;
    setSubmitting('manual');
    try {
      await onAddLine({
        sku_platform_id_row: null,
        sku_catalog_id: null,
        sku: '',
        item_name: trimmed,
        image_url: null,
      });
    } finally {
      setSubmitting(null);
    }
  }, [manualTitle, onAddLine, submitting]);

  return (
    <>
      {hint ? <HintBanner text={hint} /> : null}
      <div className="border-b border-border-hairline px-2 pb-2 pt-2">
        <span className={`${microBadge} mb-1.5 block px-1 text-text-faint`}>Internal catalog</span>
        {manualMode ? (
          <div className="flex items-center gap-2 px-1">
            <input
              autoFocus
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitManual();
              }}
              placeholder="Type a product title…"
              className="flex-1 rounded-md border border-border-soft bg-surface-card px-2.5 py-1.5 text-label outline-none focus:border-blue-500"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!manualTitle.trim() || submitting != null}
              onClick={() => void submitManual()}
            >
              {submitting === 'manual' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
            </Button>
          </div>
        ) : (
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search product name or SKU…"
            autoFocus
            isSearching={loading}
            variant="blue"
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-label text-amber-800">{error}</div>
        ) : !manualMode && items.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.id}>
                <ResultRow
                  title={item.product_title}
                  subtitle={item.sku ?? item.zoho_sku ?? ''}
                  imageUrl={item.image_url}
                  busy={submitting === item.id}
                  disabled={submitting != null}
                  onClick={() => void pick(item)}
                />
              </li>
            ))}
          </ul>
        ) : !manualMode && query.trim() && !loading ? (
          <p className="px-2 py-3 text-label text-text-faint">No catalog matches.</p>
        ) : null}
      </div>
      <div className="border-t border-border-hairline px-3 py-2">
        <button
          type="button"
          onClick={() => {
            setManualMode((m) => !m);
            setManualTitle('');
          }}
          className="ds-raw-button text-mini font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900"
        >
          {manualMode ? '← Back to catalog search' : 'Product not in catalog? Add by title'}
        </button>
      </div>
    </>
  );
}
