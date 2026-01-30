'use client';

import React, { useEffect } from 'react';

interface ReceiptData {
    rsNumber: string;
    dropOffDate: string;
    customer: {
        name: string;
        phone: string;
        email?: string;
    };
    product: string;
    serialNumber: string;
    price: string;
    repairReasons: string[];
    notes?: string;
    status: string;
}

interface RepairReceiptProps {
    data: ReceiptData;
    onClose: () => void;
    autoPrint?: boolean;
}

export function RepairReceipt({ data, onClose, autoPrint = true }: RepairReceiptProps) {
    useEffect(() => {
        if (autoPrint) {
            setTimeout(() => {
                window.print();
            }, 500);
        }
    }, [autoPrint]);

    const handlePrint = () => {
        window.print();
    };

    return (
        <>
            {/* Screen View - Non-printable controls */}
            <div className="no-print fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-[2.5rem] max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
                    <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
                        <div>
                            <h2 className="text-2xl font-black text-gray-900 tracking-tighter uppercase">Print Preview</h2>
                            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mt-1">Repair Service Paper</p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={handlePrint}
                                className="px-8 py-4 bg-gray-900 hover:bg-gray-800 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all shadow-xl shadow-gray-900/20 active:scale-95"
                            >
                                Print Document
                            </button>
                            <button
                                onClick={onClose}
                                className="px-8 py-4 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all active:scale-95"
                            >
                                Close
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-12 bg-gray-50/50">
                        <div className="bg-white shadow-2xl mx-auto p-[1in] min-h-[11in] w-[8.5in]">
                            <ReceiptContent data={data} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Print View */}
            <div className="print-only">
                <ReceiptContent data={data} />
            </div>

            <style jsx global>{`
                @media print {
                    @page {
                        size: letter;
                        margin: 0;
                    }
                    .no-print {
                        display: none !important;
                    }
                    .print-only {
                        display: block !important;
                    }
                    body {
                        background: white !important;
                        print-color-adjust: exact;
                        -webkit-print-color-adjust: exact;
                    }
                }
                @media screen {
                    .print-only {
                        display: none;
                    }
                }
            `}</style>
        </>
    );
}

