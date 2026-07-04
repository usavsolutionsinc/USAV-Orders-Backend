'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, Loader2, ExternalLink, RefreshCw } from '@/components/Icons';
import { buildNasLabelUrl, putNasPhoto, deleteNasPhoto } from '@/lib/nas-photos';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { BuyLabelSection } from '@/components/outbound/labels/BuyLabelSection';
import type {
  FetchOutboundDocumentsResponse,
  OutboundDocument,
  OutboundDocumentsResponse,
  OutboundDocumentType,
} from '@/lib/documents/types';

function displayName(doc: OutboundDocument): string {
  if (doc.data.filename) return doc.data.filename;
  try {
    return decodeURIComponent(doc.data.url.split('/').pop() || 'document');
  } catch {
    return 'document';
  }
}

interface DocumentTypeGroupProps {
  title: string;
  documentType: OutboundDocumentType;
  documents: OutboundDocument[];
  orderId: number;
  orderRef: string;
  nasBaseUrl: string;
  nasFolder: string;
  readOnly: boolean;
  isLoading: boolean;
  onChange: () => void;
}

function DocumentTypeGroup({
  title,
  documentType,
  documents,
  orderId,
  orderRef,
  nasBaseUrl,
  nasFolder,
  readOnly,
  isLoading,
  onChange,
}: DocumentTypeGroupProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const kindPrefix = documentType === 'shipping_label' ? 'LABEL' : 'SLIP';

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!nasBaseUrl) throw new Error('NAS is not configured for this org.');
      const url = buildNasLabelUrl({
        baseUrl: nasBaseUrl,
        folder: nasFolder,
        orderRef: orderRef || `order-${orderId}`,
        filename: file.name,
        kindPrefix,
      });
      const put = await putNasPhoto(url, file);
      if (!put.ok) throw new Error(put.error || 'NAS upload failed');
      const res = await fetch(`/api/orders/${orderId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType, url: put.url, filename: file.name }),
      });
      if (res.status === 409) return; // already attached — idempotent
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to record document');
      }
    },
    onSuccess: () => {
      setError(null);
      onChange();
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (doc: OutboundDocument) => {
      await deleteNasPhoto(doc.data.url).catch(() => undefined);
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete document');
    },
    onSuccess: () => onChange(),
    onError: (e: Error) => setError(e.message),
  });

  const fetchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/documents/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ types: [documentType] }),
      });
      if (!res.ok) throw new Error('Failed to fetch documents');
      return (await res.json()) as FetchOutboundDocumentsResponse;
    },
    onSuccess: (result) => {
      const failure = result.failed.find((f) => f.type === documentType);
      setFetchError(failure?.error ?? null);
      if (result.fetched.length > 0) onChange();
    },
    onError: (e: Error) => setFetchError(e.message),
  });

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) uploadMutation.mutate(file);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-eyebrow font-black uppercase tracking-wider text-text-soft">{title}</h3>
        {!readOnly ? (
          <HoverTooltip label="Fetch from the marketplace" focusable={false}>
            {/* ds-raw-button */}
            <button
              type="button"
              onClick={() => fetchMutation.mutate()}
              disabled={fetchMutation.isPending}
              className="-my-0.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-widest text-text-faint hover:bg-surface-hover hover:text-blue-600 disabled:opacity-40"
            >
              {fetchMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Fetch
            </button>
          </HoverTooltip>
        ) : null}
      </div>

      {!readOnly ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-50' : 'border-border-soft hover:bg-surface-hover'
          }`}
        >
          {uploadMutation.isPending ? (
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          ) : (
            <FileText className="h-5 w-5 text-text-faint" />
          )}
          <span className="text-caption font-semibold text-text-muted">
            {uploadMutation.isPending ? 'Uploading to NAS…' : 'Drop PDF / PNG, or click to choose'}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,image/*,application/pdf"
            className="hidden"
            onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
          />
        </div>
      ) : null}

      {error ? <p className="mt-2 text-eyebrow font-bold text-red-600">{error}</p> : null}
      {fetchError ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-dashed border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-caption text-amber-700">{fetchError}</p>
          <button
            type="button"
            onClick={() => fetchMutation.mutate()}
            className="shrink-0 text-eyebrow font-bold uppercase tracking-widest text-amber-700 hover:underline"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="mt-3 space-y-1.5">
        {isLoading ? (
          <p className="text-caption text-text-faint">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="text-caption text-text-faint">
            {readOnly ? `No ${title.toLowerCase()} attached.` : `No ${title.toLowerCase()} attached yet.`}
          </p>
        ) : (
          documents.map((doc) => {
            const shipmentLink = doc.links.find((l) => l.entityType === 'SHIPMENT');
            return (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border-soft px-3 py-2"
              >
                <a
                  href={`/api/documents/${doc.id}/content`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-2 text-caption font-semibold text-text-muted hover:text-blue-600"
                >
                  <FileText className="h-4 w-4 shrink-0 text-text-faint" />
                  <span className="truncate">{displayName(doc)}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-text-faint" />
                </a>
                <div className="flex shrink-0 items-center gap-2">
                  {shipmentLink ? (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-blue-700 ring-1 ring-inset ring-blue-200">
                      Box
                    </span>
                  ) : null}
                  {!readOnly ? (
                    <HoverTooltip label={`Delete ${title.toLowerCase()}`} asChild>
                      <IconButton
                        type="button"
                        onClick={() => deleteMutation.mutate(doc)}
                        disabled={deleteMutation.isPending}
                        className="rounded p-1 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        ariaLabel={`Delete ${title.toLowerCase()}`}
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                      />
                    </HoverTooltip>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export interface OrderDocumentsSectionProps {
  orderId: number;
  orderRef: string;
  /** Dashboard/fulfillment/staged contexts show a read-only tray — no drop
   * zone, fetch button, or delete (docs/outbound-documents-plan.md §9.2). */
  readOnly?: boolean;
}

