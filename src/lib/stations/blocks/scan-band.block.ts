/**
 * Scan-band block — the trigger-slot input for a Station surface. Focus-locked,
 * auto-refocusing; on Enter it classifies the raw scan through the surface-aware
 * `classifyUnboxScan` and dispatches a typed `station:scan` CustomEvent the host
 * surface listens for. It consumes no rows (accepts: 'none') — it drives the
 * scan loop, it doesn't display a feed.
 *
 * Registered here (CODE); dropped into a station's `trigger` slot as DATA.
 */

import { registerBlock } from './registry';
import { SURFACE_KEYS } from '../surface-keys';

let registered = false;
export function registerScanBandBlock(): void {
  if (registered) return;
  registered = true;
  registerBlock({
    type: 'scan_band',
    label: 'Scan bar',
    icon: 'Barcode',
    category: 'trigger',
    slots: ['trigger'],
    accepts: 'none',
    roles: [],
    configSchema: [
      {
        key: 'surface',
        label: 'Scan policy',
        kind: 'select',
        options: SURFACE_KEYS.map((k) => ({ value: k, label: k })),
        default: 'unbox',
      },
      { key: 'placeholder', label: 'Placeholder', kind: 'text', default: 'Scan tracking, serial, or SKU…' },
    ],
    requiredPermissions: [],
    component: () => import('@/components/stations/blocks/ScanBandBlock').then((m) => m.ScanBandBlock),
  });
}
