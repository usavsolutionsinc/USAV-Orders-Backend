'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RepairTable } from '@/components/repair';
import { SalesEditPanel } from '@/components/walk-in/SalesEditPanel';
import { WalkInSidebarPanel } from '@/components/sidebar/WalkInSidebarPanel';
import { RouteShell } from '@/design-system/components/RouteShell';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';

type WalkInMode = 'repairs' | 'sales';

function isMobileUserAgent(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function WalkInPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const mode: WalkInMode = searchParams.get('mode') === 'sales' ? 'sales' : 'repairs';

    const rawTab = searchParams.get('tab');
    const repairTab = rawTab === 'incoming' ? 'incoming' : rawTab === 'done' ? 'done' : 'active';

    // Mobile QR-scan flow: if a printed repair label lands here on a phone,
    // hop to the tech-friendly mobile page instead of the desktop sidebar.
    const openRepairParam = searchParams.get('openRepair');
    const [redirecting, setRedirecting] = useState(() => {
        if (typeof window === 'undefined') return false;
        return !!openRepairParam && isMobileUserAgent();
    });
    useEffect(() => {
        if (!openRepairParam) return;
        if (!isMobileUserAgent()) return;
        const targetId = Number(openRepairParam);
        if (!Number.isFinite(targetId) || targetId <= 0) return;
        setRedirecting(true);
        router.replace(`/m/rs/${targetId}`);
    }, [openRepairParam, router]);

    useRealtimeInvalidation({ repair: mode === 'repairs', walkIn: mode === 'sales' });

    if (redirecting) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-white">
                <LoadingSpinner size="lg" className="text-orange-500" />
            </div>
        );
    }

    return (
        <div className="flex h-full w-full bg-white">
            <RouteShell
                actions={<WalkInSidebarPanel embedded hideSectionHeader />}
                history={
                    mode === 'repairs' ? (
                        <RepairTable filter={repairTab} />
                    ) : (
                        <SalesEditPanel />
                    )
                }
            />
        </div>
    );
}

export default function WalkInPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <LoadingSpinner size="lg" className="text-emerald-600" />
            </div>
        }>
            <WalkInPageContent />
        </Suspense>
    );
}
