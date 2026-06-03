'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { toast } from 'sonner';

// Import refactored sub-components
import { ModeSelector, BarcodeMode } from './barcode/ModeSelector';
import { SkuInput } from './barcode/SkuInput';
import { SerialNumberInput } from './barcode/SerialNumberInput';
import { BarcodePreview } from './barcode/BarcodePreview';
import { LabelPreviewCard } from '@/components/labels/LabelPreviewCard';
import { RecentsStrip } from './barcode/RecentsStrip';
import { InlineSerialAdder } from '@/components/receiving/workspace/InlineSerialAdder';

// Import utilities
import { normalizeSku, getSerialLast6 } from '@/utils/sku';
import { printProductLabels, buildUnitPayload } from '@/lib/print/printProductLabel';
import { useLabelRecents } from '@/hooks/useLabelRecents';
import { useBarcodeMode } from '@/hooks/useBarcodeMode';
import { CONDITION_OPTIONS } from '@/components/receiving/zoho-po-types';
import { ConditionPills } from '@/components/receiving/workspace/ConditionPills';
import { Search, Clipboard, Check, Printer } from './Icons';
import { StickyActionBar } from '@/design-system/components/StickyActionBar';


type ConditionGrade = (typeof CONDITION_OPTIONS)[number]['value'];

interface MultiSkuSnBarcodeProps {
    /**
     * `vertical` — narrow-column wizard (sidebar / mobile). Steps reveal one at
     * a time, inactive steps dim, parent auto-scrolls to the new step.
     * `horizontal` — desktop workspace (right pane). Inputs and live preview
     * sit side-by-side; all panels stay visible at full opacity.
     */
    layout?: 'vertical' | 'horizontal';
}

