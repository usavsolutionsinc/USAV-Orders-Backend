'use client';

import { useEffect, useMemo, useState } from 'react';
import ReceivingPanel from './ReceivingPanel';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';

interface ReceivingLogRow {
  timestamp?: string;
}

interface ReceivingSidebarProps {
  embedded?: boolean;
  hideSectionHeader?: boolean;
}

export default function ReceivingSidebar({ embedded = false, hideSectionHeader = false }: ReceivingSidebarProps) {
  const [history, setHistory] = useState<ReceivingLogRow[]>([]);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/receiving-logs?limit=500');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setHistory(data);
      }
    } catch (_error) {
      // no-op
    }
  };

  useEffect(() => {
    fetchHistory();

    const handleRefresh = () => {
      fetchHistory();
    };

    window.addEventListener('usav-refresh-data', handleRefresh as any);
    return () => {
      window.removeEventListener('usav-refresh-data', handleRefresh as any);
    };
  }, []);

  const todayCount = useMemo(() => {
    if (history.length === 0) return 0;
    const today = getCurrentPSTDateKey();
    return history.filter((item) => toPSTDateKey(item.timestamp || '') === today).length;
  }, [history]);

  const averageTime = useMemo(() => {
    if (history.length < 2) return '0m';

    const today = getCurrentPSTDateKey();
    const todayLogs = history
      .filter((item) => toPSTDateKey(item.timestamp || '') === today)
      .sort((a, b) => new Date(a.timestamp || '').getTime() - new Date(b.timestamp || '').getTime());

    if (todayLogs.length < 2) return '0m';

    const timeDiffs: number[] = [];
    for (let index = 1; index < todayLogs.length; index += 1) {
      const prevTime = new Date(todayLogs[index - 1].timestamp || '').getTime();
      const currentTime = new Date(todayLogs[index].timestamp || '').getTime();
      const diffMinutes = (currentTime - prevTime) / (1000 * 60);
      if (diffMinutes > 0 && diffMinutes <= 60) {
        timeDiffs.push(diffMinutes);
      }
    }

    if (timeDiffs.length === 0) return '0m';
    const avgMinutes = timeDiffs.reduce((sum, value) => sum + value, 0) / timeDiffs.length;
    return `${avgMinutes.toFixed(1)}m`;
  }, [history]);

  return (
    <div className={`h-full overflow-hidden ${embedded ? '' : 'w-[320px] flex-shrink-0 border-r border-gray-200'}`}>
      <ReceivingPanel
        embedded
        hideSectionHeader={hideSectionHeader}
        onEntryAdded={fetchHistory}
        todayCount={todayCount}
        averageTime={averageTime}
      />
    </div>
  );
}
