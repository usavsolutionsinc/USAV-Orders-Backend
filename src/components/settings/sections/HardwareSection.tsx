'use client';

import { useEffect, useState } from 'react';
import { PrintPreferences } from '@/components/settings/PrintPreferences';
import { isElectron } from '@/lib/print/silentPrint';

export function HardwareSection() {
  const [inElectron, setInElectron] = useState(false);
  useEffect(() => { setInElectron(isElectron()); }, []);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="sr-only">Hardware</h2>
        <p className="mt-1 text-sm text-text-soft">
          Peripherals attached to this workstation. Settings here apply only to this device.
        </p>
      </header>

      <PrintPreferences />

      <div className="rounded-2xl border border-border-soft bg-surface-card p-5 shadow-sm">
        <h3 className="text-base font-semibold text-text-default">Camera / scanner</h3>
        <p className="mt-1 text-xs text-text-soft">
          The camera used for QR / barcode scanning across the app.
        </p>
        <p className="mt-3 text-xs text-text-muted">
          {inElectron
            ? 'Camera selection follows your OS default. Change which camera is used in Windows → Settings → Bluetooth & devices → Cameras.'
            : 'Camera selection is browser-managed. Use the browser permission popup the first time you scan.'}
        </p>
      </div>

      <div className="rounded-2xl border border-dashed border-border-default bg-surface-canvas p-5 text-text-soft">
        <h3 className="text-base font-semibold text-text-muted">Shipping scale</h3>
        <p className="mt-1 text-xs">Coming soon — USB scale integration via serial port.</p>
      </div>
    </div>
  );
}
