'use client';

/**
 * Rack Label Printer — main-pane workspace.
 *
 * Four-step location builder (zone → aisle → bay → level) that outputs a
 * QR-only thermal label identifying a whole rack column on one level.
 * Sibling of {@link BinLabelPrinter}; same room/zone source of truth,
 * same GS1 Digital Link envelope, but no position segment.
 *
 * Under the hood every rack label is stored as a `LocationSegments` row
 * with `position: 0` — that sentinel is how scan routing distinguishes a
 * rack scan from a bin scan (see `isRackCode` in barcode-routing).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LocationDataMatrix } from './LocationDataMatrix';
import { toast } from 'sonner';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { SkeletonCardGrid } from '@/components/ui/SkeletonCard';
import { Check, ChevronDown, ChevronLeft, ChevronUp, Printer, Settings } from '@/components/Icons';
import { useLocations } from '@/hooks/useLocations';
import { useHorizontalWheelScroll } from '@/hooks/useHorizontalWheelScroll';
import {
  useRackPrinterStore,
  patchRackPrinterState,
  resetRackPrinterState,
} from '@/hooks/useLabelPrinterStore';
import { WorkspaceCard, StickyActionBar } from '@/design-system/components';
import { LabelRoomSidebar } from './LabelRoomSidebar';
import {
  DEFAULT_GLN,
  QR_BASE_URL,
  bayHand,
  gs1LocationAi,
  noPad,
  pad2,
  rackCode,
  rackToLocation,
  type RackSegments,
} from '@/lib/barcode-routing';

// ─── Types & constants ────────────────────────────────────────────────────

interface PrinterConfig {
  maxAisles: number;
  maxBays: number;
  maxLevels: number;
  gln: string;
}

const DEFAULT_CONFIG: PrinterConfig = {
  maxAisles: 6,
  maxBays: 12,
  maxLevels: 5,
  gln: DEFAULT_GLN,
};

const CONFIG_KEY = 'rackPrinter.config.v1';

type Step = 'zone' | 'aisle' | 'bay' | 'level';
const STEPS: { id: Step; label: string }[] = [
  { id: 'zone',  label: 'Zone' },
  { id: 'aisle', label: 'Aisle' },
  { id: 'bay',   label: 'Bay' },
  { id: 'level', label: 'Level' },
];

// ─── Storage helpers ──────────────────────────────────────────────────────

function loadConfig(): PrinterConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      maxAisles: clampMax(parsed?.maxAisles, DEFAULT_CONFIG.maxAisles),
      maxBays: clampMax(parsed?.maxBays, DEFAULT_CONFIG.maxBays),
      maxLevels: clampMax(parsed?.maxLevels, DEFAULT_CONFIG.maxLevels),
      gln: typeof parsed?.gln === 'string' && parsed.gln.trim() ? parsed.gln.trim() : DEFAULT_GLN,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(cfg: PrinterConfig): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

function clampMax(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(99, Math.max(1, Math.floor(n)));
}

// ─── Component ────────────────────────────────────────────────────────────

/** See {@link BinLabelPrinter} — same variant semantics. */
export type RackPrinterVariant = 'main' | 'sidebar';

interface RackLabelPrinterProps {
  variant?: RackPrinterVariant;
}

