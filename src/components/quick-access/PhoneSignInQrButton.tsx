'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'react-qr-code';
import { QrCode, X } from '@/components/Icons';

/**
 * Compact QR trigger + centered scan overlay. Encodes the mobile sign-in URL
 * (`<origin>/m/signin`) so staff can point their phone camera at it and open
 * the site on their phone without typing anything. Lives in the "Phone history"
 * action row's trailing slot — its click is isolated from the row's navigation.
 */
export function PhoneSignInQrButton({ className }: { className?: string }) {
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="Show sign-in QR code"
        title="Scan to open on your phone"
        className={
          className ??
          'inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-eyebrow font-black uppercase tracking-wider text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 active:bg-gray-100'
        }
      >
        <QrCode className="h-3.5 w-3.5" />
        QR
      </button>

      {open && typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Scan to open on your phone"
            className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <div
              className="relative flex w-[min(20rem,calc(100vw-2rem))] flex-col items-center rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
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

export default PhoneSignInQrButton;
