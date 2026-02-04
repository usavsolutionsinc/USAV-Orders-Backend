'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus, Search, Loader2, X, Package, Tool } from '@/components/Icons';
import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { RepairIntakeForm, RepairFormData, RepairTable } from '@/components/repair';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { TabSwitch } from '@/components/ui/TabSwitch';

interface RepairSidebarProps {
    activeTab: 'active' | 'done';
    setActiveTab: (tab: 'active' | 'done') => void;
}

function RepairSidebar({ activeTab, setActiveTab }: RepairSidebarProps) {
    const [showIntakeForm, setShowIntakeForm] = useState(false);
    const searchParams = useSearchParams();
    const isNew = searchParams.get('new') === 'true';

    useEffect(() => {
        if (isNew) {
            setShowIntakeForm(true);
            window.history.replaceState({}, '', '/repair');
        }
    }, [isNew]);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');
    
    const handleNewRepair = () => {
        setShowIntakeForm(true);
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const params = new URLSearchParams(window.location.search);
        if (searchValue) {
            params.set('search', searchValue);
        } else {
            params.delete('search');
        }
        window.history.pushState({}, '', `/repair?${params.toString()}`);
    };

    const handleClearSearch = () => {
        setSearchValue('');
        const params = new URLSearchParams(window.location.search);
        params.delete('search');
        window.history.pushState({}, '', `/repair`);
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
                setShowIntakeForm(false);
                // Open the repair service form in a new window for printing
                window.open(`/api/repair-service/print/${result.id}`, '_blank');
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
                                <form onSubmit={handleSearch} className="relative group">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-orange-600 transition-colors">
                                        <Search className="w-4 h-4" />
                                    </div>
                                    <input 
                                        type="text"
                                        value={searchValue}
                                        onChange={(e) => setSearchValue(e.target.value)}
                                        placeholder="Search repairs..."
                                        className="w-full pl-11 pr-10 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-bold focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 outline-none transition-all shadow-inner"
                                    />
                                    {searchValue && (
                                        <button 
                                            type="button"
                                            onClick={handleClearSearch}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 rounded-lg transition-all text-gray-400"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </form>

                                <button
                                    onClick={handleNewRepair}
                                    className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-900 hover:bg-gray-800 text-white rounded-[1.5rem] transition-all active:scale-[0.98] shadow-xl shadow-gray-900/20 group"
                                >
                                    <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                                    <span className="text-[11px] font-black uppercase tracking-widest">New Repair Order</span>
                                </button>

                                {/* Active / Done Tabs */}
                                <TabSwitch
                                    tabs={[
                                        { id: 'active', label: 'Active', color: 'blue' },
                                        { id: 'done', label: 'Done', color: 'emerald' }
                                    ]}
                                    activeTab={activeTab}
                                    onTabChange={(tab) => setActiveTab(tab as 'active' | 'done')}
                                />
                            </div>

                            <div className="mt-auto pt-6 border-t border-gray-100 text-center">
                                <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">Repair Module v2.1</p>
                            </div>
                        </div>
                    )}
                </motion.aside>
            </AnimatePresence>
        </>
    );
}

function RepairPageContent() {
    const [activeTab, setActiveTab] = useState<'active' | 'done'>('active');
    
    return (
        <div className="flex h-full w-full bg-white">
            <RepairSidebar activeTab={activeTab} setActiveTab={setActiveTab} />
            
            <div className="flex-1 flex flex-col min-w-0">
                <RepairTable filter={activeTab} />
            </div>
        </div>
    );
}

export default function RepairPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <LoadingSpinner size="lg" className="text-blue-600" />
            </div>
        }>
            <RepairPageContent />
        </Suspense>
    );
}