export default function MultiSkuSnBarcode({ layout = 'vertical' }: MultiSkuSnBarcodeProps = {}) {
    const isHorizontal = layout === 'horizontal';
    const urlMode = useBarcodeMode();
    const [localMode, setLocalMode] = useState<BarcodeMode>('print');
    const mode = isHorizontal ? urlMode.mode : localMode;
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [sku, setSku] = useState<string>("");
    const [snInput, setSnInput] = useState<string>("");
    const [serialNumbers, setSerialNumbers] = useState<string[]>([]);
    const [uniqueSku, setUniqueSku] = useState<string>("");
    /** Internal pseudo-GTIN-14 for the current SKU. Populated by /api/units/next-id. */
    const [gtin, setGtin] = useState<string>("");
    /** GS1 Digital Link URL encoded in the printed QR. From /api/units/next-id. */
    const [qrUrl, setQrUrl] = useState<string>("");
    const [title, setTitle] = useState<string>("");
    const [stock, setStock] = useState<string>("");
    const [error, setError] = useState<string>("");
    const [isPosting, setIsPosting] = useState<boolean>(false);
    const [isGenerating, setIsGenerating] = useState<boolean>(false);
    const [isLoadingTitle, setIsLoadingTitle] = useState<boolean>(false);
    const [showNotes, setShowNotes] = useState<boolean>(false);
    const [notes, setNotes] = useState<string>("");
    const [location, setLocation] = useState<string>("");
    const [currentLocation, setCurrentLocation] = useState<string>("");
    const [imageUrl, setImageUrl] = useState<string>("");
    const [skuCatalogId, setSkuCatalogId] = useState<number | null>(null);
    const [condition, setCondition] = useState<ConditionGrade>('BRAND_NEW');

    const printRef = useRef<HTMLDivElement>(null);
    const skuInputRef = useRef<HTMLInputElement>(null);
    const snInputRef = useRef<HTMLInputElement>(null);
    const bottomAnchorRef = useRef<HTMLDivElement>(null);

    const { recents, push: pushRecent, clear: clearRecents } = useLabelRecents();

    // Surface validation/fetch errors via the global toast system instead of
    // the fixed-position pill. State stays as a one-shot trigger.
    useEffect(() => {
        if (!error) return;
        toast.error(error);
        setError("");
    }, [error]);

    // DataMatrix payload for the live preview — reuses the same builder the
    // printed label uses so what you see matches what gets printed exactly.
    const previewPayload = useMemo(
        () =>
            buildUnitPayload({
                sku: uniqueSku || sku,
                serialNumber: serialNumbers[0] ?? null,
                qrPayload: qrUrl || null,
                gtin: gtin || null,
            }),
        [uniqueSku, sku, serialNumbers, qrUrl, gtin],
    );

    // Scroll the parent scroll container to reveal the newly added step.
    // scrollIntoView walks up to the nearest scroll ancestor, so this works
    // for the narrow-column sidebar host. In horizontal mode everything is
    // already visible side-by-side, so this is a no-op.
    useEffect(() => {
        if (isHorizontal) return;
        if (step >= 2) {
            setTimeout(() => {
                bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 50);
        }
    }, [step, isHorizontal]);

    const handleSkuChange = (value: string) => {
        setSku(value);
        setUniqueSku("");
        setGtin("");
        setQrUrl("");
        setError("");
    };

    /**
     * Allocate the next unit-id for a SKU via /api/units/next-id and
     * stash {uniqueSku, gtin, qrUrl} in component state. Each call
     * atomically increments the per-SKU-per-year sequence — there is no
     * pre-flight "peek". Replaces the legacy
     * /api/sku-manager?action=current then ?action=increment dance.
     */
    const fetchNextUnitId = useCallback(async (skuValue: string, catalogIdHint?: number | null) => {
        const body: Record<string, unknown> = { sku: normalizeSku(skuValue) };
        if (catalogIdHint && Number.isFinite(catalogIdHint)) {
            body.sku_catalog_id = catalogIdHint;
        }
        const res = await fetch('/api/units/next-id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
            throw new Error(data?.error || 'next-id failed');
        }
        setUniqueSku(data.unitId);
        setGtin(data.gtin ?? "");
        setQrUrl(data.qrUrl ?? "");
        return data as { unitId: string; gtin: string; qrUrl: string };
    }, []);

    // Called when a SKU is injected from the right panel or clipboard paste
    const handleSkuFillAndSearch = useCallback(async (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        // Reset to step 1 clean state first
        setSku(trimmed);
        setUniqueSku("");
        setTitle("");
        setStock("");
        setSnInput("");
        setSerialNumbers([]);
        setImageUrl("");
        setSkuCatalogId(null);
        setStep(1);
        setError("");

        // Give React one tick to flush state, then kick off the lookup
        await new Promise(r => setTimeout(r, 0));

        if (mode === 'reprint') {
            // Reprint doesn't allocate a new unit id; only fetch product info.
            setIsLoadingTitle(true);
            try {
                const baseSku = trimmed.includes(':') ? trimmed.split(':')[0] : trimmed;
                const res = await fetch(`/api/get-title-by-sku?sku=${encodeURIComponent(normalizeSku(baseSku))}`);
                const data = await res.json();
                setTitle(data.title || "Not found");
                setStock(data.stock || "0");
                setCurrentLocation(data.location || "");
                setLocation(data.location || "");
                setImageUrl(data.imageUrl || "");
                setSkuCatalogId(typeof data.skuCatalogId === 'number' ? data.skuCatalogId : null);
            } catch {
                setTitle("Error loading info");
            } finally {
                setIsLoadingTitle(false);
            }
            setUniqueSku(trimmed);
            setStep(3);
            return;
        }

        // Parallelize product-info lookup and next-unit-id allocation. The
        // sequential await chain (title → next-id) used to add 400-900ms to
        // first preview on station devices; running them concurrently gives
        // back the slower of the two. /api/units/next-id resolves the
        // sku_catalog row itself when no catalogIdHint is passed (see
        // route.ts:70-93), so we don't need the title call to finish first.
        const baseSku = trimmed.includes(':') ? trimmed.split(':')[0] : trimmed;
        setIsLoadingTitle(true);

        const titlePromise = (async () => {
            try {
                const res = await fetch(`/api/get-title-by-sku?sku=${encodeURIComponent(normalizeSku(baseSku))}`);
                const data = await res.json();
                setTitle(data.title || "Not found");
                setStock(data.stock || "0");
                setCurrentLocation(data.location || "");
                setLocation(data.location || "");
                setImageUrl(data.imageUrl || "");
                const hint = typeof data.skuCatalogId === 'number' ? data.skuCatalogId : null;
                setSkuCatalogId(hint);
                return hint;
            } catch {
                setTitle("Error loading info");
                return null;
            } finally {
                setIsLoadingTitle(false);
            }
        })();

        const unitIdPromise: Promise<unknown> = mode === 'print'
            ? fetchNextUnitId(trimmed).catch((err) => {
                // Pre-allocation failure is not user-visible here — the click
                // path retries via handleNextStepSn and surfaces a toast then.
                // Suppressing avoids spurious errors on Ecwid SKUs not linked
                // to a sku_catalog row.
                console.warn('Pre-allocation skipped:', err);
                return null;
              })
            : Promise.resolve(null);

        await Promise.all([titlePromise, unitIdPromise]);

        setStep(2);
        setTimeout(() => snInputRef.current?.focus(), 100);
    }, [mode, fetchNextUnitId]);

    // Listen for sku:fill events dispatched by the right-panel SKU table
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
            const baseSku = skuValue.includes(':') ? skuValue.split(':')[0] : skuValue;
            const res = await fetch(`/api/get-title-by-sku?sku=${encodeURIComponent(normalizeSku(baseSku))}`);
            const data = await res.json();
            setTitle(data.title || "Not found");
            setStock(data.stock || "0");
            setCurrentLocation(data.location || "");
            setImageUrl(data.imageUrl || "");
            if (!location) setLocation(data.location || "");
            const hint = typeof data.skuCatalogId === 'number' ? data.skuCatalogId : null;
            setSkuCatalogId(hint);
            return hint;
        } catch (e) {
            setTitle("Error loading info");
            return null;
        } finally {
            setIsLoadingTitle(false);
        }
    };

    const handleNextStepSku = async () => {
        if (!sku.trim()) {
            setError("SKU required");
            return;
        }
        const catalogIdHint = await fetchProductInfo(sku);

        if (mode === 'reprint') {
            // Reprint exact same label value; no increment/current backend calls.
            setUniqueSku(sku.trim());
            setStep(3);
            return;
        }

        if (mode === 'print' && !uniqueSku) {
            setIsGenerating(true);
            try {
                await fetchNextUnitId(sku, catalogIdHint);
            } catch (err) {
                console.error("Failed to allocate unit id:", err);
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
            setError("Serial numbers required");
            return;
        }

        // Flush any pending SN (typed/scanned but not yet Enter-confirmed) into state
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
                    setError("Failed to generate unit id");
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
        setSku("");
        setUniqueSku("");
        setGtin("");
        setQrUrl("");
        setTitle("");
        setStock("");
        setSnInput("");
        setSerialNumbers([]);
        setImageUrl("");
        setSkuCatalogId(null);
        setStep(1);
        setError("");
        setTimeout(() => skuInputRef.current?.focus(), 100);
    };

    const handleSnInputChange = (value: string) => {
        setSnInput(value);
        setSerialNumbers(value.split(',').map(s => s.trim()).filter(s => !!s));
    };

    // Called by SerialNumberInput on each Enter scan — appends a single SN
    const handleSnAdd = (sn: string) => {
        const trimmed = sn.trim();
        if (!trimmed) return;
        setSerialNumbers(prev => {
            const next = [...prev, trimmed];
            setSnInput(next.join(', '));
            return next;
        });
    };

    // Issues the labels to the canonical pipeline. Writes serial_units +
    // station_activity_logs + tech_serial_numbers + a LABELED inventory_event
    // per unit, which is what powers the Recently Printed + Unit History
    // views. `sku` is sent as the minted unit id for back-compat; the route
    // resolves the actual product SKU from `productSku`.
    const issueLabels = async () => {
        setIsPosting(true);
        try {
            const res = await fetch('/api/post-multi-sn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
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
                }),
            });
            const data = await res.json();
            return data.success;
        } catch (e) {
            return false;
        } finally {
            setIsPosting(false);
        }
    };

    const handleFinalAction = async () => {
        if (mode === 'reprint') {
            // Just print, no DB/Sheet updates. Reprint uses the SKU itself
            // as the unit ID (legacy behavior); no GTIN/QR override
            // available because we don't know which unit it was.
            printProductLabels({ sku: uniqueSku, title, serialNumbers });
            pushRecent({ sku: uniqueSku || sku, sn: serialNumbers[0], title });
            setStep(1);
            setSku("");
            setUniqueSku("");
            setGtin("");
            setQrUrl("");
            setSerialNumbers([]);
            setSnInput("");
            return;
        }

        const success = await issueLabels();
        if (success) {
            if (mode === 'print') {
                // Print the current label. GTIN + qrUrl come from the
                // /api/units/next-id response that produced this unit id;
                // the print template encodes the GS1 Digital Link QR.
                printProductLabels({
                    sku: uniqueSku,
                    title,
                    serialNumbers,
                    gtin: gtin || undefined,
                    qrPayloads: qrUrl ? Array(serialNumbers.length).fill(qrUrl) : undefined,
                });
            }

            // Push to the session recents strip so the user can one-tap re-fill
            // this SKU. We persist both print + sn-to-sku flows since both
            // produce a labeled artifact worth recalling.
            pushRecent({ sku: uniqueSku || sku, sn: serialNumbers[0], title });

            setSnInput("");
            setSerialNumbers([]);

            if (mode === 'print') {
                // Allocate the NEXT unit id atomically so the operator can
                // print again immediately. fn_next_unit_seq increments
                // per-(sku, year), so each call returns a fresh value.
                try {
                    await fetchNextUnitId(sku, skuCatalogId);
                } catch (err) {
                    console.error("Failed to allocate next unit id:", err);
                    const msg = err instanceof Error ? err.message : 'Failed to allocate next unit id';
                    toast.error(`Couldn't queue next label: ${msg}`);
                }
            }

            setStep(2);
        } else {
            setError("Failed to save data");
        }
    };

    const handleModeChange = (newMode: BarcodeMode) => {
        if (isHorizontal) urlMode.setMode(newMode);
        else setLocalMode(newMode);
        setStep(1);
    };

    // When the URL-driven mode changes externally (e.g. user clicks a mode
    // pill in the sidebar), reset progression so each mode starts clean.
    useEffect(() => {
        if (!isHorizontal) return;
        setStep(1);
    }, [urlMode.mode, isHorizontal]);

    const density = isHorizontal ? 'comfortable' : 'compact';
    const previewIsReady = mode === 'reprint' ? !!sku.trim() : !!uniqueSku;

    // Cmd/Ctrl+P inside the workspace prints the current label (when ready).
    // We capture early to intercept before the browser opens its print dialog.
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
    }, [isHorizontal, mode, previewIsReady]);

    const skuInputEl = (
        <SkuInput
            sku={sku}
            uniqueSku={uniqueSku}
            mode={mode}
            skuInputRef={skuInputRef}
            isActive={isHorizontal ? true : step >= 1}
            density={density}
            onChange={handleSkuChange}
            onNext={handleNextStepSku}
            onFillAndSearch={handleSkuFillAndSearch}
        />
    );

    const showSerialPanel = mode !== 'reprint' && (isHorizontal ? !!sku.trim() : step >= 2);
    const serialPanelEl = showSerialPanel ? (
        <SerialNumberInput
            sku={sku}
            mode={mode}
            title={title}
            stock={stock}
            snInput={snInput}
            serialNumbers={serialNumbers}
            location={location}
            currentLocation={currentLocation}
            snInputRef={snInputRef}
            isLoadingTitle={isLoadingTitle}
            isActive={isHorizontal ? true : step >= 2}
            showChangeSku={mode === 'print' && (isHorizontal ? !!sku.trim() : step === 2)}
            density={density}
            imageUrl={imageUrl}
            onSnInputChange={handleSnInputChange}
            onSnAdd={handleSnAdd}
            onLocationChange={setLocation}
            onNext={handleNextStepSn}
            isPosting={isPosting}
            onChangeSku={handleChangeSku}
        />
    ) : null;

    const showPreviewPanel = isHorizontal ? true : step >= 3;
    const previewPanelEl = showPreviewPanel ? (
        isHorizontal && !previewIsReady ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 border-t border-gray-200 bg-gray-50 px-6 py-10 text-center">
                <span className="text-micro font-black uppercase tracking-[0.18em] text-gray-400">Live Preview</span>
                <p className="text-label font-semibold text-gray-400 max-w-[260px]">
                    {mode === 'sn-to-sku'
                        ? 'Scan a SKU and at least one serial to preview the log entry.'
                        : 'Scan or type a SKU to preview the label.'}
                </p>
            </div>
        ) : (
            <BarcodePreview
                mode={mode}
                uniqueSku={uniqueSku}
                sku={sku}
                title={title}
                serialNumbers={serialNumbers}
                notes={notes}
                location={location}
                showNotes={showNotes}
                dataMatrixValue={previewPayload.value}
                dataMatrixSymbology={previewPayload.symbology}
                isPosting={isPosting}
                isActive={isHorizontal ? previewIsReady : step >= 3}
                density={density}
                getSerialLast6={getSerialLast6}
                onToggleNotes={() => setShowNotes(!showNotes)}
                onNotesChange={setNotes}
                onPrint={handleFinalAction}
            />
        )
    ) : null;

    if (isHorizontal) {
        const accent = MODE_ACCENT_THEME[mode];
        const showSnCard = !!sku.trim() && (mode === 'print' || mode === 'sn-to-sku');
        const showPreviewCard = previewIsReady;

        const removeSerial = (target: string) =>
            setSerialNumbers((prev) => {
                const next = prev.filter((s) => s !== target);
                setSnInput(next.join(', '));
                return next;
            });

        // Print/log is allowed as soon as the user has a SKU and at least one
        // serial. When previewIsReady is false (eager pre-allocation failed
        // or hasn't returned yet), `primaryAction` falls through to
        // handleNextStepSn which allocates on demand and surfaces a toast on
        // failure — so we don't want to leave the button disabled forever.
        const hasRequiredInputs =
            mode === 'reprint'
                ? !!sku.trim()
                : !!sku.trim() && serialNumbers.length > 0;
        const primaryDisabled = isPosting || isGenerating || !hasRequiredInputs;

        const primaryLabel = isPosting
            ? mode === 'print'
                ? 'Saving & Printing…'
                : mode === 'reprint'
                  ? 'Reprinting…'
                  : 'Logging…'
            : mode === 'print'
              ? 'Save & Print Label'
              : mode === 'reprint'
                ? 'Reprint Label'
                : 'Log to Database';

        const primaryAction = () => {
            if (previewIsReady) return handleFinalAction();
            return handleNextStepSn();
        };

        return (
            <div className="flex h-full min-h-0 min-w-0 flex-col bg-gray-50 text-gray-900">
                {/* Scrollable hero column */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="mx-auto w-full max-w-3xl px-6 py-8 space-y-4 pb-32">
                        <WorkspaceCard label="SKU" tone={accent.tone}>
                            <ModernSkuField
                                value={sku}
                                inputRef={skuInputRef}
                                accent={accent}
                                onChange={handleSkuChange}
                                onNext={handleNextStepSku}
                                onFillAndSearch={handleSkuFillAndSearch}
                            />
                            {comfyHelperHint(mode)}
                        </WorkspaceCard>

                        {sku.trim() && (
                            <ProductContextCard
                                title={title}
                                stock={stock}
                                imageUrl={imageUrl}
                                isLoading={isLoadingTitle}
                            />
                        )}

                        {showSnCard && (
                            <SerialScanCard
                                snInputRef={snInputRef}
                                serialNumbers={serialNumbers}
                                accent={accent}
                                onAdd={handleSnAdd}
                                onRemove={removeSerial}
                                onPasteList={(list) => {
                                    list.forEach((s) => handleSnAdd(s));
                                }}
                            />
                        )}

                        {showSnCard && (
                            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
                                <ConditionPills
                                    value={condition}
                                    onChange={(next) => setCondition(next as ConditionGrade)}
                                />
                            </section>
                        )}

                        {!!sku.trim() && (
                            <NotesCard
                                notes={notes}
                                showNotes={showNotes}
                                accent={accent}
                                onToggleNotes={() => setShowNotes(!showNotes)}
                                onNotesChange={setNotes}
                            />
                        )}

                        {showPreviewCard ? (
                            <PreviewCardModern
                                mode={mode}
                                uniqueSku={uniqueSku || sku}
                                title={title}
                                serialNumbers={serialNumbers}
                                location={location}
                                accent={accent}
                                dataMatrixValue={previewPayload.value}
                                dataMatrixSymbology={previewPayload.symbology}
                            />
                        ) : (
                            <PreviewPlaceholder mode={mode} sku={sku} />
                        )}

                        {/* Inline primary CTA. Mirrors the sticky bar so the
                         * action is always reachable even when the viewport
                         * crops the sticky footer (short desktop windows,
                         * iPad split-view, browser zoom). Disabled state is
                         * intentionally bold so packers can see *why* they
                         * can't click. */}
                        <button
                            type="button"
                            onClick={primaryAction}
                            disabled={primaryDisabled}
                            className={`flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors ${
                                primaryDisabled
                                    ? 'cursor-not-allowed bg-gray-300'
                                    : `${accent.ctaBg} ${accent.ctaHover}`
                            }`}
                        >
                            <Check className="h-4 w-4" />
                            {primaryLabel}
                        </button>
                    </div>
                </div>

                {/* Sticky action bar */}
                <StickyActionBar
                    primary={{
                        label: primaryLabel,
                        onClick: primaryAction,
                        disabled: primaryDisabled,
                        isLoading: isPosting,
                        icon: <Check className="h-4 w-4" />,
                        toneClasses: { bg: accent.ctaBg, hover: accent.ctaHover },
                        tone: accent.tone,
                    }}
                    hints={[
                        { key: '⏎', label: 'Continue' },
                        ...((mode === 'print' || mode === 'reprint') && previewIsReady
                            ? [{ key: '⌘P', label: 'Print' }]
                            : []),
                    ]}
                />

                <RecentsStrip
                    recents={recents}
                    onPick={(s) => window.dispatchEvent(new CustomEvent('sku:fill', { detail: { sku: s } }))}
                    onClear={clearRecents}
                />
            </div>
        );
    }

    return (
        <div className="flex min-w-0 flex-col bg-white text-gray-900">
            {/* Mode Selector — full-width tab slider */}
            <ModeSelector mode={mode} onModeChange={handleModeChange} />

            {/*
             * Vertical: no internal scroll. The sidebar host owns the scroll
             * container; nesting another would break because `h-full` resolves
             * against the parent's content height, not the viewport.
             */}
            <div className="min-w-0">
                {skuInputEl}
                {serialPanelEl}
                {previewPanelEl}
                <div ref={bottomAnchorRef} aria-hidden />
            </div>
        </div>
    );
}

