'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus, Search, Loader2, X, Package, Tool } from '@/components/Icons';
import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { RepairIntakeForm, RepairReceipt, RepairFormData, RepairTable } from '@/components/repair';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

function RepairSidebar() {
    const [showIntakeForm, setShowIntakeForm] = useState(false);
    const searchParams = useSearchParams();
    const isNew = searchParams.get('new') === 'true';

    useEffect(() => {
        if (isNew) {
            setShowIntakeForm(true);
            window.history.replaceState({}, '', '/repair');
        }
    }, [isNew]);

    const [receiptData, setReceiptData] = useState<any>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const handleNewRepair = () => {
        setShowIntakeForm(true);
    };

    const handleCloseForm = () => {
        setShowIntakeForm(false);
    };

    const handleSubmitForm = async (data: RepairFormData) => {
        setIsSubmitting(true);
        try {
            const response = await fetch('/api/repair/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (result.success) {
                setReceiptData(result.receiptData);
                setShowIntakeForm(false);
            } else {
                alert('Failed to submit repair form. Please try again.');
            }
        } catch (error) {
            console.error('Error submitting repair:', error);
            alert('Error submitting repair form. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCloseReceipt = () => {
        setReceiptData(null);
    };

    return (
        <>
            <AnimatePresence mode="wait">
                <motion.aside
                    initial={{ width: 320, opacity: 1 }}
                    animate={{ width: 320, opacity: 1 }}
                    transition={{ type: "spring", damping: 25, stiffness: 120 }}
                    className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative no-print print:hidden"
                >
                    {showIntakeForm ? (
                        <RepairIntakeForm 
                            onClose={handleCloseForm}
                            onSubmit={handleSubmitForm}
                        />
                    ) : (
                        <div className="p-6 space-y-8 h-full flex flex-col">
                            {/* Header */}
                            <header>
                                <div className="w-12 h-12 bg-orange-100 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
                                    <Tool className="w-6 h-6 text-orange-600" />
                                </div>
                                <h2 className="text-2xl font-black tracking-tighter text-gray-900 uppercase leading-none">Repairs</h2>
                                <p className="text-[10px] font-bold text-orange-600 uppercase tracking-[0.3em] mt-2">Bose Wave Center</p>
                            </header>

                            <div className="space-y-4">
                                <button
                                    onClick={handleNewRepair}
                                    className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-900 hover:bg-gray-800 text-white rounded-[1.5rem] transition-all active:scale-[0.98] shadow-xl shadow-gray-900/20 group"
                                >
                                    <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                                    <span className="text-[11px] font-black uppercase tracking-widest">New Repair Order</span>
                                </button>

                                <div className="p-6 bg-orange-50/50 rounded-[2rem] border border-orange-100/50">
                                    <h3 className="text-[10px] font-black uppercase tracking-widest text-orange-800 mb-3">Quick Tip</h3>
                                    <p className="text-[11px] font-medium text-orange-700 leading-relaxed">
                                        Use the search bar in the table to find specific tickets, customers, or products quickly.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-auto pt-6 border-t border-gray-100 text-center">
                                <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">Repair Module v2.1</p>
                            </div>
                        </div>
                    )}
                </motion.aside>
            </AnimatePresence>

            {receiptData && (
                <RepairReceipt 
                    data={receiptData} 
                    onClose={handleCloseReceipt}
                    autoPrint={true}
                />
            )}
        </>
    );
}

export default function RepairPage() {
    return (
        <div className="flex h-full w-full bg-white">
            <Suspense fallback={null}>
                <RepairSidebar />
            </Suspense>
            
            <div className="flex-1 flex flex-col min-w-0">
                <Suspense fallback={
                    <div className="flex-1 flex items-center justify-center bg-gray-50">
                        <LoadingSpinner size="lg" className="text-blue-600" />
                    </div>
                }>
                    <RepairTable />
                </Suspense>
            </div>
        </div>
    );
}
