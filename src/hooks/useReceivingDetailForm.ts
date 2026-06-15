'use client';

import { useEffect, useState } from 'react';
import type { ReceivingDetailsLog } from '@/components/station/ReceivingDetailsStack';

type SaveState = 'idle' | 'saved' | 'error';

export interface ReceivingDetailFormActions {
  tracking: string;
  setTracking: (v: string) => void;
  isSaving: boolean;
  isDeleting: boolean;
  saveState: SaveState;
  /** Persists tracking when it differs from `log.tracking`. No-op when unchanged. */
  saveTrackingIfDirty: () => Promise<boolean>;
  handleDelete: () => Promise<void>;
}

interface UseReceivingDetailFormOptions {
  log: ReceivingDetailsLog;
  onUpdated: () => void;
  onDeleted: (id: string) => void;
}

export function useReceivingDetailForm({
  log,
  onUpdated,
  onDeleted,
}: UseReceivingDetailFormOptions): ReceivingDetailFormActions {
  const [tracking, setTracking] = useState(log.tracking || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    setTracking(log.tracking || '');
    setSaveState('idle');
  }, [log.id, log.tracking]);

  const saveTrackingIfDirty = async (): Promise<boolean> => {
    const trimmed = tracking.trim();
    const original = String(log.tracking || '').trim();
    if (!trimmed || trimmed === original) return true;

    setIsSaving(true);
    setSaveState('idle');
    try {
      const res = await fetch('/api/receiving-logs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: Number(log.id),
          tracking: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to update tracking');
      setSaveState('saved');
      onUpdated();
      return true;
    } catch (error) {
      console.error('Failed to update receiving tracking:', error);
      setSaveState('error');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/receiving-logs?id=${encodeURIComponent(log.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 404) throw new Error(data?.error || 'Failed to delete receiving log');
      window.dispatchEvent(new CustomEvent('receiving-entry-deleted', { detail: log.id }));
      onDeleted(log.id);
    } catch (error) {
      console.error('Failed to delete receiving log:', error);
      window.alert('Failed to delete receiving log.');
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    tracking,
    setTracking,
    isSaving,
    isDeleting,
    saveState,
    saveTrackingIfDirty,
    handleDelete,
  };
}