// ─── Modern workspace internals ─────────────────────────────────────────────

interface ModeAccent {
    tone: 'blue' | 'emerald' | 'orange' | 'violet';
    tagline: string;
    ctaBg: string;
    ctaHover: string;
    bannerFrom: string;
    bannerTo: string;
    bannerText: string;
    bannerTag: string;
    focusRing: string;
    chip: string;
}

const MODE_ACCENT_THEME: Record<BarcodeMode, ModeAccent> = {
    'print': {
        tone: 'blue',
        tagline: 'Create a new SKU label',
        ctaBg: 'bg-blue-600',
        ctaHover: 'hover:bg-blue-700',
        bannerFrom: 'from-blue-50',
        bannerTo: 'to-white',
        bannerText: 'text-blue-900',
        bannerTag: 'bg-blue-600 text-white',
        focusRing: 'focus:ring-blue-500/30 focus:border-blue-500',
        chip: 'bg-blue-50 text-blue-700',
    },
    'sn-to-sku': {
        tone: 'emerald',
        tagline: 'Log serials against an existing SKU',
        ctaBg: 'bg-emerald-600',
        ctaHover: 'hover:bg-emerald-700',
        bannerFrom: 'from-emerald-50',
        bannerTo: 'to-white',
        bannerText: 'text-emerald-900',
        bannerTag: 'bg-emerald-600 text-white',
        focusRing: 'focus:ring-emerald-500/30 focus:border-emerald-500',
        chip: 'bg-emerald-50 text-emerald-700',
    },
    'reprint': {
        tone: 'violet',
        tagline: 'Re-issue the same label',
        ctaBg: 'bg-violet-700',
        ctaHover: 'hover:bg-violet-800',
        bannerFrom: 'from-violet-50',
        bannerTo: 'to-white',
        bannerText: 'text-violet-900',
        bannerTag: 'bg-violet-700 text-white',
        focusRing: 'focus:ring-violet-500/30 focus:border-violet-500',
        chip: 'bg-violet-50 text-violet-700',
    },
};

