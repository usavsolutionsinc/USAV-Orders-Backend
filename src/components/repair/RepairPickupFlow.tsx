'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, Loader2, X, Camera } from '../Icons';
import { SignaturePad, type SignatureData } from './SignaturePad';
import { getSidebarIntakeSubmitButtonClass } from '@/design-system/components';
import { useBodyScrollLock } from '@/design-system/hooks';
import type { RSRecord } from '@/lib/neon/repair-service-queries';

interface RepairPickupFlowProps {
  repair: RSRecord;
  /** Called after a successful pickup / decline / Done — caller refreshes its data. */
  onUpdate: () => void;
  /** Close the overlay. */
  onClose: () => void;
}

type Step = 'sign' | 'receipt';

const PICKUP_TERMS =
  'I confirm I am picking up this repaired item and acknowledge the 30-day warranty on the repair.';

function firstNameOf(contactInfo: string | null | undefined): string {
  const raw = (contactInfo || '').split(',')[0]?.trim() || '';
  return raw.split(/\s+/)[0] || 'Customer';
}

export function RepairPickupFlow({ repair, onUpdate, onClose }: RepairPickupFlowProps) {
  // If the repair is already Done, jump straight to the receipt — staff are
  // re-opening so the customer can re-photograph the paper.
  const alreadyDone = (repair.status || '').trim().toLowerCase() === 'done';
  const [step, setStep] = useState<Step>(alreadyDone ? 'receipt' : 'sign');
  const [signatureData, setSignatureData] = useState<SignatureData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customerName = useMemo(
    () => (repair.contact_info || '').split(',')[0]?.trim() || '',
    [repair.contact_info],
  );
  const firstName = useMemo(() => firstNameOf(repair.contact_info), [repair.contact_info]);
  const rsCode = `RS-${repair.id}`;
  const orangeSubmit = getSidebarIntakeSubmitButtonClass('orange');

  useBodyScrollLock(true);

  const submit = async (
    payload: { signature: SignatureData | null; declinedReason?: string },
  ): Promise<boolean> => {
    setError(null);
    try {
      const response = await fetch('/api/repair-service/pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairId: repair.id,
          signatureDataUrl: payload.signature?.dataUrl ?? null,
          signatureStrokes: payload.signature?.strokes ?? null,
          signerName: customerName || null,
          declinedReason: payload.declinedReason ?? null,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        throw new Error(result?.details || result?.error || 'Pickup failed');
      }
      onUpdate();
      return true;
    } catch (err: any) {
      setError(err?.message || 'Pickup failed. Please try again.');
      return false;
    }
  };

  const handleSubmitSignature = async () => {
    if (!signatureData || isSubmitting) return;
    setIsSubmitting(true);
    const ok = await submit({ signature: signatureData });
    setIsSubmitting(false);
    if (ok) setStep('receipt');
  };

  const handleDecline = async () => {
    if (isDeclining) return;
    const reason = window.prompt(
      'Reason customer declined to sign? (recorded in the audit trail)',
      '',
    );
    if (reason === null) return; // cancelled
    setIsDeclining(true);
    const ok = await submit({
      signature: null,
      declinedReason: reason.trim() || 'declined',
    });
    setIsDeclining(false);
    if (ok) setStep('receipt');
  };

  const receiptUrl = `/api/repair-service/print/${repair.id}`;

  return (
    <div className="fixed inset-0 z-panelOverlay flex flex-col overflow-hidden bg-white">
      {step === 'sign' && (
        <>
          <div className="shrink-0 flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div>
              <h2 className="text-sm font-black uppercase tracking-tight text-gray-900">
                Pickup Confirmation
              </h2>
              <p className="mt-0.5 text-micro font-bold text-gray-500">
                {rsCode} — {firstName} — {repair.product_title || 'Repair'} —{' '}
                <span className="text-emerald-600">${repair.price || '0'}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-eyebrow font-black uppercase tracking-wide text-gray-600 transition-colors hover:bg-gray-50"
              >
                <ChevronLeft className="h-3 w-3" />
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmitSignature}
                disabled={!signatureData || isSubmitting}
                className={orangeSubmit}
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting...
                  </span>
                ) : (
                  'Submit Pickup'
                )}
              </button>
            </div>
          </div>

          <div className="shrink-0 border-b border-gray-100 px-6 py-3">
            <p className="text-caption text-gray-500 italic leading-relaxed">
              {PICKUP_TERMS}
              <span className="ml-2 font-black text-gray-900 not-italic uppercase text-micro">
                30-Day Warranty
              </span>
            </p>
          </div>

          <div className="flex-1 min-h-0 flex flex-col items-center justify-start px-6 pt-4 pb-2 gap-2">
            <div className="w-full max-w-3xl h-[260px]">
              <SignaturePad onSignatureChange={setSignatureData} fillHeight label="Pickup Signature" />
            </div>
            <p
              className={`text-eyebrow font-black uppercase tracking-wide transition-opacity ${
                signatureData ? 'opacity-0' : 'text-amber-600'
              }`}
            >
              Signature required to submit
            </p>
          </div>

          <div className="shrink-0 border-t border-gray-100 px-6 py-3 flex items-center justify-center">
            <button
              type="button"
              onClick={handleDecline}
              disabled={isDeclining || isSubmitting}
              className="text-micro font-black uppercase tracking-wide text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              {isDeclining ? 'Recording…' : 'Customer declined to sign'}
            </button>
          </div>

          {error && (
            <div className="shrink-0 border-t border-red-100 bg-red-50 px-6 py-2 text-caption font-bold text-red-600">
              {error}
            </div>
          )}
        </>
      )}

      {step === 'receipt' && (
        <>
          <div className="shrink-0 flex items-center justify-between border-b border-gray-100 px-6 py-4 bg-emerald-50">
            <div className="flex items-center gap-3">
              <Camera className="h-5 w-5 text-emerald-600" />
              <div>
                <h2 className="text-sm font-black uppercase tracking-tight text-gray-900">
                  Take a photo of this receipt to keep a copy
                </h2>
                <p className="mt-0.5 text-micro font-bold text-gray-500">
                  {rsCode} — {firstName} — pickup complete
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 rounded-xl bg-gray-900 px-4 py-2.5 text-micro font-black uppercase tracking-wide text-white transition-colors hover:bg-gray-700"
            >
              <X className="h-3 w-3" />
              Done
            </button>
          </div>

          <div className="flex-1 min-h-0 bg-gray-100 overflow-hidden">
            <iframe
              src={receiptUrl}
              title={`Repair receipt ${rsCode}`}
              className="h-full w-full border-0 bg-white"
            />
          </div>
        </>
      )}
    </div>
  );
}
