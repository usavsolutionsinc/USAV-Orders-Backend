'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import StationLayout from './station/StationLayout';
import TechLogs from './station/TechLogs';
import StationTesting from './station/StationTesting';
import StaffSelector from './StaffSelector';

interface TechDashboardProps {
    techId: string;
    sheetId: string;
    gid?: string;
}

export default function TechDashboard({ techId, sheetId, gid }: TechDashboardProps) {
    const router = useRouter();
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    // Color mapping based on technician ID
    const getTechInfo = (id: string) => {
        if (id === '1') return { name: 'Michael', color: 'green' as const };
        if (id === '2') return { name: 'Thuc', color: 'blue' as const };
        if (id === '3') return { name: 'Sang', color: 'purple' as const };
        return { name: 'Technician', color: 'blue' as const };
    };

    const techInfo = getTechInfo(techId);

    useEffect(() => {
        fetchHistory();
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
        const todayDate = new Date().toDateString();
        return history.filter(h => {
            const date = new Date(h.timestamp);
            return date.toDateString() === todayDate;
        }).length;
    };

    return (
        <div className="flex h-full w-full">
            <div className="w-[400px] min-w-[350px] border-r border-gray-100 flex-shrink-0 bg-gray-50/30 overflow-hidden flex flex-col">
                <div className="p-2 bg-white border-b border-gray-100 flex items-center">
                    <StaffSelector 
                        role="technician" 
                        selectedStaffId={parseInt(techId)} 
                        onSelect={(id) => router.push(`/tech/${id}`)}
                    />
                </div>
                <div className="flex-1 overflow-hidden">
                    <StationTesting 
                        userId={techId}
                        userName={techInfo.name}
                        sheetId={sheetId}
                        gid={gid}
                        themeColor={techInfo.color}
                        todayCount={getTodayCount()}
                        onComplete={fetchHistory}
                    />
                </div>
            </div>
            <div className="flex-1 overflow-hidden">
                <TechLogs 
                    history={history} 
                    isLoading={isLoadingHistory}
                    techId={techId}
                />
            </div>
        </div>
    );
}
