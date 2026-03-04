'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { TechTable } from './TechTable';
import PendingOrdersTable from './PendingOrdersTable';
import { StationDetailsHandler } from './station/StationDetailsHandler';
import { ExternalLink, Printer } from './Icons';

interface TechDashboardProps {
    techId: string;
    sheetId: string;
    gid?: string;
}

export default function TechDashboard({ techId, sheetId, gid }: TechDashboardProps) {
    const searchParams = useSearchParams();
    const rawView = searchParams.get('view');
    const rightViewMode = rawView === 'pending' ? 'pending' : rawView === 'manual' ? 'manual' : 'history';
    const [lastManual, setLastManual] = useState<any | null>(null);

    useEffect(() => {
        const storageKey = `usav:last-manual:tech:${techId}`;
        try {
            const raw = window.localStorage.getItem(storageKey);
            setLastManual(raw ? JSON.parse(raw) : null);
        } catch {
            setLastManual(null);
        }

        const handleManualUpdate = (event: Event) => {
            const custom = event as CustomEvent<{ techId?: string; manual?: any | null }>;
            if (String(custom?.detail?.techId || '') !== String(techId)) return;
            setLastManual(custom?.detail?.manual || null);
        };

        window.addEventListener('tech-last-manual-updated', handleManualUpdate as EventListener);
        return () => window.removeEventListener('tech-last-manual-updated', handleManualUpdate as EventListener);
    }, [techId]);

    useEffect(() => {
        void sheetId;
        void gid;
    }, [gid, sheetId]);

    return (
        <div className="flex h-full w-full relative">
            <div className="flex-1 overflow-hidden">
                {rightViewMode === 'manual' ? (
                    <div className="h-full w-full bg-white flex flex-col">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                            <div className="min-w-0">
                                <p className="text-[11px] font-black uppercase tracking-wider text-gray-900">Last Order Manual</p>
                                {lastManual?.type ? (
                                    <p className="text-[10px] font-bold text-gray-500 truncate">Type: {lastManual.type}</p>
                                ) : (
                                    <p className="text-[10px] font-bold text-gray-500 truncate">Google Drive manual preview</p>
                                )}
                            </div>
                            {lastManual ? (
                                <div className="flex items-center gap-2">
                                    <a
                                        href={lastManual.viewUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider"
                                    >
                                        <ExternalLink className="w-3 h-3" />
                                        Open
                                    </a>
                                    <a
                                        href={lastManual.downloadUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-900 text-[10px] font-black uppercase tracking-wider"
                                    >
                                        <Printer className="w-3 h-3" />
                                        Print
                                    </a>
                                </div>
                            ) : null}
                        </div>
                        <div className="flex-1 bg-gray-50 p-4">
                            {lastManual?.previewUrl ? (
                                <div className="h-full rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
                                    <iframe
                                        src={lastManual.previewUrl}
                                        title="Last order manual"
                                        className="w-full h-full"
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                    />
                                </div>
                            ) : (
                                <div className="h-full rounded-xl border border-dashed border-gray-300 bg-white flex items-center justify-center p-6">
                                    <p className="text-xs font-bold text-gray-500 text-center">
                                        Scan an order with a linked manual to load it here.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                ) : rightViewMode === 'pending' ? (
                    <PendingOrdersTable />
                ) : (
                    <TechTable testedBy={parseInt(techId)} />
                )}
            </div>
            <StationDetailsHandler viewMode={rightViewMode} />
        </div>
    );
}
