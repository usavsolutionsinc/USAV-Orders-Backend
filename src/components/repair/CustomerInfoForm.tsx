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
    onCustomerChange: (field: string, value: string) => void;
    onSerialNumberChange: (value: string) => void;
    onPriceChange: (value: string) => void;
}

interface SerialNumberInputProps {
    serialNumbers: string[];
    onSerialNumbersChange: (serialNumbers: string[]) => void;
}

export function CustomerInfoForm({ 
    customer, 
    serialNumber, 
    price,
    onCustomerChange, 
    onSerialNumberChange,
    onPriceChange
}: CustomerInfoFormProps) {
    // Parse serial numbers from comma-separated string
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
        <div className="space-y-6">
            <div className="space-y-4">
                {/* Name Field */}
                <div className="space-y-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-gray-700">
                        Customer Name <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={customer.name}
                        onChange={(e) => onCustomerChange('name', e.target.value)}
                        placeholder="Enter customer name"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        required
                    />
                </div>

                {/* Phone Field */}
                <div className="space-y-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-gray-700">
                        Phone Number <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="tel"
                        value={customer.phone}
                        onChange={(e) => handlePhoneChange(e.target.value)}
                        placeholder="000-000-0000"
                        maxLength={12}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        required
                    />
                </div>

                {/* Email Field */}
                <div className="space-y-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-gray-700">
                        Email <span className="text-gray-400 text-[10px] font-normal">(Optional)</span>
                    </label>
                    <input
                        type="email"
                        value={customer.email}
                        onChange={(e) => onCustomerChange('email', e.target.value)}
                        placeholder="customer@example.com"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-bold lowercase focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                </div>

                {/* Serial Numbers Field */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="block text-xs font-black uppercase tracking-widest text-gray-700">
                            Serial Numbers <span className="text-red-500">*</span>
                        </label>
                        <button
                            type="button"
                            onClick={addSerialNumber}
                            className="flex items-center gap-1 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-all"
                        >
                            <Plus className="w-3 h-3" />
                            Add More
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
                                    className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    required={index === 0}
                                />
                                {serialNumbers.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => removeSerialNumber(index)}
                                        className="p-3 text-red-500 hover:bg-red-50 rounded-xl transition-all"
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
                <div className="space-y-2">
                    <label className="block text-xs font-black uppercase tracking-widest text-gray-700">
                        Price <span className="text-red-500">*</span>
                    </label>
                    <div className="flex items-center gap-2 px-4 py-3 border-2 border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all">
                        <span className="text-lg font-bold text-gray-400">$</span>
                        <input
                            type="text"
                            value={price}
                            onChange={(e) => onPriceChange(e.target.value)}
                            placeholder="130"
                            className="flex-1 text-sm font-black text-emerald-600 bg-transparent outline-none placeholder:text-gray-300 placeholder:font-normal"
                            required
                        />
                    </div>
                </div>

                {/* Info Box */}
                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                    <p className="text-[10px] leading-relaxed text-gray-600 font-bold">
                        Your Bose product has been received into our repair center. Under normal circumstances it will be repaired within the next 3-10 working days.
                    </p>
                    <p className="text-[10px] leading-relaxed text-blue-600 font-black uppercase tracking-widest mt-2">
                        30 Day Warranty on all repair services.
                    </p>
                </div>
            </div>
            
            <p className="text-[9px] text-center font-bold text-gray-400 uppercase tracking-[0.2em]">
                Fields marked with <span className="text-red-500">*</span> are required
            </p>
        </div>
    );
}
