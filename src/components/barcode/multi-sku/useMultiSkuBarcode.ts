'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  printProductLabel,
  printProductLabels,
  buildUnitPayload,
  deriveColorFromTitle,
} from '@/lib/print/printProductLabel';
import { useLabelRecents } from '@/hooks/useLabelRecents';
import { CONDITION_OPTIONS } from '@/components/receiving/zoho-po-types';
import type { BarcodeMode } from '@/components/barcode/ModeSelector';
import { useBarcodeModeStep } from './useBarcodeModeStep';
import { useSerialList } from './useSerialList';
import { allocateNextUnitId, lookupProductInfo, postMultiSn, resolveUnitId } from './unit-label-api';

export type ConditionGrade = (typeof CONDITION_OPTIONS)[number]['value'];
export type BarcodeLayout = 'vertical' | 'horizontal';

/**
 * Controller for the multi-SKU / serial barcode workspace. Composes
 * {@link useBarcodeModeStep} (mode + wizard step), {@link useSerialList}
 * (serials) and the pure {@link unit-label-api} network layer, and owns the
 * product/label state plus the three issue paths — print, sn-to-sku log, and
 * reprint — for both the horizontal (desktop) and vertical (wizard) layouts.
 *
 * Returns one bag consumed by the layout components so the view files stay
 * presentational.
 *
 * @param layout `horizontal` reads/writes mode via the URL; `vertical` keeps
 *   mode in local state and reveals steps one at a time.
 */
