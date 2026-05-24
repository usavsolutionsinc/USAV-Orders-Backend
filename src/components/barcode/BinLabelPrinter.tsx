'use client';

/**
 * Location Label Printer — main-pane workspace.
 *
 * Five-step location builder (zone → aisle → bay → level → position) that
 * outputs a QR-only thermal label. Lives inside LabelPrintWorkspace; renders
 * with the MultiSkuSnBarcode-horizontal language: WorkspaceCard surfaces,
 * StickyActionBar for the primary print action, BottomSheet for config.
 *
 * Rooms are a read-only input here — add / rename / re-letter / reorder
 * are done from the Rooms tab (RoomsBoard owns that CRUD). The zone letter
 * for the picked room comes from locations.zone_letter on the server.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LocationDataMatrix } from './LocationDataMatrix';
import { toast } from 'sonner';
import { SkeletonCardGrid } from '@/components/ui/SkeletonCard';
import { ChevronLeft, Printer, Settings } from '@/components/Icons';
import { successFeedback, errorFeedback, scanFeedback } from '@/lib/feedback/confirm';
import { useLocations } from '@/hooks/useLocations';
import { useHorizontalWheelScroll } from '@/hooks/useHorizontalWheelScroll';
import { LabelRoomSidebar } from './LabelRoomSidebar';
import {
  useLabelPrinterStore,
  patchLabelPrinterState,
  resetLabelPrinterState,
} from '@/hooks/useLabelPrinterStore';
import { WorkspaceCard, StickyActionBar } from '@/design-system/components';
import {
  gs1LocationAi,
  locationCode,
  noPad,
  pad2,
  type LocationSegments,
} from '@/lib/barcode-routing';
import {
  ConfigSheet,
  DEFAULT_CONFIG,
  GiantPreviewPanel,
  NumericStep,
  PrintLabel,
  STEPS,
  type PrinterConfig,
  type Step,
  humanReadable,
  loadConfig,
  partialCode,
  saveConfig,
} from './bin-label-printer';

// ─── Component ────────────────────────────────────────────────────────────

/**
 * Where the printer is being rendered. Drives the responsive split:
 *   - `main`    — full-width main pane. On mobile shows the full
 *                 picker + preview; on lg+ collapses to a giant preview
 *                 panel because the picker has been promoted to the
 *                 sidebar.
 *   - `sidebar` — narrow sidebar rail (desktop only via `hidden lg:block`
 *                 from the caller). Picker only — preview lives in the
 *                 main pane so we don't render it twice.
 */
export type LabelPrinterVariant = 'main' | 'sidebar';

interface BinLabelPrinterProps {
  variant?: LabelPrinterVariant;
}

