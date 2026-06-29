'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, Loader2, ExternalLink } from '@/components/Icons';
import { buildNasLabelUrl, putNasPhoto, deleteNasPhoto } from '@/lib/nas-photos';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';

interface LabelRow {
  id: number;
  orderId: number;
  url: string;
  carrier: string | null;
  tracking: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

interface LabelsResponse {
  labels: LabelRow[];
  nasBaseUrl: string;
  nasFolder: string;
}

/**
 * Shipping-label section for the order details panel: list attached labels +
 * drop/pick a label file (PDF/PNG) that's PUT browser-direct to the NAS over
 * WebDAV, then recorded via /api/order-labels. Full CRUD — upload, list, delete.
 * Dropping the first label records the `orders.label.printed` event (timeline).
 */
export function OrderLabelsSection({ orderId, orderRef }: { orderId: number; orderRef: string }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const queryKey = ['order-labels', orderId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/order-labels?orderId=${orderId}`);
      if (!res.ok) throw new Error('Failed to fetch labels');
      return (await res.json()) as LabelsResponse;
    },
    enabled: Number.isFinite(orderId) && orderId > 0,
    staleTime: 30_000,
  });

  const labels = data?.labels ?? [];

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const baseUrl = data?.nasBaseUrl || '';
      if (!baseUrl) throw new Error('NAS is not configured for this org.');
      const url = buildNasLabelUrl({
        baseUrl,
        folder: data?.nasFolder || '',
        orderRef: orderRef || `order-${orderId}`,
        filename: file.name,
      });
      const put = await putNasPhoto(url, file);
      if (!put.ok) throw new Error(put.error || 'NAS upload failed');
      const res = await fetch('/api/order-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, labelUrl: put.url }),
      });
      if (res.status === 409) return; // already attached — idempotent
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to record label');
      }
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['order-timeline', orderId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (label: LabelRow) => {
      // Best-effort NAS file delete (browser-direct), then unlink the DB row.
      await deleteNasPhoto(label.url).catch(() => undefined);
      const res = await fetch(`/api/order-labels?id=${label.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete label');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => setError(e.message),
  });

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) uploadMutation.mutate(file);
  };

  return (
    <section className="mx-8 mt-2 border-t border-gray-100 pt-4 pb-8">
      <h3 className="mb-2 text-eyebrow font-black uppercase tracking-wider text-gray-500">Shipping Label</h3>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
          dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
        }`}
      >
        {uploadMutation.isPending ? (
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        ) : (
          <FileText className="h-5 w-5 text-gray-400" />
        )}
        <span className="text-caption font-semibold text-gray-600">
          {uploadMutation.isPending ? 'Uploading to NAS…' : 'Drop label PDF / PNG, or click to choose'}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,image/*,application/pdf"
          className="hidden"
          onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {error ? <p className="mt-2 text-eyebrow font-bold text-red-600">{error}</p> : null}

      {/* Existing labels */}
      <div className="mt-3 space-y-1.5">
        {isLoading ? (
          <p className="text-caption text-gray-400">Loading…</p>
        ) : labels.length === 0 ? (
          <p className="text-caption text-gray-400">No labels attached yet.</p>
        ) : (
          labels.map((label) => (
            <div
              key={label.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2"
            >
              <a
                href={label.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-2 text-caption font-semibold text-gray-700 hover:text-blue-600"
              >
                <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="truncate">{decodeURIComponent(label.url.split('/').pop() || 'label')}</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-gray-300" />
              </a>
              <HoverTooltip label="Delete label" asChild>
                <IconButton
                  type="button"
                  onClick={() => deleteMutation.mutate(label)}
                  disabled={deleteMutation.isPending}
                  className="shrink-0 rounded p-1 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  ariaLabel="Delete label"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                />
              </HoverTooltip>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
