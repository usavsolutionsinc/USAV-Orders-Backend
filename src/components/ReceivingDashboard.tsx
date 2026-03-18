'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ReceivingLogs from './station/ReceivingLogs';
import ReceivingLinesTable from './station/ReceivingLinesTable';
import { AnimatePresence } from 'framer-motion';
import { ReceivingDetailsStack, type ReceivingDetailsLog } from './station/ReceivingDetailsStack';
import { useQueryClient } from '@tanstack/react-query';

export default function ReceivingDashboard() {
    const [selectedLog, setSelectedLog] = useState<ReceivingDetailsLog | null>(null);
    const queryClient = useQueryClient();
    const searchParams = useSearchParams();
    const mode = searchParams.get('mode') ?? 'bulk';
    const isUnboxingMode = mode === 'unboxing';

    useEffect(() => {
        const handleSelectLog = (e: Event) => {
            const custom = e as CustomEvent<ReceivingDetailsLog>;
            if (custom.detail) setSelectedLog(custom.detail);
        };
        window.addEventListener('receiving-select-log', handleSelectLog);
        return () => window.removeEventListener('receiving-select-log', handleSelectLog);
    }, []);

    return (
        <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f8fbfb_0%,#ffffff_16%)]">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-1 overflow-hidden">
                    {!isUnboxingMode && (
                        <div className="flex flex-1 min-w-0 overflow-hidden">
                            <ReceivingLogs
                                onSelectLog={(log) => setSelectedLog(log)}
                                selectedLogId={selectedLog?.id || null}
                            />
                        </div>
                    )}

                    {isUnboxingMode && (
                        <div className="flex-1 min-w-0 overflow-hidden">
                            <ReceivingLinesTable />
                        </div>
                    )}
                </div>
            </div>

            <AnimatePresence>
                {selectedLog && (
                    <ReceivingDetailsStack
                        log={selectedLog}
                        onClose={() => setSelectedLog(null)}
                        onUpdated={() => {
                            setSelectedLog(null);
                            queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
                            queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
                            queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
                            queryClient.invalidateQueries({ queryKey: ['zoho-health'] });
                            window.dispatchEvent(new CustomEvent('receiving-focus-scan'));
                        }}
                        onDeleted={(_id) => {
                            setSelectedLog(null);
                            queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
                            queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
                            queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