function modeLabel(mode: BarcodeMode): string {
    if (mode === 'sn-to-sku') return 'Log Serials';
    if (mode === 'reprint') return 'Reprint';
    return 'Print Label';
}

function comfyHelperHint(mode: BarcodeMode) {
    const text =
        mode === 'reprint'
            ? 'Scan or paste a SKU to bring up its last label.'
            : 'Scan or paste a SKU to load product info.';
    return <p className="mt-2 text-xs text-gray-500">{text}</p>;
}

interface ModeBannerProps {
    mode: BarcodeMode;
    accent: ModeAccent;
}

function ModeBanner({ mode, accent }: ModeBannerProps) {
    return (
        <div
            className={`flex items-center justify-between rounded-2xl bg-gradient-to-r ${accent.bannerFrom} ${accent.bannerTo} px-5 py-3 ring-1 ring-gray-200/60`}
        >
            <div className="flex items-center gap-3">
                <span className={`rounded-lg px-2.5 py-1 text-micro font-bold uppercase tracking-[0.16em] ${accent.bannerTag}`}>
                    {modeLabel(mode)}
                </span>
                <span className={`text-sm font-semibold ${accent.bannerText}`}>{accent.tagline}</span>
            </div>
        </div>
    );
}

interface WorkspaceCardProps {
    label?: string;
    tone?: ModeAccent['tone'];
    children: React.ReactNode;
    actions?: React.ReactNode;
}

