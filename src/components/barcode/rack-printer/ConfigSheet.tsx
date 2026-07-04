import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Check } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { DEFAULT_GLN, QR_BASE_URL } from '@/lib/barcode-routing';
import { DEFAULT_CONFIG, clampMax, type PrinterConfig } from './rack-printer-config';

interface ConfigSheetProps {
  open: boolean;
  onClose: () => void;
  config: PrinterConfig;
  onSave: (next: PrinterConfig) => void;
}

/** Bottom-sheet editor for the per-warehouse counts + GLN (localStorage-backed). */
export function ConfigSheet({ open, onClose, config, onSave }: ConfigSheetProps) {
  const [draft, setDraft] = useState<PrinterConfig>(config);
  useEffect(() => { if (open) setDraft(config); }, [open, config]);

  const set = (k: keyof PrinterConfig) => (v: string) => {
    if (k === 'gln') return setDraft({ ...draft, gln: v.trim() || DEFAULT_GLN });
    setDraft({ ...draft, [k]: clampMax(v, (DEFAULT_CONFIG as unknown as Record<string, number>)[k]) });
  };

  const handleSave = () => {
    onSave({
      maxAisles: clampMax(draft.maxAisles, DEFAULT_CONFIG.maxAisles),
      maxBays: clampMax(draft.maxBays, DEFAULT_CONFIG.maxBays),
      maxLevels: clampMax(draft.maxLevels, DEFAULT_CONFIG.maxLevels),
      gln: draft.gln.trim() || DEFAULT_GLN,
    });
  };

  const handleReset = () => setDraft({ ...DEFAULT_CONFIG });

  return (
    <BottomSheet open={open} onClose={onClose} title="Configure counts">
      <p className="mb-4 text-center text-label text-text-soft">
        Match these to your warehouse layout. Saved locally — no rebuild required.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <NumField label="Aisles" value={draft.maxAisles} onChange={set('maxAisles')} />
        <NumField label="Bays" value={draft.maxBays} onChange={set('maxBays')} />
        <NumField label="Levels" value={draft.maxLevels} onChange={set('maxLevels')} />
      </div>

      <div className="mt-4">
        <label className="text-micro font-semibold uppercase tracking-wider text-text-soft">
          GLN (Global Location Number)
        </label>
        <input
          type="text"
          value={draft.gln}
          onChange={(e) => set('gln')(e.target.value)}
          className="mt-1 h-11 w-full rounded-2xl border border-border-default bg-surface-canvas px-4 font-mono text-sm font-semibold text-text-default outline-none focus:border-blue-500 focus:bg-surface-card focus:ring-2 focus:ring-blue-200"
        />
        <p className="mt-1 text-micro text-text-faint">
          Default is the GS1 documentation placeholder ({DEFAULT_GLN}). Replace once registered with GS1 US.
        </p>
      </div>

      <div className="mt-3 text-micro text-text-faint">
        Domain in QR: <span className="font-mono">{QR_BASE_URL}</span>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:gap-3">
        <Button
          variant="primary"
          icon={<Check />}
          onClick={handleSave}
          className="h-12 w-full rounded-2xl sm:flex-1"
        >
          Save
        </Button>
        <Button
          variant="ghost"
          onClick={handleReset}
          className="h-12 w-full rounded-2xl sm:flex-1"
        >
          Reset
        </Button>
      </div>
    </BottomSheet>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-micro font-semibold uppercase tracking-wider text-text-soft">{label}</label>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={99}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-12 w-full rounded-2xl border border-border-default bg-surface-canvas px-4 text-center text-lg font-semibold tabular-nums text-text-default outline-none focus:border-blue-500 focus:bg-surface-card focus:ring-2 focus:ring-blue-200"
      />
    </div>
  );
}
