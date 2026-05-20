'use client';

import { useEffect, useState } from 'react';
import { Box } from '@/components/Icons';
import { StatusCard } from '../StatusCard';

interface FeatureRow {
  id: number;
  status: 'backlog' | 'in_progress' | 'done';
  type: 'feature' | 'bug_fix';
}

export function FeaturesCard() {
  const [counts, setCounts] = useState<{ inProgress: number; backlog: number; bugs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/features', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Features ${r.status}`))))
      .then((data: { features?: FeatureRow[] } | FeatureRow[]) => {
        const list = Array.isArray(data) ? data : data.features ?? [];
        setCounts({
          inProgress: list.filter((f) => f.status === 'in_progress').length,
          backlog: list.filter((f) => f.status === 'backlog').length,
          bugs: list.filter((f) => f.type === 'bug_fix' && f.status !== 'done').length,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <StatusCard
      icon={Box}
      title="Features & bugs"
      loading={loading}
      error={error}
      primary={counts ? counts.inProgress + counts.backlog : undefined}
      secondary={counts ? `${counts.inProgress} in progress · ${counts.backlog} backlog` : undefined}
      tertiary={counts ? (counts.bugs > 0 ? `${counts.bugs} open bug${counts.bugs === 1 ? '' : 's'}` : 'No open bugs') : undefined}
      tone={counts && counts.bugs > 0 ? 'warn' : 'default'}
      href="/admin?section=features"
    />
  );
}
