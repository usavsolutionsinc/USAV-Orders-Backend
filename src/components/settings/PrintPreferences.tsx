'use client';

import { useEffect, useState } from 'react';
import {
  AUTO_PAPER_ID,
  PAPER_SIZE_OPTIONS,
  getSavedPreset,
  isElectron,
  listPrinters,
  printHtmlSilent,
  resolvePaperSizeOption,
  setSavedPreset,
  type PrintPreset,
  type PrinterInfo,
} from '@/lib/print/silentPrint';

interface PrintPreferencesProps {
  onClose?: () => void;
}

const FIELD_CLS =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ' +
  'placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 ' +
  'focus:ring-blue-500/20';

/**
 * Captures the silent-print preset (printer, paper size, copies). The saved
 * preset is read automatically by `printHtmlSilent` so every print button in
 * the app uses these settings without any per-call wiring.
 */
export function PrintPreferences({ onClose }: PrintPreferencesProps) {
  const [available, setAvailable] = useState(false);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [preset, setPreset] = useState<PrintPreset>(getSavedPreset());
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    if (!isElectron()) return;
    setAvailable(true);
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    const list = await listPrinters();
    setPrinters(list);
    setLoading(false);
  }

  function update<K extends keyof PrintPreset>(key: K, value: PrintPreset[K]) {
    const next = setSavedPreset({ [key]: value } as Partial<PrintPreset>);
    setPreset(next);
    setStatus('Saved');
  }

  async function onTest() {
    setStatus('Sending test page…');
    const paper = preset.paperSizeId === AUTO_PAPER_ID
      ? PAPER_SIZE_OPTIONS[0]
      : resolvePaperSizeOption(preset.paperSizeId) ?? PAPER_SIZE_OPTIONS[0];

    const html = `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  @page{margin:0}
  html,body{margin:0;padding:6px;font-family:Arial,sans-serif}
  .t{font-size:14px;font-weight:900}
  .s{font-size:10px;color:#444;margin-top:4px}
</style></head><body>
  <div class="t">USAV silent print test</div>
  <div class="s">Printer: ${preset.deviceName || '(system default)'}</div>
  <div class="s">Paper: ${paper.label}</div>
  <div class="s">Copies: ${preset.copies}</div>
  <div class="s">${new Date().toLocaleString()}</div>
</body></html>`;

    const ok = await printHtmlSilent(html, { waitMs: 150 });
    setStatus(ok ? 'Test sent ✓' : 'Test failed — check printer name');
  }

  if (!available) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Silent printing is only available in the desktop app.</p>
        <p className="mt-1 text-amber-800">
          In a browser tab the system print dialog will always appear. Install the USAV Orders desktop app to enable silent printing.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Print preferences</h3>
          <p className="text-xs text-gray-500">Applied automatically to every Print button.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-xl border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Printer</span>
          <select
            value={preset.deviceName ?? ''}
            onChange={(e) => update('deviceName', e.target.value || null)}
            className={FIELD_CLS}
          >
            <option value="">System default</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName}
                {p.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Paper size</span>
          <select
            value={preset.paperSizeId}
            onChange={(e) => update('paperSizeId', e.target.value)}
            className={FIELD_CLS}
          >
            <option value={AUTO_PAPER_ID}>Let each label decide (default)</option>
            {PAPER_SIZE_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-caption text-gray-500">
            Forces this paper size for every silent print. Pick &ldquo;Let each label decide&rdquo;
            if different labels use different stock.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Copies</span>
          <input
            type="number"
            min={1}
            max={20}
            value={preset.copies}
            onChange={(e) => {
              const n = Math.max(1, Math.min(20, Number(e.target.value) || 1));
              update('copies', n);
            }}
            className={`${FIELD_CLS} w-24`}
          />
        </label>

        <div className="flex items-center gap-3 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={onTest}
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500"
          >
            Print test label
          </button>
          {status && <span className="text-xs text-gray-500">{status}</span>}
        </div>
      </div>
    </div>
  );
}
