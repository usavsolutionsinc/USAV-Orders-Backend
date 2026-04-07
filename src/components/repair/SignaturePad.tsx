'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import SignaturePadLib, { type PointGroup } from 'signature_pad';

export interface SignatureData {
  strokes: PointGroup[];
  dataUrl: string;
}

interface SignaturePadProps {
  onSignatureChange: (data: SignatureData | null) => void;
  label?: string;
  /** When true, the pad fills its parent height instead of using a fixed height */
  fillHeight?: boolean;
}

const PAD_HEIGHT = 200;

/**
 * Scale canvas for Retina/HiDPI displays so strokes are crisp on iPad.
 * Sets the internal resolution to match devicePixelRatio while keeping
 * the CSS display size at the container's dimensions.
 */
function scaleCanvas(canvas: HTMLCanvasElement) {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.scale(ratio, ratio);
}

export function SignaturePad({ onSignatureChange, label = 'Customer Signature', fillHeight }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [signed, setSigned] = useState(false);

  // Initialize signature_pad + ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let pad: SignaturePadLib | null = null;
    let resizeTimer: ReturnType<typeof setTimeout>;

    const initPad = () => {
      if (pad) return; // already initialised
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w === 0 || h === 0) return; // layout not ready yet

      scaleCanvas(canvas);

      pad = new SignaturePadLib(canvas, {
        minWidth: 0.5,
        maxWidth: 2.5,
        penColor: 'black',
        velocityFilterWeight: 0.7,
      });
      padRef.current = pad;

      pad.addEventListener('endStroke', () => {
        if (!pad) return;
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
    };

    // Debounced resize — also handles deferred init when layout is ready
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!pad) {
          initPad();
          return;
        }
        const strokeData = pad.toData();
        scaleCanvas(canvas);
        pad.clear();
        if (strokeData.length > 0) pad.fromData(strokeData);
      }, 50);
    });
    ro.observe(container);

    // Try immediate init (works when container already has size)
    initPad();

    return () => {
      clearTimeout(resizeTimer);
      ro.disconnect();
      if (pad) pad.off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClear = useCallback(() => {
    padRef.current?.clear();
    setSigned(false);
    onSignatureChange(null);
  }, [onSignatureChange]);

  return (
    <div className={fillHeight ? 'flex h-full flex-col gap-2' : 'space-y-2'}>
      {/* Label row */}
      <div className="flex items-center justify-between">
        <label className="block text-[9px] font-black uppercase tracking-[0.15em] text-gray-500">
          {label}
        </label>
        <div className="flex items-center gap-3">
            <span className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wide px-2 py-1 border transition-opacity ${signed ? 'text-orange-600 bg-orange-50 border-orange-200' : 'opacity-0 border-transparent'}`}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Signed
            </span>
          <button
            type="button"
            onClick={handleClear}
            className="text-[9px] font-black text-red-500 hover:text-red-700 uppercase tracking-wide transition-colors px-2 py-1 hover:bg-red-50"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className={`relative border-2 border-gray-900 bg-white overflow-hidden ${fillHeight ? 'flex-1 min-h-0' : ''}`}
        style={fillHeight ? undefined : { height: PAD_HEIGHT }}
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
        <div className="absolute bottom-10 left-6 right-6 border-b-2 border-dashed border-gray-200 pointer-events-none" />
        <span className="absolute bottom-3 left-6 text-[8px] text-gray-400 font-black uppercase tracking-[0.2em] pointer-events-none">
          Sign above
        </span>
        {/* Corner accent */}
        {!signed && (
          <span className="absolute top-3 right-3 text-[8px] font-black text-gray-300 uppercase tracking-wide pointer-events-none">
            Touch to sign
          </span>
        )}
      </div>
    </div>
  );
}
