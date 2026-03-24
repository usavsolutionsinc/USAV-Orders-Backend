'use client';

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  X,
} from '@/components/Icons';
import { usePendingCatalog } from '@/components/fba/hooks/usePendingCatalog';
import { useTodayPlan } from '@/components/fba/hooks/useTodayPlan';
import { parseFnskus } from '@/components/fba/utils/parseFnskus';
import { getTodayDateIso } from '@/components/fba/utils/getTodayDate';
import type { StepId } from '@/components/fba/parts/StepIndicator';

interface ValidatedFnsku {
  fnsku: string;
  found: boolean;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  is_active: boolean | null;
}

interface FbaFnskuPlanInputProps {
  onCreated: (shipmentId: number, shipmentRef: string) => void;
  onClose: () => void;
  variant?: 'default' | 'sidebar';
}

type Step = StepId;

const STEP_ORDER: Step[] = ['paste', 'review', 'form', 'post-create'];

const STEP_HEADLINE: Record<Step, string> = {
  paste: 'FBA plan',
  review: 'Review lines',
  form: 'Create plan',
  'post-create': 'Done',
};

function stepProgressIndex(s: Step): number {
  return Math.max(0, STEP_ORDER.indexOf(s));
}

/** Match RepairIntakeForm: section label */
function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`block text-[9px] font-bold uppercase tracking-widest text-gray-600 ${className ?? ''}`}
    >
      {children}
    </span>
  );
}

function FnskuInfo({ row }: { row: ValidatedFnsku }) {
  return (
    <>
      <p className="text-sm font-bold leading-snug text-gray-900 break-words">{row.product_title || row.asin || 'Unknown product'}</p>
      <p className="mt-1 font-mono text-xs font-bold tabular-nums tracking-wide text-blue-600 break-all">{row.fnsku}</p>
    </>
  );
}

function StatInline({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'amber' | 'red' | 'slate';
}) {
  const toneCls =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'red'
          ? 'text-red-600'
          : 'text-gray-700';
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500">{label}</span>
      <span className={`text-sm font-black tabular-nums ${toneCls}`}>{value}</span>
    </span>
  );
}

