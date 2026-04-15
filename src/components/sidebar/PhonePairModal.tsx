'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { X } from '@/components/Icons';
import StaffSelector from '@/components/StaffSelector';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { usePhonePair } from '@/contexts/PhonePairContext';

type PairResponse = {
  success: boolean;
  code?: string;
  pair_url?: string;
  expires_in_seconds?: number;
  staff_id?: number;
  staff_name?: string | null;
  error?: string;
};

type Step = 'staff' | 'qr';

type QrState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; code: string; pairUrl: string; expiresAt: number; staffName: string | null }
  | { kind: 'error'; message: string };

export function PhonePairModal() {
  const { modalOpen, closeModal, confirmPaired } = usePhonePair();

  const [step, setStep] = useState<Step>('staff');
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [selectedStaffName, setSelectedStaffName] = useState<string | null>(null);
  const [qrState, setQrState] = useState<QrState>({ kind: 'idle' });
  const [remaining, setRemaining] = useState<number>(0);
  const createdCodeRef = useRef<string | null>(null);

  // Reset to step 1 every time the modal opens so the user always picks staff
  // fresh — safer than retaining a previous selection across sessions.
  useEffect(() => {
    if (!modalOpen) return;
    setStep('staff');
    setSelectedStaffId(null);
    setSelectedStaffName(null);
    setQrState({ kind: 'idle' });
    createdCodeRef.current = null;
  }, [modalOpen]);

  const requestCode = useCallback(async (staffId: number) => {
    setQrState({ kind: 'loading' });
    try {
      const res = await fetch('/api/pair/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId }),
      });
      const data = (await res.json()) as PairResponse;
      if (!data?.success || !data.code || !data.pair_url) {
        setQrState({ kind: 'error', message: data?.error || 'Failed to create pair code' });
        return;
      }
      const ttl = data.expires_in_seconds ?? 300;
      createdCodeRef.current = data.code;
      setQrState({
        kind: 'ready',
        code: data.code,
        pairUrl: data.pair_url,
        expiresAt: Date.now() + ttl * 1000,
        staffName: data.staff_name ?? null,
      });
      setRemaining(ttl);
    } catch (err) {
      setQrState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      });
    }
  }, []);

  const handleContinue = useCallback(() => {
    if (!selectedStaffId) return;
    setStep('qr');
    void requestCode(selectedStaffId);
  }, [selectedStaffId, requestCode]);

  // Countdown ticker while a code is live.
  useEffect(() => {
    if (qrState.kind !== 'ready') return;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.round((qrState.expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setQrState({ kind: 'error', message: 'Code expired. Tap Retry.' });
        window.clearInterval(id);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [qrState]);

  // Listen on pair:{code} for the phone's claim. /api/pair/claim publishes
  // `paired` server-side; the realtime token now allows pair:* subscribe.
  const liveCode = qrState.kind === 'ready' ? qrState.code : null;
  useAblyChannel(
    liveCode ? `pair:${liveCode}` : 'pair:__idle__',
    'paired',
    (msg: { data?: { staff_id?: number; staff_name?: string | null } }) => {
      const data = msg?.data;
      if (!data?.staff_id) return;
      if (createdCodeRef.current !== liveCode) return;
      confirmPaired({
        staffId: Number(data.staff_id),
        staffName: data.staff_name ?? selectedStaffName,
        pairedAt: Date.now(),
      });
      closeModal();
    },
    modalOpen && Boolean(liveCode),
  );

  if (!modalOpen) return null;

  const themeId = selectedStaffId ?? 0;
  const theme = getStaffThemeById(themeId);
  const themeColors = stationThemeColors[theme];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={closeModal}
      role="dialog"
      aria-modal="true"
      aria-label="Pair phone"
    >
      <div
        className="relative w-[360px] max-w-[92vw] rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={closeModal}
          aria-label="Close"
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
          Pair phone
        </p>

        {step === 'staff' && (
          <div className="mt-2 space-y-4">
            <p className="text-[12px] text-gray-600">
              Pick the station this phone should pair with, then tap{' '}
              <span className="font-black text-gray-900">Continue</span>.
            </p>
            <div>
              <StaffSelector
                role="all"
                variant="default"
                selectedStaffId={selectedStaffId}
                onSelect={(id, name) => {
                  setSelectedStaffId(id);
                  setSelectedStaffName(name);
                }}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleContinue}
                disabled={!selectedStaffId}
                className={`rounded-lg px-4 py-1.5 text-[11px] font-black uppercase tracking-widest text-white shadow-sm transition-colors ${
                  selectedStaffId
                    ? 'bg-gray-900 hover:bg-gray-800'
                    : 'bg-gray-300 cursor-not-allowed'
                }`}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'qr' && (
          <div className="mt-2">
            <p className="text-[12px] text-gray-600">
              Scan with your phone camera to pair it with{' '}
              <span className={`font-black ${themeColors.text}`}>
                {selectedStaffName || `Staff #${selectedStaffId}`}
              </span>
              .
            </p>

            {qrState.kind === 'loading' && (
              <div className="mt-6 flex justify-center">
                <div className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-gray-700 animate-spin" />
              </div>
            )}

            {qrState.kind === 'ready' && (
              <>
                <div className="mt-4 flex justify-center">
                  <div className={`rounded-lg border-2 bg-white p-3 ${themeColors.border}`}>
                    <QRCode
                      value={qrState.pairUrl}
                      size={220}
                      level="M"
                      fgColor="#000000"
                      bgColor="#ffffff"
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <div>
                    <p className="font-black uppercase tracking-widest text-gray-500">Code</p>
                    <p className="font-mono font-black text-gray-900 tracking-wider">
                      {qrState.code}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black uppercase tracking-widest text-gray-500">Expires</p>
                    <p className="tabular-nums font-black text-gray-900">
                      {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => selectedStaffId && void requestCode(selectedStaffId)}
                    className="rounded-lg bg-gray-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white shadow-sm hover:bg-gray-800"
                  >
                    Refresh
                  </button>
                </div>
                <p className="mt-4 text-[10px] leading-snug text-gray-400">
                  Link:{' '}
                  <span className="font-mono text-gray-500 break-all">{qrState.pairUrl}</span>
                </p>
              </>
            )}

            {qrState.kind === 'error' && (
              <div className="mt-4 space-y-3 text-center">
                <p className="text-[12px] font-bold text-red-600">{qrState.message}</p>
                <button
                  type="button"
                  onClick={() => selectedStaffId && void requestCode(selectedStaffId)}
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-white shadow-sm hover:bg-gray-800"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setStep('staff');
                  setQrState({ kind: 'idle' });
                  createdCodeRef.current = null;
                }}
                className="text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-800"
              >
                ← Change staff
              </button>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                Waiting for phone…
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
