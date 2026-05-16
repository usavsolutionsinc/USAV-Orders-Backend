'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, Reorder, useReducedMotion } from 'framer-motion';
import QRCode from 'react-qr-code';
import { toast } from 'sonner';
import { BottomSheet, ConfirmSheet } from '@/components/ui/BottomSheet';
import { SkeletonCardGrid } from '@/components/ui/SkeletonCard';
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Printer, Settings, Trash2,
} from '@/components/Icons';
import { successFeedback, errorFeedback, scanFeedback } from '@/lib/feedback/confirm';
import { useLocations } from '@/hooks/useLocations';
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

// ─── Types ──────────────────────────────────────────────────────────────────

interface BinLabelPrinterProps {
  isActive: boolean;
}

interface PrinterConfig {
  maxAisles: number;
  maxBays: number;
  maxLevels: number;
  maxPositions: number;
  gln: string;
  /** Persistent room-name → zone-letter A-Z assignment. */
  zoneMap: Record<string, string>;
}

const DEFAULT_CONFIG: PrinterConfig = {
  maxAisles: 6,
  maxBays: 12,
  maxLevels: 5,
  maxPositions: 20,
  gln: DEFAULT_GLN,
  zoneMap: {},
};

const CONFIG_KEY = 'binPrinter.config.v3';
const STATE_KEY = 'binPrinter.state.v3';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

type Step = 'zone' | 'aisle' | 'bay' | 'level' | 'position';
const STEPS: { id: Step; label: string }[] = [
  { id: 'zone',     label: 'Zone' },
  { id: 'aisle',    label: 'Aisle' },
  { id: 'bay',      label: 'Bay' },
  { id: 'level',    label: 'Level' },
  { id: 'position', label: 'Position' },
];

// ─── Storage helpers ────────────────────────────────────────────────────────

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
      zoneMap: parsed?.zoneMap && typeof parsed.zoneMap === 'object' ? sanitizeZoneMap(parsed.zoneMap) : {},
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(cfg: PrinterConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

function sanitizeZoneMap(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const letter = String(v ?? '').trim().toUpperCase().charAt(0);
    if (k && /[A-Z]/.test(letter)) out[k] = letter;
  }
  return out;
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
  } catch {
    return {};
  }
}