export function useMultiSkuBarcode(layout: BarcodeLayout) {
  const isHorizontal = layout === 'horizontal';
  const { mode, step, setStep, handleModeChange, bottomAnchorRef } = useBarcodeModeStep(isHorizontal);
  const {
    snInput,
    setSnInput,
    serialNumbers,
    setSerialNumbers,
    handleSnInputChange,
    handleSnAdd,
    removeSerial,
    resetSerials,
  } = useSerialList();

  const [sku, setSku] = useState('');
  const [uniqueSku, setUniqueSku] = useState('');
  /** Internal pseudo-GTIN-14 for the current SKU. Populated by /api/units/next-id. */
  const [gtin, setGtin] = useState('');
  const [title, setTitle] = useState('');
  const [stock, setStock] = useState('');
  const [error, setError] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingTitle, setIsLoadingTitle] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [location, setLocation] = useState('');
  const [currentLocation, setCurrentLocation] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [skuCatalogId, setSkuCatalogId] = useState<number | null>(null);
  const [condition, setCondition] = useState<ConditionGrade>('BRAND_NEW');
  // Product color (label bottom-right). Prefilled from the title; the Edit-label
  // popover can override it. No DB column yet — print-time only.
  const [colorOverride, setColorOverride] = useState<string | null>(null);
  const color = (colorOverride ?? deriveColorFromTitle(title)).trim();

  const skuInputRef = useRef<HTMLInputElement>(null);
  const snInputRef = useRef<HTMLInputElement>(null);

  // localStorage recents still feed the Products picker's pinned chips
  // (ProductsSidebarPanel); the desktop "Recent" bottom strip was removed in
  // favour of the server-backed Recent sub-tab (RecentlyPrintedList).
  const { push: pushRecent } = useLabelRecents();

  // Surface validation/fetch errors via the global toast system instead of the
  // fixed-position pill. State stays as a one-shot trigger.
  useEffect(() => {
    if (!error) return;
    toast.error(error);
    setError('');
  }, [error]);

  // DataMatrix payload for the live preview — reuses the same builder the
  // printed label uses so what you see matches what gets printed exactly.
  // Products labels encode ONLY the bare unit id ({SKU}-{YYWW}-{SEQ6}); no GS1
  // Digital Link, no GTIN/serial AIs. Passing it as `qrPayload` (a non-AI
  // string) yields a plain `datamatrix` symbology.
  const previewPayload = useMemo(
    () =>
      buildUnitPayload({
        sku: uniqueSku || sku,
        serialNumber: null,
        qrPayload: uniqueSku || sku || null,
        gtin: null,
      }),
    [uniqueSku, sku],
  );

  const handleSkuChange = (value: string) => {
    setSku(value);
    setUniqueSku('');
    setGtin('');
    setError('');
  };

  /** Allocate the next unit-id and stash {uniqueSku, gtin}. */
  const fetchNextUnitId = useCallback(async (skuValue: string, catalogIdHint?: number | null) => {
    const data = await allocateNextUnitId(skuValue, catalogIdHint);
    setUniqueSku(data.unitId);
    setGtin(data.gtin);
    return data;
  }, []);

  /**
   * Reprint path — the SKU field holds an existing full unit id. Resolve its
   * catalog row (no sequence allocation) and enrich title/stock/image; reprint
   * the CANONICAL stored unit id so scanning a manufacturer serial still
   * reproduces the original. Falls back to a plain SKU lookup for legacy ids.
   */
  const resolveReprintUnit = useCallback(async (unitIdInput: string) => {
    const trimmed = unitIdInput.trim();
    if (!trimmed) return;
    setIsLoadingTitle(true);
    try {
      const data = await resolveUnitId(trimmed);
      if (data?.ok) {
        setUniqueSku(data.unitUid || trimmed);
        setGtin(data.gtin ?? '');
        try {
          const info = await lookupProductInfo(data.sku);
          setTitle(info.title || data.productTitle || 'Not found');
          setStock(info.stock);
          setCurrentLocation(info.location);
          setLocation(info.location);
          setImageUrl(info.imageUrl);
          setSkuCatalogId(
            info.skuCatalogId ?? (typeof data.skuCatalogId === 'number' ? data.skuCatalogId : null),
          );
        } catch {
          setTitle(data.productTitle || 'Not found');
        }
        return;
      }
      throw new Error(data?.error || 'resolve-id failed');
    } catch {
      // Legacy / unresolved id — look up by the raw input and print the bare
      // unit id (no gtin available).
      const baseSku = trimmed.includes(':') ? trimmed.split(':')[0] : trimmed;
      try {
        const info = await lookupProductInfo(baseSku);
        setTitle(info.title || 'Not found');
        setStock(info.stock);
        setCurrentLocation(info.location);
        setLocation(info.location);
        setImageUrl(info.imageUrl);
        setSkuCatalogId(info.skuCatalogId);
      } catch {
        setTitle('Error loading info');
      }
      setUniqueSku(trimmed);
      setGtin('');
    } finally {
      setIsLoadingTitle(false);
    }
  }, []);

  // Called when a SKU is injected from the right panel or clipboard paste.
  const handleSkuFillAndSearch = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      // Reset to step 1 clean state first.
      setSku(trimmed);
      setUniqueSku('');
      setTitle('');
      setStock('');
      resetSerials();
      setImageUrl('');
      setSkuCatalogId(null);
      setStep(1);
      setError('');

      // Give React one tick to flush state, then kick off the lookup.
      await new Promise((r) => setTimeout(r, 0));

      if (mode === 'reprint') {
        await resolveReprintUnit(trimmed);
        setStep(3);
        return;
      }

      // Parallelize product-info lookup and next-unit-id allocation — the
      // sequential chain used to add 400-900ms to first preview on station
      // devices. /api/units/next-id resolves the sku_catalog row itself when no
      // catalogIdHint is passed, so the title call need not finish first.
      setIsLoadingTitle(true);

      const titlePromise = (async () => {
        try {
          const info = await lookupProductInfo(trimmed);
          setTitle(info.title || 'Not found');
          setStock(info.stock);
          setCurrentLocation(info.location);
          setLocation(info.location);
          setImageUrl(info.imageUrl);
          setSkuCatalogId(info.skuCatalogId);
          return info.skuCatalogId;
        } catch {
          setTitle('Error loading info');
          return null;
        } finally {
          setIsLoadingTitle(false);
        }
      })();

      const unitIdPromise: Promise<unknown> =
        mode === 'print'
          ? fetchNextUnitId(trimmed).catch((err) => {
              // Pre-allocation failure is not user-visible here — the click path
              // retries via handleNextStepSn and surfaces a toast then.
              console.warn('Pre-allocation skipped:', err);
              return null;
            })
          : Promise.resolve(null);

      await Promise.all([titlePromise, unitIdPromise]);

      setStep(2);
      setTimeout(() => snInputRef.current?.focus(), 100);
    },
    [mode, fetchNextUnitId, resolveReprintUnit, resetSerials, setStep],
  );

  // Listen for sku:fill events dispatched by the right-panel SKU table.
  useEffect(() => {
    const handler = (e: Event) => {
      const skuValue = (e as CustomEvent<{ sku: string }>).detail?.sku;
      if (skuValue) handleSkuFillAndSearch(skuValue);
    };
    window.addEventListener('sku:fill', handler);
    return () => window.removeEventListener('sku:fill', handler);
  }, [handleSkuFillAndSearch]);

  const fetchProductInfo = async (skuValue: string): Promise<number | null> => {
    setIsLoadingTitle(true);
    try {
      const info = await lookupProductInfo(skuValue);
      setTitle(info.title || 'Not found');
      setStock(info.stock);
      setCurrentLocation(info.location);
      setImageUrl(info.imageUrl);
      if (!location) setLocation(info.location);
      setSkuCatalogId(info.skuCatalogId);
      return info.skuCatalogId;
    } catch {
      setTitle('Error loading info');
      return null;
    } finally {
      setIsLoadingTitle(false);
    }
  };

  const handleNextStepSku = async () => {
    if (!sku.trim()) {
      setError('SKU required');
      return;
    }

    if (mode === 'reprint') {
      await resolveReprintUnit(sku.trim());
      setStep(3);
      return;
    }

    const catalogIdHint = await fetchProductInfo(sku);

    if (mode === 'print' && !uniqueSku) {
      setIsGenerating(true);
      try {
        await fetchNextUnitId(sku, catalogIdHint);
      } catch (err) {
        console.error('Failed to allocate unit id:', err);
        const msg = err instanceof Error ? err.message : 'Failed to allocate unit id';
        toast.error(`Can't print label: ${msg}`);
      } finally {
        setIsGenerating(false);
      }
    }

    setStep(2);
    setTimeout(() => snInputRef.current?.focus(), 100);
  };

  const handleNextStepSn = async (pendingSn?: string) => {
    const allSns = pendingSn ? [...serialNumbers, pendingSn] : serialNumbers;

    if (allSns.length === 0) {
      setError('Serial numbers required');
      return;
    }

    // Flush any pending SN (typed/scanned but not yet Enter-confirmed) into state.
    if (pendingSn) {
      setSerialNumbers(allSns);
      setSnInput(allSns.join(', '));
    }

    if (mode === 'print') {
      if (!uniqueSku) {
        setIsGenerating(true);
        try {
          await fetchNextUnitId(sku, skuCatalogId);
        } catch (err) {
          console.error('Failed to allocate unit id:', err);
          const msg = err instanceof Error ? err.message : 'Failed to generate unit id';
          toast.error(`Can't print label: ${msg}`);
          setError('Failed to generate unit id');
          return;
        } finally {
          setIsGenerating(false);
        }
      }
      setStep(3);
    } else if (mode === 'reprint') {
      setUniqueSku(sku);
      setStep(3);
    } else {
      setUniqueSku(sku);
      setStep(3);
    }
  };

  const handleChangeSku = () => {
    setSku('');
    setUniqueSku('');
    setGtin('');
    setTitle('');
    setStock('');
    resetSerials();
    setImageUrl('');
    setSkuCatalogId(null);
    setStep(1);
    setError('');
    setTimeout(() => skuInputRef.current?.focus(), 100);
  };

  const issueLabels = async (): Promise<{
    success: boolean;
    units: Array<{ serial: string; unitUid: string | null }>;
  }> => {
    setIsPosting(true);
    try {
      return await postMultiSn({
        sku: uniqueSku,
        productSku: sku,
        unitId: uniqueSku,
        gtin: gtin || undefined,
        qrPayload: previewPayload.value,
        symbology: previewPayload.symbology,
        serialNumbers,
        notes,
        location,
        condition,
        printClass: mode === 'sn-to-sku' ? 'sn-to-sku' : 'print',
      });
    } catch {
      return { success: false, units: [] };
    } finally {
      setIsPosting(false);
    }
  };

  const handleFinalAction = async () => {
    if (mode === 'reprint') {
      // Just print, no DB/Sheet updates. The DataMatrix encodes ONLY the bare
      // unit id — never a GS1 Digital Link — so a reprint matches new labels.
      printProductLabel({ sku: uniqueSku, title, qrPayload: uniqueSku, condition, color });
      pushRecent({ sku: uniqueSku || sku, sn: serialNumbers[0], title });
      setStep(1);
      setSku('');
      setUniqueSku('');
      setGtin('');
      resetSerials();
      return;
    }

    const { success, units } = await issueLabels();
    if (success) {
      if (mode === 'print') {
        // Print one label per serial. Each label's DataMatrix encodes that
        // unit's OWN minted unit id (returned by the route).
        const uidBySerial = new Map(units.map((u) => [u.serial, u.unitUid]));
        printProductLabels({
          sku: uniqueSku,
          title,
          serialNumbers,
          condition,
          color,
          qrPayloads: serialNumbers.map((s) => uidBySerial.get(s) ?? uniqueSku),
        });
      }

      // Pin this SKU at the top of the Products picker for one-tap re-fill.
      pushRecent({ sku: uniqueSku || sku, sn: serialNumbers[0], title });

      resetSerials();

      if (mode === 'print') {
        // Refresh the preview to the NEXT unit id (a peek now — server mints the
        // authoritative id per serial at print time, so no double-burn).
        try {
          await fetchNextUnitId(sku, skuCatalogId);
        } catch (err) {
          console.error('Failed to refresh next unit id:', err);
          const msg = err instanceof Error ? err.message : 'Failed to refresh next unit id';
          toast.error(`Couldn't preview next label: ${msg}`);
        }
      }

      setStep(2);
    } else {
      setError('Failed to save data');
    }
  };

  const density: 'comfortable' | 'compact' = isHorizontal ? 'comfortable' : 'compact';
  const previewIsReady = mode === 'reprint' ? !!sku.trim() : !!uniqueSku;

  // Cmd/Ctrl+P inside the workspace prints the current label (when ready). We
  // capture early to intercept before the browser opens its print dialog.
  useEffect(() => {
    if (!isHorizontal) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'P')) {
        if (!previewIsReady) return;
        e.preventDefault();
        handleFinalAction();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHorizontal, mode, previewIsReady]);

  return {
    // layout
    isHorizontal,
    density,
    // mode + step
    mode,
    step,
    handleModeChange,
    // sku/title/product
    sku,
    uniqueSku,
    title,
    setTitle,
    stock,
    imageUrl,
    isLoadingTitle,
    location,
    setLocation,
    currentLocation,
    // serials
    snInput,
    serialNumbers,
    setSerialNumbers,
    handleSnInputChange,
    handleSnAdd,
    removeSerial,
    // condition / color / notes
    condition,
    setCondition,
    color,
    setColorOverride,
    notes,
    setNotes,
    showNotes,
    setShowNotes,
    // status flags
    isPosting,
    isGenerating,
    previewIsReady,
    // derived
    previewPayload,
    // refs
    skuInputRef,
    snInputRef,
    bottomAnchorRef,
    // handlers
    handleSkuChange,
    handleSkuFillAndSearch,
    handleNextStepSku,
    handleNextStepSn,
    handleChangeSku,
    handleFinalAction,
  };
}

export type MultiSkuBarcodeController = ReturnType<typeof useMultiSkuBarcode>;
