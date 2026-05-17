'use client';

import { useState } from 'react';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { MAX_PINS, type ActionToggles } from '@/lib/quick-access/types';

const FIELD_CLS =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ' +
  'placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 ' +
  'focus:ring-blue-500/20';

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-900">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] text-gray-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </label>
  );
}

export function QuickAccessSection() {
  const { settings, recents, updateSettings, pin, unpin, rename, wipeRecents } = useQuickAccess();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addError, setAddError] = useState('');

  function patchActions(patch: Partial<ActionToggles>) {
    updateSettings({ actions: { ...settings.actions, ...patch } });
  }

  function startEdit(id: string, currentLabel: string) {
    setEditingId(id);
    setEditingLabel(currentLabel);
  }

  function commitEdit() {
    if (editingId) rename(editingId, editingLabel);
    setEditingId(null);
    setEditingLabel('');
  }

  function handleAddManually() {
    setAddError('');
    const href = addUrl.trim();
    if (!href.startsWith('/')) {
      setAddError('URL must start with /');
      return;
    }
    const label = addLabel.trim() || href;
    const result = pin({ href, label });
    if (result === 'duplicate') setAddError('Already pinned');
    else if (result === 'full') setAddError(`Limit reached (${MAX_PINS})`);
    else {
      setAddUrl('');
      setAddLabel('');
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-gray-900">Quick access</h2>
        <p className="mt-1 text-sm text-gray-500">
          The bottom-right floating button. Pin pages for one-click navigation and toggle which built-in
          actions appear.
        </p>
      </header>

      <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white px-5 shadow-sm">
        <ToggleRow
          label="Show quick access button"
          description="The ⚡ floating button in the bottom-right corner."
          checked={settings.enabled}
          onChange={(v) => updateSettings({ enabled: v })}
        />
        <ToggleRow
          label="Open with ⌘K / Ctrl+K shortcut"
          description="Skipped automatically while typing in inputs."
          checked={settings.hotkey === 'cmdk'}
          onChange={(v) => updateSettings({ hotkey: v ? 'cmdk' : 'off' })}
        />
        <ToggleRow
          label="Show recently visited pages"
          description="Auto-collected from your last 12 page visits."
          checked={settings.showRecent}
          onChange={(v) => updateSettings({ showRecent: v })}
        />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Built-in actions</h3>
        <p className="mb-2 text-[11px] text-gray-500">Choose which actions appear at the top of the popover.</p>
        <div className="divide-y divide-gray-100">
          <ToggleRow
            label="Phone history"
            description="Resume your recent packed orders from the FAB."
            checked={settings.actions.phoneHistory}
            onChange={(v) => patchActions({ phoneHistory: v })}
          />
          <ToggleRow
            label="Install desktop app"
            description="Hidden when running inside Electron or when no download URL is configured."
            checked={settings.actions.installDesktopApp !== false}
            onChange={(v) => patchActions({ installDesktopApp: v })}
          />
          <ToggleRow
            label="Switch staff"
            description="Show the Switch action in the popover header. PIN-protected."
            checked={settings.actions.switchStaff !== false}
            onChange={(v) => patchActions({ switchStaff: v })}
          />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 pb-1 pt-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">FAB appearance</h3>
          </div>
          <div className="px-4">
            <ToggleRow
              label="Show signed-in staff on the FAB"
              description="When on, the FAB shows the active staff's initials in their theme colour. When off, the FAB is the Zap icon."
              checked={settings.showStaffChipOnFab !== false}
              onChange={(v) => updateSettings({ showStaffChipOnFab: v })}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Pinned pages</h3>
          <span className="text-[11px] font-medium text-gray-500">
            {settings.pinned.length} / {MAX_PINS}
          </span>
        </div>

        {settings.pinned.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-xs text-gray-500">
            No pinned pages. Open Quick Access from any page and tap <span className="font-semibold text-blue-600">+ Pin page</span>.
          </p>
        ) : (
          <ul className="space-y-1">
            {settings.pinned.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2"
              >
                <span className="text-gray-400" aria-hidden>
                  ⠿
                </span>
                <div className="min-w-0 flex-1">
                  {editingId === p.id ? (
                    <input
                      autoFocus
                      type="text"
                      value={editingLabel}
                      onChange={(e) => setEditingLabel(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit();
                        if (e.key === 'Escape') { setEditingId(null); setEditingLabel(''); }
                      }}
                      className={FIELD_CLS}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(p.id, p.label)}
                      className="block w-full text-left text-sm font-semibold text-gray-900 hover:text-blue-600"
                      title="Click to rename"
                    >
                      {p.label}
                    </button>
                  )}
                  <p className="truncate font-mono text-[11px] text-gray-500">{p.href}</p>
                </div>
                <button
                  type="button"
                  onClick={() => unpin(p.id)}
                  className="rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                >
                  Unpin
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Add manually</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              type="text"
              placeholder="/receiving?warehouse=SAL"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              className={FIELD_CLS}
            />
            <input
              type="text"
              placeholder="Label (optional)"
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              className={FIELD_CLS}
            />
            <button
              type="button"
              onClick={handleAddManually}
              className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
            >
              Add
            </button>
          </div>
          {addError && <p className="text-[11px] text-red-600">{addError}</p>}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Recent pages</h3>
            <p className="text-[11px] text-gray-500">{recents.length} stored on this device</p>
          </div>
          <button
            type="button"
            onClick={wipeRecents}
            disabled={recents.length === 0}
            className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Clear recents
          </button>
        </div>
      </div>
    </div>
  );
}

export default QuickAccessSection;
