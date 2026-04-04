'use client';

import { Suspense, useEffect, useState, type KeyboardEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FileText, ExternalLink } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';
import { formatMediumDate } from '@/utils/_date';

interface ProductManual {
  id: number;
  sku: string | null;
  item_number: string | null;
  product_title: string | null;
  display_name: string | null;
  google_file_id: string;
  type: string | null;
  updated_at: string | null;
}

function buildManualsHref(pathname: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function ManualDetailPanel({ manual, onClose }: { manual: ProductManual; onClose: () => void }) {
  const title = manual.display_name || manual.product_title || manual.item_number || `Manual #${manual.id}`;
  const docUrl = manual.google_file_id
    ? `https://docs.google.com/document/d/${manual.google_file_id}/preview`
    : null;

  return (
    <div className="h-full flex flex-col bg-white">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} px-4`}>
          <p className="truncate text-[11px] font-black uppercase tracking-[0.18em] text-gray-900">{title}</p>
          <div className="inline-flex items-center gap-1.5">
            {manual.google_file_id && (
              <a
                href={`https://docs.google.com/document/d/${manual.google_file_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 border border-gray-900 px-3 py-1 text-[9px] font-black uppercase tracking-wider text-gray-900 transition-colors hover:bg-gray-900 hover:text-white"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center border border-gray-300 px-3 py-1 text-[9px] font-black uppercase tracking-wider text-gray-700 transition-colors hover:bg-gray-100"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-gray-100 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {manual.item_number && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-gray-100 text-[9px] font-black uppercase tracking-wider text-gray-600">
              Item: {manual.item_number}
            </span>
          )}
          {manual.type && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-blue-50 text-[9px] font-black uppercase tracking-wider text-blue-600">
              {manual.type}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {docUrl ? (
          <iframe
            src={docUrl}
            title={title}
            className="w-full h-full border-0"
            allow="autoplay"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="h-16 w-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <FileText className="h-8 w-8 text-gray-500" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500">No document linked</p>
            <p className="mt-1 text-[10px] font-semibold text-gray-500">This manual has no Google Doc attached yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ManualsTable({ manuals, selectedId, onSelect }: {
  manuals: ProductManual[];
  selectedId: number | null;
  onSelect: (manual: ProductManual) => void;
}) {
  if (manuals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="h-14 w-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
          <FileText className="h-6 w-6 text-gray-500" />
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">No manuals found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.25em] text-gray-500">Manual</th>
            <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.25em] text-gray-500">Item #</th>
            <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.25em] text-gray-500">Type</th>
            <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.25em] text-gray-500">Updated</th>
            <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.25em] text-gray-500">Doc</th>
          </tr>
        </thead>
        <tbody>
          {manuals.map((manual) => {
            const isSelected = selectedId === manual.id;
            return (
              <tr
                key={manual.id}
                onClick={() => onSelect(manual)}
                onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(manual);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`Open manual ${manual.display_name || manual.product_title || manual.item_number || `#${manual.id}`}`}
                className={`border-b border-gray-50 cursor-pointer transition-colors group ${
                  isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                } focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300`}
              >
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-black tracking-tight ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                    {manual.display_name || manual.product_title || <span className="text-gray-500 font-semibold">—</span>}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-bold text-gray-500 font-mono">
                    {manual.item_number || <span className="text-gray-500">—</span>}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {manual.type ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-blue-50 text-[9px] font-black uppercase tracking-wider text-blue-600">
                      {manual.type}
                    </span>
                  ) : (
                    <span className="text-gray-500 text-[10px]">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-semibold text-gray-500">{formatMediumDate(manual.updated_at)}</span>
                </td>
                <td className="px-4 py-3">
                  {manual.google_file_id ? (
                    <a
                      href={`https://docs.google.com/document/d/${manual.google_file_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </a>
                  ) : (
                    <span className="text-gray-500 text-[10px]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ManualsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get('q') || '';
  const selectedParam = searchParams.get('id');
  const selectedId = selectedParam && Number.isFinite(Number(selectedParam)) ? Number(selectedParam) : null;

  const [manuals, setManuals] = useState<ProductManual[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedManual, setSelectedManual] = useState<ProductManual | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        params.set('limit', '200');
        const res = await fetch(`/api/product-manuals/search?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to load manuals');
        if (cancelled) return;
        const data = await res.json();
        if (data.success && Array.isArray(data.manuals) && !cancelled) {
          setManuals(data.manuals);
          return;
        }
        throw new Error('Failed to load manuals');
      } catch (_error) {
        if (cancelled) return;
        setManuals([]);
        setLoadError('Failed to load manuals.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [query, reloadKey]);

  useEffect(() => {
    if (selectedId === null) {
      setSelectedManual(null);
      return;
    }

    const found = manuals.find((manual) => manual.id === selectedId) || null;
    setSelectedManual(found);

    if (!isLoading && !found) {
      const params = new URLSearchParams(searchParams.toString());
      if (params.has('id')) {
        params.delete('id');
        router.replace(buildManualsHref(pathname, params));
      }
    }
  }, [isLoading, manuals, pathname, router, searchParams, selectedId]);

  const handleSelect = (manual: ProductManual) => {
    const params = new URLSearchParams(searchParams.toString());
    if (selectedManual?.id === manual.id) {
      setSelectedManual(null);
      params.delete('id');
      router.replace(buildManualsHref(pathname, params));
      return;
    }
    setSelectedManual(manual);
    params.set('id', String(manual.id));
    router.replace(buildManualsHref(pathname, params));
  };

  const handleCloseDetails = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('id');
    setSelectedManual(null);
    router.replace(buildManualsHref(pathname, params));
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-gray-50">
      <div className={`flex flex-col min-w-0 overflow-hidden transition-all duration-300 ${selectedManual ? 'flex-1' : 'w-full'}`}>
        {/* Page header */}
        <div className={mainStickyHeaderClass}>
          <div className={`${mainStickyHeaderShellRowClass} px-6`}>
            <p className="truncate text-[11px] font-black uppercase tracking-[0.2em] text-gray-900">Product Manuals</p>
            <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
              <span>{isLoading ? 'Loading…' : `${manuals.length} result${manuals.length !== 1 ? 's' : ''}`}</span>
              {query ? (
                <span className="max-w-[180px] truncate text-blue-600">&ldquo;{query}&rdquo;</span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center space-y-3">
                <div className="h-10 w-10 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Loading manuals…</p>
              </div>
            </div>
          ) : loadError ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-red-500">{loadError}</p>
                <button
                  type="button"
                  onClick={() => setReloadKey((current) => current + 1)}
                  className="inline-flex items-center border border-red-300 px-3 py-1 text-[9px] font-black uppercase tracking-wider text-red-700 transition-colors hover:bg-red-50"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <ManualsTable
              manuals={manuals}
              selectedId={selectedManual?.id ?? null}
              onSelect={handleSelect}
            />
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedManual && (
        <div className="w-[520px] flex-shrink-0 border-l border-gray-200 overflow-hidden">
          <ManualDetailPanel manual={selectedManual} onClose={handleCloseDetails} />
        </div>
      )}
    </div>
  );
}

export default function ManualsPage() {
  return (
    <Suspense>
      <ManualsPageContent />
    </Suspense>
  );
}
