'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FileText, ExternalLink } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';

interface ProductManual {
  id: number;
  sku: string | null;
  item_number: string | null;
  product_title: string | null;
  google_doc_id: string;
  type: string | null;
  updated_at: string | null;
}

function formatDate(raw: string | null): string {
  if (!raw) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(raw));
  } catch {
    return raw;
  }
}

function ManualDetailPanel({ manual }: { manual: ProductManual }) {
  const title = manual.product_title || manual.sku || manual.item_number || `Manual #${manual.id}`;
  const docUrl = manual.google_doc_id
    ? `https://docs.google.com/document/d/${manual.google_doc_id}/preview`
    : null;

  return (
    <div className="h-full flex flex-col bg-white">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderRowClass} items-start px-6`}>
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-600 mb-1">Product Manual</p>
          <h2 className="text-lg font-black tracking-tight text-gray-900 leading-tight">{title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {manual.sku && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-gray-100 text-[9px] font-black uppercase tracking-wider text-gray-600">
                SKU: {manual.sku}
              </span>
            )}
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
        {manual.google_doc_id && (
          <a
            href={`https://docs.google.com/document/d/${manual.google_doc_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-gray-900 text-white text-[10px] font-black uppercase tracking-wider hover:bg-black transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open
          </a>
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
            <div className="w-16 h-16 rounded-3xl bg-gray-100 flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400">No document linked</p>
            <p className="mt-1 text-[10px] font-medium text-gray-300">This manual has no Google Doc attached yet.</p>
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
        <div className="w-14 h-14 rounded-3xl bg-gray-100 flex items-center justify-center mb-3">
          <FileText className="w-6 h-6 text-gray-400" />
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">No manuals found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Product Title</th>
            <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">SKU</th>
            <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Item #</th>
            <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Type</th>
            <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Updated</th>
            <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.25em] text-gray-400">Doc</th>
          </tr>
        </thead>
        <tbody>
          {manuals.map((manual) => {
            const isSelected = selectedId === manual.id;
            return (
              <tr
                key={manual.id}
                onClick={() => onSelect(manual)}
                className={`border-b border-gray-50 cursor-pointer transition-colors group ${
                  isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-black tracking-tight ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                    {manual.product_title || <span className="text-gray-400 font-medium">—</span>}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-bold text-gray-500 font-mono">
                    {manual.sku || <span className="text-gray-300">—</span>}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-bold text-gray-500 font-mono">
                    {manual.item_number || <span className="text-gray-300">—</span>}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {manual.type ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-blue-50 text-[9px] font-black uppercase tracking-wider text-blue-600">
                      {manual.type}
                    </span>
                  ) : (
                    <span className="text-gray-300 text-[10px]">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-medium text-gray-400">{formatDate(manual.updated_at)}</span>
                </td>
                <td className="px-4 py-3">
                  {manual.google_doc_id ? (
                    <a
                      href={`https://docs.google.com/document/d/${manual.google_doc_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open
                    </a>
                  ) : (
                    <span className="text-gray-300 text-[10px]">—</span>
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
  const searchParams = useSearchParams();
  const query = searchParams.get('q') || '';
  const selectedId = searchParams.get('id') ? Number(searchParams.get('id')) : null;

  const [manuals, setManuals] = useState<ProductManual[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedManual, setSelectedManual] = useState<ProductManual | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        params.set('limit', '200');
        const res = await fetch(`/api/product-manuals/search?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.success && Array.isArray(data.manuals) && !cancelled) {
          setManuals(data.manuals);
          if (selectedId) {
            const found = data.manuals.find((m: ProductManual) => m.id === selectedId);
            if (found) setSelectedManual(found);
          }
        }
      } catch (_error) {
        // no-op
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [query, selectedId]);

  const handleSelect = (manual: ProductManual) => {
    setSelectedManual(manual);
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-gray-50">
      <div className={`flex flex-col min-w-0 overflow-hidden transition-all duration-300 ${selectedManual ? 'flex-1' : 'w-full'}`}>
        {/* Page header */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-gray-400 mb-0.5">Library</p>
              <h1 className="text-xl font-black tracking-tight text-gray-900">Product Manuals</h1>
            </div>
            <div className="text-right">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">
                {isLoading ? 'Loading…' : `${manuals.length} result${manuals.length !== 1 ? 's' : ''}`}
              </p>
              {query && (
                <p className="text-[10px] font-bold text-blue-600 mt-0.5">for "{query}"</p>
              )}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center space-y-3">
                <div className="w-10 h-10 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Loading manuals…</p>
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
          <ManualDetailPanel manual={selectedManual} />
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