export function RackLabelPrinter({ variant = 'main' }: RackLabelPrinterProps) {
  const { rooms, roomNames, loading } = useLocations();

  const [config, setConfig] = useState<PrinterConfig>(DEFAULT_CONFIG);
  const [configOpen, setConfigOpen] = useState(false);

  const stored = useRackPrinterStore();
  const selectedRoom = stored.room;
  const aisle = stored.aisle;
  const bay = stored.bay;
  const level = stored.level;

  const [bulkLabels, setBulkLabels] = useState<RackSegments[] | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  const [overrideStep, setOverrideStep] = useState<Step | null>(null);

  useEffect(() => {
    setConfig(loadConfig());
  }, []);

  const zoneMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of rooms) {
      const key = (r.room || r.name)?.trim();
      if (!key) continue;
      if (r.zone_letter && /^[A-Z]$/.test(r.zone_letter)) map[key] = r.zone_letter;
    }
    return map;
  }, [rooms]);

  const allRoomNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) {
      const key = (r.room || r.name)?.trim();
      if (key) set.add(key);
    }
    for (const n of roomNames) if (n) set.add(n);
    return Array.from(set).sort((a, b) => {
      const sa = rooms.find((r) => (r.room || r.name) === a)?.sort_order ?? 0;
      const sb = rooms.find((r) => (r.room || r.name) === b)?.sort_order ?? 0;
      if (sa !== sb) return sa - sb;
      return a.localeCompare(b);
    });
  }, [rooms, roomNames]);

  const pickRoom = useCallback((name: string) => {
    if (selectedRoom !== name) {
      patchRackPrinterState({ room: name, aisle: undefined, bay: undefined, level: undefined });
    } else {
      patchRackPrinterState({ room: name });
    }
    setOverrideStep(null);
  }, [selectedRoom]);

  const pickAisle = useCallback((n: number) => {
    if (aisle !== n) {
      patchRackPrinterState({ aisle: n, bay: undefined, level: undefined });
    } else {
      patchRackPrinterState({ aisle: n });
    }
    setOverrideStep(null);
  }, [aisle]);

  const pickBay = useCallback((n: number) => {
    if (bay !== n) {
      patchRackPrinterState({ bay: n, level: undefined });
    } else {
      patchRackPrinterState({ bay: n });
    }
    setOverrideStep(null);
  }, [bay]);

  const pickLevel = useCallback((n: number) => {
    patchRackPrinterState({ level: n });
    setOverrideStep(null);
  }, []);

  const resetAll = useCallback(() => {
    resetRackPrinterState();
    setOverrideStep(null);
  }, []);

  const computedStep: Step = useMemo(() => {
    if (!selectedRoom) return 'zone';
    if (aisle == null) return 'aisle';
    if (bay == null) return 'bay';
    return 'level';
  }, [selectedRoom, aisle, bay]);

  const activeStep: Step = overrideStep ?? computedStep;

  const handlePillClick = useCallback((step: Step) => {
    const done: Record<Step, boolean> = {
      zone: !!selectedRoom,
      aisle: aisle != null,
      bay: bay != null,
      level: level != null,
    };
    if (!done[step] && step !== computedStep) return;
    if (step === activeStep) return;
    setOverrideStep(step);
  }, [selectedRoom, aisle, bay, level, computedStep, activeStep]);

  const allSelected = selectedRoom != null && aisle != null && bay != null && level != null;
  const zoneLetter = selectedRoom ? zoneMap[selectedRoom] : undefined;

  const currentSegments: RackSegments | null = allSelected && zoneLetter
    ? { zone: zoneLetter, aisle: aisle!, bay: bay!, level: level! }
    : null;

  const missingLetter = !!selectedRoom && !zoneLetter;

  // Print — register the rack row (position=0) before window.print() so
  // scans of the printed QR resolve to a real row in the locations table.
  const triggerPrint = useCallback(async (labels: RackSegments[]) => {
    if (labels.length === 0) return;
    if (!selectedRoom) {
      toast.error('Pick a room first.');
      return;
    }
    setIsPrinting(true);
    try {
      const res = await fetch('/api/locations/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: selectedRoom,
          segments: labels.map(rackToLocation),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `Registration failed (HTTP ${res.status})`);
      }
    } catch (err: any) {
      setIsPrinting(false);
      toast.error(err?.message || 'Could not register rack for printing');
      return;
    }

    setBulkLabels(labels);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        setTimeout(() => {
          setBulkLabels(null);
          setIsPrinting(false);
          toast.success(`Printed ${labels.length} rack label${labels.length === 1 ? '' : 's'}`);
        }, 250);
      });
    });
  }, [selectedRoom]);

  const handlePrintOne = useCallback(() => {
    if (!currentSegments) return;
    triggerPrint([currentSegments]);
  }, [currentSegments, triggerPrint]);

  // Bulk: print every level of the picked bay as a separate rack label.
  const handlePrintBay = useCallback(() => {
    if (!zoneLetter || aisle == null || bay == null) return;
    const labels: RackSegments[] = [];
    for (let lv = 1; lv <= config.maxLevels; lv += 1) {
      labels.push({ zone: zoneLetter, aisle, bay, level: lv });
    }
    triggerPrint(labels);
  }, [zoneLetter, aisle, bay, config.maxLevels, triggerPrint]);

  const handleConfigSave = useCallback((next: PrinterConfig) => {
    setConfig(next);
    saveConfig(next);
    toast.success('Configuration saved');
    setConfigOpen(false);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'P')) {
        if (!currentSegments) return;
        e.preventDefault();
        handlePrintOne();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [currentSegments, handlePrintOne]);

  const picker = (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className={variant === 'sidebar'
            ? 'text-base font-bold tracking-tight text-gray-900'
            : 'text-2xl font-bold tracking-tight text-gray-900'}
          >
            {variant === 'sidebar' ? 'Build a rack label' : 'Rack Label Printer'}
          </h1>
          {variant === 'main' && (
            <p className="mt-1 text-sm text-gray-500">
              Pick a room, then drill down to the rack level. Prints one large
              QR-only label per rack — no position needed.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(selectedRoom || aisle != null) && (
            <button
              type="button"
              onClick={resetAll}
              className="flex h-9 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-[11.5px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 active:scale-[0.97]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            aria-label="Configure rack printer"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 active:scale-95"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      <StepPills
        activeStep={activeStep}
        zoneLetter={zoneLetter}
        roomName={selectedRoom}
        aisle={aisle}
        bay={bay}
        level={level}
        onPillClick={handlePillClick}
      />

      {selectedRoom && (
        <WorkspaceCard tone="blue" label="Selected room">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <ZoneLetterTile letter={zoneLetter} />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-gray-900">{selectedRoom}</p>
                <p className="mt-0.5 text-[11.5px] text-gray-500">
                  {zoneLetter ? `Zone ${zoneLetter}` : 'No zone letter yet — set one in the Rooms tab.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOverrideStep('zone')}
              className="shrink-0 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-caption font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Change
            </button>
          </div>
        </WorkspaceCard>
      )}

      {missingLetter && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
          <p className="font-semibold">No zone letter assigned to this room.</p>
          <p className="mt-0.5 text-amber-700">
            Open the <span className="font-semibold">Rooms</span> tab, tap this room, and pick a
            letter (A–Z). The letter prints on every label and inside the QR.
          </p>
        </div>
      )}

      <WorkspaceCard label={STEPS.find((s) => s.id === activeStep)?.label} tone={activeStep === 'zone' ? undefined : 'blue'}>
        {activeStep === 'zone' && (
          <RoomPicker
            rooms={allRoomNames}
            zoneMap={zoneMap}
            loading={loading}
            selectedRoom={selectedRoom}
            onSelect={pickRoom}
          />
        )}
        {activeStep === 'aisle' && (
          <NumericStep
            key="aisle"
            title="Pick an aisle"
            count={config.maxAisles}
            selected={aisle}
            onPick={pickAisle}
            customLabel="Custom aisle #"
          />
        )}
        {activeStep === 'bay' && (
          <NumericStep
            key="bay"
            title="Pick a bay"
            count={config.maxBays}
            selected={bay}
            onPick={pickBay}
            hint="Parallel rack setup — odd numbers on the left, even on the right."
            customLabel="Custom bay #"
          />
        )}
        {activeStep === 'level' && (
          <NumericStep
            key="level"
            title="Pick a level"
            count={config.maxLevels}
            selected={level}
            onPick={pickLevel}
            customLabel="Custom level #"
            unpadded
          />
        )}
      </WorkspaceCard>

      <ConfigSheet
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        config={config}
        onSave={handleConfigSave}
      />
    </div>
  );

  // ── Sidebar variant — rooms list only ───────────────────────────────
  if (variant === 'sidebar') {
    return (
      <>
        <LabelRoomSidebar
          rooms={allRoomNames}
          zoneMap={zoneMap}
          loading={loading}
          selectedRoom={selectedRoom}
          zoneLetter={zoneLetter}
          onSelect={pickRoom}
          emptySubtitle="Then drill into aisle, bay, and level on the right."
        />
        <ConfigSheet
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          config={config}
          onSave={handleConfigSave}
        />
      </>
    );
  }

  // ── Main-pane variant ─────────────────────────────────────────────────
  const desktopBuilder = (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight text-gray-900">
          {selectedRoom ?? 'Pick a room to start'}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {(selectedRoom || aisle != null) && (
            <button
              type="button"
              onClick={resetAll}
              className="flex h-10 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-label font-semibold text-gray-700 transition-colors hover:bg-gray-50 active:scale-[0.97]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            aria-label="Configure rack printer"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 active:scale-95"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      <StepPills
        activeStep={activeStep}
        zoneLetter={zoneLetter}
        roomName={selectedRoom}
        aisle={aisle}
        bay={bay}
        level={level}
        onPillClick={handlePillClick}
      />

      {missingLetter && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
          <p className="font-semibold">No zone letter assigned to this room.</p>
          <p className="mt-0.5 text-amber-700">
            Open the <span className="font-semibold">Rooms</span> tab, tap this room, and pick a
            letter (A–Z). The letter prints on every label and inside the QR.
          </p>
        </div>
      )}

      {activeStep === 'zone' ? (
        <WorkspaceCard label="Zone">
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 ring-1 ring-blue-200">
              <ChevronLeft className="h-5 w-5 text-blue-500" />
            </div>
            <p className="text-sm font-semibold text-gray-800">
              Pick a room in the sidebar
            </p>
            <p className="max-w-[40ch] text-[11.5px] text-gray-500">
              Tap any zone on the left. Aisle, bay, and level unlock here as
              soon as a room is chosen.
            </p>
          </div>
        </WorkspaceCard>
      ) : (
        <WorkspaceCard label={STEPS.find((s) => s.id === activeStep)?.label} tone="blue">
          {activeStep === 'aisle' && (
            <NumericStep
              key="aisle"
              title="Pick an aisle"
              count={config.maxAisles}
              selected={aisle}
              onPick={pickAisle}
              customLabel="Custom aisle #"
            />
          )}
          {activeStep === 'bay' && (
            <NumericStep
              key="bay"
              title="Pick a bay"
              count={config.maxBays}
              selected={bay}
              onPick={pickBay}
              hint="Parallel rack setup — odd numbers on the left, even on the right."
              customLabel="Custom bay #"
            />
          )}
          {activeStep === 'level' && (
            <NumericStep
              key="level"
              title="Pick a level"
              count={config.maxLevels}
              selected={level}
              onPick={pickLevel}
              customLabel="Custom level #"
              unpadded
            />
          )}
        </WorkspaceCard>
      )}

      <GiantRackPreviewPanel
        zoneLetter={zoneLetter}
        aisle={aisle}
        bay={bay}
        level={level}
        gln={config.gln}
      />

      <ConfigSheet
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        config={config}
        onSave={handleConfigSave}
      />
    </div>
  );

  return (
    // flex-1 + min-h-0 lets this fill the RackLabelWorkspace height; mt-auto
    // on the StickyActionBar pins it to the bottom of the page.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="lg:hidden">{picker}</div>

      {(selectedRoom || aisle != null) && (
        <WorkspaceCard label="Live preview" className="lg:hidden">
          <LivePreviewBody
            zoneLetter={zoneLetter}
            roomName={selectedRoom}
            aisle={aisle}
            bay={bay}
            level={level}
            gln={config.gln}
          />
        </WorkspaceCard>
      )}

      <div className="hidden lg:block">{desktopBuilder}</div>

      <StickyActionBar
        // Receiving-page parity: negative margins cancel the /warehouse page's
        // px-4 py-6 sm:px-6 gutter so the bar spans edge-to-edge and sits
        // flush against the scroll-container floor (no gap below it).
        className="mt-auto -mx-4 -mb-6 sm:-mx-6"
        primary={{
          label: isPrinting
            ? 'Printing…'
            : missingLetter
              ? 'Assign a zone letter first'
              : !allSelected
                ? 'Complete the steps'
                : 'Print rack label',
          onClick: handlePrintOne,
          disabled: !allSelected || isPrinting || missingLetter,
          isLoading: isPrinting,
          tone: 'blue',
          icon: <Printer className="h-4 w-4" />,
        }}
        secondary={
          selectedRoom && aisle != null && bay != null
            ? {
                label: `Print bay (×${config.maxLevels} levels)`,
                onClick: handlePrintBay,
                icon: <Printer className="h-4 w-4" />,
                disabled: isPrinting || missingLetter,
              }
            : undefined
        }
        hints={allSelected ? [{ key: '⌘P', label: 'Print' }] : []}
      />

      <div className="label-print-zone">
        {bulkLabels?.map((seg, i) => (
          <PrintLabel
            key={`${rackCode(seg)}-${i}`}
            segments={seg}
            roomName={selectedRoom ?? ''}
            gln={config.gln}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Room picker ──────────────────────────────────────────────────────────

interface RoomPickerProps {
  rooms: string[];
  zoneMap: Record<string, string>;
  loading: boolean;
  selectedRoom?: string;
  onSelect: (n: string) => void;
}

function RoomPicker({ rooms, zoneMap, loading, selectedRoom, onSelect }: RoomPickerProps) {
  if (loading) return <SkeletonCardGrid count={4} className="h-16" />;
  if (rooms.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 px-5 py-10 text-center">
        <p className="text-sm font-semibold text-gray-700">No rooms yet</p>
        <p className="mt-1 text-[11.5px] text-gray-500">
          Open the <span className="font-semibold">Rooms</span> tab and add one — it'll show up here.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {rooms.map((room) => {
        const letter = zoneMap[room];
        const isSelected = selectedRoom === room;
        return (
          <button
            key={room}
            type="button"
            onClick={() => onSelect(room)}
            className={`flex items-center gap-3 rounded-2xl border bg-white p-3 text-left transition-all active:scale-[0.99] ${
              isSelected
                ? 'border-blue-300 bg-blue-50/50 ring-2 ring-blue-200'
                : 'border-gray-200 hover:border-blue-200 hover:bg-blue-50/30'
            }`}
          >
            <ZoneLetterTile letter={letter} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-gray-900 break-words">{room}</p>
              <p className="mt-0.5 text-caption text-gray-500">
                {letter ? `Zone ${letter}` : 'No zone letter'}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ZoneLetterTile({ letter }: { letter: string | undefined }) {
  if (letter) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100/70 font-mono text-xl font-semibold text-blue-700 ring-1 ring-blue-200">
        {letter}
      </div>
    );
  }
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 font-mono text-lg font-semibold text-amber-700 ring-1 ring-amber-200"
      title="No zone letter assigned yet — go to the Rooms tab"
    >
      ?
    </div>
  );
}

// ─── Step pills ───────────────────────────────────────────────────────────

interface StepPillsProps {
  activeStep: Step;
  zoneLetter?: string;
  roomName?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  onPillClick: (step: Step) => void;
}

function StepPills({ activeStep, zoneLetter, roomName, aisle, bay, level, onPillClick }: StepPillsProps) {
  const values: Record<Step, string | undefined> = {
    zone: zoneLetter,
    aisle: aisle != null ? pad2(aisle) : undefined,
    bay: bay != null ? pad2(bay) : undefined,
    level: level != null ? noPad(level) : undefined,
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  useHorizontalWheelScroll(scrollRef);

  return (
    <div
      ref={scrollRef}
      className="flex w-full min-w-0 overflow-x-scroll overflow-y-hidden overscroll-x-contain rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-gray-200/60 [-ms-overflow-style:none] [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
      role="navigation"
      aria-label="Rack location steps"
    >
      <div className="flex w-max max-w-none flex-none flex-nowrap items-center gap-1">
        {STEPS.map(({ id, label }, idx) => {
          const value = values[id];
          const isDone = !!value;
          const isActive = activeStep === id;
          const isClickable = isDone || isActive;
          const showChevron = idx < STEPS.length - 1;
          return (
            <React.Fragment key={id}>
              <button
                type="button"
                onClick={() => onPillClick(id)}
                disabled={!isClickable}
                aria-current={isActive ? 'step' : undefined}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-caption font-semibold transition-all active:scale-95 ${
                  isActive
                    ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                    : isDone
                      ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
                title={id === 'zone' && roomName ? roomName : undefined}
              >
                <span className="text-micro uppercase tracking-wider opacity-80">{label}</span>
                <span className="font-mono text-micro font-semibold tabular-nums">{value ?? '—'}</span>
              </button>
              {showChevron && <span className="shrink-0 text-micro text-gray-300">›</span>}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─── Live preview body ────────────────────────────────────────────────────

interface LivePreviewBodyProps {
  zoneLetter?: string;
  roomName?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  gln: string;
}

function LivePreviewBody({ zoneLetter, roomName, aisle, bay, level, gln }: LivePreviewBodyProps) {
  const all = zoneLetter && aisle != null && bay != null && level != null;
  const segments: RackSegments | null = all
    ? { zone: zoneLetter!, aisle: aisle!, bay: bay!, level: level! }
    : null;
  const code = segments
    ? rackCode(segments)
    : partialCode({ zone: zoneLetter, aisle, bay, level });

  return (
    <div className="flex items-center gap-5 rounded-xl bg-gray-50 p-5 ring-1 ring-gray-200/50">
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">Rack code</p>
          <p className="mt-0.5 whitespace-nowrap font-mono text-2xl font-black tracking-tight text-gray-900">{code}</p>
        </div>
        {roomName && (
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">Room</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-gray-800">{roomName}</p>
          </div>
        )}
        <div>
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">Breakdown</p>
          <p className="mt-0.5 text-label leading-snug text-gray-700">
            {humanReadable({ zone: zoneLetter, aisle, bay, level })}
          </p>
        </div>
      </div>
      <div className="flex h-[160px] w-[160px] shrink-0 items-center justify-center rounded-lg bg-white p-2 ring-1 ring-gray-200">
        {segments ? (
          <LocationDataMatrix
            value={gs1LocationAi(rackToLocation(segments), { gln })}
            size={144}
            fgColor="#0F172A"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center">
            <Printer className="h-5 w-5 text-gray-300" />
            <p className="px-2 text-micro font-semibold text-gray-400">
              Barcode appears when all steps are picked
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function partialCode(s: { zone?: string; aisle?: number; bay?: number; level?: number }): string {
  // Width-matched ASCII placeholders so `?---------` lines up with a real
  // filled code like `A-01-01-1`.
  const parts: string[] = [];
  parts.push(s.zone ?? '?');
  parts.push(s.aisle != null ? pad2(s.aisle) : '--');
  parts.push(s.bay != null ? pad2(s.bay) : '--');
  parts.push(s.level != null ? noPad(s.level) : '-');
  return parts.join('-');
}

function humanReadable(s: { zone?: string; aisle?: number; bay?: number; level?: number }): string {
  // Zone letter is omitted intentionally — it's already shown in the big
  // code (`A-01-01-1`) and the zone/room line directly above this row, so
  // repeating it as a third copy adds noise without adding information.
  const out: string[] = [];
  if (s.aisle != null) out.push(`Aisle ${pad2(s.aisle)}`);
  if (s.bay != null) out.push(`Bay ${pad2(s.bay)} (${bayHand(s.bay)})`);
  if (s.level != null) out.push(`Level ${noPad(s.level)}`);
  return out.join(' → ') || 'Pick a room above';
}

// ─── Numeric step ─────────────────────────────────────────────────────────

interface NumericStepProps {
  title: string;
  count: number;
  selected?: number;
  onPick: (n: number) => void;
  customLabel?: string;
  hint?: string;
  unpadded?: boolean;
}

const NUMERIC_QUICK_PICKS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function NumericStep({
  title, count, selected, onPick, hint, unpadded,
  customLabel = 'Custom #',
}: NumericStepProps) {
  const format = unpadded ? noPad : pad2;
  const isCustomSelected = selected != null && selected > 9;
  const customPlaceholder = '10+';
  const reduceMotion = useReducedMotion();

  const [custom, setCustom] = useState('');
  const customNum = parseInt(custom, 10);
  const customValid =
    Number.isFinite(customNum) && customNum >= 1 && customNum <= 99;

  const confirmCustom = () => {
    if (!customValid) return;
    onPick(customNum);
    setCustom('');
  };

  const stepBy = (delta: number) => {
    if (!customValid) {
      setCustom('10');
      return;
    }
    const next = Math.min(99, Math.max(1, customNum + delta));
    setCustom(String(next));
  };

  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={title}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
      >
        <div className={`flex items-baseline justify-between ${hint ? 'mb-1' : 'mb-3'}`}>
          <h3 className="text-base font-semibold tracking-tight text-gray-900">{title}</h3>
          <span className="text-micro font-medium tabular-nums text-gray-400">
            up to {count}
          </span>
        </div>

        {hint && (
          <p className="mb-3 text-[11.5px] leading-snug text-gray-500">{hint}</p>
        )}

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {NUMERIC_QUICK_PICKS.map((n) => {
            const isSelected = selected === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onPick(n)}
                className={`relative flex h-16 flex-col items-center justify-center rounded-2xl border text-center transition-all active:scale-[0.97] ${
                  isSelected
                    ? 'border-transparent bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                    : 'border-gray-200 bg-white text-gray-900 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="font-mono text-lg font-semibold tabular-nums tracking-tight">
                  {format(n)}
                </span>
              </button>
            );
          })}

          <div
            className={`relative flex h-16 items-center rounded-2xl border border-dashed bg-white pl-3 pr-1 transition-colors ${
              isCustomSelected
                ? 'border-blue-300 ring-2 ring-blue-200'
                : 'border-gray-300 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
            }`}
            aria-label={customLabel}
          >
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmCustom();
                if (e.key === 'ArrowUp') { e.preventDefault(); stepBy(1); }
                if (e.key === 'ArrowDown') { e.preventDefault(); stepBy(-1); }
              }}
              placeholder={customPlaceholder}
              aria-label={customLabel}
              className="h-full w-full min-w-0 bg-transparent pr-1 text-center font-mono text-lg font-semibold tabular-nums tracking-tight text-gray-900 outline-none placeholder:text-label placeholder:font-medium placeholder:tracking-wide placeholder:text-gray-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />

            <div className="ml-1 flex h-12 shrink-0 flex-col justify-center gap-0.5">
              <button
                type="button"
                onClick={() => stepBy(1)}
                aria-label="Increment"
                className="flex h-[22px] w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 active:scale-95"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => stepBy(-1)}
                aria-label="Decrement"
                className="flex h-[22px] w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 active:scale-95"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={confirmCustom}
              disabled={!customValid}
              aria-label={`Confirm ${customLabel.toLowerCase()}`}
              className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm transition-all active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:bg-none disabled:text-gray-400 disabled:shadow-none"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Configuration sheet ──────────────────────────────────────────────────

interface ConfigSheetProps {
  open: boolean;
  onClose: () => void;
  config: PrinterConfig;
  onSave: (next: PrinterConfig) => void;
}

function ConfigSheet({ open, onClose, config, onSave }: ConfigSheetProps) {
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
      <p className="mb-4 text-center text-label text-gray-500">
        Match these to your warehouse layout. Saved locally — no rebuild required.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <NumField label="Aisles" value={draft.maxAisles} onChange={set('maxAisles')} />
        <NumField label="Bays" value={draft.maxBays} onChange={set('maxBays')} />
        <NumField label="Levels" value={draft.maxLevels} onChange={set('maxLevels')} />
      </div>

      <div className="mt-4">
        <label className="text-micro font-semibold uppercase tracking-wider text-gray-500">
          GLN (Global Location Number)
        </label>
        <input
          type="text"
          value={draft.gln}
          onChange={(e) => set('gln')(e.target.value)}
          className="mt-1 h-11 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 font-mono text-sm font-semibold text-gray-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200"
        />
        <p className="mt-1 text-micro text-gray-400">
          Default is the GS1 documentation placeholder ({DEFAULT_GLN}). Replace once registered with GS1 US.
        </p>
      </div>

      <div className="mt-3 text-micro text-gray-400">
        Domain in QR: <span className="font-mono">{QR_BASE_URL}</span>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:gap-3">
        <button
          type="button"
          onClick={handleSave}
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-semibold tracking-wide text-white shadow-md shadow-blue-600/30 transition-transform active:scale-[0.98] sm:flex-1"
        >
          <Check className="mr-1.5 h-4 w-4" />
          Save
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 sm:flex-1"
        >
          Reset
        </button>
      </div>
    </BottomSheet>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-micro font-semibold uppercase tracking-wider text-gray-500">{label}</label>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={99}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-12 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 text-center text-lg font-semibold tabular-nums text-gray-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200"
      />
    </div>
  );
}

// ─── Giant preview panel (desktop main-pane) ─────────────────────────────
// Rack label rendered at near-print size — bigger code, larger QR. Mirrors
// the bin printer's GiantPreviewPanel but with no position segment and a
// "Print bay" secondary action that fans out across all levels.

interface GiantRackPreviewPanelProps {
  zoneLetter?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  gln: string;
}

function GiantRackPreviewPanel({
  zoneLetter, aisle, bay, level, gln,
}: GiantRackPreviewPanelProps) {
  const segments: RackSegments | null = zoneLetter && aisle != null && bay != null && level != null
    ? { zone: zoneLetter, aisle, bay, level }
    : null;
  const code = segments
    ? rackCode(segments)
    : partialCode({ zone: zoneLetter, aisle, bay, level });
  const ai = segments ? gs1LocationAi(rackToLocation(segments), { gln }) : null;

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <p className="text-micro font-bold uppercase tracking-[0.22em] text-gray-400">
            Live preview · prints at 3″ × 2″
          </p>
        </div>

        <div className="mt-5 flex items-center justify-center">
          <div className="flex items-start gap-8 rounded-2xl border-2 border-dashed border-gray-200 bg-gradient-to-br from-white to-gray-50/50 p-8 shadow-inner">
            <div className="min-w-0 flex-1">
              <p className="text-caption font-bold uppercase tracking-[0.18em] text-gray-500">
                USAV Warehouse Rack
              </p>
              <p className="mt-2 whitespace-nowrap font-mono text-4xl font-black leading-none tracking-tight text-gray-900">
                {code}
              </p>
              <p className="mt-2 text-label font-semibold leading-snug text-gray-600">
                {humanReadable({ zone: zoneLetter, aisle, bay, level })}
              </p>
            </div>
            <div className="flex h-[240px] w-[240px] shrink-0 items-center justify-center rounded-xl bg-white p-3 ring-1 ring-gray-200">
              {ai ? (
                <LocationDataMatrix value={ai} size={216} fgColor="#0F172A" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                  <Printer className="h-7 w-7 text-gray-300" />
                  <p className="px-4 text-caption font-semibold text-gray-400">
                    Barcode appears when every step is picked in the sidebar
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Print label ──────────────────────────────────────────────────────────
// Rack label — larger code than the bin label, mounted on the rack upright
// and read from across the aisle.

function PrintLabel({ segments, roomName, gln }: { segments: RackSegments; roomName: string; gln: string }) {
  const code = rackCode(segments);
  const ai = gs1LocationAi(rackToLocation(segments), { gln });
  return (
    <div className="label-print-card" style={labelCardStyle}>
      <div style={labelLeftStyle}>
        <div style={labelEyebrowStyle}>USAV Warehouse Rack</div>
        <div style={labelCodeStyle}>{code}</div>
        {roomName && <div style={labelRoomStyle}>{roomName}</div>}
        <div style={labelHumanStyle}>
          Aisle {pad2(segments.aisle)} · Bay {pad2(segments.bay)} ({bayHand(segments.bay)})<br />
          Level {noPad(segments.level)} · whole rack
        </div>
      </div>
      <div style={labelQrStyle}>
        <LocationDataMatrix value={ai} size={115} />
      </div>
    </div>
  );
}

// 3in × 2in label stock — same media as the bin label so one printer
// can drive both flows. Rack code is fewer characters than a bin code,
// so the typography is slightly larger for read-from-across-the-aisle
// scannability.
const labelCardStyle: React.CSSProperties = {
  width: '3in',
  height: '2in',
  margin: 0,
  padding: '0.12in',
  display: 'inline-flex',
  alignItems: 'flex-start',
  gap: '0.1in',
  verticalAlign: 'top',
  fontFamily: '"Inter", "Arial", sans-serif',
  color: '#000',
  background: '#fff',
  boxSizing: 'border-box',
  overflow: 'hidden',
};
const labelLeftStyle: React.CSSProperties = { flex: '1 1 auto', minWidth: 0 };
const labelEyebrowStyle: React.CSSProperties = {
  fontSize: '7px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#666',
};
const labelCodeStyle: React.CSSProperties = {
  fontSize: '20px', fontWeight: 800, fontFamily: '"JetBrains Mono", monospace',
  letterSpacing: '-0.02em', marginTop: '4px', color: '#000', lineHeight: 1,
  whiteSpace: 'nowrap',
};
const labelRoomStyle: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, marginTop: '5px', color: '#0F172A',
};
const labelHumanStyle: React.CSSProperties = {
  fontSize: '8px', fontWeight: 600, marginTop: '3px', lineHeight: '1.35', color: '#333',
};
const labelQrStyle: React.CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
