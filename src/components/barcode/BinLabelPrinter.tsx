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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import QRCode from 'react-qr-code';
import { toast } from 'sonner';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { SkeletonCardGrid } from '@/components/ui/SkeletonCard';
import { Check, ChevronDown, ChevronLeft, ChevronUp, Printer, Settings } from '@/components/Icons';
import { successFeedback, errorFeedback, scanFeedback } from '@/lib/feedback/confirm';
import { useLocations } from '@/hooks/useLocations';
import { useHorizontalWheelScroll } from '@/hooks/useHorizontalWheelScroll';
import { WorkspaceCard, StickyActionBar } from '@/design-system/components';
import {
  DEFAULT_GLN,
  QR_BASE_URL,
  bayHand,
  gs1LocationUrl,
  locationCode,
  noPad,
  pad2,
  type LocationSegments,
} from '@/lib/barcode-routing';

// ─── Types & constants ────────────────────────────────────────────────────

interface PrinterConfig {
  maxAisles: number;
  maxBays: number;
  maxLevels: number;
  maxPositions: number;
  gln: string;
}

const DEFAULT_CONFIG: PrinterConfig = {
  maxAisles: 6,
  maxBays: 12,
  maxLevels: 5,
  maxPositions: 20,
  gln: DEFAULT_GLN,
};

const CONFIG_KEY = 'binPrinter.config.v4';
const STATE_KEY = 'binPrinter.state.v4';

type Step = 'zone' | 'aisle' | 'bay' | 'level' | 'position';
const STEPS: { id: Step; label: string }[] = [
  { id: 'zone',     label: 'Zone' },
  { id: 'aisle',    label: 'Aisle' },
  { id: 'bay',      label: 'Bay' },
  { id: 'level',    label: 'Level' },
  { id: 'position', label: 'Position' },
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
      maxPositions: clampMax(parsed?.maxPositions, DEFAULT_CONFIG.maxPositions),
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

interface SavedState {
  room?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  position?: number;
}

function loadState(): SavedState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as SavedState) : {};
  } catch { return {}; }
}

function saveState(s: SavedState): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ─── Component ────────────────────────────────────────────────────────────

