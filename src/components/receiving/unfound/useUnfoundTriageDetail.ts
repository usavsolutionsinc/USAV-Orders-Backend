'use client';

/**
 * Server state for the email_po detail of an unfound-queue row.
 *
 * Replaces the panel's hand-rolled detail/detailLoading/detailError useState
 * trio + a race-guarded fetch effect with one `useQuery` (enabled only for
 * email_po rows). `patchTriage` and the extract flow merge their returned row
 * straight into the query cache via `updateTriageRow` — no refetch needed.
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { jsonOrThrow, useResourceMutation } from '@/hooks';
import { qk } from '@/queries/keys';
import { toast } from '@/lib/toast';
import type { TriageDetail, TriageRow } from '@/components/po-triage/types';
import type { UnfoundQueueDetailsRow } from './UnfoundQueueDetailsPanel';

export function useUnfoundTriageDetail(row: UnfoundQueueDetailsRow) {
  const queryClient = useQueryClient();
  const isEmailPo = row.kind === 'email_po';
  const sourceId = row.source_id;

  const detail = useQuery<TriageDetail>({
    queryKey: qk.triage.detail(sourceId),
    enabled: isEmailPo,
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/po-gmail/triage/${encodeURIComponent(sourceId)}/detail`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as TriageDetail;
    },
  });

  // Merge an updated triage row into the cached detail envelope.
  const updateTriageRow = useCallback(
    (next: TriageRow) => {
      queryClient.setQueryData<TriageDetail>(
        qk.triage.detail(sourceId),
        (prev) => (prev ? { ...prev, row: next } : prev),
      );
    },
    [queryClient, sourceId],
  );

  const patchTriageMut = useResourceMutation(
    (body: Record<string, unknown>) =>
      fetch(`/api/admin/po-gmail/triage/${encodeURIComponent(sourceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => jsonOrThrow<{ row: TriageRow }>(r)),
    { onSuccess: (data) => updateTriageRow(data.row) },
  );

  // Keep the prop contract the cards expect: (body) => Promise<void>, toast on error.
  const patchTriage = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        await patchTriageMut.mutateAsync(body);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Update failed');
      }
    },
    [patchTriageMut],
  );

  return { isEmailPo, detail, updateTriageRow, patchTriage };
}
