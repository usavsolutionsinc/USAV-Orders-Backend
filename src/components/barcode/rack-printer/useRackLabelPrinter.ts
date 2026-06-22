'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLocations } from '@/hooks/useLocations';
import {
  useRackPrinterStore,
  patchRackPrinterState,
  resetRackPrinterState,
} from '@/hooks/useLabelPrinterStore';
import type { RackSegments } from '@/lib/barcode-routing';
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  type PrinterConfig,
  type Step,
} from './rack-printer-config';
import { registerRackLocations } from './rack-printer-api';

/**
 * Controller for the rack label printer. Owns the four-step location builder
 * (zone → aisle → bay → level), the per-warehouse config, and the
 * register-then-print flow for single and bulk (whole-bay) labels. The
 * zone/aisle/bay/level selection lives in the shared `useRackPrinterStore` so it
 * survives across the sidebar ↔ main-pane variants; everything else is local.
 *
 * Returns one bag consumed by the layout components (mobile picker, desktop
 * builder, sidebar) so the views stay presentational.
 */
export function useRackLabelPrinter() {
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

  // Register the rack row (position=0) before window.print() so scans of the
  // printed QR resolve to a real row in the locations table.
  const triggerPrint = useCallback(async (labels: RackSegments[]) => {
    if (labels.length === 0) return;
    if (!selectedRoom) {
      toast.error('Pick a room first.');
      return;
    }
    setIsPrinting(true);
    try {
      await registerRackLocations(selectedRoom, labels);
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
    // data
    loading,
    allRoomNames,
    zoneMap,
    config,
    // selection
    selectedRoom,
    aisle,
    bay,
    level,
    zoneLetter,
    activeStep,
    allSelected,
    missingLetter,
    currentSegments,
    bulkLabels,
    isPrinting,
    // config sheet
    configOpen,
    setConfigOpen,
    handleConfigSave,
    // actions
    setOverrideStep,
    pickRoom,
    pickAisle,
    pickBay,
    pickLevel,
    resetAll,
    handlePillClick,
    handlePrintOne,
    handlePrintBay,
  };
}

export type RackLabelPrinterController = ReturnType<typeof useRackLabelPrinter>;
