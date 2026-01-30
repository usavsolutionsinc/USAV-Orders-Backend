'use client';

import React from 'react';

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

export function CustomerInfoForm({ 
    customer, 
    serialNumber, 
    price,
    onCustomerChange, 
    onSerialNumberChange,
    onPriceChange
}: CustomerInfoFormProps) {
    return (
        <div className="space-y-6">
            <div className="bg-white text-gray-900 font-sans border-2 border-black p-6 shadow-sm">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h1 className="text-2xl font-black uppercase tracking-tighter">Repair Service</h1>
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-1">Intake Information</p>
                    </div>
                    <div className="text-right">
                        <h2 className="font-bold text-xs uppercase">USAV Solutions</h2>
                        <p className="text-[9px] text-gray-500">16161 Gothard St. Suite A</p>
                        <p className="text-[9px] text-gray-500">Huntington Beach, CA 92647</p>
                    </div>
                </div>

                <div className="border-t-2 border-l-2 border-black">
                    {/* Name Field */}
                    <div className="flex border-b-2 border-r-2 border-black group focus-within:bg-blue-50/30 transition-colors">
                        <div className="w-32 p-3 font-black text-[10px] uppercase tracking-widest bg-gray-50 border-r-2 border-black flex items-center">
                            Name <span className="text-red-500 ml-1">*</span>
                        </div>
                        <div className="flex-1">
                            <input
                                type="text"
                                value={customer.name}
                                onChange={(e) => onCustomerChange('name', e.target.value)}
                                placeholder="Enter customer name"
                                className="w-full p-3 text-sm font-bold bg-transparent outline-none placeholder:text-gray-300 placeholder:font-normal"
                                required
                            />
                        </div>
                    </div>

                    {/* Contact Field */}
                    <div className="flex border-b-2 border-r-2 border-black focus-within:bg-blue-50/30 transition-colors">
                        <div className="w-32 p-3 font-black text-[10px] uppercase tracking-widest bg-gray-50 border-r-2 border-black flex flex-col justify-center">
                            <span>Contact</span>
                            <span className="text-[8px] text-gray-400 font-bold mt-1">(Phone & Email)</span>
                        </div>
                        <div className="flex-1 divide-y-2 divide-black">
                            <input
                                type="tel"
                                value={customer.phone}
                                onChange={(e) => onCustomerChange('phone', e.target.value)}
                                placeholder="Phone: (123) 456-7890"
                                className="w-full p-3 text-sm font-bold bg-transparent outline-none placeholder:text-gray-300 placeholder:font-normal"
                                required
                            />
                            <input
                                type="email"
                                value={customer.email}
                                onChange={(e) => onCustomerChange('email', e.target.value)}
                                placeholder="Email: customer@example.com"
                                className="w-full p-3 text-sm font-bold bg-transparent outline-none placeholder:text-gray-300 placeholder:font-normal"
                                required
                            />
                        </div>
                    </div>

                    {/* Serial Number Field */}
                    <div className="flex border-b-2 border-r-2 border-black focus-within:bg-blue-50/30 transition-colors">
                        <div className="w-32 p-3 font-black text-[10px] uppercase tracking-widest bg-gray-50 border-r-2 border-black flex items-center">
                            Serial # <span className="text-red-500 ml-1">*</span>
                        </div>
                        <div className="flex-1">
                            <input
                                type="text"
                                value={serialNumber}
                                onChange={(e) => onSerialNumberChange(e.target.value)}
                                placeholder="Enter Serial Number"
                                className="w-full p-3 text-sm font-mono font-bold bg-transparent outline-none placeholder:text-gray-300 placeholder:font-normal"
                                required
                            />
                        </div>
                    </div>

                    {/* Price Field */}
                    <div className="flex border-b-2 border-r-2 border-black focus-within:bg-blue-50/30 transition-colors">
                        <div className="w-32 p-3 font-black text-[10px] uppercase tracking-widest bg-gray-50 border-r-2 border-black flex items-center">
                            Price <span className="text-red-500 ml-1">*</span>
                        </div>
                        <div className="flex-1 flex items-center px-3">
                            <span className="font-bold text-gray-400 mr-1">$</span>
                            <input
                                type="text"
                                value={price}
                                onChange={(e) => onPriceChange(e.target.value)}
                                placeholder="130"
                                className="w-full py-3 text-sm font-black text-emerald-600 bg-transparent outline-none placeholder:text-gray-300 placeholder:font-normal"
                                required
                            />
                        </div>
                    </div>
                </div>

                <div className="mt-6 p-4 bg-gray-50 border-2 border-black border-dashed">
                    <p className="text-[10px] leading-relaxed text-gray-600 font-bold">
                        Your Bose product has been received into our repair center. Under normal circumstances it will be repaired within the next 3-10 working days.
                    </p>
                    <p className="text-[10px] leading-relaxed text-blue-600 font-black uppercase tracking-widest mt-2">
                        30 Day Warranty on all repair services.
                    </p>
                </div>
            </div>
            
            <p className="text-[9px] text-center font-bold text-gray-400 uppercase tracking-[0.2em]">
                All fields marked with * are required for submission
            </p>
        </div>
    );
}
