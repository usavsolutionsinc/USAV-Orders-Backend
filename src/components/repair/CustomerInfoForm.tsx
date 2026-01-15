'use client';

import React from 'react';

interface CustomerInfoFormProps {
    customer: {
        name: string;
        phone: string;
        email: string;
    };
    serialNumber: string;
    onCustomerChange: (field: string, value: string) => void;
    onSerialNumberChange: (value: string) => void;
}

export function CustomerInfoForm({ 
    customer, 
    serialNumber, 
    onCustomerChange, 
    onSerialNumberChange 
}: CustomerInfoFormProps) {
    return (
        <div className="space-y-4">
            <h3 className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-3">
                Customer Information
            </h3>

            {/* Name */}
            <div>
                <label className="block text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">
                    Name <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    value={customer.name}
                    onChange={(e) => onCustomerChange('name', e.target.value)}
                    placeholder="Enter customer name"
                    className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                />
            </div>

            {/* Phone */}
            <div>
                <label className="block text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">
                    Phone # Called for Pick up <span className="text-red-500">*</span>
                </label>
                <input
                    type="tel"
                    value={customer.phone}
                    onChange={(e) => onCustomerChange('phone', e.target.value)}
                    placeholder="(123) 456-7890"
                    className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                />
            </div>

            {/* Email */}
            <div>
                <label className="block text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">
                    Email
                </label>
                <input
                    type="email"
                    value={customer.email}
                    onChange={(e) => onCustomerChange('email', e.target.value)}
                    placeholder="customer@example.com"
                    className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            </div>

            {/* Serial Number */}
            <div>
                <label className="block text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">
                    Serial # (Last 4 digits)
                </label>
                <input
                    type="text"
                    value={serialNumber}
                    onChange={(e) => onSerialNumberChange(e.target.value)}
                    placeholder="1234"
                    maxLength={4}
                    className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-xl text-sm text-gray-900 font-mono placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            </div>

            {/* Warranty Message */}
            <div className="mt-6 p-4 rounded-xl bg-blue-50 border border-blue-200">
                <p className="text-[10px] leading-relaxed text-blue-600 font-medium">
                    Your Bose product has been received into our repair center. Under normal circumstances it will be repaired within the next 3-10 working days and returned to you at the address above.
                </p>
                <p className="text-[10px] leading-relaxed text-blue-600 font-bold mt-3">
                    There is a 30 day Warranty on all our repair services.
                </p>
            </div>
        </div>
    );
}
