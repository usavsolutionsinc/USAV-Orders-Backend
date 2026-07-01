# Outbound Documents × Media Library — Integration Plan

**Status:** Phase A + B + C (core) shipped (2026-07-01); Phase D polish pending  
**Created:** 2026-07-01  
**Depends on:** [outbound-documents-plan.md](./outbound-documents-plan.md), [media-library-modernization-plan.md](./media-library-modernization-plan.md)

## Vision

Packing slips and shipping labels are **documents** (PDF/PNG), stored in **GCS** under `{orgId}/outbound/…`, linked to orders and shipments via `document_entity_links`, and browsable from the media library under a new **Outbound** sidebar scope with **document-type sub-filters**.

Pack-station **photos** (`PACKER_LOG` → `packing` scope) remain separate.

## Architecture (locked)

| Decision | Choice |
|----------|--------|
| Storage table | `documents` only — never `photos` |
| Taxonomy | `document_type` enum — not `photo_image_types` |
| Bytes | GCS primary (`PHOTOS_GCS_BUCKET`, `{orgId}/outbound/…`); NAS fallback for manual station upload |
| Library scope | One built-in row **Outbound** + `documentType` chips (All · Labels · Slips) |
| Library union | `GET /api/photos/library?sourceScope=outbound` → document query (not photo query) |
| Item identity | `kind: 'document'` + negative `id` in library payload to avoid collision with photo ids |

## Phases

### Phase A — GCS document storage (~2–3 days)

| Task | File(s) |
|------|---------|
| Extend `OutboundDocumentData` with `bucket`, `objectKey`, `storageProvider` | `src/lib/documents/types.ts` |
| Path builder (exists) | `src/lib/documents/storage-paths.ts` |
| GCS upload helper | `src/lib/documents/storage/upload.ts` |
| `documentContentUrl(id)` | `src/lib/documents/display-url.ts` |
| Content route: GCS signed URL + stream | `src/app/api/documents/[id]/content/route.ts` |
| `storeOutboundDocumentBytes` domain fn | `src/lib/documents/store-bytes.ts` |
| Allow `/api/documents/…` in attach URL validation | `outbound-documents.ts` (already same-origin) |

### Phase B — Media library outbound scope (~3–4 days)

| Task | File(s) |
|------|---------|
| `outbound` in `PhotoLibrarySourceScope` + `documentType` filter | `library-filter-state.ts` |
| Built-in sidebar row | `image-types.ts`, `PhotoStationFolders.tsx` |
| Document-type sub-chips | `OutboundDocumentTypeFilters.tsx` (new) |
| Library query | `src/lib/documents/queries/library.ts` |
| API branch | `src/app/api/photos/library/route.ts` |
| Hook: pass `sourceScope=outbound` | `usePhotoLibrary.ts` |
| `LibraryDocument` shape + grid tile | `photo-library-types.ts`, `PhotoCard.tsx` |
| Deep link from order panel | `OrderDocumentsSection.tsx` |

### Phase C — Marketplace fetch (~1–2 weeks, later)

Wire `fetchOutboundDocuments` → adapters → `storeOutboundDocumentBytes`. Feature flag `OUTBOUND_MARKETPLACE_FETCH`.

### Phase D — Polish (later)

NAS→GCS backfill, PDF thumbs, pack-photo union in outbound scope, ZIP bulk for PDFs, saved views presets.

## Data flow

```
Manual NAS PUT / Marketplace fetch / Server upload
        ↓
  GCS putObject (or NAS URL for legacy manual)
        ↓
  documents row + document_entity_links (ORDER + SHIPMENT)
        ↓
  GET /api/photos/library?sourceScope=outbound&documentType=shipping_label
        ↓
  Grid tile → GET /api/documents/{id}/content
```

## Testing

- Unit: `library-filter-state.test.ts` (outbound scope parse/serialize)
- Unit: `documents/queries/library.test.ts` (WHERE builder)
- Unit: `store-bytes.test.ts` (path + idempotent attach)
- E2E: attach label → appears under Outbound scope (future)

## Success metrics

- Labels/slips discoverable from `/ops/photos?sourceScope=outbound`
- Server-fetched PDFs land in GCS with stable content URLs
- No photo/document id collisions in library selection
