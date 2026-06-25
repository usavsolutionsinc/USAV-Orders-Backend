'use client';

import { Suspense, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

/**
 * Legacy bin-label landing page. Older QR labels still point at /m/b/{barcode};
 * the new ones land on /inventory?bin={barcode}. This page exists solely
 * to redirect so any sticker already in the wild keeps working.
 */
function BinRedirectInner() {
  const router = useRouter();
  const params = useParams<{ barcode: string }>();
  const searchParams = useSearchParams();
  const barcode = decodeURIComponent(params?.barcode || '').trim();

  useEffect(() => {
    if (!barcode) {
      router.replace('/inventory');
      return;
    }
    const qs = searchParams.toString();
    const base = `/inventory?bin=${encodeURIComponent(barcode)}`;
    router.replace(qs ? `${base}&${qs}` : base);
  }, [barcode, router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-bold text-slate-500">
      Opening bin…
    </div>
  );
}

export default function LegacyBinPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <BinRedirectInner />
    </Suspense>
  );
}
