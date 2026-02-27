'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import StationLayout from './station/StationLayout';
import { TechTable } from './TechTable';
import { ShippedTable } from './shipped/ShippedTable';
import StationTesting from './station/StationTesting';
import StaffSelector from './StaffSelector';
import { StationDetailsHandler } from './station/StationDetailsHandler';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';
import { getTechThemeById } from '@/utils/staff-colors';

interface TechDashboardProps {
    techId: string;
    sheetId: string;
    gid?: string;
}

export default function TechDashboard({ techId, sheetId, gid }: TechDashboardProps) {
    const router = useRouter();
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [rightViewMode, setRightViewMode] = useState<'history' | 'pending'>('history');
    const [dailyGoal, setDailyGoal] = useState(50);

    // Color mapping based on technician ID
    const getTechInfo = (id: string) => {
        if (id === '1') return { name: 'Michael', color: 'green' as const };
        if (id === '2') return { name: 'Thuc', color: getTechThemeById(id) };
        if (id === '3') return { name: 'Sang', color: getTechThemeById(id) };
        if (id === '4') return { name: 'Cuong', color: getTechThemeById(id) };
        if (id === '6') return { name: 'Cuong', color: getTechThemeById(id) };
        return { name: 'Technician', color: getTechThemeById(id) };
    };

    const techInfo = getTechInfo(techId);

    useEffect(() => {
        fetchHistory();
    }, [techId]);

    useEffect(() => {
        const fetchGoal = async () => {
            try {
                const res = await fetch(`/api/staff-goals?staffId=${encodeURIComponent(techId)}`, { cache: 'no-store' });
                if (!res.ok) return;
                const data = await res.json();
                const goalValue = Number(data?.daily_goal);
                if (Number.isFinite(goalValue) && goalValue > 0) {
                    setDailyGoal(goalValue);
                }
            } catch (err) {
                console.error('Failed to fetch staff goal:', err);
            }
        };
        fetchGoal();
    }, [techId]);

    const fetchHistory = async () => {
        setIsLoadingHistory(true);
        try {
            const res = await fetch(`/api/tech-logs?techId=${techId}`);
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
        const todayDate = getCurrentPSTDateKey();
        return history.filter(h => {
            return toPSTDateKey(h.timestamp) === todayDate;
        }).length;
    };

    return (
        <div className="flex h-full w-full relative">
            <div className="w-[400px] min-w-[350px] border-r border-gray-100 flex-shrink-0 bg-gray-50/30 overflow-hidden flex flex-col">
                <div className="p-2 bg-white border-b border-gray-100 flex items-center justify-between gap-2">
                    <StaffSelector 
                        role="technician" 
                        selectedStaffId={parseInt(techId)} 
                        onSelect={(id) => router.push(`/tech/${id}`)}
                    />
                    <div className="relative">
                        <select
                            value={rightViewMode}
                            onChange={(e) => setRightViewMode(e.target.value as 'history' | 'pending')}
                            className="appearance-none text-[10px] font-black uppercase tracking-wider text-gray-700 bg-white border border-gray-200 rounded-xl px-3 py-1.5 pr-7 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
                        >
                            <option value="history">Tech History</option>
                            <option value="pending">Pending Orders</option>
                        </select>
                        <svg
                            className="w-3 h-3 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>
                <div className="flex-1 overflow-hidden">
                    <StationTesting 
                        userId={techId}
                        userName={techInfo.name}
                        sheetId={sheetId}
                        gid={gid}
                        themeColor={techInfo.color}
                        onTrackingScan={() => setRightViewMode('history')}
                        todayCount={getTodayCount()}
                        goal={dailyGoal}
                        onComplete={fetchHistory}
                    />
                </div>
            </div>
            <div className="flex-1 overflow-hidden">
                {rightViewMode === 'pending' ? (
                    <ShippedTable ordersOnly />
                ) : (
                    <TechTable testedBy={parseInt(techId)} />
                )}
            </div>
            <StationDetailsHandler viewMode={rightViewMode} />
        </div>
    );
}
