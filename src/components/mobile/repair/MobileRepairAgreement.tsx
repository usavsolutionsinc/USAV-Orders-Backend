'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import SignaturePadLib from 'signature_pad';
import type { RepairFormData } from '@/components/repair/RepairIntakeForm';
import type { SignatureData } from '@/components/repair/SignaturePad';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MobileRepairAgreementProps {
  formData: RepairFormData;
  signatureData: SignatureData | null;
  onSignatureChange: (data: SignatureData | null) => void;
}

// ─── Landscape signature height (iPad landscape gets more canvas) ───────────

const SIGNATURE_HEIGHT_PORTRAIT = 220;
const SIGNATURE_HEIGHT_LANDSCAPE = 300;

// ─── Canvas scaling for Retina/HiDPI ────────────────────────────────────────

function scaleCanvas(canvas: HTMLCanvasElement) {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.scale(ratio, ratio);
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MobileRepairAgreement({
  formData,
  signatureData,
  onSignatureChange,
}: MobileRepairAgreementProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [signed, setSigned] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);

  // ── Orientation detection ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(orientation: landscape)');
    setIsLandscape(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // ── Initialize signature pad ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    scaleCanvas(canvas);

    const pad = new SignaturePadLib(canvas, {
      minWidth: 0.8,
      maxWidth: 3,
      penColor: 'black',
      velocityFilterWeight: 0.7,
    });
    padRef.current = pad;

    pad.addEventListener('endStroke', () => {
      const data = pad.toData();
      const totalPoints = data.reduce((sum, group) => sum + group.points.length, 0);
      if (data.length >= 1 && totalPoints >= 5) {
        setSigned(true);
        onSignatureChange({
          strokes: data,
          dataUrl: pad.toDataURL('image/png'),
        });
      } else {
        setSigned(false);
        onSignatureChange(null);
      }
    });

    // Debounced resize — preserves stroke data
    let resizeTimer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const strokeData = pad.toData();
        scaleCanvas(canvas);
        pad.clear();
        if (strokeData.length > 0) pad.fromData(strokeData);
      }, 150);
    });
    ro.observe(container);

    return () => {
      clearTimeout(resizeTimer);
      ro.disconnect();
      pad.off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClear = useCallback(() => {
    padRef.current?.clear();
    setSigned(false);
    onSignatureChange(null);
  }, [onSignatureChange]);

  const today = new Date().toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  const formatPhone = (phone: string) => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  };

  const sigHeight = isLandscape ? SIGNATURE_HEIGHT_LANDSCAPE : SIGNATURE_HEIGHT_PORTRAIT;

  // ── Detail rows for the agreement table ──
  const details: { label: string; value: string; highlight?: boolean }[] = [
    { label: 'Product', value: formData.product.model || formData.product.type },
    { label: 'Serial #', value: formData.serialNumber },
    {
      label: 'Issue',
      value: [
        ...formData.repairReasons,
        formData.repairNotes ? formData.repairNotes : null,
      ].filter(Boolean).join(', ') || '—',
    },
    { label: 'Customer', value: formData.customer.name },
    { label: 'Phone', value: formatPhone(formData.customer.phone) },
    ...(formData.customer.email ? [{ label: 'Email', value: formData.customer.email }] : []),
    { label: 'Price', value: `$${formData.price}`, highlight: true },
    { label: 'Payment', value: 'Card / Cash — Due at Pick-up' },
    { label: 'Date', value: today },
  ];

  return (
    <div className={isLandscape ? 'flex gap-5 items-start' : 'space-y-5'}>

      {/* ── LEFT COLUMN (or top in portrait): Agreement details ── */}
      <div className={`space-y-5 ${isLandscape ? 'flex-1 min-w-0' : ''}`}>
        {/* Header card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-blue-600 mb-0.5">Agreement</p>
              <h3 className="text-base font-black text-gray-900 uppercase tracking-tight">
                Repair Service Agreement
              </h3>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mt-0.5">
                Drop-Off Authorization
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[11px] font-black text-gray-900 uppercase tracking-tight">USAV Solutions</p>
              <p className="text-[10px] text-gray-400">16161 Gothard St. Suite A</p>
              <p className="text-[10px] text-gray-400">Huntington Beach, CA 92647</p>
              <p className="text-[10px] text-gray-400">(714) 596-6888</p>
            </div>
          </div>

          {/* Details table */}
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            {details.map((row, i) => (
              <div
                key={row.label}
                className={`flex items-stretch ${i < details.length - 1 ? 'border-b border-gray-100' : ''}`}
              >
                <span className="text-[10px] font-black uppercase tracking-wide text-gray-500 bg-gray-50 px-4 py-3 w-24 shrink-0 flex items-center border-r border-gray-100">
                  {row.label}
                </span>
                <span className={`flex-1 text-sm font-bold px-4 py-3 flex items-center ${
                  row.highlight ? 'text-emerald-700 bg-emerald-50' : 'text-gray-900 bg-white'
                }`}>
                  {row.value || '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Terms */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
          <div className="border-l-4 border-blue-600 pl-4 space-y-2">
            <p className="text-[12px] text-gray-700 leading-relaxed">
              Your Bose product has been received into our repair center. Under normal circumstances it will
              be repaired within the next <span className="font-black text-gray-900">3-10 working days</span> and returned to you.
            </p>
            <p className="font-black text-gray-900 uppercase tracking-wide text-[11px]">
              30-Day Warranty on all repair services.
            </p>
          </div>
          <p className="text-[11px] text-gray-500 italic leading-relaxed bg-gray-50 p-3 rounded-lg border border-gray-100">
            By signing below, I consent to conduct this transaction electronically
            and agree to the listed repair price, terms, and any unexpected delays in the repair process.
          </p>
        </div>
      </div>

      {/* ── RIGHT COLUMN (or bottom in portrait): Signature pad ── */}
      <div className={`${isLandscape ? 'w-[45%] flex-shrink-0 sticky top-5' : ''}`}>
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
          {/* Label row */}
          <div className="flex items-center justify-between">
            <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-gray-500">
              Customer Signature
            </label>
            <div className="flex items-center gap-3">
              {signed && (
                <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-600 uppercase tracking-wide bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Signed
                </span>
              )}
              <button
                type="button"
                onClick={handleClear}
                className="h-11 px-3 rounded-xl text-[10px] font-black text-red-500 uppercase tracking-wide active:bg-red-50 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Canvas */}
          <div
            ref={containerRef}
            className="relative rounded-xl border-2 border-gray-900 bg-white overflow-hidden"
            style={{ height: sigHeight }}
          >
            <canvas
              ref={canvasRef}
              className="w-full h-full"
              style={{
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            />
            {/* Baseline */}
            <div className="absolute bottom-12 left-6 right-6 border-b-2 border-dashed border-gray-200 pointer-events-none" />
            <span className="absolute bottom-4 left-6 text-[9px] text-gray-400 font-black uppercase tracking-[0.2em] pointer-events-none">
              Sign above
            </span>
            {/* Corner prompt */}
            {!signed && (
              <span className="absolute top-4 right-4 text-[10px] font-black text-gray-300 uppercase tracking-wide pointer-events-none">
                Touch to sign
              </span>
            )}
          </div>

          {/* Landscape helper text */}
          {isLandscape && (
            <p className="text-[10px] text-gray-400 font-bold text-center uppercase tracking-wide">
              iPad Landscape Mode — Full Signature Area
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