function ProgressBars({ activeIndex }: { activeIndex: number }) {
  return (
    <div className="flex gap-2">
      {STEP_ORDER.map((_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full transition-colors ${i <= activeIndex ? 'bg-blue-500' : 'bg-gray-200'}`}
        />
      ))}
    </div>
  );
}

const inputClass =
  'w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-bold bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50';

const btnPrimary =
  'flex flex-1 items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl transition-all text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed';

const btnSecondary =
  'flex flex-1 items-center justify-center gap-2 px-4 py-3 bg-gray-200 hover:bg-gray-300 text-gray-900 rounded-xl transition-all text-xs font-bold uppercase tracking-wide';

const btnGhost = 'px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-all text-xs font-bold uppercase tracking-wide';

export function FbaFnskuPlanInput({ onCreated, onClose: _onClose, variant = 'default' }: FbaFnskuPlanInputProps) {
  const isSidebar = variant === 'sidebar';
  /** Tight vertical rhythm in sidebar; default keeps slightly more air */
  const pad = isSidebar ? 'px-3 py-1' : 'px-4 py-2.5';
  const planBtnPrimary = isSidebar
    ? 'flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl transition-all text-[10px] font-bold uppercase tracking-wide disabled:cursor-not-allowed'
    : btnPrimary;
  const planBtnSecondary = isSidebar
    ? 'flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-900 rounded-xl transition-all text-[10px] font-bold uppercase tracking-wide'
    : btnSecondary;
  const planBtnGhost = isSidebar
    ? 'px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-all text-[10px] font-bold uppercase tracking-wide'
    : btnGhost;
  const planBtnCreate = isSidebar
    ? 'flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500'
    : 'flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-bold uppercase tracking-wide text-white transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500';
  const planBtnCatalog = isSidebar
    ? 'flex flex-1 items-center justify-center rounded-xl border-2 border-amber-300 bg-amber-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-950 transition-all hover:bg-amber-200'
    : 'flex flex-1 items-center justify-center rounded-xl border-2 border-amber-300 bg-amber-100 px-4 py-3 text-xs font-bold uppercase tracking-wide text-amber-950 transition-all hover:bg-amber-200';
  const pasteInputClass = isSidebar
    ? 'min-h-[36px] w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-1.5 font-mono text-xs font-bold text-gray-900 placeholder:text-gray-400 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50'
    : inputClass;
  const [step, setStep] = useState<Step>('paste');
  const [rawText, setRawText] = useState('');
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState<ValidatedFnsku[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [shortPanel, setShortPanel] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pasteInputRef = useRef<HTMLInputElement>(null);
  const { todayFnskus, addFnskus: addTodayFnskus, resetIfStale } = useTodayPlan();
  const { pending, addPending, removePending } = usePendingCatalog();
  const [createdRef, setCreatedRef] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const uploadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarDropdownMotion = useRef(false);
  const toggleSidebarOpen = useCallback(() => {
    sidebarDropdownMotion.current = true;
    setSidebarOpen((o) => !o);
  }, []);

  const singleLinePaste = isSidebar || shortPanel;
  /** Sidebar paste: shrink-wrap height; other steps fill the flex pane */
  const sidebarPasteCompact = isSidebar && step === 'paste';
  const progressIdx = stepProgressIndex(step);

  const panelStyle: CSSProperties = {
    minHeight: 0,
    height: sidebarPasteCompact
      ? 'auto'
      : isSidebar
        ? 'clamp(260px, 42vh, 520px)'
        : '100%',
    maxHeight: isSidebar ? 'min(520px, 50vh)' : 'var(--fnsku-modal-height, 520px)',
  };

  useEffect(() => {
    if (step !== 'paste') return;
    if (singleLinePaste) pasteInputRef.current?.focus();
    else textareaRef.current?.focus();
  }, [step, singleLinePaste]);

  useEffect(() => {
    if (isSidebar) {
      setShortPanel(false);
      return;
    }
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      setShortPanel(h > 0 && h < 296);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isSidebar]);

  useEffect(() => {
    resetIfStale();
  }, [resetIfStale]);

  useEffect(() => {
    return () => {
      if (uploadTimerRef.current) clearInterval(uploadTimerRef.current);
    };
  }, []);

  const parsedFnskus = useMemo(() => parseFnskus(rawText), [rawText]);

  const handleValidate = useCallback(async () => {
    if (parsedFnskus.length === 0) return;
    setValidating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/fba/fnskus/validate?fnskus=${encodeURIComponent(parsedFnskus.join(','))}`
      );
      const data = await res.json();
      if (Array.isArray(data?.results)) {
        const next = data.results as ValidatedFnsku[];
        setValidated(next);
        setQuantities((prev) => {
          const nextQuantities: Record<string, number> = {};
          next.forEach((row) => {
            if (!row.found) return;
            nextQuantities[row.fnsku] = prev[row.fnsku] ?? 1;
          });
          return nextQuantities;
        });
        const missing = next.filter((row) => !row.found).map((row) => row.fnsku);
        if (missing.length) addPending(missing);
        setStep('review');
      }
    } catch {
      /* no-op */
    } finally {
      setValidating(false);
    }
  }, [parsedFnskus, addPending]);

  const handleCreate = async () => {
    const foundItems = validated.filter((v) => v.found && !todayFnskus.includes(v.fnsku));
    const unresolved = validated.filter((v) => !v.found).map((v) => v.fnsku);
    if (foundItems.length === 0 && unresolved.length === 0) {
      setError('Nothing to add: every line is already on today’s plan or not in the catalog.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/fba/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          due_date: getTodayDateIso(),
          items: foundItems.map((v) => ({
            fnsku: v.fnsku,
            expected_qty: quantities[v.fnsku] ?? 1,
          })),
          unresolved_fnskus: unresolved,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Could not create the plan. Try again.');
        return;
      }
      addTodayFnskus(foundItems.map((v) => v.fnsku));
      setCreatedRef(String(data.shipment.shipment_ref));
      setStep('post-create');
      onCreated(Number(data.shipment.id), String(data.shipment.shipment_ref));
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep('paste');
    setRawText('');
    setValidated([]);
    setError(null);
    setQuantities({});
    setCreatedRef(null);
  };

  const foundCount = validated.filter((v) => v.found && !todayFnskus.includes(v.fnsku)).length;
  const skippedCount = validated.filter((v) => v.found && todayFnskus.includes(v.fnsku)).length;
  const notFoundCount = validated.filter((v) => !v.found).length;

  const handleAdjustQuantity = useCallback((fnsku: string, delta: number) => {
    setQuantities((prev) => {
      const current = prev[fnsku] ?? 1;
      const next = Math.max(1, current + delta);
      if (next === current) return prev;
      return { ...prev, [fnsku]: next };
    });
  }, []);

  const handleRemoveFnsku = useCallback(
    (fnsku: string) => {
      setValidated((prev) => prev.filter((row) => row.fnsku !== fnsku));
      setQuantities((prev) => {
        if (!(fnsku in prev)) return prev;
        const copy = { ...prev };
        delete copy[fnsku];
        return copy;
      });
      removePending(fnsku);
    },
    [removePending]
  );

  const handleUploadCatalog = useCallback(() => {
    setShowUpload((prev) => !prev);
    setUploadError(null);
  }, []);

  const handleUploadFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      const text = await file.text();
      const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
      const headers = firstLine.split(',').map((h) => h.trim().toLowerCase());
      const allowed = ['fnsku', 'product_title', 'asin', 'sku', 'condition', 'is_active'];
      const invalid = headers.filter((h) => h && !allowed.includes(h));
      if (invalid.length > 0 || !headers.includes('fnsku') || !headers.includes('product_title')) {
        setUploadError(
          invalid.length > 0
            ? `Unsupported columns: ${invalid.join(', ')}. Remove or rename them.`
            : 'CSV needs headers fnsku and product_title.'
        );
        return;
      }

      const form = new FormData();
      form.append('file', file);
      setUploading(true);
      setUploadError(null);
      setUploadSuccess(false);
      setUploadProgress(20);
      if (uploadTimerRef.current) clearInterval(uploadTimerRef.current);
      uploadTimerRef.current = setInterval(() => {
        setUploadProgress((p) => Math.min(90, p + 10));
      }, 180);
      try {
        const res = await fetch('/api/fba/fnskus/bulk', { method: 'POST', body: form });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || 'Upload failed');
        }
        setUploadSuccess(true);
        setUploadProgress(100);
        await handleValidate();
        setTimeout(() => setUploadProgress(0), 800);
      } catch (err: any) {
        setUploadError(err?.message || 'Upload did not complete.');
        setUploadProgress(0);
      } finally {
        if (uploadTimerRef.current) clearInterval(uploadTimerRef.current);
        setUploading(false);
      }
    },
    [handleValidate]
  );

  const slideVariants = {
    enter: { opacity: 0, x: 12 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -12 },
  };
  const transition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };
  const dropdownEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

  const renderMainColumn = () => (
    <>
      {/* Progress */}
      <div className={`${pad} shrink-0 border-b border-gray-200`}>
        <ProgressBars activeIndex={progressIdx} />
      </div>

      {/* Body */}
      <div
        className={`fnsku-body flex flex-col ${
          sidebarPasteCompact ? 'min-h-0 shrink-0' : 'min-h-0 flex-1 overflow-hidden'
        }`}
      >
        <div
          className={`fnsku-step-body w-full bg-white ${pad} space-y-0 ${
            sidebarPasteCompact
              ? 'flex flex-none flex-col overflow-visible items-start'
              : 'scrollbar-hide flex min-h-0 flex-1 flex-col overflow-y-auto'
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            {step === 'paste' && (
              <motion.div
                key="paste"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={transition}
                className={`flex min-h-0 w-full flex-col ${isSidebar ? 'space-y-2' : 'space-y-6'} ${sidebarPasteCompact ? 'h-auto' : ''}`}
              >
                <div className="space-y-2">
                  <FieldLabel>Paste FNSKUs</FieldLabel>
                  <p className="text-xs font-bold text-gray-500">
                    We detect <span className="font-mono text-blue-600">X00</span> codes from any pasted text.
                  </p>
                </div>

                {isSidebar ? (
                  <div className="w-full space-y-2">
                    <input
                      ref={pasteInputRef}
                      type="text"
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (parsedFnskus.length > 0 && !validating) void handleValidate();
                        }
                      }}
                      placeholder="Paste FNSKUs (X00…)"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      className={pasteInputClass}
                      aria-label="Paste FNSKU codes"
                    />
                    <p className="text-xs font-bold text-blue-600 tabular-nums">
                      {parsedFnskus.length > 0
                        ? `${parsedFnskus.length} found`
                        : rawText.length > 0
                          ? 'No X00 codes detected'
                          : '\u00a0'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-blue-600">
                      {parsedFnskus.length > 0 ? (
                        <span className="tabular-nums">{parsedFnskus.length} found</span>
                      ) : rawText.length > 0 ? (
                        <span className="text-amber-600">No FNSKU codes yet</span>
                      ) : null}
                    </div>
                    {singleLinePaste ? (
                      <input
                        ref={pasteInputRef}
                        type="text"
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && parsedFnskus.length > 0) {
                            void handleValidate();
                          }
                        }}
                        placeholder="X004NDIUJJ, X003SG6CER…"
                        className={`${inputClass} font-mono text-sm`}
                      />
                    ) : (
                      <textarea
                        ref={textareaRef}
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleValidate();
                        }}
                        placeholder={`X004NDIUJJ\nX003SG6CER\nX00492D0TJ`}
                        rows={4}
                        className={`${inputClass} min-h-[140px] resize-none font-mono text-sm`}
                      />
                    )}
                    <p className="border-t-2 border-dashed border-blue-200 pt-4 text-xs font-bold text-gray-500">
                      After checking the catalog you can fix quantities and remove lines.
                    </p>
                  </div>
                )}
              </motion.div>
            )}

            {step === 'review' && (
              <motion.div
                key="review"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={transition}
                className="flex h-full min-h-0 w-full flex-col gap-4"
              >
                <div className="shrink-0 space-y-3 border-b border-gray-200 pb-4">
                  <FieldLabel>Summary</FieldLabel>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold">
                    {foundCount > 0 && <span className="text-emerald-700">{foundCount} to add</span>}
                    {skippedCount > 0 && <span className="text-amber-700">{skippedCount} already planned</span>}
                    {notFoundCount > 0 && <span className="text-red-600">{notFoundCount} not in catalog</span>}
                  </div>
                  <button
                    type="button"
                    onClick={handleUploadCatalog}
                    className="text-xs font-bold uppercase tracking-wide text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-800"
                  >
                    {showUpload ? 'Hide CSV upload' : 'Upload catalog CSV'}
                  </button>
                </div>

                {showUpload && (
                  <div className="space-y-3 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <FieldLabel>Bulk catalog CSV</FieldLabel>
                        <p className="mt-2 text-xs font-bold text-gray-600">
                          Headers <span className="font-mono text-blue-600">fnsku</span> +{' '}
                          <span className="font-mono text-blue-600">product_title</span>. List re-checks after upload.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowUpload(false)}
                        className="text-xs font-bold text-gray-600 hover:text-gray-900"
                      >
                        Close
                      </button>
                    </div>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => handleUploadFile(e.target.files?.[0] ?? null)}
                      disabled={uploading}
                      className="block w-full text-xs font-bold text-gray-700 file:mr-3 file:rounded-xl file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-xs file:font-bold file:text-white file:uppercase"
                    />
                    {(uploading || uploadProgress > 0) && (
                      <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200">
                        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    )}
                    {uploading && <p className="text-xs font-bold text-blue-700">Uploading…</p>}
                    {uploadError && <p className="text-xs font-bold text-red-600">{uploadError}</p>}
                    {uploadSuccess && <p className="text-xs font-bold text-emerald-700">Uploaded. List refreshed.</p>}
                  </div>
                )}

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                  {validated.map((v) => {
                    const qty = quantities[v.fnsku] ?? 1;
                    const inToday = todayFnskus.includes(v.fnsku);
                    const missing = !v.found;
                    return (
                      <div
                        key={v.fnsku}
                        className={`rounded-xl border-2 p-3 ${
                          missing
                            ? 'border-red-200 bg-red-50/50'
                            : inToday
                              ? 'border-amber-200 bg-amber-50/40'
                              : 'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <div
                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                              missing ? 'bg-red-100 text-red-600' : inToday ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {missing ? <X className="h-3.5 w-3.5" /> : inToday ? <AlertCircle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            {v.found ? (
                              <>
                                <FnskuInfo row={v} />
                                {inToday && (
                                  <p className="mt-2 text-[9px] font-bold uppercase tracking-widest text-amber-700">
                                    Already on today’s plan
                                  </p>
                                )}
                              </>
                            ) : (
                              <>
                                <p className="text-sm font-black text-gray-900">Not in catalog</p>
                                <p className="mt-1 font-mono text-xs font-bold text-red-600 break-all">{v.fnsku}</p>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3">
                          {v.found && !inToday ? (
                            <div className="flex items-center overflow-hidden rounded-xl border-2 border-gray-200 bg-white text-xs font-black">
                              <button
                                type="button"
                                onClick={() => handleAdjustQuantity(v.fnsku, -1)}
                                disabled={qty <= 1}
                                className="px-3 py-2 transition-colors hover:bg-gray-50 disabled:opacity-40"
                                aria-label="Decrease quantity"
                              >
                                −
                              </button>
                              <span className="min-w-[2.5rem] border-x border-gray-200 px-3 py-2 text-center tabular-nums">{qty}</span>
                              <button
                                type="button"
                                onClick={() => handleAdjustQuantity(v.fnsku, 1)}
                                className="px-3 py-2 transition-colors hover:bg-gray-50"
                                aria-label="Increase quantity"
                              >
                                +
                              </button>
                              <span className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-gray-500">Qty</span>
                            </div>
                          ) : missing ? (
                            <span className="text-xs font-bold text-red-600">Needs catalog row</span>
                          ) : (
                            <span className="text-xs font-bold text-amber-800">Skipped</span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveFnsku(v.fnsku)}
                            className="text-xs font-bold uppercase tracking-wide text-red-600 underline decoration-red-200 underline-offset-2 hover:text-red-800"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {notFoundCount > 0 && (
                  <div className="shrink-0 rounded-xl border-2 border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <p className="text-xs font-bold text-amber-900">
                        {notFoundCount} line{notFoundCount > 1 ? 's' : ''} missing from catalog. Matched items ship; others stay
                        pending. <span className="block pt-1 text-[9px] uppercase tracking-widest text-amber-800">{pending.length} pending saved</span>
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {step === 'form' && (
              <motion.div
                key="form"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={transition}
                className={isSidebar ? 'w-full space-y-3' : 'w-full space-y-6'}
              >
                <div className="space-y-2 border-b border-gray-200 pb-4">
                  <FieldLabel>Plan summary</FieldLabel>
                  <p className="text-xs font-bold text-gray-600">Due date is today.</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-dashed border-blue-200 pt-4">
                    <StatInline label="Adding" value={foundCount} tone="emerald" />
                    <StatInline label="Skipped" value={skippedCount} tone="amber" />
                    <StatInline label="Unresolved" value={notFoundCount} tone="red" />
                    <span className="inline-flex items-baseline gap-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Due</span>
                      <span className="font-mono text-sm font-black text-gray-900">{getTodayDateIso()}</span>
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <FieldLabel>Lines on this plan</FieldLabel>
                  <div className="space-y-2">
                    {validated
                      .filter((v) => v.found && !todayFnskus.includes(v.fnsku))
                      .map((v) => (
                        <div key={v.fnsku} className="rounded-xl border-2 border-gray-200 bg-gray-50/50 p-3">
                          <FnskuInfo row={v} />
                        </div>
                      ))}
                  </div>
                </div>

                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
                  >
                    {error}
                  </motion.p>
                )}
              </motion.div>
            )}

            {step === 'post-create' && (
              <motion.div
                key="post-create"
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={transition}
                className={`flex min-h-0 w-full flex-1 flex-col ${isSidebar ? 'gap-2' : 'gap-4'}`}
              >
                <div
                  className={`shrink-0 rounded-xl border-2 border-emerald-200 bg-emerald-50 ${isSidebar ? 'p-2.5' : 'p-4'}`}
                >
                  <FieldLabel className="text-emerald-800">Success</FieldLabel>
                  <p className="mt-2 text-sm font-black text-emerald-900">Plan created</p>
                  {createdRef && (
                    <p className="mt-1 font-mono text-xs font-bold text-emerald-800">Ref {createdRef}</p>
                  )}
                  <p className="mt-2 text-xs font-bold text-emerald-800">Start another plan or finish catalog work below.</p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {pending.length > 0 ? (
                    <div className="space-y-2">
                      <FieldLabel>Pending catalog ({pending.length})</FieldLabel>
                      {pending.map((fnsku) => (
                        <div
                          key={fnsku}
                          className="flex items-center justify-between gap-2 rounded-xl border-2 border-amber-200 bg-amber-50/60 px-3 py-2"
                        >
                          <span className="font-mono text-xs font-black text-amber-950">{fnsku}</span>
                          <button
                            type="button"
                            onClick={() => removePending(fnsku)}
                            className="text-xs font-bold uppercase tracking-wide text-amber-800 underline"
                          >
                            Clear
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs font-bold text-gray-500">No pending FNSKUs.</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer — RepairIntakeForm */}
      <div className={`${pad} shrink-0 border-t border-gray-200 bg-white`}>
        <div className={isSidebar ? 'flex gap-2' : 'flex gap-3'}>
          {step === 'paste' && (
            <button
              type="button"
              onClick={() => void handleValidate()}
              disabled={parsedFnskus.length === 0 || validating}
              className={planBtnPrimary}
            >
              {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
              Check catalog
            </button>
          )}

          {step === 'review' && (
            <>
              <button type="button" onClick={() => setStep('paste')} className={planBtnSecondary}>
                <ChevronLeft className="h-4 w-4" />
                Edit paste
              </button>
              <button
                type="button"
                onClick={() => setStep('form')}
                disabled={validated.length === 0}
                className={planBtnPrimary}
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}

          {step === 'form' && (
            <>
              <button type="button" onClick={() => setStep('review')} className={btnSecondary}>
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={submitting}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-bold uppercase tracking-wide text-white transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Package className="h-4 w-4" />
                    Create plan
                  </>
                )}
              </button>
            </>
          )}

          {step === 'post-create' && (
            <>
              <button
                type="button"
                onClick={() => {
                  reset();
                  setCreatedRef(null);
                  setStep('paste');
                }}
                className={planBtnSecondary}
              >
                New plan
              </button>
              <button
                type="button"
                onClick={() => window.open('/admin/fba-fnskus', '_blank')}
                className={planBtnCatalog}
              >
                Catalog admin
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      {isSidebar ? (
        <div
          ref={panelRef}
          className="fnsku-panel fnsku-panel--sidebar flex w-full flex-col overflow-hidden border-b border-zinc-200 bg-white text-gray-900"
        >
          <div className={`${pad} flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-zinc-50/95`}>
            <div className="relative min-w-0 flex-1">
              <button
                type="button"
                onClick={toggleSidebarOpen}
                className="w-full py-0 pr-10 text-left outline-none transition-colors hover:bg-zinc-100/80 focus-visible:ring-2 focus-visible:ring-blue-500/40"
                aria-expanded={sidebarOpen}
                aria-controls="fba-plan-dropdown-panel"
                aria-label={
                  sidebarOpen
                    ? undefined
                    : `${STEP_HEADLINE[step]}, step ${progressIdx + 1} of ${STEP_ORDER.length}`
                }
                id="fba-plan-dropdown-trigger"
              >
                <h2 className="text-sm font-black uppercase tracking-tight text-gray-900">{STEP_HEADLINE[step]}</h2>
                {sidebarOpen ? (
                  <p className="text-[8px] font-bold uppercase tracking-widest text-blue-600">
                    Step {progressIdx + 1} of {STEP_ORDER.length}
                  </p>
                ) : null}
              </button>
              <motion.span
                initial={false}
                animate={{ rotate: sidebarOpen ? 180 : 0 }}
                transition={{ duration: sidebarDropdownMotion.current ? 0.28 : 0, ease: dropdownEase }}
                className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 items-center justify-center text-zinc-500"
                aria-hidden
              >
                <ChevronDown className="h-4 w-4 shrink-0" />
              </motion.span>
            </div>
            {step !== 'paste' && (
              <button type="button" onClick={reset} className={`shrink-0 ${planBtnGhost}`}>
                Start over
              </button>
            )}
          </div>

          <motion.div
            id="fba-plan-dropdown-panel"
            role="region"
            aria-labelledby="fba-plan-dropdown-trigger"
            initial={false}
            animate={{
              height: sidebarOpen ? 'auto' : 0,
              opacity: sidebarOpen ? 1 : 0,
            }}
            transition={{
              height: { duration: sidebarDropdownMotion.current ? 0.34 : 0, ease: dropdownEase },
              opacity: { duration: sidebarDropdownMotion.current ? 0.18 : 0, ease: dropdownEase },
            }}
            className={sidebarOpen ? 'overflow-hidden' : 'overflow-hidden pointer-events-none'}
          >
            <div
              className={`flex min-h-0 w-full flex-col bg-white text-gray-900 ${
                sidebarPasteCompact ? 'h-auto max-h-full' : 'max-h-full'
              }`}
              style={panelStyle}
            >
              {renderMainColumn()}
            </div>
          </motion.div>
        </div>
      ) : (
        <div
          ref={panelRef}
          className={`fnsku-panel flex min-h-0 w-full flex-col bg-white text-gray-900 ${
            sidebarPasteCompact ? 'h-auto max-h-full' : 'h-full max-h-full'
          }`}
          style={panelStyle}
        >
          <div className={`${pad} flex shrink-0 items-center justify-between border-b border-gray-200`}>
            <div className="min-w-0">
              <h2 className="text-sm font-black uppercase tracking-tight text-gray-900">{STEP_HEADLINE[step]}</h2>
              <p className="text-[8px] font-bold uppercase tracking-widest text-blue-600">
                Step {progressIdx + 1} of {STEP_ORDER.length}
              </p>
            </div>
            {step !== 'paste' && (
              <button type="button" onClick={reset} className={`shrink-0 ${btnGhost}`}>
                Start over
              </button>
            )}
          </div>
          {renderMainColumn()}
        </div>
      )}

      <style jsx global>{`
        .fnsku-panel {
          --surface-base: #0f0f11;
          --surface-raised: #18181b;
          --border-subtle: #3f3f46;
        }
      `}</style>
    </>
  );
}
