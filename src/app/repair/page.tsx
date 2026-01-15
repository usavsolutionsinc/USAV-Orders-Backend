'use client';

import PageLayout from '@/components/PageLayout';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Tool, Settings, History, Plus } from '@/components/Icons';
import { useState } from 'react';
import { RepairIntakeForm, RepairReceipt, RepairFormData } from '@/components/repair';

function RepairSidebar() {
    const [isOpen, setIsOpen] = useState(true);
    const [showIntakeForm, setShowIntakeForm] = useState(false);
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
        <div className="relative flex-shrink-0 z-40 h-full">
            <AnimatePresence mode="wait">
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 380, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 120 }}
                        className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative group"
                    >
                        {!showIntakeForm && (
                            <button
                                onClick={() => setIsOpen(false)}
                                className="absolute top-4 right-4 z-50 p-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                        )}

                        {showIntakeForm ? (
                            <RepairIntakeForm 
                                onClose={handleCloseForm}
                                onSubmit={handleSubmitForm}
                            />
                        ) : (
                            <div className="p-6 space-y-8 h-full flex flex-col">
                                <div className="flex items-start justify-between pr-12">
                                    <header>
                                        <h2 className="text-xl font-black tracking-tighter text-gray-900 uppercase">Repair Service</h2>
                                        <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mt-1">Bose Wave Repair</p>
                                    </header>
                                    
                                    <button
                                        onClick={handleNewRepair}
                                        className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-lg shadow-blue-600/30 group shrink-0"
                                        title="New Repair"
                                    >
                                        <Plus className="w-5 h-5" />
                                    </button>
                                </div>

                                <div className="space-y-2">
                                    {[
                                        { icon: Tool, label: 'Active Repairs' },
                                        { icon: History, label: 'Repair Log' },
                                        { icon: Settings, label: 'Configuration' },
                                    ].map((item, i) => (
                                        <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-blue-300 transition-all cursor-pointer group/item">
                                            <item.icon className="w-4 h-4 text-gray-500 group-hover/item:text-blue-600" />
                                            <span className="text-[10px] font-black uppercase tracking-wider text-gray-600 group-hover/item:text-gray-900">{item.label}</span>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-auto p-4 rounded-2xl bg-blue-50 border border-blue-200">
                                    <p className="text-[9px] font-bold text-blue-600 uppercase leading-relaxed">
                                        Click the + button to start a new repair intake.
                                    </p>
                                </div>
                            </div>
                        )}
                    </motion.aside>
                )}
            </AnimatePresence>

            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed top-20 left-0 z-[60] p-3 bg-white text-gray-900 rounded-r-2xl shadow-xl hover:bg-blue-600 hover:text-white transition-all duration-300 group border border-l-0 border-gray-200"
                >
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                </button>
            )}

            {receiptData && (
                <RepairReceipt 
                    data={receiptData} 
                    onClose={handleCloseReceipt}
                    autoPrint={true}
                />
            )}
        </div>
    );
}

export default function RepairPage() {
    return (
        <PageLayout
            sheetId="1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE"
            gid="408116623"
            showChecklist={false}
            customSidebar={<RepairSidebar />}
        />
    );
}