function saveState(s: SavedState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Find the next unused A-Z letter, excluding ones already mapped. */
function nextFreeLetter(used: Set<string>): string {
  for (const l of LETTERS) if (!used.has(l)) return l;
  return 'A';
}

// ─── Component ──────────────────────────────────────────────────────────────

export function BinLabelPrinter({ isActive }: BinLabelPrinterProps) {
  const {
    locations, rooms, roomNames, loading,
    createRoom, renameRoom, removeRoom, reorderRooms,
    roomMutating,
  } = useLocations();

  const [config, setConfig] = useState<PrinterConfig>(DEFAULT_CONFIG);
  const [hydrated, setHydrated] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  // Selection state
  const [selectedRoom, setSelectedRoom] = useState<string | undefined>();
  const [aisle, setAisle] = useState<number | undefined>();
  const [bay, setBay] = useState<number | undefined>();
  const [level, setLevel] = useState<number | undefined>();
  const [position, setPosition] = useState<number | undefined>();

  // Room CRUD UI state
  const [editMode, setEditMode] = useState(false);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [addingRoom, setAddingRoom] = useState(false);
  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());

  // Print state
  const [bulkLabels, setBulkLabels] = useState<LocationSegments[] | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Pill-driven back-navigation. When set, overrides the auto-computed step.
  const [overrideStep, setOverrideStep] = useState<Step | null>(null);

  // Hydrate once.
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

  // ─── Canonical, optimistic-aware room list ──────────────────────────────
  const allRoomNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) {
      const key = (r.room || r.name)?.trim();
      if (key) set.add(key);
    }
    for (const r of roomNames) if (r) set.add(r);
    return Array.from(set);
  }, [rooms, roomNames]);

  const orderedRooms = useMemo(() => {
    const baseline = localOrder
      ? localOrder.filter((n) => allRoomNames.includes(n))
      : [...allRoomNames].sort((a, b) => {
          const sa = rooms.find((r) => (r.room || r.name) === a)?.sort_order ?? 0;
          const sb = rooms.find((r) => (r.room || r.name) === b)?.sort_order ?? 0;
          if (sa !== sb) return sa - sb;
          return a.localeCompare(b);
        });
    for (const n of allRoomNames) if (!baseline.includes(n)) baseline.push(n);
    return baseline.filter((n) => !pendingDeletes.has(n));
  }, [allRoomNames, localOrder, rooms, pendingDeletes]);

  const binCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of locations) {
      if (!l.room || !l.row_label || !l.col_label) continue;
      c[l.room] = (c[l.room] ?? 0) + 1;
    }
    return c;
  }, [locations]);

  // ─── Selection handlers — only reset downstream when value actually changes ───
  const pickRoom = useCallback((name: string) => {
    if (editMode) return;
    successFeedback();
    if (selectedRoom !== name) {
      setAisle(undefined);
      setBay(undefined);
      setLevel(undefined);
      setPosition(1);
    }
    setSelectedRoom(name);
    setOverrideStep(null);
  }, [editMode, selectedRoom]);

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

  /** Computed step — first incomplete tier. */
  const computedStep: Step = useMemo(() => {
    if (!selectedRoom) return 'zone';
    if (aisle == null) return 'aisle';
    if (bay == null) return 'bay';
    if (level == null) return 'level';
    return 'position';
  }, [selectedRoom, aisle, bay, level]);

  /** Active step — pill click can override; otherwise falls back to computed. */
  const activeStep: Step = overrideStep ?? computedStep;

  /** Pill click navigates back to that step if it's already completed (or current). */
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
  const zoneLetter = selectedRoom ? config.zoneMap[selectedRoom] : undefined;

  const currentSegments: LocationSegments | null = allSelected && zoneLetter
    ? { zone: zoneLetter, aisle: aisle!, bay: bay!, level: level!, position: position! }
    : null;

  // ─── Room CRUD: create / rename / delete / reorder (optimistic) ────────
  const usedLetters = useMemo(() => new Set(Object.values(config.zoneMap)), [config.zoneMap]);

  const upsertZoneLetter = useCallback((roomName: string, letter: string) => {
    setConfig((cur) => {
      const next: PrinterConfig = {
        ...cur,
        zoneMap: { ...cur.zoneMap, [roomName]: letter.toUpperCase() },
      };
      saveConfig(next);
      return next;
    });
  }, []);

  const dropZoneLetter = useCallback((roomName: string) => {
    setConfig((cur) => {
      const map = { ...cur.zoneMap };
      delete map[roomName];
      const next = { ...cur, zoneMap: map };
      saveConfig(next);
      return next;
    });
  }, []);

  const handleAddRoom = useCallback(async (name: string, letter: string) => {
    const next = [name, ...(localOrder ?? orderedRooms)].filter((v, i, arr) => arr.indexOf(v) === i);
    setLocalOrder(next);
    upsertZoneLetter(name, letter);
    try {
      const result = await createRoom(name);
      if (!result) throw new Error('Create failed');
      successFeedback();
      toast.success(`Room "${name}" added (Zone ${letter})`);
    } catch (err: any) {
      errorFeedback();
      setLocalOrder((cur) => (cur ?? next).filter((n) => n !== name));
      dropZoneLetter(name);
      toast.error(err?.message || 'Could not add room');
    }
  }, [createRoom, localOrder, orderedRooms, upsertZoneLetter, dropZoneLetter]);

  const handleSaveRoom = useCallback(async (
    oldName: string,
    newName: string,
    letter: string,
  ) => {
    // Letter-only update is local; no API.
    if (oldName === newName) {
      upsertZoneLetter(newName, letter);
      successFeedback();
      toast.success(`Zone letter updated to ${letter}`);
      return;
    }
    // Rename + letter update.
    try {
      const result = await renameRoom(oldName, newName);
      if (!result) throw new Error('Rename failed');
      // Move the letter to the new name and drop the old key.
      setConfig((cur) => {
        const map = { ...cur.zoneMap };
        delete map[oldName];
        map[newName] = letter.toUpperCase();
        const next = { ...cur, zoneMap: map };
        saveConfig(next);
        return next;
      });
      if (selectedRoom === oldName) setSelectedRoom(newName);
      setLocalOrder((cur) => {
        if (!cur) return cur;
        const idx = cur.indexOf(oldName);
        if (idx === -1) return cur;
        const arr = [...cur];
        arr[idx] = newName;
        return arr;
      });
      successFeedback();
      toast.success(`Renamed to "${newName}" (Zone ${letter})`);
    } catch (err: any) {
      errorFeedback();
      toast.error(err?.message || 'Could not save');
    }
  }, [renameRoom, selectedRoom, upsertZoneLetter]);

  const handleConfirmDelete = useCallback(async () => {
    const name = confirmDeleteRoom;
    if (!name) return;
    setPendingDeletes((s) => new Set(s).add(name));
    if (selectedRoom === name) setSelectedRoom(undefined);
    try {
      const result = await removeRoom(name);
      if (!result) throw new Error('Delete failed');
      dropZoneLetter(name);
      setLocalOrder((cur) => cur?.filter((n) => n !== name) ?? cur);
      successFeedback();
      toast.success(`Room "${name}" deleted`);
    } catch (err: any) {
      errorFeedback();
      setPendingDeletes((s) => {
        const next = new Set(s);
        next.delete(name);
        return next;
      });
      toast.error(err?.message || 'Could not delete');
    }
  }, [confirmDeleteRoom, removeRoom, selectedRoom, dropZoneLetter]);

  const handleReorder = useCallback((order: string[]) => {
    setLocalOrder(order);
  }, []);

  const handleToggleEdit = useCallback(() => {
    successFeedback();
    setEditMode((v) => {
      if (v && localOrder) {
        const order = localOrder.filter((n) => !pendingDeletes.has(n));
        reorderRooms(order)
          .then(() => {
            toast.success('Room order saved');
            setLocalOrder(null);
          })
          .catch((err) => {
            errorFeedback();
            toast.error(err?.message || 'Could not save order');
          });
      }
      return !v;
    });
  }, [localOrder, pendingDeletes, reorderRooms]);

  // ─── Print ────────────────────────────────────────────────────────────
  const triggerPrint = useCallback((labels: LocationSegments[]) => {
    if (labels.length === 0) return;
    setIsPrinting(true);
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
  }, []);

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

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div className={`min-w-0 transition-opacity duration-200 ${!isActive ? 'opacity-15 pointer-events-none' : ''}`}>
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/80 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          {(selectedRoom || aisle != null || bay != null || level != null) && (
            <button
              type="button"
              onClick={resetAll}
              className="flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 active:scale-95"
              aria-label="Reset"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <h2 className="text-[15px] font-semibold tracking-tight text-gray-900">
            {activeStep === 'zone' ? (editMode ? 'Manage rooms' : 'Select a room') : 'Bin Label Printer'}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {activeStep === 'zone' && (
            <button
              type="button"
              onClick={handleToggleEdit}
              aria-label={editMode ? 'Done editing' : 'Edit rooms'}
              aria-pressed={editMode}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-95 ${
                editMode
                  ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {editMode ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Step pills */}
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

      {/* Live preview — visible from the first selection onwards */}
      {(selectedRoom || aisle != null) && (
        <LivePreview
          zoneLetter={zoneLetter}
          aisle={aisle}
          bay={bay}
          level={level}
          position={position}
        />
      )}

      {/* Stage body */}
      <div className="px-4 py-3">
        {activeStep === 'zone' && (
          <ZoneRoomsList
            rooms={orderedRooms}
            binCounts={binCounts}
            zoneMap={config.zoneMap}
            loading={loading}
            editMode={editMode}
            mutating={roomMutating}
            onSelect={pickRoom}
            onStartRename={(name) => setEditingRoom(name)}
            onRequestDelete={(name) => setConfirmDeleteRoom(name)}
            onStartAdd={() => setAddingRoom(true)}
            onReorder={handleReorder}
            onOpenConfig={() => setConfigOpen(true)}
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
            prefix="B"
            count={config.maxBays}
            selected={bay}
            onPick={pickBay}
            renderTag={(n) => bayHand(n)}
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
          />
        )}
        {activeStep === 'position' && (
          <PositionStep
            key="position"
            value={position ?? 1}
            max={config.maxPositions}
            onPick={pickPosition}
          />
        )}
      </div>

      {/* Bottom label preview — what the printed sticker actually shows */}
      {currentSegments && (
        <div className="mx-4 mb-3 flex items-start gap-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-16px_rgba(0,0,0,0.10)]">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Location code
            </div>
            <div className="mt-1 whitespace-nowrap font-mono text-[16px] font-semibold tracking-tight text-gray-900">
              {locationCode(currentSegments)}
            </div>
            <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Breakdown
            </div>
            <div className="mt-1 text-[11px] leading-snug text-gray-700">
              {humanReadable({ zone: zoneLetter, aisle, bay, level, position })}
            </div>
          </div>
          <div className="flex-shrink-0 rounded-2xl bg-white p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-gray-100">
            <QRCode
              value={gs1LocationUrl(currentSegments, { gln: config.gln })}
              size={120}
              level="M"
              fgColor="#0F172A"
              bgColor="#FFFFFF"
            />
          </div>
        </div>
      )}

      {/* Sticky split-action print bar — left chevron opens bulk menu, right is the main print */}
      {allSelected && (
        <div
          className="sticky bottom-0 border-t border-gray-100 bg-white/80 px-4 pt-3 backdrop-blur-md"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="relative z-20 flex w-full overflow-visible rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-md shadow-blue-600/30">
            {/* Left: chevron-only dropdown trigger for bulk options */}
            <div className="group/print-menu relative flex shrink-0 self-stretch">
              <button
                type="button"
                aria-haspopup="menu"
                aria-label="Bulk print options"
                disabled={isPrinting}
                className="flex h-12 items-center justify-center rounded-l-2xl border-r border-white/25 px-3 text-white outline-none transition-colors hover:bg-blue-700/40 focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-60"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <div
                className="
                  invisible absolute bottom-full left-0 z-50 pb-1.5 opacity-0
                  transition-opacity duration-75
                  group-hover/print-menu:pointer-events-auto group-hover/print-menu:visible group-hover/print-menu:opacity-100
                  group-focus-within/print-menu:pointer-events-auto group-focus-within/print-menu:visible group-focus-within/print-menu:opacity-100
                "
                role="presentation"
              >
                <ul
                  role="menu"
                  aria-label="Bulk print options"
                  className="min-w-[15rem] rounded-2xl border border-gray-200 bg-white py-1 shadow-xl ring-1 ring-gray-200/80"
                >
                  <li role="none">
                    <button
                      role="menuitem"
                      type="button"
                      disabled={isPrinting || level == null}
                      onClick={handlePrintBulk}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold text-gray-800 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Printer className="h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden />
                      <span className="flex-1">Print all positions on level</span>
                      <span className="font-mono text-[11px] tabular-nums text-gray-400">
                        ×{config.maxPositions}
                      </span>
                    </button>
                  </li>
                  <li role="none" aria-hidden="true">
                    <div className="my-1 h-px bg-gray-100" />
                  </li>
                  <li role="none">
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => setConfigOpen(true)}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <Settings className="h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden />
                      <span className="flex-1">Configure bulk count…</span>
                    </button>
                  </li>
                </ul>
              </div>
            </div>

            {/* Right: main print action */}
            <button
              type="button"
              onClick={handlePrintOne}
              disabled={isPrinting}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-r-2xl text-sm font-semibold tracking-wide text-white transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPrinting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Printing…</>
              ) : (
                <><Printer className="h-4 w-4" /> Print Bin Label</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ─── Sheets ──────────────────────────────────────────────────────── */}
      <RoomEditSheet
        open={addingRoom}
        onClose={() => setAddingRoom(false)}
        title="Add a new room"
        message="Give it a friendly name and assign a single zone letter (A–Z). The letter is what shows up in the QR code."
        confirmLabel="Add Room"
        initialName=""
        initialLetter={nextFreeLetter(usedLetters)}
        lockedLetters={usedLetters}
        onSave={(name, letter) => handleAddRoom(name, letter)}
      />

      <RoomEditSheet
        open={editingRoom !== null}
        onClose={() => setEditingRoom(null)}
        title="Edit room"
        message="Rename the friendly label and/or change which zone letter (A–Z) it maps to."
        confirmLabel="Save"
        initialName={editingRoom ?? ''}
        initialLetter={editingRoom ? config.zoneMap[editingRoom] ?? nextFreeLetter(usedLetters) : 'A'}
        lockedLetters={new Set(
          Object.entries(config.zoneMap)
            .filter(([k]) => k !== editingRoom)
            .map(([, v]) => v),
        )}
        onSave={(name, letter) => {
          if (editingRoom) handleSaveRoom(editingRoom, name, letter);
        }}
      />

      <ConfirmSheet
        open={!!confirmDeleteRoom}
        onClose={() => setConfirmDeleteRoom(null)}
        title={`Delete ${confirmDeleteRoom ?? ''}?`}
        message="This is a soft delete — bins can be recreated by printing them again."
        confirmLabel="Delete Room"
        destructive
        onConfirm={handleConfirmDelete}
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

// ─── Zone rooms list (the "before" layout, restored) ──────────────────────

interface ZoneRoomsListProps {
  rooms: string[];
  binCounts: Record<string, number>;
  zoneMap: Record<string, string>;
  loading: boolean;
  editMode: boolean;
  mutating: boolean;
  onSelect: (n: string) => void;
  onStartRename: (n: string) => void;
  onRequestDelete: (n: string) => void;
  onStartAdd: () => void;
  onReorder: (order: string[]) => void;
  onOpenConfig: () => void;
}

function ZoneRoomsList(p: ZoneRoomsListProps) {
  if (p.loading) {
    return (
      <div className="flex flex-col gap-2">
        <SkeletonCardGrid count={5} className="h-16" />
      </div>
    );
  }

  return (
    <Reorder.Group
      axis="y"
      values={p.rooms}
      onReorder={p.onReorder}
      className="flex flex-col gap-2"
      as="div"
    >
      {p.rooms.length === 0 && !p.editMode && (
        <div className="rounded-3xl border border-dashed border-gray-200 px-5 py-12 text-center">
          <p className="text-[13px] font-semibold text-gray-700">No rooms yet</p>
          <p className="mt-1 text-[11px] text-gray-400">
            Tap the pencil and then Add Room to get started
          </p>
        </div>
      )}

      {p.rooms.map((room) => (
        <Reorder.Item
          key={room}
          value={room}
          dragListener={p.editMode}
          whileDrag={{ scale: 1.02, zIndex: 20 }}
          className="touch-none"
          as="div"
        >
          <RoomCard
            room={room}
            letter={p.zoneMap[room]}
            binCount={p.binCounts[room] ?? 0}
            editMode={p.editMode}
            mutating={p.mutating}
            onSelect={p.onSelect}
            onStartRename={p.onStartRename}
            onRequestDelete={p.onRequestDelete}
          />
        </Reorder.Item>
      ))}

      {p.editMode && (
        <>
          <button
            type="button"
            onClick={p.onStartAdd}
            className="mt-1 flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/40 text-[13px] font-semibold text-blue-600 transition-colors hover:bg-blue-100/60 active:scale-[0.99]"
          >
            <Plus className="h-4 w-4" />
            Add Room
          </button>
          <button
            type="button"
            onClick={p.onOpenConfig}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-[12px] font-semibold text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 active:scale-[0.99]"
          >
            <Settings className="h-3.5 w-3.5" />
            Configure counts
          </button>
        </>
      )}
    </Reorder.Group>
  );
}

// ─── Single row card (name + zone-letter chip + actions) ──────────────────

interface RoomCardProps {
  room: string;
  letter?: string;
  binCount: number;
  editMode: boolean;
  mutating: boolean;
  onSelect: (n: string) => void;
  onStartRename: (n: string) => void;
  onRequestDelete: (n: string) => void;
}

function RoomCard(p: RoomCardProps) {
  const reduceMotion = useReducedMotion();
  const pressTimer = useRef<number | null>(null);
  const longPressedRef = useRef(false);

  const startPress = () => {
    longPressedRef.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressedRef.current = true;
      successFeedback();
      p.onStartRename(p.room);
    }, 380);
  };
  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  return (
    <motion.div
      layout={!reduceMotion}
      whileTap={p.editMode ? undefined : { scale: 0.99 }}
      transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      className="relative flex items-center gap-2 overflow-hidden rounded-2xl border border-gray-200 bg-white pl-2 pr-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-16px_rgba(0,0,0,0.10)]"
    >
      {p.editMode && (
        <div
          aria-hidden="true"
          className="flex h-12 w-6 flex-shrink-0 cursor-grab items-center justify-center text-gray-300 active:cursor-grabbing"
        >
          <div className="flex flex-col gap-[3px]">
            <span className="block h-1 w-1 rounded-full bg-current" />
            <span className="block h-1 w-1 rounded-full bg-current" />
            <span className="block h-1 w-1 rounded-full bg-current" />
          </div>
        </div>
      )}

      <button
        type="button"
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onClick={() => {
          if (longPressedRef.current) return;
          if (p.editMode) p.onStartRename(p.room);
          else p.onSelect(p.room);
        }}
        className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-2 pr-1 text-left active:bg-gray-50/60"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug tracking-tight text-gray-900 break-words">
            {p.room}
          </p>
          <p className="mt-1 text-[11px] font-medium text-gray-500">
            {p.binCount} bin{p.binCount === 1 ? '' : 's'}
          </p>
        </div>
        {/* Zone-letter chip — single letter only */}
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl font-mono text-[18px] font-semibold ${
          p.letter
            ? 'bg-gradient-to-br from-blue-50 to-blue-100/60 text-blue-700 ring-1 ring-blue-200'
            : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
        }`}>
          {p.letter ?? '?'}
        </div>
      </button>

      {p.editMode && (
        <button
          type="button"
          onClick={() => p.onRequestDelete(p.room)}
          aria-label={`Delete ${p.room}`}
          disabled={p.mutating}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 transition-colors hover:bg-red-100 active:scale-95 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </motion.div>
  );
}

// ─── Room-edit sheet — name + zone-letter (A-Z) picker ────────────────────

interface RoomEditSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  confirmLabel?: string;
  initialName: string;
  initialLetter: string;
  /** Letters used by *other* rooms — can't be picked. */
  lockedLetters: Set<string>;
  onSave: (name: string, letter: string) => void;
}

function RoomEditSheet({
  open, onClose, title, message,
  confirmLabel = 'Save',
  initialName, initialLetter, lockedLetters,
  onSave,
}: RoomEditSheetProps) {
  const [name, setName] = useState(initialName);
  const [letter, setLetter] = useState(initialLetter);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setLetter(initialLetter);
      const t = setTimeout(() => inputRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
  }, [open, initialName, initialLetter]);

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && /[A-Z]/.test(letter);

  const handleSave = () => {
    if (!canSave) return;
    onSave(trimmedName, letter);
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {message && (
        <p className="mb-3 text-center text-[12px] text-gray-500">{message}</p>
      )}

      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Room Name
      </label>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') onClose();
        }}
        placeholder="e.g. Receiving Cage 04"
        autoComplete="off"
        className="mt-1 mb-4 h-12 w-full rounded-2xl border border-gray-300 bg-gray-50 px-4 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200"
      />

      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Zone letter (A–Z)
      </label>
      <div className="mt-2 mb-4 grid grid-cols-6 gap-1.5 sm:grid-cols-9">
        {LETTERS.map((l) => {
          const isLocked = lockedLetters.has(l);
          const isSelected = letter === l;
          return (
            <button
              key={l}
              type="button"
              disabled={isLocked && !isSelected}
              onClick={() => { scanFeedback(); setLetter(l); }}
              className={`relative flex h-10 items-center justify-center rounded-xl text-[14px] font-semibold tabular-nums transition-all active:scale-[0.95] ${
                isSelected
                  ? 'bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                  : isLocked
                    ? 'bg-gray-100 text-gray-300'
                    : 'border border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
              }`}
              title={isLocked && !isSelected ? 'Already used by another room' : undefined}
            >
              {l}
            </button>
          );
        })}
      </div>
      <p className="mb-4 text-center text-[10px] text-gray-400">
        Letter shows on every printed label and in the QR. Locked letters are already in use.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-semibold tracking-wide text-white shadow-md shadow-blue-600/30 transition-transform active:scale-[0.98] disabled:opacity-40 sm:flex-1"
        >
          <Check className="mr-1.5 h-4 w-4" />
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 sm:flex-1"
        >
          Cancel
        </button>
      </div>
    </BottomSheet>
  );
}

// ─── Step pills (now show zone letter for the room) ────────────────────────

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
  return (
    // Outer flex + overflow-x-auto + inner flex-none/w-max: reliable horizontal scroll (incl. nested vertical scroll parents).
    <div
      className="flex w-full min-w-0 overflow-x-scroll overflow-y-hidden overscroll-x-contain py-3 [-ms-overflow-style:none] [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
      role="navigation"
      aria-label="Bin location steps"
    >
      <div className="flex w-max max-w-none flex-none flex-nowrap items-center gap-1 px-4">
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

// ─── Live preview panel ────────────────────────────────────────────────────

interface LivePreviewProps {
  zoneLetter?: string;
  aisle?: number;
  bay?: number;
  level?: number;
  position?: number;
}

function LivePreview({ zoneLetter, aisle, bay, level, position }: LivePreviewProps) {
  const all = zoneLetter && aisle != null && bay != null && level != null && position != null;
  const segments: LocationSegments | null = all
    ? { zone: zoneLetter!, aisle: aisle!, bay: bay!, level: level!, position: position! }
    : null;
  const code = segments ? locationCode(segments) : partialCode({ zone: zoneLetter, aisle, bay, level, position });
  const human = humanReadable({ zone: zoneLetter, aisle, bay, level, position });

  return (
    <div className="mx-4 mb-3 overflow-hidden rounded-3xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-16px_rgba(0,0,0,0.10)]">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Location code
      </div>
      <div className="mt-1 whitespace-nowrap font-mono text-[15px] font-semibold tracking-tight text-gray-900">
        {code}
      </div>
      <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Breakdown
      </div>
      <div className="mt-1 text-[12px] leading-snug text-gray-700">{human}</div>
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
  if (s.zone) {
    out.push(s.zone);
  }
  if (s.aisle != null) out.push(`Aisle ${pad2(s.aisle)}`);
  if (s.bay != null) out.push(`Bay ${pad2(s.bay)} (${bayHand(s.bay)})`);
  if (s.level != null) out.push(`Level ${noPad(s.level)}`);
  if (s.position != null) out.push(`Position ${pad2(s.position)}`);
  return out.join(' → ') || 'Pick a room below';
}

// ─── Unified numeric step — quick picks on top, custom + Next below ────────
//
// Quick-pick tiles auto-advance the flow. The custom input requires an
// explicit Next press (or Enter) so partial keystrokes don't bump the user
// to the next stage mid-typing.

interface NumericStepProps {
  title: string;
  prefix: string;
  count: number;
  selected?: number;
  onPick: (n: number) => void;
  renderTag?: (n: number) => string | null;
  customLabel?: string;
}

const NUMERIC_QUICK_PICKS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function NumericStep({
  title, prefix, count, selected, onPick, renderTag,
  customLabel = 'Custom #',
}: NumericStepProps) {
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

  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={prefix || 'num'}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[15px] font-semibold tracking-tight text-gray-900">{title}</h3>
          <span className="text-[10px] font-medium tabular-nums text-gray-400">
            up to {count}
          </span>
        </div>

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
                  {prefix}{pad2(n)}
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
        </div>

        {/* Custom input + Next button — below the quick picks */}
        <div className="mt-4">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {customLabel}
          </label>
          <div className="mt-1 flex items-stretch gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmCustom();
              }}
              placeholder="Type any number…"
              className="h-14 flex-1 rounded-2xl border border-gray-300 bg-gray-50 px-4 text-center text-[20px] font-semibold tabular-nums tracking-tight text-gray-900 outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              onClick={confirmCustom}
              disabled={!customValid}
              aria-label="Confirm custom number and continue"
              className="flex h-14 w-24 items-center justify-center gap-1 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-semibold tracking-wide text-white shadow-md shadow-blue-600/30 transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Position step — compact display with pencil-to-edit ─────────────────

interface PositionStepProps {
  value: number;
  max: number;
  onPick: (n: number) => void;
}

function PositionStep({ value, max, onPick }: PositionStepProps) {
  const [custom, setCustom] = useState('');
  const customNum = parseInt(custom, 10);
  const customValid =
    Number.isFinite(customNum) && customNum >= 1 && customNum <= 99;

  const confirmCustom = () => {
    if (!customValid) return;
    onPick(customNum);
    setCustom('');
  };

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold tracking-tight text-gray-900">Position</h3>
        <span className="text-[10px] font-medium tabular-nums text-gray-400">
          up to {max}
        </span>
      </div>

      <div className="mb-3 flex h-16 items-center justify-center rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white">
        <span className="font-mono text-[28px] font-semibold tabular-nums tracking-tight text-blue-700">
          P{pad2(value)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {NUMERIC_QUICK_PICKS.map((n) => {
          const isSelected = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onPick(n)}
              className={`flex h-16 flex-col items-center justify-center rounded-2xl border text-center transition-all active:scale-[0.97] ${
                isSelected
                  ? 'border-transparent bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-600/30'
                  : 'border-gray-200 bg-white text-gray-900 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <span className="font-mono text-[18px] font-semibold tabular-nums tracking-tight">
                {pad2(n)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Custom position #
        </label>
        <div className="mt-1 flex items-stretch gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmCustom();
            }}
            placeholder="Type any number…"
            className="h-14 flex-1 rounded-2xl border border-gray-300 bg-gray-50 px-4 text-center text-[20px] font-semibold tabular-nums tracking-tight text-gray-900 outline-none transition-colors focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200"
          />
          <button
            type="button"
            onClick={confirmCustom}
            disabled={!customValid}
            aria-label="Confirm custom position and continue"
            className="flex h-14 w-24 items-center justify-center gap-1 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-semibold tracking-wide text-white shadow-md shadow-blue-600/30 transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Configuration sheet ───────────────────────────────────────────────────

interface ConfigSheetProps {
  open: boolean;
  onClose: () => void;
  config: PrinterConfig;
  onSave: (next: PrinterConfig) => void;
}

function ConfigSheet({ open, onClose, config, onSave }: ConfigSheetProps) {
  const [draft, setDraft] = useState<PrinterConfig>(config);
  useEffect(() => { if (open) setDraft(config); }, [open, config]);

  const set = (k: keyof Omit<PrinterConfig, 'zoneMap'>) => (v: string) => {
    if (k === 'gln') return setDraft({ ...draft, gln: v.trim() || DEFAULT_GLN });
    setDraft({ ...draft, [k]: clampMax(v, (DEFAULT_CONFIG as unknown as Record<string, number>)[k]) });
  };

  const handleSave = () => {
    onSave({
      ...draft,
      maxAisles: clampMax(draft.maxAisles, DEFAULT_CONFIG.maxAisles),
      maxBays: clampMax(draft.maxBays, DEFAULT_CONFIG.maxBays),
      maxLevels: clampMax(draft.maxLevels, DEFAULT_CONFIG.maxLevels),
      maxPositions: clampMax(draft.maxPositions, DEFAULT_CONFIG.maxPositions),
      gln: draft.gln.trim() || DEFAULT_GLN,
    });
  };

  const handleReset = () => setDraft({ ...DEFAULT_CONFIG, zoneMap: draft.zoneMap });

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
  // QR still encodes the GS1 Digital Link so scans resolve correctly — just not displayed as text.
  const uri = gs1LocationUrl(segments, { gln });
  return (
    <div className="label-print-card" style={labelCardStyle}>
      {/* Left column — code + room + breakdown */}
      <div style={labelLeftStyle}>
        <div style={labelEyebrowStyle}>USAV Warehouse Location</div>
        <div style={labelCodeStyle}>{code}</div>
        {roomName && <div style={labelRoomStyle}>{roomName} ({segments.zone})</div>}
        <div style={labelHumanStyle}>
          Aisle {pad2(segments.aisle)} · Bay {pad2(segments.bay)} ({bayHand(segments.bay)})<br />
          Level {noPad(segments.level)} · Position {pad2(segments.position)}
        </div>
      </div>
      {/* Right column — QR */}
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
  border: '1px solid #000',
  borderRadius: '0.18in',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.18in',
  verticalAlign: 'top',
  fontFamily: '"Inter", "Arial", sans-serif',
  color: '#000',
  background: '#fff',
};
const labelLeftStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
};
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