function WorkspaceCard({ label, children, actions }: WorkspaceCardProps) {
    return (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
            {(label || actions) && (
                <div className="mb-3 flex items-center justify-between">
                    {label && (
                        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                            {label}
                        </h3>
                    )}
                    {actions}
                </div>
            )}
            {children}
        </section>
    );
}

interface ModernSkuFieldProps {
    value: string;
    inputRef: React.RefObject<HTMLInputElement>;
    accent: ModeAccent;
    onChange: (v: string) => void;
    onNext: () => void;
    onFillAndSearch: (v: string) => void;
}

function ModernSkuField({ value, inputRef, accent, onChange, onNext, onFillAndSearch }: ModernSkuFieldProps) {
    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            const trimmed = text.trim();
            if (trimmed) onFillAndSearch(trimmed);
        } catch {}
    };

    return (
        <div className="flex items-stretch gap-2">
            <div className="relative flex-1">
                <input
                    ref={inputRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onNext()}
                    placeholder="Scan or type a SKU…"
                    autoComplete="off"
                    spellCheck={false}
                    className={`block h-12 w-full rounded-xl border border-gray-200 bg-white px-4 font-mono text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 ${accent.focusRing}`}
                />
            </div>
            <button
                type="button"
                onClick={handlePaste}
                title="Paste from clipboard and search"
                className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
            >
                <Clipboard className="h-4 w-4" />
            </button>
            <button
                type="button"
                onClick={onNext}
                title="Search"
                className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white shadow-sm transition-colors ${accent.ctaBg} ${accent.ctaHover}`}
            >
                <Search className="h-4 w-4" />
                <span>Search</span>
            </button>
        </div>
    );
}

interface ProductContextCardProps {
    title: string;
    stock: string;
    imageUrl?: string;
    isLoading: boolean;
}

function ProductContextCard({
    title,
    stock,
    imageUrl,
    isLoading,
}: ProductContextCardProps) {
    const stockNum = parseInt(stock || '0', 10) || 0;
    const stockClass =
        stockNum <= 0
            ? 'bg-red-50 text-red-700 ring-red-200'
            : stockNum <= 5
              ? 'bg-amber-50 text-amber-700 ring-amber-200'
              : 'bg-emerald-50 text-emerald-700 ring-emerald-200';

    return (
        <section className="flex items-start gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-50 ring-1 ring-gray-200">
                {isLoading ? (
                    <div className="h-full w-full animate-pulse bg-gray-200" />
                ) : imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={imageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                    />
                ) : (
                    <Printer className="h-5 w-5 text-gray-300" />
                )}
            </div>

            <div className="min-w-0 flex-1">
                {isLoading ? (
                    <div className="space-y-2">
                        <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
                        <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
                    </div>
                ) : (
                    <p className="text-base font-semibold leading-snug text-gray-900">
                        {title || <span className="italic text-gray-400">SKU not in catalog</span>}
                    </p>
                )}
            </div>

            <span className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums ring-1 ${stockClass}`}>
                {stock || '0'} <span className="text-micro font-semibold uppercase tracking-wider">stock</span>
            </span>
        </section>
    );
}