export function BinLabelPrinter() {
  const { rooms, roomNames, loading } = useLocations();

  const [config, setConfig] = useState<PrinterConfig>(DEFAULT_CONFIG);
  const [hydrated, setHydrated] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  // Selection state
  const [selectedRoom, setSelectedRoom] = useState<string | undefined>();
  const [aisle, setAisle] = useState<number | undefined>();
  const [bay, setBay] = useState<number | undefined>();
  const [level, setLevel] = useState<number | undefined>();
  const [position, setPosition] = useState<number | undefined>();

  // Print state
  const [bulkLabels, setBulkLabels] = useState<LocationSegments[] | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Pill-driven back-navigation.
  const [overrideStep, setOverrideStep] = useState<Step | null>(null);

  useEffect(() => {
    setConfig(loadConfig());
    const s = loadState();
    if (s.room) setSelectedRoom(s.room);
    if (s.aisle) setAisle(s.aisle);
    if (s.bay) setBay(s.bay);
    if (s.level) setLevel(s.level);
    if (s.position) setPosition(s.position);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveState({ room: selectedRoom, aisle, bay, level, position });
  }, [selectedRoom, aisle, bay, level, position, hydrated]);

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
      setAisle(undefined);
      setBay(undefined);
      setLevel(undefined);
      setPosition(1);
    }
    setSelectedRoom(name);
    setOverrideStep(null);
  }, [selectedRoom]);

  const pickAisle = useCallback((n: number) => {
    scanFeedback();
    if (aisle !== n) {
      setBay(undefined);
      setLevel(undefined);
      setPosition(1);
    }
    setAisle(n);
    setOverrideStep(null);
  }, [aisle]);

  const pickBay = useCallback((n: number) => {
    scanFeedback();
    if (bay !== n) {
      setLevel(undefined);
      setPosition(1);
    }
    setBay(n);
    setOverrideStep(null);
  }, [bay]);

  const pickLevel = useCallback((n: number) => {
    scanFeedback();
    if (level !== n) setPosition(1);
    setLevel(n);
    setOverrideStep(null);
  }, [level]);

  const pickPosition = useCallback((n: number) => {
    scanFeedback();
    setPosition(n);
    setOverrideStep(null);
  }, []);

  const resetAll = useCallback(() => {
    scanFeedback();
    setSelectedRoom(undefined);
    setAisle(undefined);
    setBay(undefined);
    setLevel(undefined);
    setPosition(undefined);
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

  return (
    <div className="flex flex-col gap-4 pb-32">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Location Label Printer</h1>
          <p className="mt-1 text-[13px] text-gray-500">
            Pick a room, then drill down to the bin. Prints a QR-only GS1 Digital Link label.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(selectedRoom || aisle != null) && (
            <button
              type="button"
              onClick={resetAll}
              className="flex h-11 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 text-[12.5px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 active:scale-[0.97]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Start over
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            aria-label="Configure label printer"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 active:scale-95"
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
                <p className="truncate text-[15px] font-semibold text-gray-900">{selectedRoom}</p>
                <p className="mt-0.5 text-[11.5px] text-gray-500">
                  {zoneLetter ? `Zone ${zoneLetter}` : 'No zone letter yet — set one in the Rooms tab.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOverrideStep('zone')}
              className="shrink-0 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-gray-50"
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

      {/* Active-step body */}
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

      {/* Live preview — appears once first selection is made */}
      {(selectedRoom || aisle != null) && (
        <WorkspaceCard label="Live preview">
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

      <StickyActionBar
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

      <ConfigSheet
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        config={config}
        onSave={handleConfigSave}
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
        <p className="text-[13px] font-semibold text-gray-700">No rooms yet</p>
        <p className="mt-1 text-[11.5px] text-gray-500">
          Open the <span className="font-semibold">Rooms</span> tab and add one — it'll show up here.
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <p className="truncate text-[14px] font-semibold text-gray-900">{room}</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
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
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100/70 font-mono text-[20px] font-semibold text-blue-700 ring-1 ring-blue-200">
        {letter}
      </div>
    );
  }
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 font-mono text-[18px] font-semibold text-amber-700 ring-1 ring-amber-200"
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
            <React.Fragment key={id}>
              <button
                type="button"
                onClick={() => onPillClick(id)}
                disabled={!isClickable}
                aria-current={isActive ? 'step' : undefined}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold transition-all active:scale-95 ${
                  isActive
                    ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                    : isDone
                      ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
                title={id === 'zone' && roomName ? roomName : undefined}
              >
                <span className="text-[10px] uppercase tracking-wider opacity-80">{label}</span>
                <span className="font-mono text-[10px] font-semibold tabular-nums">{value ?? '—'}</span>
              </button>
              {showChevron && <span className="shrink-0 text-[10px] text-gray-300">›</span>}
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Location code</p>
          <p className="mt-0.5 whitespace-nowrap font-mono text-[18px] font-black tracking-tight text-gray-900">{code}</p>
        </div>
        {roomName && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Room</p>
            <p className="mt-0.5 truncate text-[13px] font-semibold text-gray-800">{roomName}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Breakdown</p>
          <p className="mt-0.5 text-[12px] leading-snug text-gray-700">
            {humanReadable({ zone: zoneLetter, aisle, bay, level, position })}
          </p>
        </div>
      </div>
      <div className="flex h-[160px] w-[160px] shrink-0 items-center justify-center rounded-lg bg-white p-2 ring-1 ring-gray-200">
        {segments ? (
          <QRCode
            value={gs1LocationUrl(segments, { gln })}
            size={144}
            level="M"
            fgColor="#0F172A"
            bgColor="#FFFFFF"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center">
            <Printer className="h-5 w-5 text-gray-300" />
            <p className="px-2 text-[10px] font-semibold text-gray-400">
              QR appears when all steps are picked
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function partialCode(s: { zone?: string; aisle?: number; bay?: number; level?: number; position?: number }): string {
  const parts: string[] = [];
  parts.push(s.zone ?? '?');
  parts.push(s.aisle != null ? pad2(s.aisle) : '—');
  parts.push(s.bay != null ? pad2(s.bay) : '—');
  parts.push(s.level != null ? noPad(s.level) : '—');
  parts.push(s.position != null ? pad2(s.position) : '—');
  return parts.join('-');
}

function humanReadable(s: { zone?: string; aisle?: number; bay?: number; level?: number; position?: number }): string {
  const out: string[] = [];
  if (s.zone) out.push(s.zone);
  if (s.aisle != null) out.push(`Aisle ${pad2(s.aisle)}`);
  if (s.bay != null) out.push(`Bay ${pad2(s.bay)} (${bayHand(s.bay)})`);
  if (s.level != null) out.push(`Level ${noPad(s.level)}`);
  if (s.position != null) out.push(`Position ${pad2(s.position)}`);
  return out.join(' → ') || 'Pick a room above';
}

// ─── Numeric step (aisle / bay / level) ───────────────────────────────────

interface NumericStepProps {
  title: string;
  prefix: string;
  count: number;
  selected?: number;
  onPick: (n: number) => void;
  renderTag?: (n: number) => string | null;
  customLabel?: string;
  /** Optional one-line explainer rendered between title and the tile grid. */
  hint?: string;
  /** When true, tile labels are unpadded ("1", "2", …) — matches the level
   *  segment on printed labels which uses {@link noPad}. Defaults to false. */
  unpadded?: boolean;
}

const NUMERIC_QUICK_PICKS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function NumericStep({
  title, prefix, count, selected, onPick, renderTag, hint, unpadded,
  customLabel = 'Custom #',
}: NumericStepProps) {
  const format = unpadded ? noPad : pad2;
  // selected > 9 means a custom value is the current pick; highlight the
  // 10th tile so users can see what they entered without scanning the
  // step pills at the top.
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

  // Stepper buttons. First tap on either arrow with an empty field always
  // lands on 10 (one past the quick-pick range), so the user discovers the
  // custom range without overshooting. Subsequent taps step from there.
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
        key={prefix || 'num'}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
      >
        <div className={`flex items-baseline justify-between ${hint ? 'mb-1' : 'mb-3'}`}>
          <h3 className="text-[15px] font-semibold tracking-tight text-gray-900">{title}</h3>
          <span className="text-[10px] font-medium tabular-nums text-gray-400">
            up to {count}
          </span>
        </div>

        {hint && (
          <p className="mb-3 text-[11.5px] leading-snug text-gray-500">{hint}</p>
        )}

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {NUMERIC_QUICK_PICKS.map((n) => {
            const isSelected = selected === n;
            const tag = renderTag ? renderTag(n) : null;
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
                <span className="font-mono text-[18px] font-semibold tabular-nums tracking-tight">
                  {prefix}{format(n)}
                </span>
                {tag && (
                  <span className={`mt-0.5 text-[9px] font-bold uppercase tracking-wider ${
                    isSelected ? 'text-white/80' : 'text-gray-400'
                  }`}>
                    {tag}
                  </span>
                )}
              </button>
            );
          })}

          {/* 10th tile = inline custom input with stepper + checkmark.
              Subsumes the separate "Custom #" row that used to live below
              the grid. */}
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
              className="h-full w-full min-w-0 bg-transparent pr-1 text-center font-mono text-[18px] font-semibold tabular-nums tracking-tight text-gray-900 outline-none placeholder:text-[12px] placeholder:font-medium placeholder:tracking-wide placeholder:text-gray-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
      maxPositions: clampMax(draft.maxPositions, DEFAULT_CONFIG.maxPositions),
      gln: draft.gln.trim() || DEFAULT_GLN,
    });
  };

  const handleReset = () => setDraft({ ...DEFAULT_CONFIG });

  return (
    <BottomSheet open={open} onClose={onClose} title="Configure counts">
      <p className="mb-4 text-center text-[12px] text-gray-500">
        Match these to your warehouse layout. Saved locally — no rebuild required.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <NumField label="Aisles" value={draft.maxAisles} onChange={set('maxAisles')} />
        <NumField label="Bays" value={draft.maxBays} onChange={set('maxBays')} />
        <NumField label="Levels" value={draft.maxLevels} onChange={set('maxLevels')} />
        <NumField label="Positions" value={draft.maxPositions} onChange={set('maxPositions')} />
      </div>

      <div className="mt-4">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          GLN (Global Location Number)
        </label>
        <input
          type="text"
          value={draft.gln}
          onChange={(e) => set('gln')(e.target.value)}
          className="mt-1 h-11 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 font-mono text-[13px] font-semibold text-gray-900 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200"
        />
        <p className="mt-1 text-[10px] text-gray-400">
          Default is the GS1 documentation placeholder ({DEFAULT_GLN}). Replace once registered with GS1 US.
        </p>
      </div>

      <div className="mt-3 text-[10px] text-gray-400">
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
      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</label>
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

// ─── Print label ──────────────────────────────────────────────────────────

function PrintLabel({ segments, roomName, gln }: { segments: LocationSegments; roomName: string; gln: string }) {
  const code = locationCode(segments);
  const uri = gs1LocationUrl(segments, { gln });
  return (
    <div className="label-print-card" style={labelCardStyle}>
      <div style={labelLeftStyle}>
        <div style={labelEyebrowStyle}>USAV Warehouse Location</div>
        <div style={labelCodeStyle}>{code}</div>
        {roomName && <div style={labelRoomStyle}>{segments.zone} {roomName}</div>}
        <div style={labelHumanStyle}>
          Aisle {pad2(segments.aisle)} · Bay {pad2(segments.bay)} ({bayHand(segments.bay)})<br />
          Level {noPad(segments.level)} · Position {pad2(segments.position)}
        </div>
      </div>
      <div style={labelQrStyle}>
        <QRCode value={uri} size={140} level="M" fgColor="#000000" bgColor="#FFFFFF" />
      </div>
    </div>
  );
}

const labelCardStyle: React.CSSProperties = {
  width: '4.25in',
  margin: '0.1in',
  padding: '0.2in',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.18in',
  verticalAlign: 'top',
  fontFamily: '"Inter", "Arial", sans-serif',
  color: '#000',
  background: '#fff',
};
const labelLeftStyle: React.CSSProperties = { flex: '1 1 auto', minWidth: 0 };
const labelEyebrowStyle: React.CSSProperties = {
  fontSize: '8px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#666',
};
const labelCodeStyle: React.CSSProperties = {
  fontSize: '26px', fontWeight: 800, fontFamily: '"JetBrains Mono", monospace',
  letterSpacing: '0.02em', marginTop: '6px', color: '#000',
};
const labelRoomStyle: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, marginTop: '6px', color: '#0F172A',
};
const labelHumanStyle: React.CSSProperties = {
  fontSize: '9px', fontWeight: 600, marginTop: '4px', lineHeight: '1.4', color: '#333',
};
const labelQrStyle: React.CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
