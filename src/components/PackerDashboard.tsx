'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PackerTable } from './PackerTable';
import StaffSelector from './StaffSelector';
import { StationDetailsHandler } from './station/StationDetailsHandler';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';
import { getPackerThemeById } from '@/utils/staff-colors';
import StationPacking from './station/StationPacking';

interface PackerDashboardProps {
    packerId: string;
    showStaffSelector?: boolean;
}

export default function PackerDashboard({ packerId, showStaffSelector = true }: PackerDashboardProps) {
    const router = useRouter();
    const [history, setHistory] = useState<any[]>([]);
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [dailyGoal, setDailyGoal] = useState(50);

    // Mock names for packers
    const getPackerInfo = (id: string) => {
        if (id === '4') return { name: 'Tuan', color: getPackerThemeById(id) };
        if (id === '5') return { name: 'Thuy', color: getPackerThemeById(id) };
        return { name: 'Packer', color: getPackerThemeById(id) };
    };

    const packerInfo = getPackerInfo(packerId);

    useEffect(() => {
        fetchHistory();
    }, [packerId]);

    useEffect(() => {
        const fetchGoal = async () => {
            try {
                const res = await fetch(`/api/staff-goals?staffId=${encodeURIComponent(packerId)}`, { cache: 'no-store' });
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
    }, [packerId]);

    const fetchHistory = async () => {
        try {
            const res = await fetch(`/api/packerlogs?packerId=${packerId}&limit=5000`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            if (Array.isArray(data)) {
                setHistory(data);
            }
        } catch (err) {
            console.error("Failed to fetch history:", err);
        }
    };

    const getTodayCount = () => {
        if (history.length === 0) return 0;
        const today = getCurrentPSTDateKey();
        return history.filter(h => {
            return toPSTDateKey(h.pack_date_time || h.timestamp || h.packedAt || '') === today;
        }).length;
    };

    return (
        <>
        <div className="flex h-full w-full relative">
            <div className="w-[400px] min-w-[350px] border-r border-gray-100 flex-shrink-0 bg-gray-50/30 overflow-hidden flex flex-col">
                {showStaffSelector && (
                    <div className="p-2 bg-white border-b border-gray-100 flex items-center">
                        <StaffSelector
                            role="packer"
                            selectedStaffId={parseInt(packerId)}
                            onSelect={(id) => router.push(`/packer/${id}`)}
                        />
                    </div>
                )}
                <div className="flex-1 overflow-hidden">
                    <StationPacking
                        userId={packerId}
                        userName={packerInfo.name}
                        themeColor={packerInfo.color}
                        todayCount={getTodayCount()}
                        goal={dailyGoal}
                        onComplete={() => {
                            fetchHistory();
                            setRefreshNonce((n) => n + 1);
                        }}
                    />
                </div>
            </div>
            <div className="flex-1 overflow-hidden">
                <PackerTable key={`${packerId}-${refreshNonce}`} packedBy={parseInt(packerId)} />
            </div>
        </div>
        <StationDetailsHandler />
        </>
    );
}
