'use client';

import React, { useEffect, useState } from 'react';
import { Plus, X } from '@/components/Icons';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MobileCustomerInfoFormProps {
  customer: {
    name: string;
    phone: string;
    email: string;
  };
  serialNumber: string;
  price: string;
  notes: string;
  onCustomerChange: (field: string, value: string) => void;
  onSerialNumberChange: (value: string) => void;
  onPriceChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}

// ─── Shared field styles (56px spacious touch targets) ──────────────────────

const INPUT_CLASS =
  'w-full px-5 h-14 rounded-xl border border-gray-200 bg-white text-base font-bold focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-all placeholder:text-gray-300';

const LABEL_CLASS =
  'block text-[10px] font-black uppercase tracking-[0.15em] text-gray-500';

// ─── Component ──────────────────────────────────────────────────────────────

export function MobileCustomerInfoForm({
  customer,
  serialNumber,
  price,
  notes,
  onCustomerChange,
  onSerialNumberChange,
  onPriceChange,
  onNotesChange,
}: MobileCustomerInfoFormProps) {
  const [serialNumbers, setSerialNumbers] = useState<string[]>(
    serialNumber ? serialNumber.split(',').map(s => s.trim()).filter(s => s) : [''],
  );

  // Format phone as user types
  const handlePhoneChange = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    let formatted = cleaned;

    if (cleaned.length >= 10) {
      formatted = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
    } else if (cleaned.length > 6) {
      formatted = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    } else if (cleaned.length > 3) {
      formatted = `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    }

    onCustomerChange('phone', formatted);
  };

  // Sync serial numbers to parent
  useEffect(() => {
    const joined = serialNumbers.filter(s => s.trim()).join(', ');
    if (joined !== serialNumber) {
      onSerialNumberChange(joined);
    }
  }, [serialNumbers]);

  const addSerialNumber = () => setSerialNumbers([...serialNumbers, '']);

  const removeSerialNumber = (index: number) => {
    if (serialNumbers.length > 1) {
      setSerialNumbers(serialNumbers.filter((_, i) => i !== index));
    }
  };

  const updateSerialNumber = (index: number, value: string) => {
    const updated = [...serialNumbers];
    updated[index] = value;
    setSerialNumbers(updated);
  };

  return (
    <div className="space-y-6">
      {/* ── Name ── */}
      <div className="space-y-2">
        <label className={LABEL_CLASS}>
          Customer Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={customer.name}
          onChange={(e) => onCustomerChange('name', e.target.value)}
          placeholder="Enter customer name"
          className={INPUT_CLASS}
          autoComplete="name"
          required
        />
      </div>

      {/* ── Phone ── */}
      <div className="space-y-2">
        <label className={LABEL_CLASS}>
          Phone Number <span className="text-red-500">*</span>
        </label>
        <input
          type="tel"
          value={customer.phone}
          onChange={(e) => handlePhoneChange(e.target.value)}
          placeholder="000-000-0000"
          maxLength={12}
          className={INPUT_CLASS}
          autoComplete="tel"
          inputMode="tel"
          required
        />
      </div>

      {/* ── Email ── */}
      <div className="space-y-2">
        <label className={LABEL_CLASS}>
          Email{' '}
          <span className="text-gray-400 font-normal normal-case tracking-normal">— Optional</span>
        </label>
        <input
          type="email"
          value={customer.email}
          onChange={(e) => onCustomerChange('email', e.target.value)}
          placeholder="customer@example.com"
          className={`${INPUT_CLASS} lowercase`}
          autoComplete="email"
          inputMode="email"
        />
      </div>

      {/* ── Serial Numbers ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className={LABEL_CLASS}>
            Serial Numbers <span className="text-red-500">*</span>
          </label>
          <button
            type="button"
            onClick={addSerialNumber}
            className="flex items-center gap-1.5 h-11 px-3 rounded-xl text-[10px] font-black uppercase tracking-wide text-blue-600 active:bg-blue-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        <div className="space-y-2">
          {serialNumbers.map((sn, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={sn}
                onChange={(e) => updateSerialNumber(index, e.target.value)}
                placeholder={`Serial Number ${index + 1}`}
                className={`flex-1 ${INPUT_CLASS} font-mono`}
                required={index === 0}
              />
              {serialNumbers.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSerialNumber(index)}
                  className="flex items-center justify-center w-14 h-14 rounded-xl border border-red-200 bg-red-50 text-red-500 active:bg-red-100 transition-colors"
                  aria-label="Remove serial number"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Price ── */}
      <div className="space-y-2">
        <label className={LABEL_CLASS}>
          Price <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center h-14 rounded-xl border border-gray-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-blue-600/20 focus-within:border-blue-600 transition-all">
          <span className="flex items-center justify-center w-14 h-full text-lg font-black text-gray-400 border-r border-gray-200 bg-gray-50">
            $
          </span>
          <input
            type="text"
            value={price}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder="130"
            inputMode="decimal"
            className="flex-1 px-5 h-full text-base font-black text-emerald-600 bg-transparent outline-none placeholder:text-gray-300 placeholder:font-normal"
            required
          />
        </div>
      </div>

      {/* ── Notes ── */}
      <div className="space-y-2">
        <label className={LABEL_CLASS}>
          Notes{' '}
          <span className="text-gray-400 font-normal normal-case tracking-normal">— Optional</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Additional notes..."
          rows={3}
          className="w-full px-5 py-4 rounded-xl border border-gray-200 bg-white text-base font-bold focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-all resize-none placeholder:text-gray-300"
        />
      </div>

      {/* ── Info strip ── */}
      <div className="rounded-2xl overflow-hidden">
        <div className="p-5 bg-blue-600 text-white">
          <p className="text-[11px] leading-relaxed font-bold">
            Product received into repair center — typically repaired within{' '}
            <span className="font-black">3-10 working days</span>.
          </p>
          <p className="text-[10px] font-black uppercase tracking-[0.15em] mt-2 text-blue-200">
            30-Day Warranty on all repairs
          </p>
        </div>
      </div>

      <p className="text-[10px] text-center font-bold text-gray-400 uppercase tracking-[0.15em] pb-2">
        <span className="text-red-500">*</span> Required fields
      </p>
    </div>
  );
}
