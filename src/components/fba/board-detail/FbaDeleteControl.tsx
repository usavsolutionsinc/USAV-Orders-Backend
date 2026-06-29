'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/design-system/primitives';
import { deleteFbaItem } from '@/lib/fba/patch';
import type { PlanEntry } from './board-detail-shared';

/* ── Delete control (armed pattern matching DeleteOrderControl) ────── */

export function FbaDeleteControl({ entries, onDeleted }: { entries: PlanEntry[]; onDeleted: () => void }) {
  const [isArmed, setIsArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const handleClick = async () => {
    if (!isArmed) {
      setIsArmed(true);
      setError(null);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setIsArmed(false), 3000);
      return;
    }
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    setIsArmed(false);
    setDeleting(true);
    setError(null);
    try {
      const errors: string[] = [];
      for (const entry of entries) {
        const result = await deleteFbaItem(entry.shipment_id, entry.item_id);
        if (!result.ok) errors.push(`${entry.shipment_ref || entry.shipment_id}: ${result.error}`);
      }
      if (errors.length > 0) {
        setError(errors.join('; '));
      } else {
        window.dispatchEvent(new Event('usav-refresh-data'));
        onDeleted();
      }
    } catch {
      setError('Failed to delete. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-micro font-semibold text-red-700">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="danger"
        size="lg"
        onClick={() => void handleClick()}
        disabled={deleting}
        className="w-full"
      >
        {deleting ? 'Deleting...' : isArmed ? 'Click Again To Confirm' : 'Delete Permanently'}
      </Button>
    </div>
  );
}
