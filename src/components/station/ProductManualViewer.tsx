'use client';

import React, { useState } from 'react';
import { ExternalLink, Loader2, Printer } from '../Icons';
import type { ResolvedProductManual } from '@/hooks/useStationTestingController';

interface ProductManualViewerProps {
  manuals: ResolvedProductManual[];
  isLoading?: boolean;
  className?: string;
}

export default function ProductManualViewer({ manuals, isLoading = false, className = '' }: ProductManualViewerProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const safeIndex = Math.min(activeIndex, Math.max(manuals.length - 1, 0));
  const selected = manuals[safeIndex] ?? null;

  if (isLoading && manuals.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full bg-gray-50 rounded-xl border border-gray-200 ${className}`}>
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Loading manual...</p>
        </div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className={`flex items-center justify-center h-full rounded-xl border border-dashed border-gray-300 bg-white p-6 ${className}`}>
        <p className="text-xs font-bold text-gray-400 text-center">
          Scan an order with a linked manual to load it here.
        </p>
      </div>
    );
  }

  const typeLabel = selected.type?.toUpperCase() || 'PRODUCT MANUAL';

  return (
    <div className={`flex flex-col h-full rounded-xl overflow-hidden border border-gray-200 shadow-sm ${className}`}>
      {/* Type banner */}
      <div className="flex items-center justify-between px-3 py-2 bg-indigo-600 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {manuals.length > 1 ? (
            <div className="flex items-center gap-1 flex-wrap">
              {manuals.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  className={`px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider transition-all ${
                    i === safeIndex
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'bg-indigo-500/60 text-indigo-100 hover:bg-indigo-500'
                  }`}
                >
                  {m.type?.toUpperCase() || 'MANUAL'}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[11px] font-black uppercase tracking-wider text-white truncate">{typeLabel}</p>
          )}
        </div>
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          <a
            href={selected.viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/20 hover:bg-white/30 text-white text-[10px] font-black uppercase tracking-wider transition-all"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </a>
          <a
            href={selected.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/20 hover:bg-white/30 text-white text-[10px] font-black uppercase tracking-wider transition-all"
          >
            <Printer className="w-3 h-3" />
            Print
          </a>
        </div>
      </div>

      {/* iframe */}
      <div className="flex-1 bg-white overflow-hidden">
        <iframe
          key={selected.previewUrl}
          src={selected.previewUrl}
          title={selected.type || 'Product manual'}
          className="w-full h-full"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}
