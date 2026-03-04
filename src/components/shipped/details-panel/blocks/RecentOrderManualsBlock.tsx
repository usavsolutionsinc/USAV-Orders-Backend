'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Printer } from '@/components/Icons';

interface RecentManual {
  id: number;
  sku: string | null;
  itemNumber: string | null;
  googleFileId: string;
  type: string | null;
  isActive: boolean;
  updatedAt: string;
  previewUrl: string;
  viewUrl: string;
  downloadUrl: string;
}

interface RecentOrderManualsBlockProps {
  sku?: string | null;
  itemNumber?: string | null;
  rowSource?: 'order' | 'exception';
}

export function RecentOrderManualsBlock({
  sku,
  itemNumber,
  rowSource = 'order',
}: RecentOrderManualsBlockProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [manuals, setManuals] = useState<RecentManual[]>([]);
  const [manualSkuInput, setManualSkuInput] = useState('');
  const [googleLinkOrId, setGoogleLinkOrId] = useState('');

  const normalizedSku = useMemo(() => String(sku || '').trim(), [sku]);
  const normalizedItemNumber = useMemo(() => String(itemNumber || '').trim(), [itemNumber]);
  const effectiveSku = useMemo(
    () => (normalizedSku || String(manualSkuInput || '').trim()).toUpperCase(),
    [manualSkuInput, normalizedSku]
  );

  useEffect(() => {
    if (rowSource === 'exception') {
      setManuals([]);
      return;
    }
    if (!normalizedSku && !normalizedItemNumber) {
      setManuals([]);
      return;
    }

    let active = true;
    const loadManuals = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (normalizedSku) params.set('sku', normalizedSku);
        if (normalizedItemNumber) params.set('itemNumber', normalizedItemNumber);
        params.set('limit', '3');

        const res = await fetch(`/api/manuals/recent?${params.toString()}`);
        const data = await res.json();
        if (!active) return;

        if (res.ok && Array.isArray(data?.manuals)) {
          setManuals(data.manuals as RecentManual[]);
        } else {
          setManuals([]);
        }
      } catch {
        if (!active) return;
        setManuals([]);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadManuals();
    return () => {
      active = false;
    };
  }, [normalizedItemNumber, normalizedSku, rowSource]);

  const refreshManuals = async () => {
    if (!normalizedSku && !normalizedItemNumber) return;
    try {
      const params = new URLSearchParams();
      if (normalizedSku) params.set('sku', normalizedSku);
      if (normalizedItemNumber) params.set('itemNumber', normalizedItemNumber);
      params.set('limit', '3');
      const res = await fetch(`/api/manuals/recent?${params.toString()}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data?.manuals)) {
        setManuals(data.manuals as RecentManual[]);
      } else {
        setManuals([]);
      }
    } catch {
      setManuals([]);
    }
  };

  const handleAddManual = async () => {
    if (!googleLinkOrId.trim()) return;
    if (!effectiveSku) return;

    setIsSaving(true);
    try {
      const res = await fetch('/api/manuals/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: effectiveSku,
          itemNumber: normalizedItemNumber || null,
          googleLinkOrFileId: googleLinkOrId.trim(),
          type: 'Product Manual',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        window.alert(data?.error || 'Failed to add manual');
        return;
      }
      if (!normalizedSku) setManualSkuInput(effectiveSku);
      setGoogleLinkOrId('');
      await refreshManuals();
    } catch {
      window.alert('Failed to add manual');
    } finally {
      setIsSaving(false);
    }
  };

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
          <p className="text-[10px] font-black uppercase tracking-wider text-blue-800">Add Product Manual</p>
          <span className="text-[9px] font-black uppercase tracking-wider text-gray-500">
            {effectiveSku ? `SKU ${effectiveSku}` : 'Enter SKU First'}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {!normalizedSku && (
            <input
              type="text"
              value={manualSkuInput}
              onChange={(e) => setManualSkuInput(e.target.value)}
              placeholder="Enter SKU first"
              className="w-full h-8 rounded-lg border border-blue-200 bg-white px-2.5 text-[11px] font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-200"
            />
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={googleLinkOrId}
              onChange={(e) => setGoogleLinkOrId(e.target.value)}
              placeholder={effectiveSku ? 'Then paste Google Drive link or file ID' : 'Enter SKU first'}
              disabled={!effectiveSku}
              className="flex-1 h-8 rounded-lg border border-blue-200 bg-white px-2.5 text-[11px] font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100 disabled:text-gray-400"
            />
            <button
              type="button"
              onClick={handleAddManual}
              disabled={isSaving || !googleLinkOrId.trim() || !effectiveSku}
              className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
            >
              {isSaving ? 'Saving' : 'Add'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-8 mt-4 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-blue-800">Recent Manuals</p>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {manuals.map((manual) => (
            <div key={manual.id} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2 py-1">
              <span className="text-[9px] font-black uppercase tracking-wider text-gray-700 whitespace-nowrap">
                {manual.type || 'Manual'}
              </span>
              <a
                href={manual.viewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-md p-1 text-blue-700 hover:bg-blue-50"
                title="Open manual"
                aria-label="Open manual"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href={manual.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-md p-1 text-gray-700 hover:bg-gray-50"
                title="Print/download manual"
                aria-label="Print manual"
              >
                <Printer className="w-3 h-3" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
