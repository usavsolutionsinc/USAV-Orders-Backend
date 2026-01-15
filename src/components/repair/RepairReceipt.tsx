'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';

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
    repairReasons: string[];
    additionalNotes?: string;
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
            // Small delay to ensure component is fully rendered
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
            <div className="no-print fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                    <div className="p-6 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
                        <h2 className="text-xl font-black text-gray-900">Repair Receipt</h2>
                        <div className="flex gap-3">
                            <button
                                onClick={handlePrint}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold uppercase transition-all"
                            >
                                Print Receipt
                            </button>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-900 rounded-xl text-sm font-bold uppercase transition-all"
                            >
                                Close
                            </button>
                        </div>
                    </div>

                    {/* Receipt Preview */}
                    <div className="p-8">
                        <ReceiptContent data={data} />
                    </div>
                </div>
            </div>

            {/* Print View - Hidden on screen, shown when printing */}
            <div className="print-only">
                <ReceiptContent data={data} />
            </div>

            {/* Print Styles */}
            <style jsx global>{`
                @media print {
                    @page {
                        size: letter;
                        margin: 0.5in;
                    }
                    
                    .no-print {
                        display: none !important;
                    }
                    
                    .print-only {
                        display: block !important;
                    }
                    
                    body {
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
    return (
        <div className="max-w-[8.5in] mx-auto bg-white text-black" style={{ fontFamily: 'Arial, sans-serif' }}>
            {/* Header */}
            <div className="border-b-2 border-gray-900 pb-4 mb-6">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">USAV Solutions</h1>
                        <div className="mt-2 text-sm text-gray-600">
                            <p>16161 Gothard St. Suite A</p>
                            <p>Huntington Beach, CA 92647, United States</p>
                            <p>Tel: (714) 596-6888</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <h2 className="text-xl font-bold text-gray-900">Bose Wave Repair Service</h2>
                        <div className="mt-2 text-sm">
                            <p className="font-bold">RS Number: {data.rsNumber}</p>
                            <p>Date: {data.dropOffDate}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Customer Information */}
            <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900 mb-3 border-b border-gray-300 pb-1">
                    Customer Information
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <p className="font-bold text-gray-600">Name:</p>
                        <p className="text-gray-900">{data.customer.name}</p>
                    </div>
                    <div>
                        <p className="font-bold text-gray-600">Phone # Called for Pick up:</p>
                        <p className="text-gray-900">{data.customer.phone}</p>
                    </div>
                    {data.customer.email && (
                        <div className="col-span-2">
                            <p className="font-bold text-gray-600">Email:</p>
                            <p className="text-gray-900">{data.customer.email}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Product Information */}
            <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900 mb-3 border-b border-gray-300 pb-1">
                    Product Information
                </h3>
                <div className="text-sm space-y-2">
                    <div>
                        <p className="font-bold text-gray-600">Bose Model:</p>
                        <p className="text-gray-900">{data.product}</p>
                    </div>
                    <div>
                        <p className="font-bold text-gray-600">Last 4 Serial #:</p>
                        <p className="text-gray-900 font-mono">{data.serialNumber}</p>
                    </div>
                </div>
            </div>

            {/* Reason for Repair */}
            <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900 mb-3 border-b border-gray-300 pb-1">
                    Reason for Repair
                </h3>
                <ul className="list-disc list-inside text-sm space-y-1 text-gray-900">
                    {data.repairReasons.map((reason, index) => (
                        <li key={index}>{reason}</li>
                    ))}
                </ul>
                {data.additionalNotes && (
                    <div className="mt-3">
                        <p className="font-bold text-gray-600 text-sm">Additional Notes:</p>
                        <p className="text-sm text-gray-900 mt-1">{data.additionalNotes}</p>
                    </div>
                )}
            </div>

            {/* Warranty Message */}
            <div className="mb-6 p-4 bg-gray-100 border border-gray-300 rounded">
                <p className="text-sm text-gray-900 mb-2">
                    Your Bose product has been received into our repair center. Under normal circumstances it will be repaired within the next 3-10 working days and returned to you at the address above.
                </p>
                <p className="text-sm font-bold text-gray-900">
                    There is a 30 day Warranty on all our repair services.
                </p>
            </div>

            {/* Signature Line */}
            <div className="mt-8 pt-6 border-t border-gray-300">
                <div className="flex items-center gap-4 text-sm">
                    <span className="font-bold text-gray-900">Drop Off X</span>
                    <div className="flex-1 border-b border-gray-900"></div>
                    <span className="font-bold text-gray-900">Date:</span>
                    <div className="w-12 border-b border-gray-900"></div>
                    <span className="font-bold text-gray-900">/</span>
                    <div className="w-12 border-b border-gray-900"></div>
                    <span className="font-bold text-gray-900">/</span>
                    <div className="w-16 border-b border-gray-900"></div>
                </div>
            </div>

            {/* Footer */}
            <div className="mt-8 text-center text-xs text-gray-500">
                <p>Thank you for choosing USAV Solutions for your Bose repair needs.</p>
            </div>
        </div>
    );
}
