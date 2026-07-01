'use client';

import { useQuery } from '@tanstack/react-query';
import { outboundOrderByIdQuery } from '@/lib/queries/outbound-queries';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { FileText, Printer } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { sourcePlatformLabel } from '@/lib/source-platform';
import { printOutboundDocuments, type PrintableOutboundDocument } from '@/lib/print/printOutboundDocuments';
import type { OutboundDocument, OutboundDocumentsResponse } from '@/lib/documents/types';

/** application/pdf (or unknown-but-`.pdf`-named) → <embed>/<iframe>; else <img>. */
function isPdfDocument(doc: OutboundDocument): boolean {
  const mime = doc.data.mimeType?.toLowerCase() ?? '';
  if (mime) return mime.includes('pdf');
  return /\.pdf(\?|$)/i.test(doc.data.url);
}

interface DocumentPreviewPaneProps {
  title: string;
  doc: OutboundDocument | undefined;
}

function DocumentPreviewPane({ title, doc }: DocumentPreviewPaneProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-gray-200 bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <h3 className="text-eyebrow font-black uppercase tracking-widest text-gray-500">{title}</h3>
        {doc?.data.platform ? (
          <span className="text-eyebrow font-bold uppercase tracking-widest text-gray-400">
            {sourcePlatformLabel(doc.data.platform)}
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-50 p-3">
        {doc ? (
          isPdfDocument(doc) ? (
            <iframe
              src={`/api/documents/${doc.id}/content`}
              title={title}
              className="h-full w-full rounded-lg border border-gray-200 bg-white"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary externally-stored document, not a Next-optimizable local asset
            <img
              src={`/api/documents/${doc.id}/content`}
              alt={title}
              className="max-h-full max-w-full rounded-lg border border-gray-200 bg-white object-contain"
            />
          )
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <FileText className="h-8 w-8 text-gray-300" />
            <p className="text-caption font-semibold text-gray-500">No {title.toLowerCase()} attached</p>
            <p className="text-eyebrow text-gray-400">Attach one from the Documents tab</p>
          </div>
        )}
      </div>
    </div>
  );
}

export interface OutboundDocumentsPrintViewProps {
  orderId: number;
}

/**
 * The Outbound · Labels main pane's document view (docs/outbound-documents-plan.md
 * Phase 2): full-size shipping-label + packing-slip previews with a single
 * "Print" action that combines whichever documents exist into one job
 * (src/lib/print/printOutboundDocuments.ts). Crossfades in over the queue list
 * on row selection (see OutboundWorkspace) — attach/fetch/delete stay on the
 * side panel's Documents tab; this pane is view + print only.
 */
export function OutboundDocumentsPrintView({ orderId }: OutboundDocumentsPrintViewProps) {
  const { data: order } = useQuery(outboundOrderByIdQuery(orderId));
  const { data, isLoading } = useQuery({
    queryKey: ['order-documents', orderId],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/documents`);
      if (!res.ok) throw new Error('Failed to fetch documents');
      return (await res.json()) as OutboundDocumentsResponse;
    },
    enabled: Number.isFinite(orderId) && orderId > 0,
    staleTime: 30_000,
  });

  const documents = data?.documents ?? [];
  const label = documents.find((d) => d.documentType === 'shipping_label');
  const slip = documents.find((d) => d.documentType === 'packing_slip');

  const printableDocs: PrintableOutboundDocument[] = [label, slip]
    .filter((d): d is OutboundDocument => Boolean(d))
    .map((d) => ({ id: d.id, isPdf: isPdfDocument(d) }));

  if (isLoading) {
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center bg-white">
        <LoadingSpinner size="lg" className="text-violet-600" />
      </div>
    );
  }

  return (
    // pr matches ShippedDetailsPanel's fixed w-[420px] overlay (always open
    // alongside this pane) so the header/print button never renders under it.
    <div className="flex h-full min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-white p-6 pr-[456px]">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <p className="text-eyebrow font-bold uppercase tracking-widest text-gray-400">Order #</p>
          <p className="text-lg font-black text-gray-900">{order?.order_id ?? orderId}</p>
        </div>
        <Button
          type="button"
          variant="primary"
          icon={<Printer className="h-4 w-4" />}
          disabled={printableDocs.length === 0}
          onClick={() => printOutboundDocuments(printableDocs)}
        >
          {printableDocs.length === 2 ? 'Print both' : 'Print'}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <DocumentPreviewPane title="Shipping Label" doc={label} />
        <DocumentPreviewPane title="Packing Slip" doc={slip} />
      </div>
    </div>
  );
}
