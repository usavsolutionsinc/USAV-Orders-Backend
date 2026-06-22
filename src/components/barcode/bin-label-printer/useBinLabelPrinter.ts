'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLocations } from '@/hooks/useLocations';
import {
  useLabelPrinterStore,
  patchLabelPrinterState,
  resetLabelPrinterState,
} from '@/hooks/useLabelPrinterStore';
import type { LocationSegments } from '@/lib/barcode-routing';
import { DEFAULT_CONFIG, loadConfig, saveConfig, type PrinterConfig, type Step } from './index';
import { registerLocations } from './bin-printer-api';

/**
 * Controller for the bin (location) label printer. Owns the five-step builder
 * (zone → aisle → bay → level → position), the per-warehouse config, and the
 * register-then-print flow for single and bulk (whole-level) labels. The
 * selection lives in the shared `useLabelPrinterStore` so the main-pane preview
 * stays in lock-step with the sidebar picker.
 *
 * Returns one bag consumed by the layout components so the views stay
 * presentational.
 */
export function useBinLabelPrinter() {
  const { rooms, roomNames, loading } = useLocations();

  const [config, setConfig] = useState<PrinterConfig>(DEFAULT_CONFIG);
  const [configOpen, setConfigOpen] = useState(false);

  const stored = useLabelPrinterStore();
  const selectedRoom = stored.room;
  const aisle = stored.aisle;
  const bay = stored.bay;
  const level = stored.level;
  const position = stored.position;

  const [bulkLabels, setBulkLabels] = useState<LocationSegments[] | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [overrideStep, setOverrideStep] = useState<Step | null>(null);

  useEffect(() => {
    setConfig(loadConfig());
  }, []);

  // Server-of-record zone-letter map.
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

  // ─── Selection handlers ─────────────────────────────────────────────────
  const pickRoom = useCallback((name: string) => {
    if (selectedRoom !== name) {
      patchLabelPrinterState({ room: name, aisle: undefined, bay: undefined, level: undefined, position: 1 });
    } else {
      patchLabelPrinterState({ room: name });
    }
    setOverrideStep(null);
  }, [selectedRoom]);

  const pickAisle = useCallback((n: number) => {
    if (aisle !== n) {
      patchLabelPrinterState({ aisle: n, bay: undefined, level: undefined, position: 1 });
    } else {
      patchLabelPrinterState({ aisle: n });
    }
    setOverrideStep(null);
  }, [aisle]);

  const pickBay = useCallback((n: number) => {
    if (bay !== n) {
      patchLabelPrinterState({ bay: n, level: undefined, position: 1 });
    } else {
      patchLabelPrinterState({ bay: n });
    }
    setOverrideStep(null);
  }, [bay]);

  const pickLevel = useCallback((n: number) => {
    if (level !== n) {
      patchLabelPrinterState({ level: n, position: 1 });
    } else {
      patchLabelPrinterState({ level: n });
    }
    setOverrideStep(null);
  }, [level]);

  const pickPosition = useCallback((n: number) => {
    patchLabelPrinterState({ position: n });
    setOverrideStep(null);
  }, []);

  const resetAll = useCallback(() => {
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
    setOverrideStep(step);
  }, [selectedRoom, aisle, bay, level, position, computedStep, activeStep]);

  const allSelected =
    selectedRoom != null && aisle != null && bay != null && level != null && position != null;
  const zoneLetter = selectedRoom ? zoneMap[selectedRoom] : undefined;

  const currentSegments: LocationSegments | null = allSelected && zoneLetter
    ? { zone: zoneLetter, aisle: aisle!, bay: bay!, level: level!, position: position! }
    : null;

  const missingLetter = !!selectedRoom && !zoneLetter;

  // Register every label before window.print(); abort the print on failure.
  const triggerPrint = useCallback(async (labels: LocationSegments[]) => {
    if (labels.length === 0) return;
    if (!selectedRoom) {
      toast.error('Pick a room first.');
      return;
    }
    setIsPrinting(true);
    try {
      await registerLocations(selectedRoom, labels);
    } catch (err: any) {
      setIsPrinting(false);
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
          toast.success(`Printed ${labels.length} label${labels.length === 1 ? '' : 's'}`);
        }, 250);
      });
    });
  }, [selectedRoom]);

  const handlePrintOne = useCallback(() => {
    if (!currentSegments) return;
    triggerPrint([currentSegments]);
  }, [currentSegments, triggerPrint]);

  // Bulk: print every position of the picked level as a separate bin label.
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
    toast.success('Configuration saved');
    setConfigOpen(false);
  }, []);

  // ⌘/Ctrl+P prints the current single label.
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

  return {
    loading,
    allRoomNames,
    zoneMap,
    config,
    selectedRoom,
    aisle,
    bay,
    level,
    position,
    zoneLetter,
    activeStep,
    allSelected,
    missingLetter,
    bulkLabels,
    isPrinting,
    configOpen,
    setConfigOpen,
    handleConfigSave,
    setOverrideStep,
    pickRoom,
    pickAisle,
    pickBay,
    pickLevel,
    pickPosition,
    resetAll,
    handlePillClick,
    handlePrintOne,
    handlePrintBulk,
  };
}

export type BinLabelPrinterController = ReturnType<typeof useBinLabelPrinter>;
