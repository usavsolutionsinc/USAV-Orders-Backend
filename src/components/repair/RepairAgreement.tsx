'use client';

import React from 'react';
import { SignaturePad, type SignatureData } from './SignaturePad';
import type { RepairFormData } from './RepairIntakeForm';

interface RepairAgreementProps {
  formData: RepairFormData;
  signatureData: SignatureData | null;
  onSignatureChange: (data: SignatureData | null) => void;
}

export function RepairAgreement({ formData, signatureData, onSignatureChange }: RepairAgreementProps) {
  const today = new Date().toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  const formatPhone = (phone: string) => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  };

  return (
    <div className="space-y-5">
      {/* Company Header — right-aligned */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.2em] text-blue-600 mb-0.5">Agreement</p>
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight">
            Repair Service Agreement
          </h3>
          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wide mt-0.5">
            Drop-Off Authorization
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black text-gray-900 uppercase tracking-tight">USAV Solutions</p>
          <p className="text-[9px] text-gray-400">16161 Gothard St. Suite A</p>
          <p className="text-[9px] text-gray-400">Huntington Beach, CA 92647</p>
          <p className="text-[9px] text-gray-400">(714) 596-6888</p>
        </div>
      </div>

      {/* Details — table style */}
      <div className="border-2 border-gray-900">
        <DetailRow label="Product" value={formData.product.model || formData.product.type} />
        <DetailRow label="Serial #" value={formData.serialNumber} />
        <DetailRow
          label="Issue"
          value={
            [
              ...formData.repairReasons,
              formData.repairNotes ? formData.repairNotes : null,
            ]
              .filter(Boolean)
              .join(', ') || '—'
          }
        />
        <DetailRow label="Customer" value={formData.customer.name} />
        <DetailRow label="Phone" value={formatPhone(formData.customer.phone)} />
        {formData.customer.email && (
          <DetailRow label="Email" value={formData.customer.email} />
        )}
        <DetailRow label="Price" value={`$${formData.price}`} highlight />
        <DetailRow label="Payment" value="Card / Cash — Due at Pick-up" />
        <DetailRow label="Date" value={today} isLast />
      </div>

      {/* Terms */}
      <div className="space-y-2 text-[11px] text-gray-700 leading-relaxed border-l-4 border-blue-600 pl-4">
        <p>
          Your Bose product has been received into our repair center. Under normal circumstances it will
          be repaired within the next <span className="font-black text-gray-900">3–10 working days</span> and returned to you.
        </p>
        <p className="font-black text-gray-900 uppercase tracking-wide text-[10px]">
          30-Day Warranty on all repair services.
        </p>
      </div>

      {/* ESIGN/UETA Consent */}
      <p className="text-[10px] text-gray-500 italic leading-relaxed bg-gray-50 p-3 border border-gray-200">
        By signing below, I consent to conduct this transaction electronically
        and agree to the listed repair price, terms, and any unexpected delays in the repair process.
      </p>

      {/* Signature */}
      <SignaturePad onSignatureChange={onSignatureChange} />
    </div>
  );
}

function DetailRow({ label, value, highlight, isLast }: { label: string; value: string; highlight?: boolean; isLast?: boolean }) {
  return (
    <div className={`flex items-stretch ${!isLast ? 'border-b border-gray-200' : ''}`}>
      <span className="text-[9px] font-black uppercase tracking-wide text-gray-500 bg-gray-50 px-3 py-2.5 w-20 shrink-0 flex items-center border-r border-gray-200">
        {label}
      </span>
      <span className={`flex-1 text-xs font-bold px-3 py-2.5 flex items-center ${highlight ? 'text-emerald-700 bg-emerald-50' : 'text-gray-900 bg-white'}`}>
        {value || '—'}
      </span>
    </div>
  );
}
