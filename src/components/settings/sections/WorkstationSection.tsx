'use client';

import { useEffect, useState } from 'react';
import {
  getWorkstation,
  setWorkstation,
  type WorkstationRole,
  type WorkstationSettings,
} from '@/lib/settings/workstation';

const ROLES: { value: WorkstationRole; label: string }[] = [
  { value: '', label: '— No default role —' },
  { value: 'packer', label: 'Packer' },
  { value: 'tech', label: 'Technician' },
  { value: 'receiver', label: 'Receiver' },
  { value: 'admin', label: 'Admin' },
];

const FIELD_CLS =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ' +
  'placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 ' +
  'focus:ring-blue-500/20';

export function WorkstationSection() {
  const [settings, setSettings] = useState<WorkstationSettings>({
    stationName: '',
    defaultWarehouse: '',
    defaultRole: '',
  });
  const [status, setStatus] = useState('');

  useEffect(() => { setSettings(getWorkstation()); }, []);

  function update<K extends keyof WorkstationSettings>(key: K, value: WorkstationSettings[K]) {
    const next = setWorkstation({ [key]: value } as Partial<WorkstationSettings>);
    setSettings(next);
    setStatus('Saved');
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="sr-only">Workstation</h2>
        <p className="mt-1 text-sm text-gray-500">
          Identifies which station this is so forms and filters can pre-fill. Local to this device.
        </p>
      </header>

      <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Station name</span>
          <input
            type="text"
            placeholder="e.g. Packing 02, Receiving Bay A"
            value={settings.stationName}
            onChange={(e) => update('stationName', e.target.value)}
            className={FIELD_CLS}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Default warehouse / location</span>
          <input
            type="text"
            placeholder="e.g. SAL, MAIN, TSN"
            value={settings.defaultWarehouse}
            onChange={(e) => update('defaultWarehouse', e.target.value.toUpperCase())}
            className={FIELD_CLS}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">Default role</span>
          <select
            value={settings.defaultRole}
            onChange={(e) => update('defaultRole', e.target.value as WorkstationRole)}
            className={FIELD_CLS}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-caption text-gray-500">
            Determines which dashboard opens by default when the app launches.
          </span>
        </label>

        {status && <span className="block text-xs text-gray-500">{status}</span>}
      </div>
    </div>
  );
}
