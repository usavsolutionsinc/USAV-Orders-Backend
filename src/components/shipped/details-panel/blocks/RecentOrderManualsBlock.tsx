'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2 } from '@/components/Icons';

interface ProductManualRecord {
  id: number;
  display_name: string | null;
  product_title: string | null;
  relative_path: string | null;
  folder_path: string | null;
  file_name: string | null;
  source_url: string | null;
  updated_at: string | null;
}

interface RecentOrderManualsBlockProps {
  sku?: string | null;
  itemNumber?: string | null;
  rowSource?: 'order' | 'exception';
}

export function RecentOrderManualsBlock({
  itemNumber,
  rowSource = 'order',
}: RecentOrderManualsBlockProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [manuals, setManuals] = useState<ProductManualRecord[]>([]);
  const [folderPath, setFolderPath] = useState('');

  const normalizedItemNumber = useMemo(() => String(itemNumber || '').trim(), [itemNumber]);
  const effectiveItemNumber = useMemo(() => normalizedItemNumber.toUpperCase(), [normalizedItemNumber]);

  useEffect(() => {
    if (rowSource === 'exception') {
      setManuals([]);
      setFolderPath('');
      return;
    }
    if (!normalizedItemNumber) {
      setManuals([]);
      setFolderPath('');
      return;
    }

    let active = true;
    const loadManuals = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          itemNumber: normalizedItemNumber,
          status: 'assigned',
          limit: '20',
        });
        const res = await fetch(`/api/product-manuals?${params.toString()}`, { cache: 'no-store' });
        const data = await res.json();
        if (!active) return;

        if (res.ok && Array.isArray(data?.rows)) {
          const rows = data.rows as ProductManualRecord[];
          setManuals(rows);
          setFolderPath(String(rows[0]?.folder_path || ''));
        } else {
          setManuals([]);
          setFolderPath('');
        }
      } catch {
        if (!active) return;
        setManuals([]);
        setFolderPath('');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadManuals();
    return () => {
      active = false;
    };
  }, [normalizedItemNumber, rowSource]);

  if (rowSource === 'exception') return null;

  if (isLoading) {
    return (
      <section className="mx-8 mt-4 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-2.5">
        <div className="inline-flex items-center gap-2 text-blue-700 text-[10px] font-black uppercase tracking-wider">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading Manuals
        </div>
      </section>
    );
  }

  if (manuals.length === 0) {
    return (
      <section className="mx-8 mt-4 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-blue-800">Manual Folder</p>
          <span className="text-[9px] font-black uppercase tracking-wider text-gray-500">
            {effectiveItemNumber ? `Item ${effectiveItemNumber}` : 'Item Number Required'}
          </span>
        </div>
        {!effectiveItemNumber ? (
          <p className="text-[10px] font-semibold text-gray-500">
            Add the item number to this order before linking a manual.
          </p>
        ) : (
          <p className="text-[10px] font-semibold text-gray-500">
            No PDFs are linked in the manual library for this item yet. Use the Update Manuals view to move a file from
            `manuals/unassigned` into this item folder.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="mx-8 mt-4 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-blue-800">Manual Folder</p>
          <p className="mt-1 text-[9px] font-semibold text-gray-500">{folderPath || `assigned/${effectiveItemNumber}`}</p>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {manuals.map((manual) => (
            <div key={manual.relative_path || manual.id} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2 py-1">
              <FileText className="h-3 w-3 text-blue-700" />
              <span className="text-[9px] font-black tracking-wider text-gray-700 whitespace-nowrap">
                {manual.file_name || manual.display_name || manual.product_title || 'Manual'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
