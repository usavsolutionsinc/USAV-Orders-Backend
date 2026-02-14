'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus, Search, Loader2, X, Package, Tool } from '@/components/Icons';
import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { RepairIntakeForm, RepairFormData, RepairTable } from '@/components/repair';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { TabSwitch } from '@/components/ui/TabSwitch';
import { SearchBar } from '@/components/ui/SearchBar';

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
                                <h2 className="text-2xl font-black tracking-tighter text-gray-900 uppercase leading-none">Repairs</h2>
                                <p className="text-[10px] font-bold text-orange-600 uppercase tracking-[0.3em] mt-2">USAV Repair Service</p>
                            </header>

                            <div className="space-y-4">
                                <SearchBar
                                    value={searchValue}
                                    onChange={setSearchValue}
                                    onSearch={() => {
                                        const params = new URLSearchParams(window.location.search);
                                        if (searchValue) {
                                            params.set('search', searchValue);
                                        } else {
                                            params.delete('search');
                                        }
                                        window.history.pushState({}, '', `/repair?${params.toString()}`);
                                    }}
                                    onClear={handleClearSearch}
                                    placeholder="Search repairs..."
                                    variant="orange"
                                    rightElement={
                                        <button
                                            onClick={handleNewRepair}
                                            className="p-3 bg-gray-900 hover:bg-gray-800 text-white rounded-2xl transition-all active:scale-95 shadow-lg shadow-gray-900/10 group"
                                            title="New Repair Order"
                                        >
                                            <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                                        </button>
                                    }
                                />
                                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 px-1">
                                    Repairs sorted by most urgent
                                </p>

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
