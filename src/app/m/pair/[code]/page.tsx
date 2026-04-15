'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';

type ClaimResponse = {
  success: boolean;
  staff_id?: number;
  staff_name?: string | null;
  phone_channel?: string;
  station_channel?: string;
  token_request?: unknown;
  error?: string;
};

export default function MobilePairPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [status, setStatus] = useState<'claiming' | 'ok' | 'error'>('claiming');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/pair/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = (await res.json()) as ClaimResponse;
        if (cancelled) return;
        if (!data?.success || !data.staff_id || !data.phone_channel || !data.token_request) {
          setStatus('error');
          setErrorMessage(data?.error || 'Pairing failed');
          return;
        }
        // Stash the session in sessionStorage. Short-lived, phone-only.
        window.sessionStorage.setItem(
          'usav.phonePair',
          JSON.stringify({
            staff_id: data.staff_id,
            staff_name: data.staff_name ?? null,
            phone_channel: data.phone_channel,
            station_channel: data.station_channel,
            token_request: data.token_request,
            paired_at: Date.now(),
          }),
        );
        setStatus('ok');
        router.replace('/m/scan');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Network error');
      }
    })();
    return () => { cancelled = true; };
  }, [code, router]);

  return (
    <div className="min-h-dvh w-full bg-white text-gray-900 flex flex-col items-center justify-center px-6 text-center">
      {status === 'claiming' && (
        <>
          <div className="h-10 w-10 rounded-full border-2 border-gray-200 border-t-gray-700 animate-spin mb-4" />
          <p className="text-sm font-black uppercase tracking-widest text-gray-600">Pairing</p>
          <p className="mt-1 text-xs font-mono text-gray-400">{code}</p>
        </>
      )}
      {status === 'ok' && (
        <p className="text-sm font-black uppercase tracking-widest text-emerald-600">Paired · opening scanner…</p>
      )}
      {status === 'error' && (
        <>
          <p className="text-sm font-black uppercase tracking-widest text-red-600">Pairing failed</p>
          <p className="mt-2 text-xs text-gray-500 max-w-xs">{errorMessage}</p>
          <p className="mt-4 text-[11px] text-gray-400">Ask the desktop to generate a new code.</p>
        </>
      )}
    </div>
  );
}
