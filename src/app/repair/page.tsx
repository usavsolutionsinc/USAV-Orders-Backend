'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus, Search, Loader2, X, Package } from '@/components/Icons';
import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { RepairIntakeForm, RepairReceipt, RepairFormData, RepairTable } from '@/components/repair';

function RepairSidebar() {
    const [isOpen, setIsOpen] = useState(true);
    const [showIntakeForm, setShowIntakeForm] = useState(false);
    const searchParams = useSearchParams();
    const isNew = searchParams.get('new') === 'true';

    useEffect(() => {
        if (isNew) {
            setShowIntakeForm(true);
            // Clear the param after opening
            window.history.replaceState({}, '', '/repair');
        }
    }, [isNew]);

    const [receiptData, setReceiptData] = useState<any>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Search functionality
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSearchResults, setShowSearchResults] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

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

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            setShowSearchResults(false);
            setHasSearched(false);
            return;
        }

        setIsSearching(true);
        setHasSearched(true);
        try {
            const res = await fetch(`/api/repair/search?q=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();
            
            if (data.results) {
                setSearchResults(data.results);
                setShowSearchResults(true);
            } else {
                setSearchResults([]);
                setShowSearchResults(true);
            }
        } catch (error) {
            console.error('Search error:', error);
            setSearchResults([]);
            setShowSearchResults(true);
        } finally {
            setIsSearching(false);
        }
    };

    const handleSearchKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
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
                        <div className="p-6 pt-16 space-y-6 h-full flex flex-col">
                                {/* Header */}
                                <header>
                                    <h2 className="text-xl font-black tracking-tighter text-gray-900 uppercase">Repair Service</h2>
                                    <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mt-1">Bose Wave Repair</p>
                                </header>

                                {/* Search Bar + Add Button */}
                                <div className="relative">
                                    <div className="flex items-center gap-2">
                                        <div className="relative flex-1">
                                            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                                <Search className="w-3.5 h-3.5 text-gray-400" />
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="Search repairs..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                onKeyPress={handleSearchKeyPress}
                                                className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 pl-9 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-gray-400"
                                            />
                                            {isSearching && (
                                                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={handleNewRepair}
                                            className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all shadow-lg shadow-blue-600/30 group shrink-0"
                                            title="New Repair"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {/* Search Results */}
                                    <AnimatePresence>
                                        {showSearchResults && (
                                            <motion.div
                                                initial={{ opacity: 0, y: -10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -10 }}
                                                className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl max-h-96 overflow-y-auto z-50"
                                            >
                                                <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-2 flex items-center justify-between">
                                                    <p className="text-xs font-bold text-gray-600">
                                                        {searchResults.length} Result{searchResults.length !== 1 ? 's' : ''}
                                                    </p>
                                                    <button
                                                        onClick={() => setShowSearchResults(false)}
                                                        className="p-1 hover:bg-gray-100 rounded transition-all"
                                                    >
                                                        <X className="w-4 h-4 text-gray-400" />
                                                    </button>
                                                </div>
                                                
                                                {searchResults.length > 0 ? (
                                                    <div className="p-2 space-y-2">
                                                        {searchResults.map((result) => (
                                                            <div
                                                                key={result.id}
                                                                className="bg-gray-50 border border-gray-200 rounded-lg p-3 hover:border-blue-300 transition-all"
                                                            >
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-blue-100 text-blue-700">
                                                                        {result.ticket_number}
                                                                    </span>
                                                                    <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                                                                        result.status === 'Completed' 
                                                                            ? 'bg-emerald-100 text-emerald-700'
                                                                            : result.status === 'Pending'
                                                                            ? 'bg-amber-100 text-amber-700'
                                                                            : 'bg-gray-100 text-gray-700'
                                                                    }`}>
                                                                        {result.status}
                                                                    </span>
                                                                </div>
                                                                
                                                                <div className="space-y-1 text-[10px]">
                                                                    <div className="flex justify-between">
                                                                        <span className="text-gray-500 font-bold">Contact</span>
                                                                        <span className="font-semibold text-right">{result.contact}</span>
                                                                    </div>
                                                                    <div className="flex justify-between">
                                                                        <span className="text-gray-500 font-bold">Product</span>
                                                                        <span className="font-semibold text-right">{result.product_title}</span>
                                                                    </div>
                                                                    {result.serial_number && (
                                                                        <div className="flex justify-between pt-1 border-t border-gray-200">
                                                                            <span className="text-gray-500 font-bold">Serial</span>
                                                                            <span className="font-mono font-semibold">{result.serial_number}</span>
                                                                        </div>
                                                                    )}
                                                                    <div className="flex justify-between">
                                                                        <span className="text-gray-500 font-bold">Price</span>
                                                                        <span className="font-semibold">${result.price}</span>
                                                                    </div>
                                                                    {result.repair_reasons && (
                                                                        <div className="pt-1 border-t border-gray-200">
                                                                            <span className="text-gray-500 font-bold">Reason</span>
                                                                            <p className="text-gray-700 mt-0.5">{result.repair_reasons}</p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : hasSearched && (
                                                    <div className="p-8 text-center bg-red-50/50">
                                                        <Search className="w-8 h-8 text-red-300 mx-auto mb-2" />
                                                        <h3 className="text-xs font-black text-red-900 uppercase tracking-tight mb-1">Repair not found</h3>
                                                        <p className="text-[10px] text-red-600 font-bold uppercase tracking-widest leading-relaxed">
                                                            No matches for "{searchQuery}"
                                                        </p>
                                                    </div>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
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
        <div className="flex h-full w-full">
            <Suspense fallback={null}>
                {/* Keep existing RepairSidebar for search and new repair intake */}
                <RepairSidebar />
            </Suspense>
            
            {/* New RepairTable component reading from Neon DB */}
            <Suspense fallback={
                <div className="flex-1 flex items-center justify-center bg-gray-50">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            }>
                <RepairTable />
            </Suspense>
        </div>
    );
}
