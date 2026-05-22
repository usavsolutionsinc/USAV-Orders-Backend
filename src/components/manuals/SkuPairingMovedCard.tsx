'use client';

import Link from 'next/link';
import { Link2 } from '@/components/Icons';

/**
 * Manuals → SKU Pairing moved to /products?view=pairing.
 *
 * The legacy SkuPairingPanel still exists as `SkuPairingPanel` for any
 * external callers but is no longer mounted by the manuals sidebar. This
 * redirect card surfaces the new location without breaking deep links.
 */
export function SkuPairingMovedCard() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-white px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-200 bg-blue-50">
        <Link2 className="h-6 w-6 text-blue-600" />
      </div>
      <h2 className="mt-3 text-[14px] font-black uppercase tracking-tight text-gray-900">
        Pairing moved
      </h2>
      <p className="mt-1 max-w-xs text-[11px] font-semibold leading-snug text-gray-500">
        Product pairing lives under Products → Pairing now, with candidate
        suggestions, batch save, and a full audit trail.
      </p>
      <Link
        href="/products?view=pairing"
        className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-gray-800"
      >
        <Link2 className="h-3.5 w-3.5" />
        Open Pairing
      </Link>
    </div>
  );
}
