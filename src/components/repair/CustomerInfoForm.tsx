'use client';

import React from 'react';
import { Plus, X } from '../Icons';

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
}

interface SerialNumberInputProps {
    serialNumbers: string[];
    onSerialNumbersChange: (serialNumbers: string[]) => void;
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
}: CustomerInfoFormProps) {
    const [serialNumbers, setSerialNumbers] = React.useState<string[]>(
        serialNumber ? serialNumber.split(',').map(s => s.trim()).filter(s => s) : ['']
    );

    // Format phone number as user types
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

    // Update parent when serial numbers change
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
        <div className="space-y-5">
            {/* Name Field */}
            <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase tracking-[0.15em] text-gray-500">
                    Customer Name <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    value={customer.name}
                    onChange={(e) => onCustomerChange('name', e.target.value)}
                    placeholder="Enter customer name"
                    className="w-full px-4 py-3.5 border-2 border-gray-300 bg-white text-sm font-bold focus:outline-none focus:border-blue-600 transition-colors"
                    required
                />
            </div>

            {/* Phone Field */}
            <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase tracking-[0.15em] text-gray-500">
                    Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                    type="tel"
                    value={customer.phone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="000-000-0000"
                    maxLength={12}
                    className="w-full px-4 py-3.5 border-2 border-gray-300 bg-white text-sm font-bold focus:outline-none focus:border-blue-600 transition-colors"
                    required
                />
            </div>

            {/* Email Field */}
            <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase tracking-[0.15em] text-gray-500">
                    Email <span className="text-gray-400 font-normal normal-case tracking-normal">— Optional</span>
                </label>
                <input
                    type="email"
                    value={customer.email}
                    onChange={(e) => onCustomerChange('email', e.target.value)}
                    placeholder="customer@example.com"
                    className="w-full px-4 py-3.5 border-2 border-gray-300 bg-white text-sm font-bold lowercase focus:outline-none focus:border-blue-600 transition-colors"
                />
            </div>

            {/* Serial Numbers Field */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <label className="block text-[9px] font-black uppercase tracking-[0.15em] text-gray-500">
                        Serial Numbers <span className="text-red-500">*</span>
                    </label>
                    <button
                        type="button"
                        onClick={addSerialNumber}
                        className="flex items-center gap-1 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-blue-600 hover:bg-blue-50 transition-colors"
                    >
                        <Plus className="w-3 h-3" />
                        Add
                    </button>
                </div>
                <div className="space-y-2">
                    {serialNumbers.map((sn, index) => (
                        <div key={index} className="flex gap-0">
                            <input
                                type="text"
                                value={sn}
                                onChange={(e) => updateSerialNumber(index, e.target.value)}
                                placeholder={`Serial Number ${index + 1}`}
                                className="flex-1 px-4 py-3.5 border-2 border-gray-300 bg-white text-sm font-mono font-bold focus:outline-none focus:border-blue-600 transition-colors"
                                required={index === 0}
                            />
                            {serialNumbers.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => removeSerialNumber(index)}
                                    className="flex items-center justify-center w-12 border-2 border-l-0 border-gray-300 text-red-500 hover:bg-red-50 transition-colors"
                                    aria-label="Remove serial number"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Price Field */}
            <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase tracking-[0.15em] text-gray-500">
                    Price <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center border-2 border-gray-300 bg-white focus-within:border-blue-600 transition-colors">
                    <span className="px-4 text-lg font-black text-gray-400 border-r-2 border-gray-300 py-3.5 leading-none">$</span>
                    <input
                        type="text"
                        value={price}
                        onChange={(e) => onPriceChange(e.target.value)}
                        placeholder="130"
                        className="flex-1 px-4 py-3.5 text-sm font-black text-emerald-600 bg-transparent outline-none placeholder:text-gray-300 placeholder:font-normal"
                        required
                    />
                </div>
            </div>

            {/* Notes Field */}
            <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase tracking-[0.15em] text-gray-500">
                    Notes <span className="text-gray-400 font-normal normal-case tracking-normal">— Optional</span>
                </label>
                <textarea
                    value={notes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    placeholder="Additional notes..."
                    rows={3}
                    className="w-full px-4 py-3.5 border-2 border-gray-300 bg-white text-sm font-bold focus:outline-none focus:border-blue-600 transition-colors resize-none"
                />
            </div>

            {/* Info strip */}
            <div className="p-4 bg-blue-600 text-white">
                <p className="text-[10px] leading-relaxed font-bold">
                    Product received into repair center — typically repaired within <span className="font-black">3–10 working days</span>.
                </p>
                <p className="text-[9px] font-black uppercase tracking-[0.15em] mt-1.5 text-blue-200">
                    30-Day Warranty on all repairs
                </p>
            </div>

            <p className="text-[9px] text-center font-bold text-gray-400 uppercase tracking-[0.15em]">
                <span className="text-red-500">*</span> Required fields
            </p>
        </div>
    );
}
