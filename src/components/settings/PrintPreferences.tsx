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
import {
  PAPER_SIZES,
  PRINTER_ROLES,
  deleteProfile,
  getRouting,
  isBrowserPrintSupported,
  isWebSerialSupported,
  isWebUsbSupported,
  listProfiles,
  newProfileId,
  printRawToProfile,
  profileSummary,
  requestSerialDevice,
  requestUsbDevice,
  resolvePaperSize,
  setRoute,
  upsertProfile,
  type LabelLanguage,
  type PrinterKind,
  type PrinterProfile,
  type PrinterRole,
} from '@/lib/print/browserPrint';
import { buildTestLabelCommands } from '@/lib/print/labelCommands';
import { isSilentPrintEnabled, setSilentPrintEnabled } from '@/lib/print/printMode';
import { friendlyPrintError } from '@/lib/print/printErrors';

interface PrintPreferencesProps {
  onClose?: () => void;
}

const FIELD_CLS =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ' +
  'placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 ' +
  'focus:ring-blue-500/20';

const LANGUAGES: { id: LabelLanguage; label: string }[] = [
  { id: 'tspl', label: 'TSPL (TSC / generic thermal)' },
  { id: 'zpl', label: 'ZPL (Zebra)' },
  { id: 'escpos', label: 'ESC/POS (80mm receipt)' },
];

/**
 * Per-workstation switch: print labels silently (no dialog) vs. hand them to
 * the browser print dialog. Mirrors the app's house switch markup.
 */
function SilentPrintToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(isSilentPrintEnabled());
  }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    setSilentPrintEnabled(next);
  };
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-gray-900">Silent printing</div>
        <p className="mt-0.5 text-xs text-gray-500">
          {on
            ? 'Labels print straight to the configured printer with no dialog.'
            : 'Labels open the browser print dialog so you can pick a printer / preview.'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Toggle silent printing"
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
          on ? 'bg-emerald-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            on ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export function PrintPreferences({ onClose }: PrintPreferencesProps) {
  const electronAvail = isElectron();
  const webAvail = !electronAvail && isBrowserPrintSupported();

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Print preferences</h3>
          <p className="text-xs text-gray-500">Profiles apply to this workstation only.</p>
        </div>
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

      <SilentPrintToggle />

      {electronAvail ? (
        <ElectronPreferences />
      ) : webAvail ? (
        <BrowserProfiles />
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Silent printing isn&rsquo;t available in this browser.</p>
          <p className="mt-1 text-amber-800">
            Use Chrome or Edge to pair wired label printers, or install the desktop app.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Electron — OS-printer preset (unchanged)
// ---------------------------------------------------------------------------
function ElectronPreferences() {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [preset, setPreset] = useState<PrintPreset>(getSavedPreset());
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setPrinters(await listPrinters());
    setLoading(false);
  }

  function update<K extends keyof PrintPreset>(key: K, value: PrintPreset[K]) {
    setPreset(setSavedPreset({ [key]: value } as Partial<PrintPreset>));
    setStatus('Saved');
  }

  async function onTest() {
    setStatus('Sending test page…');
    const paper =
      preset.paperSizeId === AUTO_PAPER_ID
        ? PAPER_SIZE_OPTIONS[0]
        : resolvePaperSizeOption(preset.paperSizeId) ?? PAPER_SIZE_OPTIONS[0];
    const html = `<!doctype html><html><head><meta charset="utf-8"/><style>@page{margin:0}html,body{margin:0;padding:6px;font-family:Arial,sans-serif}.t{font-size:14px;font-weight:900}.s{font-size:10px;color:#444;margin-top:4px}</style></head><body><div class="t">USAV silent print test</div><div class="s">Printer: ${preset.deviceName || '(system default)'}</div><div class="s">Paper: ${paper.label}</div><div class="s">${new Date().toLocaleString()}</div></body></html>`;
    setStatus((await printHtmlSilent(html, { waitMs: 150 })) ? 'Test sent ✓' : 'Test failed');
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh printers'}
        </button>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-700">Printer</span>
        <select value={preset.deviceName ?? ''} onChange={(e) => update('deviceName', e.target.value || null)} className={FIELD_CLS}>
          <option value="">System default</option>
          {printers.map((p) => (
            <option key={p.name} value={p.name}>{p.displayName}{p.isDefault ? ' (default)' : ''}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-700">Paper size</span>
        <select value={preset.paperSizeId} onChange={(e) => update('paperSizeId', e.target.value)} className={FIELD_CLS}>
          <option value={AUTO_PAPER_ID}>Let each label decide (default)</option>
          {PAPER_SIZE_OPTIONS.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-700">Copies</span>
        <input type="number" min={1} max={20} value={preset.copies} onChange={(e) => update('copies', Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className={`${FIELD_CLS} w-24`} />
      </label>
      <div className="flex items-center gap-3 border-t border-gray-200 pt-4">
        <button type="button" onClick={onTest} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500">Print test label</button>
        {status && <span className="text-xs text-gray-500">{status}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browser — multiple printer profiles (label / paper / receipt)
// ---------------------------------------------------------------------------
function BrowserProfiles() {
  const [profiles, setProfiles] = useState<PrinterProfile[]>([]);
  const [routing, setRouting] = useState<Partial<Record<PrinterRole, string>>>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    reload();
  }, []);

  function reload() {
    setProfiles(listProfiles());
    setRouting(getRouting());
  }

  async function pair(kind: 'usb' | 'serial') {
    setBusy(true);
    setStatus('Pick the printer in the browser dialog…');
    try {
      const dev = kind === 'usb' ? await requestUsbDevice() : await requestSerialDevice();
      const profile: PrinterProfile = {
        id: newProfileId(),
        name: dev.suggestedName,
        role: profiles.some((p) => p.role === 'label') ? 'receipt' : 'label',
        kind: dev.kind,
        vendorId: dev.vendorId,
        productId: dev.productId,
        serialNumber: dev.serialNumber,
        language: kind === 'serial' ? 'escpos' : 'tspl',
        paperSizeId: '2x1',
        baudRate: kind === 'serial' ? 9600 : undefined,
        copies: 1,
      };
      upsertProfile(profile);
      reload();
      setStatus(
        kind === 'usb'
          ? `Paired: ${profile.name}. If its Test says “Access denied”, this USB printer is driver-owned — pair it as a serial (COM) port instead.`
          : `Paired: ${profile.name}. Set the language to match your printer, then hit Test.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Pairing cancelled');
    } finally {
      setBusy(false);
    }
  }

  function addOsPrinter() {
    const profile: PrinterProfile = {
      id: newProfileId(),
      name: 'Office printer',
      role: 'paper',
      kind: 'os',
      deviceName: '',
      language: 'none',
      paperSizeId: 'letter',
      copies: 1,
    };
    upsertProfile(profile);
    reload();
    setStatus('Added a paper/office profile — set its name to the OS printer.');
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        Pair a printer for each role. Labels &amp; receipts print silently from the browser (raw
        TSPL/ZPL/ESC-POS). Paper/office printers print silently only in the desktop app — in a
        browser tab they use the print dialog.
        <span className="mt-1 block text-gray-500">
          On Windows, a USB printer with a vendor driver installed is owned by that driver, so
          WebUSB can’t reach it (“Access denied”). Pair it as a <strong>serial (COM)</strong> port
          for reliable silent printing, or remove its Windows driver to use USB.
        </span>
      </div>

      {profiles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white px-3 py-6 text-center text-sm text-gray-500">
          No printers paired yet.
        </p>
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              isDefaultForRole={routing[p.role] === p.id}
              onChange={(next) => {
                upsertProfile(next);
                reload();
              }}
              onMakeDefault={() => {
                setRoute(p.role, p.id);
                reload();
              }}
              onRemove={() => {
                deleteProfile(p.id);
                reload();
              }}
              onStatus={setStatus}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
        {isWebUsbSupported() && (
          <button type="button" onClick={() => pair('usb')} disabled={busy} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            + Pair USB printer
          </button>
        )}
        {isWebSerialSupported() && (
          <button type="button" onClick={() => pair('serial')} disabled={busy} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            + Pair serial printer
          </button>
        )}
        <button type="button" onClick={addOsPrinter} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
          + Add paper / office printer
        </button>
      </div>
      {status && <p className="text-xs text-gray-500">{status}</p>}
    </div>
  );
}

function ProfileCard({
  profile,
  isDefaultForRole,
  onChange,
  onMakeDefault,
  onRemove,
  onStatus,
}: {
  profile: PrinterProfile;
  isDefaultForRole: boolean;
  onChange: (p: PrinterProfile) => void;
  onMakeDefault: () => void;
  onRemove: () => void;
  onStatus: (s: string) => void;
}) {
  const sizes = PAPER_SIZES.filter((s) => s.kinds.includes(profile.kind as PrinterKind));
  const set = <K extends keyof PrinterProfile>(key: K, value: PrinterProfile[K]) =>
    onChange({ ...profile, [key]: value });

  async function onTest() {
    if (profile.kind === 'os') {
      onStatus('Paper/office printers can only be tested from the desktop app.');
      return;
    }
    onStatus('Sending test label…');
    const commands = buildTestLabelCommands(
      profile.language,
      resolvePaperSize(profile.paperSizeId),
      profile.name,
      new Date().toLocaleString(),
      profile.copies,
    );
    const res = await printRawToProfile(commands, profile);
    onStatus(res.success ? `Test sent to ${profile.name} ✓` : friendlyPrintError(res.reason));
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <input
          value={profile.name}
          onChange={(e) => set('name', e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-gray-900 hover:border-gray-300 focus:border-blue-500 focus:outline-none"
        />
        <span className="shrink-0 text-caption text-gray-400">{profileSummary(profile)}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-gray-600">Role</span>
          <select value={profile.role} onChange={(e) => set('role', e.target.value as PrinterRole)} className={`${FIELD_CLS} px-2 py-1.5`}>
            {PRINTER_ROLES.map((r) => (<option key={r.id} value={r.id}>{r.label}</option>))}
          </select>
        </label>

        {profile.kind !== 'os' ? (
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-gray-600">Language</span>
            <select value={profile.language} onChange={(e) => set('language', e.target.value as LabelLanguage)} className={`${FIELD_CLS} px-2 py-1.5`}>
              {LANGUAGES.map((l) => (<option key={l.id} value={l.id}>{l.label}</option>))}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-gray-600">OS printer name</span>
            <input value={profile.deviceName ?? ''} onChange={(e) => set('deviceName', e.target.value)} placeholder="System default" className={`${FIELD_CLS} px-2 py-1.5`} />
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-caption font-medium text-gray-600">Paper size</span>
          <select value={profile.paperSizeId} onChange={(e) => set('paperSizeId', e.target.value)} className={`${FIELD_CLS} px-2 py-1.5`}>
            {sizes.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
          </select>
        </label>

        {profile.kind === 'serial' && (
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-gray-600">Baud</span>
            <select value={profile.baudRate ?? 9600} onChange={(e) => set('baudRate', Number(e.target.value))} className={`${FIELD_CLS} px-2 py-1.5`}>
              {[9600, 19200, 38400, 57600, 115200].map((b) => (<option key={b} value={b}>{b}</option>))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-caption font-medium text-gray-600">Copies</span>
          <input type="number" min={1} max={20} value={profile.copies} onChange={(e) => set('copies', Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className={`${FIELD_CLS} px-2 py-1.5`} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <button type="button" onClick={onTest} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">Test</button>
        {isDefaultForRole ? (
          <span className="rounded-lg bg-green-50 px-2 py-1 text-caption font-medium text-green-700">Default for {profile.role}</span>
        ) : (
          <button type="button" onClick={onMakeDefault} className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-caption text-gray-600 hover:bg-gray-50">Make default for {profile.role}</button>
        )}
        <button type="button" onClick={onRemove} className="ml-auto rounded-lg border border-gray-300 bg-white px-2 py-1 text-caption text-gray-600 hover:bg-gray-50">Remove</button>
      </div>
    </div>
  );
}
