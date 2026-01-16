'use client';

import React, { useState, useEffect } from 'react';
import StationLayout from './station/StationLayout';
import StationNav from './station/StationNav';
import ReceivingLogs from './station/ReceivingLogs';
import { Package, TrendingUp, Clock, AlertCircle } from './Icons';

export default function ReceivingDashboard() {
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        setIsLoadingHistory(true);
        try {
            const res = await fetch('/api/receiving-logs');
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            if (Array.isArray(data)) {
                setHistory(data);
            }
        } catch (err) {
            console.error("Failed to fetch receiving history:", err);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    return (
        <StationLayout
            stationType="testing"
            stationId="receiving"
            navContent={<StationNav />}
            historyContent={
                <ReceivingLogs 
                    history={history} 
                    isLoading={isLoadingHistory}
                />
            }
        >
            <div className="flex flex-col h-full bg-white">
                {/* Header */}
                <div className="p-8 border-b border-gray-100">
                    <h2 className="text-2xl font-black text-gray-900 tracking-tighter">
                        Receiving Station
                    </h2>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
                        Incoming Shipments & Inventory
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="p-8 grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 rounded-3xl p-6 border border-blue-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-blue-500 rounded-xl">
                                <Package className="w-4 h-4 text-white" />
                            </div>
                            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Today</p>
                        </div>
                        <p className="text-3xl font-black text-blue-900 tracking-tighter">
                            {history.filter(h => {
                                const date = new Date(h.timestamp || '');
                                const today = new Date();
                                return date.toDateString() === today.toDateString();
                            }).length}
                        </p>
                        <p className="text-[10px] font-bold text-blue-600/60 uppercase mt-1">Packages received</p>
                    </div>

                    <div className="bg-emerald-50 rounded-3xl p-6 border border-emerald-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-emerald-500 rounded-xl">
                                <TrendingUp className="w-4 h-4 text-white" />
                            </div>
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">This Week</p>
                        </div>
                        <p className="text-3xl font-black text-emerald-900 tracking-tighter">
                            {history.filter(h => {
                                const date = new Date(h.timestamp || '');
                                const today = new Date();
                                const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
                                return date >= weekAgo;
                            }).length}
                        </p>
                        <p className="text-[10px] font-bold text-emerald-600/60 uppercase mt-1">Total received</p>
                    </div>

                    <div className="bg-purple-50 rounded-3xl p-6 border border-purple-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-purple-500 rounded-xl">
                                <Clock className="w-4 h-4 text-white" />
                            </div>
                            <p className="text-[10px] font-black text-purple-600 uppercase tracking-widest">Avg Time</p>
                        </div>
                        <p className="text-3xl font-black text-purple-900 tracking-tighter">2.3m</p>
                        <p className="text-[10px] font-bold text-purple-600/60 uppercase mt-1">Per package</p>
                    </div>

                    <div className="bg-orange-50 rounded-3xl p-6 border border-orange-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-orange-500 rounded-xl">
                                <AlertCircle className="w-4 h-4 text-white" />
                            </div>
                            <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Pending</p>
                        </div>
                        <p className="text-3xl font-black text-orange-900 tracking-tighter">0</p>
                        <p className="text-[10px] font-bold text-orange-600/60 uppercase mt-1">To process</p>
                    </div>
                </div>

                {/* Info Box */}
                <div className="px-8 flex-1">
                    <div className="bg-gray-50 rounded-3xl p-8 border border-gray-100 h-full flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-4">
                            <Package className="w-8 h-8 text-gray-300" />
                        </div>
                        <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
                            Scan incoming packages and track shipments. History and carrier information synced in real-time from NEON DB.
                        </p>
                    </div>
                </div>

                <div className="p-8 mt-auto border-t border-gray-50 text-center">
                    <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV RECEIVING v1.0</p>
                </div>
            </div>
        </StationLayout>
    );
}
