'use client';

import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { X } from '@/components/Icons';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

type PairResponse = {
  success: boolean;
  code?: string;
  pair_url?: string;
  expires_in_seconds?: number;
  staff_id?: number;
  staff_name?: string | null;
  error?: string;
};

type Props = {
  staffId: number;
  open: boolean;
  onClose: () => void;
};

export function PhonePairModal({ staffId, open, onClose }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [code, setCode] = useState<string | null>(null);
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [staffName, setStaffName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState('loading');
    setCode(null);
    setPairUrl(null);
    setErrorMessage(null);

    (async () => {
      try {
        const res = await fetch('/api/pair/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ staffId }),
        });
        const data = (await res.json()) as PairResponse;
        if (cancelled) return;
        if (!data?.success || !data.code || !data.pair_url) {
          setState('error');
          setErrorMessage(data?.error || 'Failed to create pair code');
          return;
        }
        setCode(data.code);
        setPairUrl(data.pair_url);
        setRemaining(data.expires_in_seconds ?? 300);
        setStaffName(data.staff_name || null);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setState('error');
        setErrorMessage(err instanceof Error ? err.message : 'Network error');
      }
    })();

    return () => { cancelled = true; };
  }, [open, staffId]);

  useEffect(() => {
    if (state !== 'ready' || remaining <= 0) return;
    const id = window.setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [state, remaining]);

  if (!open) return null;

  const theme = getStaffThemeById(staffId);
  const themeColors = stationThemeColors[theme];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative w-[320px] max-w-[90vw] rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
          Pair phone
        </p>
        <p className="mt-1 text-[12px] text-gray-600">
          Scan with your phone camera to bond it to{' '}
          <span className={`font-black ${themeColors.text}`}>
            {staffName || `Staff #${staffId}`}
          </span>.
        </p>

        {state === 'loading' && (
          <div className="mt-6 flex justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-gray-700 animate-spin" />
          </div>
        )}

        {state === 'ready' && pairUrl && code && (
          <>
            <div className="mt-4 flex justify-center">
              <div className={`rounded-lg border-2 bg-white p-3 ${themeColors.border}`}>
                <QRCode value={pairUrl} size={220} level="M" fgColor="#000000" bgColor="#ffffff" />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px]">
              <div>
                <p className="font-black uppercase tracking-widest text-gray-500">Code</p>
                <p className="font-mono font-black text-gray-900 tracking-wider">{code}</p>
              </div>
              <div className="text-right">
                <p className="font-black uppercase tracking-widest text-gray-500">Expires</p>
                <p className="tabular-nums font-black text-gray-900">
                  {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                </p>
              </div>
            </div>
            <p className="mt-4 text-[10px] leading-snug text-gray-400">
              Pairing link: <span className="font-mono text-gray-500 break-all">{pairUrl}</span>
            </p>
          </>
        )}

        {state === 'error' && (
          <div className="mt-4 text-center">
            <p className="text-[12px] font-bold text-red-600">{errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
}
