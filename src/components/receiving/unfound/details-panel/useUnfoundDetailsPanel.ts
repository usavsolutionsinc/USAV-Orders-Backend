'use client';

import { useCallback, useMemo, useState } from 'react';
import { useResourceMutation } from '@/hooks';
import { toast } from '@/lib/toast';
import { copyToClipboard } from '@/utils/_dom';
import { formatDateTimePST } from '@/utils/date';
import { getLast4 } from '@/components/ui/CopyChip';
import { useUnfoundTriageDetail } from '../useUnfoundTriageDetail';
import {
  KIND_META,
  splitPoContext,
  type DetailsTab,
  type UnfoundQueueDetailsPanelProps,
} from './unfound-details-helpers';

/**
 * Owns the unfound-details panel's interactive concerns: the email-detail query
 * (via {@link useUnfoundTriageDetail}), push-to-Zendesk + two-step delete
 * mutations, copy-all, active tab, and the derived identity / external-link /
 * subject + PO context. Returns a controller bag the thin panel shell renders.
 */
export function useUnfoundDetailsPanel({
  row,
  onClose,
  onDeleted,
  onPushedToZendesk,
}: UnfoundQueueDetailsPanelProps) {
  const meta = KIND_META[row.kind];
  const Icon = meta.Icon;
  const { prefix: subjectPrefix, poNumbers } = useMemo(
    () => splitPoContext(row.context),
    [row.context],
  );

  // Email-specific detail (body + Zoho compare + the full triage row). Owned by
  // the query hook — fetched only for kind === 'email_po'.
  const { isEmailPo, detail: detailQuery, patchTriage, updateTriageRow } =
    useUnfoundTriageDetail(row);
  const detail = detailQuery.data ?? null;

  const [activeTab, setActiveTab] = useState<DetailsTab>('overview');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const canHardDelete = row.kind !== 'unmatched_receiving';

  const pushMut = useResourceMutation<
    { ticketNumber: string; ticketUrl?: string | null },
    { subject: string; description: string } | undefined
  >(async (overrides) => {
    const res = await fetch(
      `/api/receiving/unfound-queue/${row.kind}/${encodeURIComponent(row.source_id)}/push-to-zendesk`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: overrides ? JSON.stringify(overrides) : undefined,
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      ticketNumber?: string;
      ticketUrl?: string | null;
      error?: string;
    };
    if (!res.ok || !body.success || !body.ticketNumber) {
      throw new Error(body.error ?? `push failed (${res.status})`);
    }
    return { ticketNumber: body.ticketNumber, ticketUrl: body.ticketUrl };
  });
  const pushing = pushMut.isPending;

  const handlePushToZendesk = useCallback(async (overrides?: { subject: string; description: string }) => {
    if (pushMut.isPending || row.zendesk_ticket_id) return;
    const toastId = toast.loading('Pushing to Zendesk…');
    try {
      const body = await pushMut.mutateAsync(overrides);
      toast.success(`Zendesk ticket ${body.ticketNumber} created`, {
        id: toastId,
        action: body.ticketUrl
          ? { label: 'Open', onClick: () => window.open(body.ticketUrl!, '_blank', 'noopener') }
          : undefined,
      });
      onPushedToZendesk?.(row, body.ticketNumber);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Push failed', { id: toastId });
    }
  }, [pushMut, row, onPushedToZendesk]);

  const deleteMut = useResourceMutation(async () => {
    const res = await fetch(
      `/api/receiving/unfound-queue/${row.kind}/${encodeURIComponent(row.source_id)}`,
      { method: 'DELETE' },
    );
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!res.ok || !body.success) throw new Error(body.error ?? `delete failed (${res.status})`);
  });
  const deleting = deleteMut.isPending;

  const handleDelete = useCallback(async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    if (deleteMut.isPending) return;
    const toastId = toast.loading('Deleting row…');
    try {
      await deleteMut.mutateAsync();
      toast.success('Row deleted', { id: toastId });
      onDeleted(row);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed', { id: toastId });
      setConfirmingDelete(false);
    }
  }, [confirmingDelete, deleteMut, row, onDeleted, onClose]);

  const handleCopyAll = useCallback(async () => {
    const lines = [
      `Kind: ${meta.label}`,
      `Source id: ${row.source_id}`,
      poNumbers.length > 0 ? `PO #s: ${poNumbers.join(', ')}` : null,
      subjectPrefix ? `Subject: ${subjectPrefix}` : null,
      row.product_title ? `Product: ${row.product_title}` : null,
      row.zendesk_ticket_id ? `Zendesk: ${row.zendesk_ticket_id}` : null,
      row.usa_team_note ? `USA: ${row.usa_team_note}` : null,
      row.vietnam_team_note ? `VN: ${row.vietnam_team_note}` : null,
      `Created: ${formatDateTimePST(row.created_at)}`,
    ]
      .filter(Boolean)
      .join('\n');
    const ok = await copyToClipboard(lines);
    if (ok) toast.success('Copied details');
    else toast.error('Could not copy');
  }, [
    meta.label,
    poNumbers,
    row.created_at,
    row.product_title,
    row.source_id,
    row.usa_team_note,
    row.vietnam_team_note,
    row.zendesk_ticket_id,
    subjectPrefix,
  ]);

  const externalUrl = useMemo<string | null>(() => {
    if (row.kind === 'email_po')
      return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(row.source_id)}`;
    if (row.kind === 'unmatched_receiving')
      return `/receiving?id=${encodeURIComponent(row.source_id)}`;
    return null;
  }, [row.kind, row.source_id]);

  const externalLabel =
    row.kind === 'email_po'
      ? 'Open in Gmail'
      : row.kind === 'unmatched_receiving'
        ? 'Open in workspace'
        : null;

  const identityLabel =
    row.kind === 'email_po' && poNumbers.length > 0
      ? `PO ${poNumbers.length === 1 ? poNumbers[0] : `${poNumbers[0]} +${poNumbers.length - 1}`}`
      : row.kind === 'unmatched_receiving' && row.context
        ? `Tracking ${getLast4(row.context)}`
        : row.kind === 'station_exception' && row.context
          ? `Tracking ${getLast4(row.context.split(' · ')[0])}`
          : row.product_title || row.source_id;

  return {
    meta,
    Icon,
    subjectPrefix,
    poNumbers,
    isEmailPo,
    detailQuery,
    detail,
    patchTriage,
    updateTriageRow,
    activeTab,
    setActiveTab,
    confirmingDelete,
    canHardDelete,
    pushing,
    handlePushToZendesk,
    deleting,
    handleDelete,
    handleCopyAll,
    externalUrl,
    externalLabel,
    identityLabel,
  };
}

export type UnfoundDetailsPanelController = ReturnType<typeof useUnfoundDetailsPanel>;
