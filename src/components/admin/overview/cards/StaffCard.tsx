'use client';

import { useEffect, useState } from 'react';
import { User } from '@/components/Icons';
import { StatusCard } from '../StatusCard';

interface StaffRow {
  id: number;
  active: boolean;
  role?: string;
}

export function StaffCard() {
  const [count, setCount] = useState<{ active: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/staff?active=false', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Staff ${r.status}`))))
      .then((rows: StaffRow[] | { rows?: StaffRow[] }) => {
        const list = Array.isArray(rows) ? rows : rows.rows ?? [];
        setCount({
          active: list.filter((s) => s.active !== false).length,
          total: list.length,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <StatusCard
      icon={User}
      title="Staff"
      loading={loading}
      error={error}
      primary={count?.active}
      secondary={count ? `${count.active} active · ${count.total} total` : undefined}
      tertiary="Manage roles, schedule, access"
      href="/admin?section=staff"
    />
  );
}
