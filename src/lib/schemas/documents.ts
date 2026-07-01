import { z } from 'zod';

const outboundDocumentType = z.enum(['shipping_label', 'packing_slip']);

/** POST /api/orders/[id]/documents — manual attach (upload fallback, D4). */
export const OutboundDocumentAttachBody = z
  .object({
    documentType: outboundDocumentType,
    url: z.string().trim().min(1, 'url is required'),
    platform: z.string().trim().nullable().optional(),
    source: z.string().trim().optional(),
    carrier: z.string().trim().nullable().optional(),
    tracking: z.string().trim().nullable().optional(),
    mimeType: z.string().trim().nullable().optional(),
    filename: z.string().trim().nullable().optional(),
  })
  .strict();

/** POST /api/orders/[id]/documents/fetch — marketplace fetch trigger (Phase 4 stub). */
export const OutboundDocumentFetchBody = z
  .object({
    types: z.array(outboundDocumentType).min(1, 'At least one document type is required'),
  })
  .strict();