export function BinLabelPrinter({ variant = 'main' }: BinLabelPrinterProps) {
  const { rooms, roomNames, loading } = useLocations();

  const [config, setConfig] = useState<PrinterConfig>(DEFAULT_CONFIG);
  const [configOpen, setConfigOpen] = useState(false);

  // Selection state — backed by the shared cross-surface store so the
  // main-pane preview stays in lock-step with the sidebar picker.
  const stored = useLabelPrinterStore();
  const selectedRoom = stored.room;
  const aisle = stored.aisle;
  const bay = stored.bay;
  const level = stored.level;
  const position = stored.position;

  // Print state
  const [bulkLabels, setBulkLabels] = useState<LocationSegments[] | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Pill-driven back-navigation.
  const [overrideStep, setOverrideStep] = useState<Step | null>(null);

  useEffect(() => {
    setConfig(loadConfig());
  }, []);

  // ─── Server-of-record zone-letter map ───────────────────────────────────
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

  const binCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of rooms) {
      const name = (l.room || l.name)?.trim();
      if (name) c[name] = 0; // seed
    }
    return c;
  }, [rooms]);

  // ─── Selection handlers ─────────────────────────────────────────────────
  const pickRoom = useCallback((name: string) => {
    successFeedback();
    if (selectedRoom !== name) {
      patchLabelPrinterState({ room: name, aisle: undefined, bay: undefined, level: undefined, position: 1 });
    } else {
      patchLabelPrinterState({ room: name });
    }
    setOverrideStep(null);
  }, [selectedRoom]);

  const pickAisle = useCallback((n: number) => {
    scanFeedback();
    if (aisle !== n) {
      patchLabelPrinterState({ aisle: n, bay: undefined, level: undefined, position: 1 });
    } else {
      patchLabelPrinterState({ aisle: n });
    }
    setOverrideStep(null);
  }, [aisle]);

  const pickBay = useCallback((n: number) => {
    scanFeedback();
    if (bay !== n) {
      patchLabelPrinterState({ bay: n, level: undefined, position: 1 });
    } else {
      patchLabelPrinterState({ bay: n });
    }
    setOverrideStep(null);
  }, [bay]);

  const pickLevel = useCallback((n: number) => {
    scanFeedback();
    if (level !== n) {
      patchLabelPrinterState({ level: n, position: 1 });
    } else {
      patchLabelPrinterState({ level: n });
    }
    setOverrideStep(null);
  }, [level]);

  const pickPosition = useCallback((n: number) => {
    scanFeedback();
    patchLabelPrinterState({ position: n });
    setOverrideStep(null);
  }, []);

  const resetAll = useCallback(() => {
    scanFeedback();
    resetLabelPrinterState();
    setOverrideStep(null);
  }, []);

  const computedStep: Step = useMemo(() => {
    if (!selectedRoom) return 'zone';
    if (aisle == null) return 'aisle';
    if (bay == null) return 'bay';
    if (level == null) return 'level';
    return 'position';
  }, [selectedRoom, aisle, bay, level]);

  const activeStep: Step = overrideStep ?? computedStep;

  const handlePillClick = useCallback((step: Step) => {
    const done: Record<Step, boolean> = {
      zone: !!selectedRoom,
      aisle: aisle != null,
      bay: bay != null,
      level: level != null,
      position: position != null,
    };
    if (!done[step] && step !== computedStep) return;
    if (step === activeStep) return;
    scanFeedback();
    setOverrideStep(step);
  }, [selectedRoom, aisle, bay, level, position, computedStep, activeStep]);

  const allSelected = selectedRoom != null && aisle != null && bay != null && level != null && position != null;
  const zoneLetter = selectedRoom ? zoneMap[selectedRoom] : undefined;

  const currentSegments: LocationSegments | null = allSelected && zoneLetter
    ? { zone: zoneLetter, aisle: aisle!, bay: bay!, level: level!, position: position! }
    : null;

  const missingLetter = !!selectedRoom && !zoneLetter;

  // ─── Print ─────────────────────────────────────────────────────────────
  // Before window.print(), register every label in the locations table so
  // scans of the printed QR resolve to a real bin row, putaway audits
  // work, and the bin appears in bins-overview. If registration fails we
  // abort the print — printing an orphan label is worse than nothing.
  const triggerPrint = useCallback(async (labels: LocationSegments[]) => {
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
        body: JSON.stringify({ room: selectedRoom, segments: labels }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `Registration failed (HTTP ${res.status})`);
      }
    } catch (err: any) {
      setIsPrinting(false);
      errorFeedback();
      toast.error(err?.message || 'Could not register location for printing');
      return;
    }

    setBulkLabels(labels);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        setTimeout(() => {
          setBulkLabels(null);
          setIsPrinting(false);
          successFeedback();
          toast.success(`Printed ${labels.length} label${labels.length === 1 ? '' : 's'}`);
        }, 250);
      });
    });
  }, [selectedRoom]);

  const handlePrintOne = useCallback(() => {
    if (!currentSegments) return;
    triggerPrint([currentSegments]);
  }, [currentSegments, triggerPrint]);

  const handlePrintBulk = useCallback(() => {
    if (!zoneLetter || aisle == null || bay == null || level == null) return;
    const labels: LocationSegments[] = [];
    for (let p = 1; p <= config.maxPositions; p += 1) {
      labels.push({ zone: zoneLetter, aisle, bay, level, position: p });
    }
    triggerPrint(labels);
  }, [zoneLetter, aisle, bay, level, config.maxPositions, triggerPrint]);

  const handleConfigSave = useCallback((next: PrinterConfig) => {
    setConfig(next);
    saveConfig(next);
    successFeedback();
    toast.success('Configuration saved');
    setConfigOpen(false);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+P prints current label if ready.
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

  // Picker block — header + pills + selected room card + active step body.
  // Rendered in the sidebar (desktop) and in the main pane (mobile, via
  // `lg:hidden` on the wrapper) so picker UI only shows on one surface
  // at any breakpoint.
  const picker = (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className={variant === 'sidebar'
            ? 'text-base font-bold tracking-tight text-gray-900'
            : 'text-2xl font-bold tracking-tight text-gray-900'}
          >
            {variant === 'sidebar' ? 'Build a bin label' : 'Location Label Printer'}
          </h1>
          {variant === 'main' && (
            <p className="mt-1 text-sm text-gray-500">
              Pick a room, then drill down to the bin. Prints a QR-only GS1 Digital Link label.
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
            aria-label="Configure label printer"
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
        position={position}
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
            binCounts={binCounts}
            loading={loading}
            selectedRoom={selectedRoom}
            onSelect={pickRoom}
          />
        )}
        {activeStep === 'aisle' && (
          <NumericStep
            key="aisle"
            title="Pick an aisle"
            prefix=""
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
            prefix=""
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
            prefix=""
            count={config.maxLevels}
            selected={level}
            onPick={pickLevel}
            customLabel="Custom level #"
            unpadded
          />
        )}
        {activeStep === 'position' && (
          <NumericStep
            key="position"
            title="Pick a position"
            prefix=""
            count={config.maxPositions}
            selected={position}
            onPick={pickPosition}
            customLabel="Custom position #"
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
  // Mirrors the rooms-tab pattern: the *list* of zones/rooms lives in the
  // sidebar; every other step (aisle/bay/level/position, the preview, and
  // print actions) renders in the main pane. WMS industry-standard split —
  // pickers stay glanceable, the build surface dominates the workspace.
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
          emptySubtitle="Then build the bin code on the right."
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
  // Mobile: full picker + small preview + sticky action bar.
  // Desktop (lg+): step pills + selected room card + active non-zone step
  // body + GiantPreviewPanel. The room list lives in the sidebar.
  const desktopBuilder = (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro font-bold uppercase tracking-[0.16em] text-blue-600">
            Location Label Printer
          </p>
          <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight text-gray-900">
            {selectedRoom ?? 'Pick a room to start'}
          </h1>
          <p className="mt-1 max-w-[60ch] text-[12.5px] leading-snug text-gray-500">
            {selectedRoom
              ? 'Drill down to a specific bin. Prints a QR-only GS1 Digital Link label.'
              : 'Choose a room in the sidebar — the remaining steps unlock here.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            aria-label="Configure label printer"
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
        position={position}
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
              Tap any zone on the left. Aisle, bay, level, and position unlock
              here as soon as a room is chosen.
            </p>
          </div>
        </WorkspaceCard>
      ) : (
        <WorkspaceCard label={STEPS.find((s) => s.id === activeStep)?.label} tone="blue">
          {activeStep === 'aisle' && (
            <NumericStep
              key="aisle"
              title="Pick an aisle"
              prefix=""
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
              prefix=""
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
              prefix=""
              count={config.maxLevels}
              selected={level}
              onPick={pickLevel}
              customLabel="Custom level #"
              unpadded
            />
          )}
          {activeStep === 'position' && (
            <NumericStep
              key="position"
              title="Pick a position"
              prefix=""
              count={config.maxPositions}
              selected={position}
              onPick={pickPosition}
              customLabel="Custom position #"
            />
          )}
        </WorkspaceCard>
      )}

      <GiantPreviewPanel
        zoneLetter={zoneLetter}
        roomName={selectedRoom}
        aisle={aisle}
        bay={bay}
        level={level}
        position={position}
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
    // flex-1 + min-h-0 lets this column fill the LabelPrintWorkspace height;
    // mt-auto on the StickyActionBar pins it to the bottom of the page.
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
            position={position}
            gln={config.gln}
          />
        </WorkspaceCard>
      )}

      <div className="hidden lg:block">{desktopBuilder}</div>

      <StickyActionBar
        // Receiving-page parity: bar lives as the bottom sibling of a flex
        // column, with negative margins that cancel the /warehouse page's
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
                : 'Print bin label',
          onClick: handlePrintOne,
          disabled: !allSelected || isPrinting || missingLetter,
          isLoading: isPrinting,
          tone: 'blue',
          icon: <Printer className="h-4 w-4" />,
        }}
        secondary={
          allSelected
            ? {
                label: `Print level (×${config.maxPositions})`,
                onClick: handlePrintBulk,
                icon: <Printer className="h-4 w-4" />,
                disabled: isPrinting || missingLetter,
              }
            : undefined
        }
        hints={allSelected ? [{ key: '⌘P', label: 'Print' }] : []}
      />

      {/* Print zone — hidden on screen, fills page on print */}
      <div className="label-print-zone">
        {bulkLabels?.map((seg, i) => (
          <PrintLabel
            key={`${locationCode(seg)}-${i}`}
            segments={seg}
            roomName={selectedRoom ?? ''}
            gln={config.gln}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Room picker (read-only grid; CRUD lives in RoomsBoard) ───────────────

interface RoomPickerProps {
  rooms: string[];
  zoneMap: Record<string, string>;
  binCounts: Record<string, number>;
  loading: boolean;
  selectedRoom?: string;
  onSelect: (n: string) => void;
}

function RoomPicker({ rooms, zoneMap, loading, selectedRoom, onSelect }: RoomPickerProps) {
  if (loading) {
    return <SkeletonCardGrid count={4} className="h-16" />;
  }
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

// ─── Step pills ────────────────────────────────────────────────────────────

interface StepPillsProps {
  activeStep: Step;
  zoneLetter?: string;
  roomName?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  position?: number;
  onPillClick: (step: Step) => void;
}

function StepPills({ activeStep, zoneLetter, roomName, aisle, bay, level, position, onPillClick }: StepPillsProps) {
  const values: Record<Step, string | undefined> = {
    zone: zoneLetter,
    aisle: aisle != null ? pad2(aisle) : undefined,
    bay: bay != null ? pad2(bay) : undefined,
    level: level != null ? noPad(level) : undefined,
    position: position != null ? pad2(position) : undefined,
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  useHorizontalWheelScroll(scrollRef);

  return (
    <div
      ref={scrollRef}
      className="flex w-full min-w-0 overflow-x-scroll overflow-y-hidden overscroll-x-contain rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-gray-200/60 [-ms-overflow-style:none] [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
      role="navigation"
      aria-label="Bin location steps"
    >
      <div className="flex w-max max-w-none flex-none flex-nowrap items-center gap-1">
        {STEPS.map(({ id, label }, idx) => {
          const value = values[id];
          const isDone = !!value;
          const isActive = activeStep === id;
          const isClickable = isDone || isActive;
          const showChevron = idx < STEPS.length - 1;
          return (
            <Fragment key={id}>
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
            </Fragment>
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
  position?: number;
  gln: string;
}

function LivePreviewBody({ zoneLetter, roomName, aisle, bay, level, position, gln }: LivePreviewBodyProps) {
  const all = zoneLetter && aisle != null && bay != null && level != null && position != null;
  const segments: LocationSegments | null = all
    ? { zone: zoneLetter!, aisle: aisle!, bay: bay!, level: level!, position: position! }
    : null;
  const code = segments
    ? locationCode(segments)
    : partialCode({ zone: zoneLetter, aisle, bay, level, position });

  return (
    <div className="flex items-center gap-5 rounded-xl bg-gray-50 p-5 ring-1 ring-gray-200/50">
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">Location code</p>
          <p className="mt-0.5 whitespace-nowrap font-mono text-lg font-black tracking-tight text-gray-900">{code}</p>
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
            {humanReadable({ zone: zoneLetter, aisle, bay, level, position })}
          </p>
        </div>
      </div>
      <div className="flex h-[160px] w-[160px] shrink-0 items-center justify-center rounded-lg bg-white p-2 ring-1 ring-gray-200">
        {segments ? (
          <LocationDataMatrix
            value={gs1LocationAi(segments, { gln })}
            size={144}
            fgColor="#0F172A"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center">
            <Printer className="h-5 w-5 text-gray-300" />
            <p className="px-2 text-micro font-semibold text-gray-400">
              QR appears when all steps are picked
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

