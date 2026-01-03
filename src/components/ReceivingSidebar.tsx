'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, ChevronLeft, ChevronRight, Package } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

interface TrackingItem {
    id: string;
    trackingNumber: string;
    orderNumber?: string;
    productTitle?: string;
    timestamp: string;
}

export default function ReceivingSidebar() {
    const [isOpen, setIsOpen] = useState(true);
    const [trackings, setTrackings] = useState<TrackingItem[]>([]);
    const [newTracking, setNewTracking] = useState('');
    const [newOrderNumber, setNewOrderNumber] = useState('');
    const [newProductTitle, setNewProductTitle] = useState('');

    // Load from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem('urgent_trackings');
        if (saved) {
            try {
                setTrackings(JSON.parse(saved));
            } catch (e) {
                console.error('Failed to parse trackings');
            }
        }
    }, []);

    // Save to localStorage
    const saveTrackings = (items: TrackingItem[]) => {
        setTrackings(items);
        localStorage.setItem('urgent_trackings', JSON.stringify(items));
    };

    const addTracking = () => {
        if (!newTracking.trim()) return;
        const newItem: TrackingItem = {
            id: Date.now().toString(),
            trackingNumber: newTracking.trim().toUpperCase(),
            orderNumber: newOrderNumber.trim(),
            productTitle: newProductTitle.trim(),
            timestamp: new Date().toISOString(),
        };
        saveTrackings([newItem, ...trackings]);
        setNewTracking('');
        setNewOrderNumber('');
        setNewProductTitle('');
    };

    const removeTracking = (id: string) => {
        saveTrackings(trackings.filter(t => t.id !== id));
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            addTracking();
        }
    };

    return (
        <>
            <AnimatePresence>
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 340, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 120 }}
                        className="bg-gray-950 text-white flex-shrink-0 z-40 overflow-hidden border-r border-white/5"
                    >
                        <div className="p-8 h-full flex flex-col space-y-8 overflow-y-auto scrollbar-hide">
                            <header>
                                <h2 className="text-2xl font-black tracking-tighter uppercase leading-none">
                                    Urgent Ship
                                </h2>
                                <p className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.3em] mt-1">
                                    Incoming Trackings
                                </p>
                            </header>
                            
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <div className="space-y-2">
                                        <div className="relative group">
                                            <input
                                                type="text"
                                                placeholder="SCAN TRACKING..."
                                                value={newTracking}
                                                onChange={(e) => setNewTracking(e.target.value)}
                                                onKeyPress={handleKeyPress}
                                                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-xs font-black tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-gray-600"
                                            />
                                            <button 
                                                onClick={addTracking}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-blue-600 rounded-xl hover:bg-blue-500 transition-colors"
                                            >
                                                <Plus className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <input
                                                type="text"
                                                placeholder="ORDER #"
                                                value={newOrderNumber}
                                                onChange={(e) => setNewOrderNumber(e.target.value)}
                                                onKeyPress={handleKeyPress}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-[10px] font-black tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-gray-700"
                                            />
                                            <input
                                                type="text"
                                                placeholder="TITLE"
                                                value={newProductTitle}
                                                onChange={(e) => setNewProductTitle(e.target.value)}
                                                onKeyPress={handleKeyPress}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl py-2 px-4 text-[10px] font-black tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all placeholder:text-gray-700"
                                            />
                                        </div>
                                    </div>
                                    <p className="px-2 text-[8px] font-black text-gray-600 uppercase tracking-widest">
                                        Scan tracking to prioritize unboxing
                                    </p>
                                </div>

                                <div className="space-y-4">
                                    {trackings.length === 0 ? (
                                        <div className="bg-white/5 p-8 rounded-3xl border border-white/10 border-dashed flex flex-col items-center justify-center text-center">
                                            <Package className="w-8 h-8 text-gray-700 mb-3" />
                                            <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">
                                                No Urgent Deliveries
                                            </p>
                                        </div>
                                    ) : (
                                        trackings.map((item) => (
                                            <motion.div
                                                layout
                                                initial={{ opacity: 0, x: -20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                key={item.id}
                                                className="bg-white/5 border border-white/10 p-5 rounded-3xl group relative hover:bg-white/[0.08] transition-all"
                                            >
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em]">Priority Item</span>
                                                        {item.orderNumber && (
                                                            <span className="text-[9px] font-black text-emerald-500 uppercase tracking-[0.1em] bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                                                #{item.orderNumber}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-sm font-black tracking-tight text-white truncate pr-8">
                                                        {item.trackingNumber}
                                                    </span>
                                                    {item.productTitle && (
                                                        <span className="text-[10px] font-bold text-gray-400 truncate">
                                                            {item.productTitle}
                                                        </span>
                                                    )}
                                                    <span className="text-[8px] font-mono text-gray-600 uppercase mt-1">
                                                        Added {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => removeTracking(item.id)}
                                                    className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-2 text-gray-500 hover:text-red-400 transition-all"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </motion.div>
                                        ))
                                    )}
                                </div>
                            </div>

                            <footer className="mt-auto pt-6 border-t border-white/5 opacity-30">
                                <p className="text-[8px] font-mono uppercase tracking-[0.4em]">USAV OS PRIORITY // v2.0</p>
                            </footer>
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`fixed left-0 bottom-8 z-[60] p-3 bg-white text-gray-950 rounded-r-2xl shadow-[10px_0_30px_rgba(0,0,0,0.5)] hover:bg-blue-600 hover:text-white transition-all duration-300 group`}
            >
                {isOpen ? (
                    <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
                ) : (
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                )}
            </button>
        </>
    );
}

