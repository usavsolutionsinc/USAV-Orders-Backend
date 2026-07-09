'use client';

import { useRouter } from 'next/navigation';
import { QrCode, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';

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
      <Button
        type="button"
        variant="brand"
        size="sm"
        icon={<QrCode />}
        onClick={() => router.push('/m/scan')}
        className="rounded-full px-3 text-micro font-black uppercase tracking-wider"
      >
        Scan again
      </Button>
      <IconButton
        type="button"
        icon={<X className="h-4 w-4" />}
        ariaLabel="Exit to home"
        onClick={() => router.push('/m/home')}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-sunken text-text-soft active:bg-surface-strong"
      />
    </div>
  );
}
