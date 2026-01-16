'use client';

import React, { useState, useEffect } from 'react';
import StationLayout from './station/StationLayout';
import StationNav from './station/StationNav';
import StationHistory from './station/StationHistory';
import { Package, TrendingUp, Clock, AlertCircle } from './Icons';

interface PackerDashboardProps {
    packerId: string;
}

export default function PackerDashboard({ packerId }: PackerDashboardProps) {
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    // Mock names for packers
    const getPackerInfo = (id: string) => {
        if (id === '1') return { name: 'Tuan', color: 'emerald' as const };
        if (id === '2') return { name: 'Thuy', color: 'blue' as const };
        return { name: 'Packer', color: 'purple' as const };
    };

    const packerInfo = getPackerInfo(packerId);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        setIsLoadingHistory(true);
        try {
            // Need to create this API or use existing packing-logs API
            const res = await fetch(`/api/packing-logs?packerId=${packerId}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            if (Array.isArray(data)) {
                setHistory(data);
            }
        } catch (err) {
            console.error("Failed to fetch history:", err);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    return (
        <StationLayout
            stationType="packing"
            stationId={packerId}
            navContent={<StationNav />}
            historyContent={
                <StationHistory 
                    history={history} 
                    isLoading={isLoadingHistory} 
                    title="Packing History"
                    techId={packerId}
                    stationType="packing"
                />
            }
        >
            <div className="flex flex-col h-full bg-white">
                {/* Header */}
                <div className="p-8 border-b border-gray-100">
                    <h2 className="text-2xl font-black text-gray-900 tracking-tighter">
                        Welcome, {packerInfo.name}
                    </h2>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
                        Packer Station {packerId} • Desktop View
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="p-8 grid grid-cols-2 gap-4">
                    <div className="bg-emerald-50 rounded-3xl p-6 border border-emerald-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-emerald-500 rounded-xl">
                                <TrendingUp className="w-4 h-4 text-white" />
                            </div>
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Efficiency</p>
                        </div>
                        <p className="text-3xl font-black text-emerald-900 tracking-tighter">94%</p>
                        <p className="text-[10px] font-bold text-emerald-600/60 uppercase mt-1">+2% from yesterday</p>
                    </div>

                    <div className="bg-blue-50 rounded-3xl p-6 border border-blue-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-blue-500 rounded-xl">
                                <Clock className="w-4 h-4 text-white" />
                            </div>
                            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Avg Time</p>
                        </div>
                        <p className="text-3xl font-black text-blue-900 tracking-tighter">4.5m</p>
                        <p className="text-[10px] font-bold text-blue-600/60 uppercase mt-1">-15s vs average</p>
                    </div>

                    <div className="bg-purple-50 rounded-3xl p-6 border border-purple-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-purple-500 rounded-xl">
                                <Package className="w-4 h-4 text-white" />
                            </div>
                            <p className="text-[10px] font-black text-purple-600 uppercase tracking-widest">Daily Goal</p>
                        </div>
                        <p className="text-3xl font-black text-purple-900 tracking-tighter">42/50</p>
                        <div className="w-full bg-purple-200 h-1.5 rounded-full mt-3 overflow-hidden">
                            <div className="bg-purple-600 h-full w-[84%]" />
                        </div>
                    </div>

                    <div className="bg-orange-50 rounded-3xl p-6 border border-orange-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-orange-500 rounded-xl">
                                <AlertCircle className="w-4 h-4 text-white" />
                            </div>
                            <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Alerts</p>
                        </div>
                        <p className="text-3xl font-black text-orange-900 tracking-tighter">0</p>
                        <p className="text-[10px] font-bold text-orange-600/60 uppercase mt-1">All clear</p>
                    </div>
                </div>

                {/* Info Box */}
                <div className="px-8 flex-1">
                    <div className="bg-gray-50 rounded-3xl p-8 border border-gray-100 h-full flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-4">
                            <Package className="w-8 h-8 text-gray-300" />
                        </div>
                        <h3 className="text-lg font-black text-gray-900 tracking-tighter mb-2">Desktop Station Mode</h3>
                        <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
                            Use your iOS device to scan labels and capture photos. History and stats are synced here in real-time.
                        </p>
                    </div>
                </div>

                <div className="p-8 mt-auto border-t border-gray-50 text-center">
                    <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV PACKER DESKTOP v1.0</p>
                </div>
            </div>
        </StationLayout>
    );
}
