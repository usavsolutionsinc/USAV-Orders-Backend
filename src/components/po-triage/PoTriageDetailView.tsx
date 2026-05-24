'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mail } from '@/components/Icons';
import { PoTriageChecklist } from './PoTriageChecklist';
import type { TriageDetail } from './types';

interface PoTriageDetailViewProps {
  /** Worklist row id from the URL (?msg=). Null = empty-state. */
  id: string | null;
}

export function PoTriageDetailView({ id }: PoTriageDetailViewProps) {
  const router = useRouter();
  const [detail, setDetail] = useState<TriageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (rowId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/po-gmail/triage/${rowId}/detail`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      setDetail((await res.json()) as TriageDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    void load(id);
  }, [id, load]);

  if (!id) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="max-w-md text-center">
          <Mail className="mx-auto h-8 w-8 text-gray-300" />
          <h1 className="mt-3 text-base font-semibold text-gray-700">PO Mailbox</h1>
          <p className="mt-1 text-[12.5px] text-gray-500">
            Scan, reconcile, and triage purchase-order emails from the sidebar →
          </p>
          <p className="mt-2 text-[11.5px] text-gray-400">
            Pick an email from one of the piles to open the checklist here. Drag rows
            between piles to triage; the Zoho mirror auto-closes them when uploads land.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !detail) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="max-w-md rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <PoTriageChecklist
      detail={detail}
      onRowUpdated={(row) => {
        setDetail((prev) => (prev ? { ...prev, row } : prev));
      }}
      onClose={() => router.push('/receiving/unfound')}
    />
  );
}
