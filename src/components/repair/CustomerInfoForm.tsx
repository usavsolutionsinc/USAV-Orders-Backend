'use client';

import React, { useEffect, useRef } from 'react';
import { TextField } from '@/design-system/primitives';

export type ContactFieldKey = 'name' | 'phone' | 'email' | 'serial' | 'price' | 'notes';

export const CONTACT_FIELDS: readonly ContactFieldKey[] = [
    'name',
    'phone',
    'email',
    'serial',
    'price',
    'notes',
];

interface CustomerInfoFormProps {
    customer: {
        name: string;
        phone: string;
        email: string;
    };
    serialNumber: string;
    price: string;
    notes: string;
    activeField: ContactFieldKey;
    fieldIndex: number;
    fieldCount: number;
    onCustomerChange: (field: string, value: string) => void;
    onSerialNumberChange: (value: string) => void;
    onPriceChange: (value: string) => void;
    onNotesChange: (value: string) => void;
}

export function CustomerInfoForm({
    customer,
    serialNumber,
    price,
    notes,
    activeField,
    fieldIndex,
    fieldCount,
    onCustomerChange,
    onSerialNumberChange,
    onPriceChange,
    onNotesChange,
}: CustomerInfoFormProps) {
    const priceRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (activeField === 'price') {
                priceRef.current?.focus();
            }
        }, 50);
        return () => window.clearTimeout(timer);
    }, [activeField]);

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

    const fieldLabel =
        activeField === 'name'
            ? 'Customer Name'
            : activeField === 'phone'
                ? 'Phone Number'
                : activeField === 'email'
                    ? 'Email (optional)'
                    : activeField === 'serial'
                        ? 'Serial Number'
                        : activeField === 'price'
                            ? 'Price'
                            : 'Notes (optional)';

    return (
        <div className="space-y-4">
            <p className="text-center text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
                {fieldIndex + 1} of {fieldCount} · {fieldLabel}
            </p>

            {activeField === 'name' && (
                <TextField
                    label="Customer Name"
                    value={customer.name}
                    onChange={(value) => onCustomerChange('name', value)}
                    autoComplete="name"
                    autoFocus
                    tone="neutral"
                />
            )}

            {activeField === 'phone' && (
                <TextField
                    label="Phone Number"
                    value={customer.phone}
                    onChange={handlePhoneChange}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={12}
                    autoFocus
                    tone="neutral"
                />
            )}

            {activeField === 'email' && (
                <TextField
                    label="Email (optional)"
                    value={customer.email}
                    onChange={(value) => onCustomerChange('email', value)}
                    type="email"
                    autoComplete="email"
                    inputClassName="lowercase"
                    autoFocus
                    tone="neutral"
                />
            )}

            {activeField === 'serial' && (
                <TextField
                    label="Serial Number"
                    value={serialNumber}
                    onChange={onSerialNumberChange}
                    mono
                    autoFocus
                    tone="neutral"
                />
            )}

            {activeField === 'price' && (
                <div className="relative w-full">
                    <span className="pointer-events-none absolute left-3.5 top-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        Price
                    </span>
                    <div className="flex h-11 items-center overflow-hidden rounded-xl border border-gray-200 bg-white px-3.5 pt-3 focus-within:border-gray-900 focus-within:ring-2 focus-within:ring-gray-900/10">
                        <span className="pr-1 text-sm font-black text-gray-400">$</span>
                        <input
                            ref={priceRef}
                            type="text"
                            inputMode="decimal"
                            value={price}
                            onChange={(e) => onPriceChange(e.target.value)}
                            className="flex-1 bg-transparent text-sm font-black text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-300"
                            placeholder="130"
                            required
                        />
                    </div>
                </div>
            )}

            {activeField === 'notes' && (
                <TextField
                    label="Notes (optional)"
                    value={notes}
                    onChange={onNotesChange}
                    multiline
                    rows={4}
                    autoFocus
                    tone="neutral"
                />
            )}
        </div>
    );
}
