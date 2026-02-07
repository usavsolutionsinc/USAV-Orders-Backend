'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import StationLayout from './station/StationLayout';
import StationNav from './station/StationNav';
import { PackerTable } from './PackerTable';
import { Package, TrendingUp, Clock, AlertCircle } from './Icons';
import StaffSelector from './StaffSelector';
import { StationDetailsHandler } from './station/StationDetailsHandler';

interface PackerDashboardProps {
    packerId: string;
}

export default function PackerDashboard({ packerId }: PackerDashboardProps) {
    const router = useRouter();
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    // Mock names for packers
    const getPackerInfo = (id: string) => {
        if (id === '4') return { name: 'Tuan', color: 'emerald' as const };
        if (id === '5') return { name: 'Thuy', color: 'blue' as const };
        return { name: 'Packer', color: 'purple' as const };
    };

    const packerInfo = getPackerInfo(packerId);

    useEffect(() => {
        fetchHistory();
    }, [packerId]);

    const fetchHistory = async () => {
        setIsLoadingHistory(true);
        try {
            // Fetch more data (500 records) to ensure accurate week counts
            const res = await fetch(`/api/packing-logs?packerId=${packerId}&limit=500`);
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

    const getTodayCount = () => {
        if (history.length === 0) return 0;
        const today = new Date().toDateString();
        return history.filter(h => {
            const date = new Date(h.timestamp || h.packedAt || '');
            return date.toDateString() === today;
        }).length;
    };

    const getAverageTime = () => {
        if (history.length === 0) return '0m';
        
        const today = new Date().toDateString();
        const todayLogs = history.filter(h => {
            const date = new Date(h.timestamp || h.packedAt || '');
            return date.toDateString() === today;
        }).sort((a, b) => {
            const dateA = new Date(a.timestamp || a.packedAt);
            const dateB = new Date(b.timestamp || b.packedAt);
            return dateA.getTime() - dateB.getTime();
        });

        if (todayLogs.length < 2) return '0m';

        const timeDiffs: number[] = [];
        for (let i = 1; i < todayLogs.length; i++) {
            const prevTime = new Date(todayLogs[i - 1].timestamp || todayLogs[i - 1].packedAt).getTime();
            const currTime = new Date(todayLogs[i].timestamp || todayLogs[i].packedAt).getTime();
            const diffMinutes = (currTime - prevTime) / (1000 * 60);
            
            // Filter out gaps > 60 minutes (likely breaks)
            if (diffMinutes > 0 && diffMinutes <= 60) {
                timeDiffs.push(diffMinutes);
            }
        }

        if (timeDiffs.length === 0) return '0m';

        const avgMinutes = timeDiffs.reduce((sum, val) => sum + val, 0) / timeDiffs.length;
        return `${avgMinutes.toFixed(1)}m`;
    };

    const getWeekCount = () => {
        if (history.length === 0) return 0;
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return history.filter(h => {
            const date = new Date(h.timestamp || h.packedAt || '');
            return date >= weekAgo;
        }).length;
    };

    return (
        <>
        <StationLayout
            stationType="testing"
            stationId={packerId}
            navContent={<StationNav />}
            historyContent={
                <div className="flex flex-col h-full">
                    <div className="p-2 bg-white border-b border-gray-100 flex items-center">
                        <StaffSelector 
                            role="packer" 
                            selectedStaffId={parseInt(packerId)} 
                            onSelect={(id) => router.push(`/packer/${id}`)}
                        />
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <PackerTable packedBy={parseInt(packerId)} />
                    </div>
                </div>
            }
        >
            <div className="flex flex-col h-full bg-white">
                {/* Header */}
                <div className="p-8 border-b border-gray-100">
                    <h2 className="text-2xl font-black text-gray-900 tracking-tighter">
                        {packerInfo.name}&apos;s Packing Report
                    </h2>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
                        Packer Station {packerId}
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="p-8 grid grid-cols-2 gap-4">
                    <div className="bg-emerald-50 rounded-3xl p-6 border border-emerald-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-emerald-500 rounded-xl">
                                <Package className="w-4 h-4 text-white" />
                            </div>
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Today</p>
                        </div>
                        <p className="text-3xl font-black text-emerald-900 tracking-tighter">{getTodayCount()}</p>
                        <p className="text-[10px] font-bold text-emerald-600/60 uppercase mt-1">Packages packed</p>
                    </div>

                    <div className="bg-blue-50 rounded-3xl p-6 border border-blue-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-blue-500 rounded-xl">
                                <Clock className="w-4 h-4 text-white" />
                            </div>
                            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Avg Time</p>
                        </div>
                        <p className="text-3xl font-black text-blue-900 tracking-tighter">{getAverageTime()}</p>
                        <p className="text-[10px] font-bold text-blue-600/60 uppercase mt-1">Per package</p>
                    </div>

                    <div className="bg-purple-50 rounded-3xl p-6 border border-purple-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-purple-500 rounded-xl">
                                <TrendingUp className="w-4 h-4 text-white" />
                            </div>
                            <p className="text-[10px] font-black text-purple-600 uppercase tracking-widest">This Week</p>
                        </div>
                        <p className="text-3xl font-black text-purple-900 tracking-tighter">{getWeekCount()}</p>
                        <p className="text-[10px] font-bold text-purple-600/60 uppercase mt-1">Total packed</p>
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
            </div>
            
        </StationLayout>
        <StationDetailsHandler />
        </>
    );
}
