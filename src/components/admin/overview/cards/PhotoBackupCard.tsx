'use client';

import { useEffect, useState } from 'react';
import { Camera } from '@/components/Icons';
import { StatusCard } from '../StatusCard';

interface BackupStatus {
  connected: boolean;
  photosUploaded: number;
  photosPending: number;
  needsReconnect: boolean;
}

export function PhotoBackupCard() {
  const [data, setData] = useState<BackupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/google-photos/status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Status ${r.status}`))))
      .then((d: BackupStatus) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (data?.needsReconnect) {
    return (
      <StatusCard
        icon={Camera}
        title="Photo backup"
        primary="Reconnect"
        secondary="Google Photos refresh token expired"
        tone="warn"
        href="/admin?section=photo_backup"
        linkLabel="Fix →"
      />
    );
  }

  return (
    <StatusCard
      icon={Camera}
      title="Photo backup"
      loading={loading}
      error={error}
      primary={data ? data.photosUploaded : undefined}
      secondary={data ? `${data.photosPending} pending` : undefined}
      tertiary={data?.connected ? 'Connected to Google Photos' : 'Not connected'}
      tone={data && data.photosPending > 0 ? 'warn' : 'good'}
      href="/admin?section=photo_backup"
    />
  );
}
