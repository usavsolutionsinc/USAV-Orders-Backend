'use client';

import React from 'react';
import { Plus, X } from '../Icons';
import {
    SidebarIntakeFormField,
    getSidebarIntakeInputClass,
} from '@/design-system/components';

interface CustomerInfoFormProps {
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
    tone?: 'green' | 'orange';
}

export function CustomerInfoForm({
    customer,
    serialNumber,
    price,
    notes,
    onCustomerChange,
    onSerialNumberChange,
    onPriceChange,
    onNotesChange,
    tone = 'green',
}: CustomerInfoFormProps) {
    const inputClass = getSidebarIntakeInputClass(tone);
    const monoInputClass = `${inputClass} font-mono`.trim();
    const [serialNumbers, setSerialNumbers] = React.useState<string[]>(
        serialNumber ? serialNumber.split(',').map(s => s.trim()).filter(s => s) : ['']
    );

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

    React.useEffect(() => {
        const joined = serialNumbers.filter(s => s.trim()).join(', ');
        if (joined !== serialNumber) {
            onSerialNumberChange(joined);
        }
    }, [serialNumbers]);

    const addSerialNumber = () => {
        setSerialNumbers([...serialNumbers, '']);
    };

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
        <div className="space-y-4">
            <SidebarIntakeFormField label="Customer Name" required>
                <input
                    type="text"
                    value={customer.name}
                    onChange={(e) => onCustomerChange('name', e.target.value)}
                    placeholder="Enter customer name"
                    className={inputClass}
                    required
                />
            </SidebarIntakeFormField>

            <SidebarIntakeFormField label="Phone Number" required>
                <input
                    type="tel"
                    value={customer.phone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="000-000-0000"
                    maxLength={12}
                    className={inputClass}
                    required
                />
            </SidebarIntakeFormField>

            <SidebarIntakeFormField label="Email" optionalHint="(Optional)">
                <input
                    type="email"
                    value={customer.email}
                    onChange={(e) => onCustomerChange('email', e.target.value)}
                    placeholder="customer@example.com"
                    className={`${inputClass} lowercase`}
                />
            </SidebarIntakeFormField>

            <SidebarIntakeFormField
                label={
                    <span className="flex items-center justify-between">
                        <span>Serial Numbers <span className="text-red-500">*</span></span>
                        <button
                            type="button"
                            onClick={addSerialNumber}
                            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600 hover:text-emerald-700 transition-colors"
                        >
                            <Plus className="h-3 w-3" />
                            Add
                        </button>
                    </span>
                }
            >
                <div className="space-y-2">
                    {serialNumbers.map((sn, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <input
                                type="text"
                                value={sn}
                                onChange={(e) => updateSerialNumber(index, e.target.value)}
                                placeholder={`Serial Number ${index + 1}`}
                                className={`flex-1 ${monoInputClass}`}
                                required={index === 0}
                            />
                            {serialNumbers.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => removeSerialNumber(index)}
                                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                    aria-label="Remove serial number"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </SidebarIntakeFormField>

            <SidebarIntakeFormField label="Price" required>
                <div className="flex items-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-transparent transition-all">
                    <span className="flex items-center justify-center border-r border-gray-200 px-4 py-3 text-lg font-black text-gray-400">$</span>
                    <input
                        type="text"
                        value={price}
                        onChange={(e) => onPriceChange(e.target.value)}
                        placeholder="130"
                        className="flex-1 bg-transparent px-4 py-3 text-sm font-black text-emerald-600 outline-none placeholder:font-normal placeholder:text-gray-300"
                        required
                    />
                </div>
            </SidebarIntakeFormField>

            <SidebarIntakeFormField label="Notes" optionalHint="(Optional)">
                <textarea
                    value={notes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    placeholder="Additional notes..."
                    rows={3}
                    className={`${inputClass} resize-none`}
                />
            </SidebarIntakeFormField>

            {/* Info strip */}
            <div className="rounded-xl bg-orange-600 p-4 text-white">
                <p className="text-[10px] font-bold leading-relaxed">
                    Product received into repair center — typically repaired within <span className="font-black">3-10 working days</span>.
                </p>
                <p className="mt-1.5 text-[9px] font-black uppercase tracking-[0.15em] text-orange-200">
                    30-Day Warranty on all repairs
                </p>
            </div>
        </div>
    );
}