/**
 * Outbound documents (shipping label + packing slip) for the order details
 * panel (docs/outbound-documents-plan.md §9.1). Supersedes `OrderLabelsSection`
 * — same NAS drop-zone UX, extended to slips and to server-side marketplace
 * fetch (Phase 4 stub today; the button + retry-on-error affordance is wired
 * ahead of the real adapters).
 */
export function OrderDocumentsSection({ orderId, orderRef, readOnly = false }: OrderDocumentsSectionProps) {
  const queryClient = useQueryClient();
  const queryKey = ['order-documents', orderId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/documents`);
      if (!res.ok) throw new Error('Failed to fetch documents');
      return (await res.json()) as OutboundDocumentsResponse;
    },
    enabled: Number.isFinite(orderId) && orderId > 0,
    staleTime: 30_000,
  });

  const documents = data?.documents ?? [];
  const labels = documents.filter((d) => d.documentType === 'shipping_label');
  const slips = documents.filter((d) => d.documentType === 'packing_slip');

  const onChange = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ['order-timeline', orderId] });
    queryClient.invalidateQueries({ queryKey: ['photo-library'] });
  };

  return (
    <section className="mx-8 space-y-5">
      <div className="flex items-center justify-end">
        <Link
          href={`/ops/photos?sourceScope=outbound&poRef=${encodeURIComponent(orderRef)}`}
          className="text-caption font-semibold text-blue-600 hover:text-blue-800"
        >
          Open in media library
        </Link>
      </div>
      {!readOnly ? (
        <div className="border-b border-border-hairline pb-4">
          <BuyLabelSection orderId={orderId} orderRef={orderRef} onChange={onChange} />
        </div>
      ) : null}
      <DocumentTypeGroup
        title="Shipping Label"
        documentType="shipping_label"
        documents={labels}
        orderId={orderId}
        orderRef={orderRef}
        nasBaseUrl={data?.nasBaseUrl || ''}
        nasFolder={data?.nasFolder || ''}
        readOnly={readOnly}
        isLoading={isLoading}
        onChange={onChange}
      />
      <DocumentTypeGroup
        title="Packing Slip"
        documentType="packing_slip"
        documents={slips}
        orderId={orderId}
        orderRef={orderRef}
        nasBaseUrl={data?.nasBaseUrl || ''}
        nasFolder={data?.nasFolder || ''}
        readOnly={readOnly}
        isLoading={isLoading}
        onChange={onChange}
      />
    </section>
  );
}
