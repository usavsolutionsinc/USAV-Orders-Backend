import { useState, useCallback } from 'react';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';

export interface HistoryLog {
    id: string;
    timestamp: string;
    title?: string;
    tracking?: string;
    serial?: string;
    status?: string;
    count?: number;
}

export interface StationHistoryResult {
    history: HistoryLog[];
    isLoading: boolean;
    fetchHistory: () => Promise<void>;
    todayCount: number;
}

export interface StationHistoryOptions {
    stationType: 'packing' | 'testing';
    stationId: string;
}

/**
 * Hook to manage station history data
 * @param options - Station configuration
 * @returns History data and fetch function
 */
export function useStationHistory({
    stationType,
    stationId,
}: StationHistoryOptions): StationHistoryResult {
    const [history, setHistory] = useState<HistoryLog[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [todayCount, setTodayCount] = useState(0);

    const fetchHistory = useCallback(async () => {
        setIsLoading(true);
        try {
            const endpoint = stationType === 'packing' 
                ? `/api/packing-logs?packerId=${stationId}`
                : `/api/tech-logs?techId=${stationId}`;

            const res = await fetch(endpoint);
            if (!res.ok) throw new Error('Failed to fetch history');

            const data = await res.json();
            
            if (Array.isArray(data)) {
                // Normalize data structure
                const normalizedData = data.map((log: any) => ({
                    ...log,
                    timestamp: log.packedAt || log.timestamp,
                    title: log.product || log.title,
                    tracking: log.trackingNumber || log.tracking,
                    status: log.carrier || log.status,
                    id: log.id || `log-${Math.random()}`,
                }));

                setHistory(normalizedData);

                // Calculate today's count
                const today = getCurrentPSTDateKey();
                const count = normalizedData.filter((log: HistoryLog) => {
                    try {
                        const logDateKey = toPSTDateKey(log.timestamp);
                        return !!logDateKey && logDateKey === today;
                    } catch (e) {
                        return false;
                    }
                }).length;

                setTodayCount(count);
            }
        } catch (error) {
            console.error('Failed to fetch station history:', error);
        } finally {
            setIsLoading(false);
        }
    }, [stationType, stationId]);

    return {
        history,
        isLoading,
        fetchHistory,
        todayCount,
    };
}
