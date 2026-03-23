'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Check, ChevronRight, Loader2, Package, X } from '@/components/Icons';

interface ValidatedFnsku {
  fnsku: string;
  found: boolean;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  is_active: boolean | null;
}

interface FbaFnskuPlanInputProps {
  staff: Array<{ id: number; name: string; role: string }>;
  onCreated: (shipmentId: number, shipmentRef: string) => void;
  onClose: () => void;
}

type Step = 'paste' | 'review' | 'form';

/** Extract all unique X00XXXXXXX tokens from free-text paste */
function parseFnskus(text: string): string[] {
  const matches = text.toUpperCase().match(/X00[A-Z0-9]{7}/g) ?? [];
  return Array.from(new Set(matches));
}

function StepDots({ step }: { step: Step }) {
  const steps: Step[] = ['paste', 'review', 'form'];
  const labels: Record<Step, string> = { paste: 'Paste', review: 'Review', form: 'Create' };
  const idx = steps.indexOf(step);
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <div
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-200 ${
              i <= idx ? 'bg-violet-500' : 'bg-zinc-200'
            }`}
          />
          {i < steps.length - 1 && (
            <div
              className={`h-px w-4 transition-colors duration-200 ${i < idx ? 'bg-violet-400' : 'bg-zinc-200'}`}
            />
          )}
        </div>
      ))}
      <span className="ml-1 text-[9px] font-black uppercase tracking-widest text-zinc-400">
        {labels[step]}
      </span>
    </div>
  );
}

export function FbaFnskuPlanInput({ staff, onCreated, onClose }: FbaFnskuPlanInputProps) {
  const [step, setStep] = useState<Step>('paste');
  const [rawText, setRawText] = useState('');
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState<ValidatedFnsku[]>([]);
  const [shipmentRef, setShipmentRef] = useState('');
  const [staffId, setStaffId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (step === 'paste') textareaRef.current?.focus();
  }, [step]);

  const parsedFnskus = parseFnskus(rawText);

  const handleValidate = useCallback(async () => {
    if (parsedFnskus.length === 0) return;
    setValidating(true);
    try {
      const res = await fetch(
        `/api/fba/fnskus/validate?fnskus=${encodeURIComponent(parsedFnskus.join(','))}`
      );
      const data = await res.json();
      if (Array.isArray(data?.results)) {
        setValidated(data.results as ValidatedFnsku[]);
        setStep('review');
      }
    } catch {
      // no-op
    } finally {
      setValidating(false);
    }
  }, [parsedFnskus]);

  const handleCreate = async () => {
    if (!shipmentRef.trim()) { setError('Shipment reference is required'); return; }
    if (!staffId) { setError('Staff member is required'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/fba/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_ref: shipmentRef.trim(),
          created_by_staff_id: Number(staffId),
          items: validated
            .filter((v) => v.found)
            .map((v) => ({ fnsku: v.fnsku, expected_qty: 1 })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error || 'Failed to create shipment'); return; }
      onCreated(Number(data.shipment.id), String(data.shipment.shipment_ref));
    } catch (err: any) {
      setError(err?.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep('paste');
    setRawText('');
    setValidated([]);
    setShipmentRef('');
    setStaffId('');
    setError(null);
  };

  const foundCount = validated.filter((v) => v.found).length;
  const notFoundCount = validated.filter((v) => !v.found).length;

  const slideVariants = {
    enter: { opacity: 0, x: 14 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -14 },
  };
  const transition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };

  return (
    <div className="flex h-full min-h-0 flex-col">

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-3 py-2.5">
        <StepDots step={step} />
        <button
          type="button"
          onClick={() => { reset(); onClose(); }}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Step content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>

          {/* ── STEP 1: Paste ── */}
          {step === 'paste' && (
            <motion.div
              key="paste"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
              className="p-3"
            >
              <p className="mb-1 text-[11px] font-bold text-zinc-700">Paste FNSKUs to plan</p>
              <p className="mb-3 text-[10px] leading-relaxed text-zinc-400">
                One per line, comma-separated, or mixed text —{' '}
                <span className="font-mono font-bold text-zinc-500">X00</span> prefix is auto-detected.
              </p>
              <textarea
                ref={textareaRef}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleValidate();
                }}
                placeholder={'X004NDIUJJ\nX003SG6CER\nX00492D0TJ'}
                rows={6}
                className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 font-mono text-[11px] font-bold leading-relaxed text-zinc-900 outline-none placeholder:font-sans placeholder:font-normal placeholder:text-zinc-300 focus:border-violet-400 focus:bg-white"
              />
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <AnimatePresence mode="wait">
                  {parsedFnskus.length > 0 ? (
                    <motion.span
                      key="count"
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-700"
                    >
                      {parsedFnskus.length} FNSKU{parsedFnskus.length !== 1 ? 's' : ''} detected
                    </motion.span>
                  ) : rawText.length > 0 ? (
                    <motion.span
                      key="none"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-[10px] font-semibold text-zinc-400"
                    >
                      No X00 FNSKUs found
                    </motion.span>
                  ) : (
                    <span key="empty" />
                  )}
                </AnimatePresence>
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={parsedFnskus.length === 0 || validating}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
                >
                  {validating
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <ChevronRight className="h-3 w-3" />}
                  {validating ? 'Checking…' : 'Validate'}
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP 2: Review ── */}
          {step === 'review' && (
            <motion.div
              key="review"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
              className="p-3"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-bold text-zinc-700">Does this look right?</p>
                <div className="flex items-center gap-1.5">
                  {foundCount > 0 && (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-black text-emerald-700">
                      {foundCount} ✓
                    </span>
                  )}
                  {notFoundCount > 0 && (
                    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[9px] font-black text-red-600">
                      {notFoundCount} ✗
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-3 overflow-hidden rounded-lg border border-zinc-100">
                {validated.map((v, i) => (
                  <div
                    key={v.fnsku}
                    className={`flex items-start gap-2.5 px-3 py-2 text-[11px] ${
                      i > 0 ? 'border-t border-zinc-100' : ''
                    } ${v.found ? 'bg-white' : 'bg-red-50/50'}`}
                  >
                    <div
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                        v.found ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'
                      }`}
                    >
                      {v.found
                        ? <Check className="h-2.5 w-2.5" />
                        : <X className="h-2.5 w-2.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono font-bold text-zinc-900">{v.fnsku}</p>
                      {v.found ? (
                        <p className="mt-0.5 truncate text-[9px] text-zinc-400">
                          {v.product_title || v.asin || '—'}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[9px] font-semibold text-red-500">Not in catalog</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {notFoundCount > 0 && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <p className="text-[10px] font-semibold text-amber-700">
                    {notFoundCount} FNSKU{notFoundCount > 1 ? 's' : ''} not in catalog — only found items will be added.
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep('paste')}
                  className="flex-1 rounded-lg border border-zinc-200 py-2 text-[10px] font-black uppercase tracking-wide text-zinc-600 transition-colors hover:bg-zinc-50"
                >
                  ← Edit
                </button>
                <button
                  type="button"
                  onClick={() => { if (foundCount > 0) setStep('form'); }}
                  disabled={foundCount === 0}
                  className="flex-1 rounded-lg bg-violet-600 py-2 text-[10px] font-black uppercase tracking-wide text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
                >
                  Confirm →
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP 3: Shipment form ── */}
          {step === 'form' && (
            <motion.div
              key="form"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
              className="p-3"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-bold text-zinc-700">Plan details</p>
                <span className="text-[9px] font-semibold text-zinc-400">
                  {foundCount} FNSKU{foundCount !== 1 ? 's' : ''}
                </span>
              </div>

              {/* FNSKU chips preview */}
              <div className="mb-3 flex flex-wrap gap-1">
                {validated.filter((v) => v.found).map((v) => (
                  <span
                    key={v.fnsku}
                    className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-violet-700"
                  >
                    {v.fnsku}
                  </span>
                ))}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    Shipment ref <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={shipmentRef}
                    onChange={(e) => setShipmentRef(e.target.value)}
                    placeholder="FBA15XXXXX"
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[12px] font-bold text-zinc-900 outline-none placeholder:font-normal placeholder:text-zinc-400 focus:border-violet-400 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    Created by <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[12px] font-bold text-zinc-900 outline-none focus:border-violet-400 focus:bg-white"
                  >
                    <option value="">Select staff…</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-2 text-[10px] font-semibold text-red-600"
                >
                  {error}
                </motion.p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep('review')}
                  className="flex-1 rounded-lg border border-zinc-200 py-2 text-[10px] font-black uppercase tracking-wide text-zinc-600 transition-colors hover:bg-zinc-50"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-violet-600 py-2 text-[10px] font-black uppercase tracking-wide text-white transition-all hover:bg-violet-700 disabled:opacity-50"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Creating…
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-1.5">
                      <Package className="h-3 w-3" />
                      Create plan
                    </span>
                  )}
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
