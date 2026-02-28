'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { TechTable } from './TechTable';
import { ShippedTable } from './shipped/ShippedTable';
import { StationDetailsHandler } from './station/StationDetailsHandler';

interface TechDashboardProps {
    techId: string;
    sheetId: string;
    gid?: string;
}

export default function TechDashboard({ techId, sheetId, gid }: TechDashboardProps) {
    const searchParams = useSearchParams();
    const rightViewMode = searchParams.get('view') === 'pending' ? 'pending' : 'history';

    useEffect(() => {
        void sheetId;
        void gid;
    }, [gid, sheetId]);

    return (
        <div className="flex h-full w-full relative">
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
