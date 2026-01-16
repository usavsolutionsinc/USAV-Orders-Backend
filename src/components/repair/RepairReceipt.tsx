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
    const repairReasonsString = data.repairReasons.join(', ') + (data.additionalNotes ? ` - ${data.additionalNotes}` : '');
    
    return (
        <div className="max-w-[8.5in] mx-auto bg-white text-black" style={{ fontFamily: 'Arial, sans-serif' }}>
            {/* Header */}
            <div className="flex justify-end mb-6">
                <div className="text-right text-xs">
                    <p className="font-bold">USAV Solutions</p>
                    <p>16161 Gothard St. Suite A</p>
                    <p>Huntington Beach, CA 92647, United States</p>
                    <p>Tel: (714) 596-6888</p>
                </div>
            </div>

            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-4">Repair Service</h1>
                <p className="font-bold text-lg mb-4">RS #: {data.rsNumber}</p>

                <table className="w-full border-collapse border-2 border-black mb-6">
                    <tbody>
                        <tr>
                            <td className="border-2 border-black p-2 w-1/4 font-medium">Product:</td>
                            <td className="border-2 border-black p-2">{data.product}</td>
                        </tr>
                        <tr>
                            <td className="border-2 border-black p-2 font-medium">Issue:</td>
                            <td className="border-2 border-black p-2">{repairReasonsString}</td>
                        </tr>
                        <tr>
                            <td className="border-2 border-black p-2 font-medium">Serial #</td>
                            <td className="border-2 border-black p-2 font-mono">{data.serialNumber}</td>
                        </tr>
                        <tr>
                            <td className="border-2 border-black p-2 font-medium">Name:</td>
                            <td className="border-2 border-black p-2">{data.customer.name}</td>
                        </tr>
                        <tr>
                            <td className="border-2 border-black p-2 font-medium">Contact:</td>
                            <td className="border-2 border-black p-2">{data.customer.phone} {data.customer.email ? `(${data.customer.email})` : ''}</td>
                        </tr>
                    </tbody>
                </table>

                <div className="mb-6">
                    <p className="text-lg font-bold">${data.price} - Price Paid at Pick-up</p>
                </div>

                <div className="mb-6 text-sm space-y-4">
                    <p>
                        Your Bose product has been received into our repair center. Under normal circumstances it will be repaired within the next 3-10 working days and returned to you at the address above.
                    </p>
                    <p className="font-bold">
                        There is a 30 day Warranty on all our repair services.
                    </p>
                </div>

                {/* Drop Off Section */}
                <div className="mt-8 mb-12">
                    <div className="flex items-center gap-4 text-sm">
                        <span className="font-bold text-lg">Drop Off X</span>
                        <div className="flex-1 border-b-2 border-black h-8"></div>
                        <span className="font-bold">Date:</span>
                        <div className="w-16 border-b-2 border-black h-8"></div>
                        <span className="font-bold">/</span>
                        <div className="w-16 border-b-2 border-black h-8"></div>
                        <span className="font-bold">/</span>
                        <div className="w-24 border-b-2 border-black h-8"></div>
                    </div>
                    <p className="text-[10px] mt-1 italic text-gray-600">
                        By signing above you agree to the listed price and any unexpected delays in the repair process.
                    </p>
                </div>

                {/* Internal Use Table */}
                <div className="mb-12">
                    <table className="w-full border-collapse border-2 border-black">
                        <tbody>
                            <tr>
                                <td className="border-2 border-black p-2 w-[12%] font-medium text-xs">Repaired:</td>
                                <td className="border-2 border-black p-2 w-[13%]"></td>
                                <td className="border-2 border-black p-2 w-[8%] font-medium text-xs">Part:</td>
                                <td className="border-2 border-black p-2 w-[37%]"></td>
                                <td className="border-2 border-black p-2 w-[8%] font-medium text-xs">Who:</td>
                                <td className="border-2 border-black p-2 w-[10%]"></td>
                                <td className="border-2 border-black p-2 w-[8%] font-medium text-xs">Date:</td>
                                <td className="border-2 border-black p-2 w-[12%]"></td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* Pick Up Section */}
                <div className="mt-8 mb-8">
                    <div className="flex items-center gap-4 text-sm">
                        <span className="font-bold text-lg">Pick Up X</span>
                        <div className="flex-1 border-b-2 border-black h-8"></div>
                        <span className="font-bold">Date:</span>
                        <div className="w-16 border-b-2 border-black h-8"></div>
                        <span className="font-bold">/</span>
                        <div className="w-16 border-b-2 border-black h-8"></div>
                        <span className="font-bold">/</span>
                        <div className="w-24 border-b-2 border-black h-8"></div>
                    </div>
                </div>

                <div className="text-center font-bold text-lg mt-12">
                    <p>Enjoy your repaired unit!</p>
                </div>
            </div>
        </div>
    );
}