interface SerialScanCardProps {
    snInputRef: React.RefObject<HTMLInputElement>;
    serialNumbers: string[];
    accent: ModeAccent;
    onAdd: (sn: string) => void;
    onRemove: (sn: string) => void;
    /** Kept for source-compat with the caller; comma-paste is handled inside InlineSerialAdder. */
    onPasteList?: (list: string[]) => void;
}

/**
 * Serial-number scan section for the products workspace. Delegates the
 * input + chip rendering to {@link InlineSerialAdder} so this surface shares
 * the same UX (last-4 chip + hover Edit/Delete menu, "Scan Serial #"
 * placeholder, barcode icon) used by receiving + tech testing. Local-only
 * `string[]` state is adapted to InlineSerialAdder's `SavedSerial` shape via
 * a stable synthetic id (array index) — the products page never persists
 * these serials by row id; identity is the SN string.
 */
function SerialScanCard({
    snInputRef: _snInputRef,
    serialNumbers,
    accent,
    onAdd,
    onRemove,
}: SerialScanCardProps) {
    const saved = serialNumbers.map((sn, idx) => ({ id: idx, serial_number: sn }));

    return (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
            {serialNumbers.length > 0 ? (
                <div className="mb-3 flex justify-end">
                    <span className={`rounded-md px-2 py-0.5 text-caption font-bold tabular-nums ${accent.chip}`}>
                        {serialNumbers.length} added
                    </span>
                </div>
            ) : null}

            <InlineSerialAdder
                lineId={0}
                saved={saved}
                expected={null}
                isSubmitting={false}
                autoFocus
                onAdd={(_lineId, sn) => onAdd(sn)}
                onDelete={(_lineId, s) => onRemove(s.serial_number)}
                onReplaceSerial={(_lineId, original, nextSerial) => {
                    onRemove(original.serial_number);
                    onAdd(nextSerial);
                }}
            />
        </section>
    );
}

