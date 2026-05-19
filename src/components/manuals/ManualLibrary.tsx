'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FileText, Loader2, ExternalLink } from '@/components/Icons';
import { microBadge, tableHeader } from '@/design-system/tokens/typography/presets';

interface ManualDetail {
  id: number;
  sku: string | null;
  item_number: string | null;
  product_title: string | null;
  display_name: string | null;
  google_file_id: string | null;
  source_url: string | null;
  relative_path: string | null;
  folder_path: string | null;
  file_name: string | null;
  status: string;
  type: string | null;
}

function manualHref(m: Pick<ManualDetail, 'source_url' | 'google_file_id'>): string | null {
  if (m.source_url) return m.source_url;
  if (m.google_file_id) return `https://docs.google.com/document/d/${m.google_file_id}`;
  return null;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'unassigned': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'assigned':   return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'archived':   return 'bg-gray-100 text-gray-500 border-gray-200';
    default:           return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

function typeBadgeClass(type: string | null): string {
  switch ((type || '').toLowerCase()) {
    case 'manual':          return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'troubleshooting': return 'bg-red-50 text-red-700 border-red-200';
    case 'installation':    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'quick-start':     return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'safety':          return 'bg-orange-50 text-orange-700 border-orange-200';
    default:                return 'bg-gray-50 text-gray-600 border-gray-200';
  }
}

export function ManualLibrary() {
  const searchParams = useSearchParams();
  const idParam = searchParams.get('id');
  const id = idParam ? Number(idParam) : null;
  const [manual, setManual] = useState<ManualDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setManual(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/product-manuals?id=${id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        // The CRUD handler returns the row directly (or an error object)
        if (data && typeof data === 'object' && 'id' in data) setManual(data as ManualDetail);
        else setManual(null);
      })
      .catch(() => {
        if (!cancelled) setManual(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id) return <EmptyViewer />;
  if (loading && !manual) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-50">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }
  if (!manual) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-gray-50 px-8 text-center">
        <FileText className="mb-3 h-10 w-10 text-gray-300" />
        <p className={`${tableHeader} text-gray-500`}>Manual not found</p>
      </div>
    );
  }
  return <ManualViewer manual={manual} />;
}

function ManualViewer({ manual }: { manual: ManualDetail }) {
  const href = manualHref(manual);
  const isBlobPdf = !!manual.source_url;

  return (
    <div className="flex h-full w-full flex-col bg-gray-50">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-black text-gray-900">
            {manual.display_name || manual.file_name || `Manual #${manual.id}`}
          </p>
          {manual.product_title && (
            <p className="mt-0.5 truncate text-[11px] font-medium text-gray-500">
              {manual.product_title}
            </p>
          )}
          {manual.relative_path && (
            <p className="mt-1 truncate font-mono text-[10px] text-gray-400">{manual.relative_path}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`${microBadge} rounded-full border px-2 py-1 ${statusBadgeClass(manual.status)}`}>
            {manual.status}
          </span>
          {manual.type && (
            <span className={`${microBadge} rounded-full border px-2 py-1 ${typeBadgeClass(manual.type)}`}>
              {manual.type}
            </span>
          )}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-gray-800"
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </a>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-gray-100">
        {isBlobPdf && href ? (
          <iframe
            key={manual.id}
            src={`${href}#toolbar=1&navpanes=0`}
            title={manual.display_name || `Manual ${manual.id}`}
            className="h-full w-full border-0 bg-white"
          />
        ) : href ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <FileText className="mb-3 h-10 w-10 text-gray-300" />
            <p className={`${tableHeader} text-gray-500`}>Preview unavailable for this source</p>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-gray-800"
            >
              <ExternalLink className="h-3 w-3" /> Open in new tab
            </a>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <FileText className="mb-3 h-10 w-10 text-gray-300" />
            <p className={`${tableHeader} text-gray-500`}>No file URL on this manual</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyViewer() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gray-50 px-8 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
        <FileText className="h-6 w-6 text-gray-300" />
      </div>
      <p className="text-[14px] font-black text-gray-900">Select a manual to preview</p>
      <p className="mt-1 max-w-sm text-[11px] font-medium text-gray-500">
        Use the sidebar to search by product title, folder, or file name. PDFs render inline.
      </p>
    </div>
  );
}