function ReceiptContent({ data }: { data: ReceiptData }) {
    const repairReasonsString = data.repairReasons.join(', ') + (data.notes ? ` - ${data.notes}` : '');
    
    return (
        <div className="w-full bg-white text-black p-8" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
            {/* Header Section */}
            <div className="text-right mb-12">
                <h2 className="font-black text-xl tracking-tighter uppercase">USAV Solutions</h2>
                <p className="text-sm font-medium text-gray-600">16161 Gothard St. Suite A</p>
                <p className="text-sm font-medium text-gray-600">Huntington Beach, CA 92647, United States</p>
                <p className="text-sm font-bold text-gray-900 mt-1">Tel: (714) 596-6888</p>
            </div>

            {/* Title and RS Number */}
            <div className="mb-10">
                <h1 className="text-5xl font-black mb-4 tracking-tighter uppercase">Repair Service</h1>
                <div className="inline-block bg-gray-900 text-white px-4 py-2 rounded-lg">
                    <p className="text-xl font-black tracking-widest uppercase">RS #: {data.rsNumber}</p>
                </div>
            </div>

            {/* Information Table */}
            <div className="border-[3px] border-black mb-8 overflow-hidden rounded-xl">
                {[
                    { label: "Product:", value: data.product },
                    { label: "Issue:", value: repairReasonsString },
                    { label: "Serial #:", value: data.serialNumber },
                    { label: "Name:", value: data.customer.name },
                    { label: "Contact:", value: `${data.customer.phone} ${data.customer.email ? `(${data.customer.email})` : ''}` },
                ].map((item, idx) => (
                    <div key={idx} className={`flex ${idx !== 4 ? 'border-b-[3px] border-black' : ''}`}>
                        <div className="w-40 p-4 font-black text-xs uppercase tracking-widest bg-gray-50 border-r-[3px] border-black flex items-center">
                            {item.label}
                        </div>
                        <div className="flex-1 p-4 text-sm font-bold uppercase">
                            {item.value}
                        </div>
                    </div>
                ))}
            </div>

            {/* Price Section */}
            <div className="mb-10 p-6 bg-gray-50 border-[3px] border-black rounded-xl inline-block">
                <p className="text-2xl font-black tracking-tight">
                    <span className="text-emerald-600">${data.price}</span>
                    <span className="ml-3 text-gray-400 uppercase text-sm tracking-[0.2em] font-black">- Price Paid at Pick-up</span>
                </p>
            </div>

            {/* Terms & Warranty */}
            <div className="mb-12 text-sm leading-relaxed max-w-2xl">
                <p className="mb-6 font-medium text-gray-700">
                    Your Bose product has been received into our repair center. Under normal circumstances it will 
                    be repaired within the next <span className="font-black text-black">3-10 working days</span> and returned to you at the address above.
                </p>
                <div className="p-4 border-2 border-black border-dashed rounded-lg inline-block">
                    <p className="font-black uppercase tracking-widest text-blue-600">
                        There is a 30 day Warranty on all our repair services.
                    </p>
                </div>
            </div>

            {/* Drop Off Section */}
            <div className="mb-12">
                <div className="flex items-end gap-6 mb-3">
                    <span className="font-black text-2xl uppercase tracking-tighter italic">Drop Off X</span>
                    <div className="flex-1 border-b-[3px] border-black h-8"></div>
                    <div className="flex items-end gap-2">
                        <span className="font-black text-sm uppercase tracking-widest">Date:</span>
                        <span className="font-black text-lg border-b-[3px] border-black px-4 min-w-[150px] text-center">
                            {data.dropOffDate.split(' ')[0]}
                        </span>
                    </div>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest italic">
                    By signing above you agree to the listed price and any unexpected delays in the repair process.
                </p>
            </div>

            {/* Internal Use Table */}
            <div className="border-[3px] border-black mb-12 flex rounded-xl overflow-hidden">
                <div className="flex-1 border-r-[3px] border-black p-4">
                    <span className="font-black text-[10px] uppercase tracking-widest text-gray-400 block mb-2">Repaired:</span>
                    <div className="h-8"></div>
                </div>
                <div className="flex-1 border-r-[3px] border-black p-4">
                    <span className="font-black text-[10px] uppercase tracking-widest text-gray-400 block mb-2">Part:</span>
                    <div className="h-8"></div>
                </div>
                <div className="w-32 border-r-[3px] border-black p-4">
                    <span className="font-black text-[10px] uppercase tracking-widest text-gray-400 block mb-2">Who:</span>
                    <div className="h-8"></div>
                </div>
                <div className="w-40 p-4">
                    <span className="font-black text-[10px] uppercase tracking-widest text-gray-400 block mb-2">Date:</span>
                    <div className="h-8"></div>
                </div>
            </div>

            {/* Pick Up Section */}
            <div>
                <div className="flex items-end gap-6 mb-8">
                    <span className="font-black text-2xl uppercase tracking-tighter italic">Pick Up X</span>
                    <div className="flex-1 border-b-[3px] border-black h-8"></div>
                    <div className="flex items-end gap-2">
                        <span className="font-black text-sm uppercase tracking-widest">Date:</span>
                        <div className="flex gap-1">
                            <div className="w-12 border-b-[3px] border-black h-8"></div>
                            <span className="font-black text-xl">/</span>
                            <div className="w-12 border-b-[3px] border-black h-8"></div>
                            <span className="font-black text-xl">/</span>
                            <div className="w-20 border-b-[3px] border-black h-8"></div>
                        </div>
                    </div>
                </div>
                <p className="text-center font-black text-3xl mt-16 tracking-tighter uppercase italic text-gray-900">
                    Enjoy your repaired unit!
                </p>
            </div>
        </div>
    );
}
