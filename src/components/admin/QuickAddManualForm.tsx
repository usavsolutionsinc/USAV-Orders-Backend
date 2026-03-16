'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2 } from '@/components/Icons';

function extractGoogleFileId(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const driveMatch = raw.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch?.[1]) return driveMatch[1];
  const docMatch = raw.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch?.[1]) return docMatch[1];
  const queryMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch?.[1]) return queryMatch[1];
  return raw;
}

export interface QuickAddManualFormProps {
  /** Pre-filled SKU — typically from the order row */
  sku?: string | null;
  /** Pre-filled item number — typically from the order row */
  itemNumber?: string | null;
  /** Called after a successful save with the resolved file ID */
  onSaved?: (fileId: string) => void;
}

/**
 * Compact, self-contained form for quickly linking a Google Doc to a product.
 *
 * Flow:
 *   1. If itemNumber is missing  → show item-number input first (contextual prompt)
 *   2. Once item number is known → show Google Doc ID / Drive URL input
 *   3. After save              → show success strip with "Open" link
 */
export function QuickAddManualForm({ sku, itemNumber, onSaved }: QuickAddManualFormProps) {
  const normalizedItemNumber = String(itemNumber || '').trim();
  const normalizedSku = String(sku || '').trim();

  const [localItemNumber, setLocalItemNumber] = useState('');
  const [googleInput, setGoogleInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedFileId, setSavedFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const googleInputRef = useRef<HTMLInputElement>(null);
  const itemInputRef = useRef<HTMLInputElement>(null);

  // Effective item number: from props (preferred) or what the user typed
  const effectiveItemNumber = normalizedItemNumber || localItemNumber.trim().toUpperCase();
  const itemNumberReady = effectiveItemNumber.length > 0;

  // When item number becomes available, focus the Google Doc input
  useEffect(() => {
    if (itemNumberReady) {
      googleInputRef.current?.focus();
    }
  }, [itemNumberReady]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setGoogleInput(text.trim());
        setError(null);
      }
    } catch {
      // clipboard not available — ignore
    }
    googleInputRef.current?.focus();
  };

  const handleSave = async () => {
    if (!itemNumberReady) {
      itemInputRef.current?.focus();
      return;
    }
    const fileId = extractGoogleFileId(googleInput);
    if (!fileId) {
      setError('Paste a Google Drive link or File ID.');
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch('/api/product-manuals/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemNumber: effectiveItemNumber,
          item_number: effectiveItemNumber,
          sku: normalizedSku || effectiveItemNumber,
          googleDocId: fileId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Save failed (HTTP ${res.status})`);
        return;
      }
      const resolved = String(data?.manual?.google_file_id || fileId);
      setSavedFileId(resolved);
      setGoogleInput('');
      onSaved?.(resolved);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Saved state — show success strip ────────────────────────────────────────
  if (savedFileId) {
    const viewUrl = `https://drive.google.com/file/d/${savedFileId}/view`;
    return (
      <section className="mx-8 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
            Manual Linked
          </p>
          <div className="flex items-center gap-1.5">
            <a
              href={viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white hover:bg-emerald-700 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Open
            </a>
            <button
              type="button"
              onClick={() => { setSavedFileId(null); setGoogleInput(''); }}
              className="rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-600 hover:bg-emerald-100 transition-colors"
            >
              Replace
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-8 mt-4 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <p className="text-[10px] font-black uppercase tracking-wider text-blue-800">
          Add Product Manual
        </p>
        {effectiveItemNumber && (
          <span className="text-[9px] font-black uppercase tracking-wider text-blue-400">
            {effectiveItemNumber}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {/* Step 1 — item number input (only when not provided by props) */}
        {!normalizedItemNumber && (
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase tracking-wider text-blue-600">
              Item Number
            </label>
            <input
              ref={itemInputRef}
              type="text"
              value={localItemNumber}
              onChange={(e) => { setLocalItemNumber(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') googleInputRef.current?.focus(); }}
              placeholder="Enter item number first…"
              autoComplete="off"
              className="h-8 w-full rounded-lg border border-blue-200 bg-white px-2.5 text-[11px] font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-300 transition"
            />
          </div>
        )}

        {/* Step 2 — Google Doc input + Paste + Save */}
        <div className="flex flex-col gap-1">
          {!normalizedItemNumber && (
            <label className={`text-[9px] font-black uppercase tracking-wider ${itemNumberReady ? 'text-blue-600' : 'text-gray-400'}`}>
              Google Drive Link or File ID
            </label>
          )}
          <div className="flex items-center gap-1.5">
            <input
              ref={googleInputRef}
              type="text"
              value={googleInput}
              onChange={(e) => { setGoogleInput(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
              placeholder={itemNumberReady ? 'Paste Drive link or File ID' : 'Enter item number first…'}
              disabled={!itemNumberReady}
              autoComplete="off"
              className="h-8 flex-1 rounded-lg border border-blue-200 bg-white px-2.5 text-[11px] font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-100 disabled:text-gray-400 transition"
            />
            {/* Paste button */}
            <button
              type="button"
              onClick={handlePaste}
              disabled={!itemNumberReady}
              title="Paste from clipboard"
              className="h-8 w-8 flex-shrink-0 inline-flex items-center justify-center rounded-lg border border-blue-200 bg-white text-blue-500 hover:bg-blue-50 disabled:opacity-40 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </button>
            {/* Save button */}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || !googleInput.trim() || !itemNumberReady}
              className="h-8 flex-shrink-0 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50 transition-colors inline-flex items-center gap-1"
            >
              {isSaving ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Saving</>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-[9px] font-black uppercase tracking-wider text-red-600">{error}</p>
        )}
      </div>
    </section>
  );
}
