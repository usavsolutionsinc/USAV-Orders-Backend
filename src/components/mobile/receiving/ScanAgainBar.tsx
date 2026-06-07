'use client';

import { useRouter } from 'next/navigation';
import { QrCode, X } from '@/components/Icons';

/**
 * Header control cluster for any page reached by scanning a Data Matrix on the
 * phone (scanned receiving line, receipt, or serial unit). Gives the operator
 * a one-tap way back to the camera ("Scan again" → /m/scan) and out of the
 * flow ("✕" → /m/home cockpit). Shared so all three scanned-display surfaces
 * get the identical affordance.
 */
export function ScanAgainBar({ className = '' }: { className?: string }) {
  const router = useRouter();
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => router.push('/m/scan')}
        className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-micro font-black uppercase tracking-wider text-white active:bg-slate-800"
      >
        <QrCode className="h-3.5 w-3.5" />
        Scan again
      </button>
      <button
        type="button"
        onClick={() => router.push('/m/home')}
        aria-label="Exit to home"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 active:bg-slate-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
