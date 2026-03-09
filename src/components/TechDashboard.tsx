'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { TechTable } from './TechTable';
import PendingOrdersTable from './PendingOrdersTable';
import UpdateManualsView from './UpdateManualsView';
import { StationDetailsHandler } from './station/StationDetailsHandler';
import ProductManualViewer from './station/ProductManualViewer';
import type { ResolvedProductManual } from '@/hooks/useStationTestingController';

interface TechDashboardProps {
    techId: string;
}

export default function TechDashboard({ techId }: TechDashboardProps) {
    const searchParams = useSearchParams();
    const rawView = searchParams.get('view');
    const rightViewMode = rawView === 'pending'
        ? 'pending'
        : rawView === 'manual'
            ? 'manual'
            : rawView === 'update-manuals'
                ? 'update-manuals'
                : 'history';

    const [lastManuals, setLastManuals] = useState<ResolvedProductManual[]>([]);

    useEffect(() => {
        const storageKey = `usav:last-manual:tech:${techId}`;
        try {
            const raw = window.localStorage.getItem(storageKey);
            if (!raw) { setLastManuals([]); return; }
            const parsed = JSON.parse(raw);
            setLastManuals(Array.isArray(parsed) ? parsed : [parsed]);
        } catch {
            setLastManuals([]);
        }

        const handleManualUpdate = (event: Event) => {
            const custom = event as CustomEvent<{ techId?: string; manuals?: ResolvedProductManual[] }>;
            if (String(custom?.detail?.techId || '') !== String(techId)) return;
            setLastManuals(Array.isArray(custom?.detail?.manuals) ? custom.detail.manuals : []);
        };

        window.addEventListener('tech-last-manual-updated', handleManualUpdate as EventListener);
        return () => window.removeEventListener('tech-last-manual-updated', handleManualUpdate as EventListener);
    }, [techId]);

    return (
        <div className="flex h-full w-full relative">
            <div className="flex-1 overflow-hidden">
                {rightViewMode === 'manual' ? (
                    <div className="h-full w-full bg-gray-50 p-4">
                        <ProductManualViewer manuals={lastManuals} className="h-full" />
                    </div>
                ) : rightViewMode === 'pending' ? (
                    <PendingOrdersTable />
                ) : rightViewMode === 'update-manuals' ? (
                    <UpdateManualsView techId={techId} days={30} />
                ) : (
                    <TechTable testedBy={parseInt(techId)} />
                )}
            </div>
            <StationDetailsHandler viewMode={rightViewMode === 'update-manuals' ? 'history' : rightViewMode} />
        </div>
    );
}
