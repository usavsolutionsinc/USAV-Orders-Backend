'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'react-qr-code';
import { Smartphone, X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';

/**
 * Header phone icon + centered scan overlay. Encodes the mobile sign-in URL
 * (`<origin>/m/signin`) so staff can point their phone camera at it and open
 * the site on their phone without typing anything.
 */
export function PhoneSignInQrButton({
  className,
  iconClassName = 'h-4 w-4',
}: {
  className?: string;
  iconClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUrl(`${window.location.origin}/m/signin`);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <HoverTooltip label="Scan to open on your phone" asChild>
        <IconButton
          type="button"
          onClick={() => setOpen(true)}
          ariaLabel="Show sign-in QR code"
          className={cn(
            'flex items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 active:scale-95',
            className,
          )}
          icon={<Smartphone className={iconClassName} />}
        />
      </HoverTooltip>

      {open && typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Scan to open on your phone"
            className="fixed inset-0 z-modal flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <div
              className="relative flex w-[min(20rem,calc(100vw-2rem))] flex-col items-center rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <IconButton
                type="button"
                onClick={() => setOpen(false)}
                ariaLabel="Close"
                icon={<X className="h-4 w-4" />}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-700"
              />
              <p className="text-micro font-black uppercase tracking-widest text-gray-500">
                Scan to open on your phone
              </p>
              <p className="mt-1 text-center text-sm font-black text-gray-900">
                Point your camera at the code
              </p>
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-3 shadow-inner shadow-gray-900/[0.03]">
                {url ? (
                  <QRCode value={url} size={220} level="M" />
                ) : (
                  <div className="h-[220px] w-[220px] animate-pulse rounded-lg bg-gray-100" />
                )}
              </div>
              <p className="mt-4 w-full break-all rounded-lg bg-gray-50 px-3 py-2 text-center text-micro font-mono text-gray-500">
                {url || ' '}
              </p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