interface NotesCardProps {
    notes: string;
    showNotes: boolean;
    accent: ModeAccent;
    onToggleNotes: () => void;
    onNotesChange: (v: string) => void;
}

function NotesCard({ notes, showNotes, accent, onToggleNotes, onNotesChange }: NotesCardProps) {
    return (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
            <button
                type="button"
                onClick={onToggleNotes}
                className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 hover:text-gray-700"
            >
                <span>Notes {notes ? <span className="ml-1 text-gray-400 normal-case tracking-normal">(filled)</span> : <span className="ml-1 text-gray-400 normal-case tracking-normal">(optional)</span>}</span>
                <span aria-hidden>{showNotes ? '−' : '+'}</span>
            </button>
            {showNotes && (
                <textarea
                    value={notes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    placeholder="Anything worth recording with this unit…"
                    rows={3}
                    className={`mt-3 block w-full resize-none rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 ${accent.focusRing}`}
                />
            )}
        </section>
    );
}

interface PreviewCardModernProps {
    mode: BarcodeMode;
    uniqueSku: string;
    title: string;
    serialNumbers: string[];
    location: string;
    accent: ModeAccent;
    /** DataMatrix payload — same value/symbology the printed label will encode. */
    dataMatrixValue: string;
    dataMatrixSymbology: 'gs1datamatrix' | 'datamatrix';
}

function PreviewCardModern({
    mode,
    uniqueSku,
    title,
    serialNumbers,
    location,
    accent,
    dataMatrixValue,
    dataMatrixSymbology,
}: PreviewCardModernProps) {
    const isPrintMode = mode === 'print' || mode === 'reprint';

    if (isPrintMode) {
        return (
            <LabelPreviewCard
                sku={uniqueSku}
                title={title}
                dataMatrixValue={dataMatrixValue}
                dataMatrixSymbology={dataMatrixSymbology}
                showReady={mode === 'print'}
                readyBadgeClassName={accent.chip}
            />
        );
    }

    return (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Review
                </h3>
            </div>
            <div className="space-y-2 rounded-xl bg-gray-50 p-5 ring-1 ring-gray-200/50">
                <div>
                    <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">SKU</p>
                    <p className="font-mono text-base font-bold text-gray-900">{uniqueSku}</p>
                </div>
                <div>
                    <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">
                        Serials ({serialNumbers.length})
                    </p>
                    <p className="break-all font-mono text-xs text-gray-700">
                        {serialNumbers.join(', ') || '—'}
                    </p>
                </div>
                {location && (
                    <div>
                        <p className="text-micro font-semibold uppercase tracking-[0.14em] text-gray-500">Location</p>
                        <p className="font-mono text-xs text-gray-700">{location}</p>
                    </div>
                )}
            </div>
        </section>
    );
}

interface PreviewPlaceholderProps {
    mode: BarcodeMode;
    sku: string;
}

function PreviewPlaceholder({ mode, sku }: PreviewPlaceholderProps) {
    return (
        <section className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white/50 p-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100">
                <Printer className="h-5 w-5 text-gray-400" />
            </div>
            <p className="text-sm font-semibold text-gray-700">
                {mode === 'sn-to-sku' ? 'Review will appear once a serial is added' : 'Label preview will appear here'}
            </p>
            <p className="mt-1 max-w-[280px] text-xs text-gray-500">
                {sku
                    ? mode === 'sn-to-sku'
                        ? 'Scan at least one serial number to enable the log action.'
                        : 'Generating the next unique SKU for this product…'
                    : 'Scan a SKU above to begin.'}
            </p>
        </section>
    );
}

