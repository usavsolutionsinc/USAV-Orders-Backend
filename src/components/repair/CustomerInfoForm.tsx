'use client';

import React from 'react';
import { TextField } from '@/design-system/primitives';

export type ContactFieldKey = 'name' | 'phone' | 'email' | 'extras';

export const CONTACT_FIELDS: readonly ContactFieldKey[] = [
    'name',
    'phone',
    'email',
    'extras',
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
                    : 'Repair Details';

    return (
        <div className="space-y-4">
            <p className="text-micro font-black uppercase tracking-[0.16em] text-text-faint">
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

            {/* Combined "extras" — serial (required) + price (green) + notes (optional). */}
            {activeField === 'extras' && (
                <div className="space-y-4">
                    <TextField
                        label="Serial Number"
                        value={serialNumber}
                        onChange={onSerialNumberChange}
                        mono
                        autoFocus
                        tone="neutral"
                    />

                    <div className="relative w-full">
                        <span className="pointer-events-none absolute left-3.5 top-1.5 text-micro font-semibold uppercase tracking-wide text-text-soft">
                            Price
                        </span>
                        <div className="flex h-11 items-center overflow-hidden rounded-xl border border-border-soft bg-surface-card px-3.5 pt-3 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-border-strong/10">
                            <span className="pr-1 text-sm font-black text-emerald-500">$</span>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={price}
                                onChange={(e) => onPriceChange(e.target.value)}
                                className="flex-1 bg-transparent text-sm font-black text-emerald-600 outline-none placeholder:font-normal placeholder:text-text-faint"
                                placeholder="130"
                                required
                            />
                        </div>
                    </div>

                    <TextField
                        label="Notes (optional)"
                        value={notes}
                        onChange={onNotesChange}
                        multiline
                        rows={3}
                        tone="neutral"
                    />
                </div>
            )}
        </div>
    );
}
