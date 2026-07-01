# Media Library Modernization — Comprehensive Implementation Plan

**Status:** Planned (not started)
**Created:** 2026-07-01
**Last ground-truthed:** 2026-07-01 (verified against `main`)
**Owner:** TBD
**Route:** `/ops/photos` (unchanged — deep links preserved)
**Archetype:** Workbench (`.claude/rules/display/workbench.md`) — sidebar picker + crossfading right pane
**Related:** [nas-photos-production-plan.md](./nas-photos-production-plan.md), Operations saved views (`operations_saved_views`)

> **How to read this doc.** Every phase below has a **Reality check** block that states what already
> exists on `main` (verified file + line), so you build the delta, not a duplicate. Several items the
> original outline called "gaps" turned out to be already shipped (lightbox inspector, lightbox keyboard
> nav, command palette). Those are re-scoped to *enrichment*, and the freed effort is redirected to the
> genuinely-missing high-value work (bulk share/ZIP wiring, saved views, select-all-matching).

---

## 1. Vision & Goals

### Vision

Transform `/ops/photos` from a capable photo browser into a **Media Library workbench**: fast triage,
powerful bulk workflows, keyboard-first navigation, and persistent filter presets — while staying aligned
with house style (linear, icon-based, contextual, **workbench** archetype per
`.claude/rules/contextual-display.md`).

### Primary goals

| Goal | Success looks like |
|------|-------------------|
| **Clearer product identity** | Users see "Media library" everywhere; expectations set correctly |
| **Reduce clicks for daily ops** | Share, ZIP, Zendesk attach, label edit reachable in ≤2 actions from selection |
| **Power-user speed** | Grid keyboard nav, saved views, command-palette PO/ticket jumps |
| **Context without leaving viewer** | Lightbox shows provenance, links, labels, analysis (already partly shipped) |
| **Scale bulk operations** | Select-all-*matching-filter*, not just the loaded page |

### Non-goals (explicitly out of scope for initial rollout)

- Renaming internal code (`PhotoLibrary*`, `photos.view` permission id, `/ops/photos` route)
- Full video/PDF ingestion (Phase 4 only; branding can precede capability)
- Replacing station capture UX (receiving/packing immersive flows stay as-is)
- Re-adding drag-to-share (inline toolbar is the canonical share surface)
- AI semantic search in production (Phase 4; `searchMode=ask` is a **comment-only stub**, no field/parser today)

---

## 2. Current State Inventory (ground-truthed)

### 2.1 Page shell & components

| File | Role | Notes verified on `main` |
|------|------|--------------------------|
| `src/app/ops/photos/page.tsx` (17 lines) | Route + metadata + guard | `metadata.title = 'Photo Library · USAV'` (L6-8); `requirePermission('photos.view')` (L11); Suspense fallback `Loading photo library…` (L13). **Does not** mount the sidebar. |
| `src/components/sidebar/SidebarContextPanel.tsx` | Sidebar dispatcher | L72: `if (routeKey === 'ops-photos') return <PhotoLibrarySidebarPanel />` |
| `src/components/photos/PhotoLibraryPage.tsx` (491 lines) | Right-pane orchestrator | Hosts selection state (`selectMode` useState L96, `exitSelectMode` L150), bulk actions (L311-374), overlays (Zendesk modal, context menu, label editor). Lightbox lives in the grid, **not** here. |
| `src/components/photos/PhotoLibrarySidebarPanel.tsx` (199 lines) | Search, filters, folders, labels | Composes `SidebarShell`; body children = clear-all button → `PhotoStationFolders` → `PhotoLabelsSection`; footer = `PhotoLibraryNasBackup`. |
| `src/components/photos/PhotoLibraryHeader.tsx` (101 lines) | Title, view toggles, sort | `VIEW_OPTIONS` (L28-38) order: `grid-sm, grid-lg, folders, grid-ticket, list`. `PhotoSortMenu` = `recent`/`oldest` only. |
| `src/components/photos/PhotoLibraryToolbar.tsx` (148 lines) | Inline bulk bar | Generic `<T>`; renders passed `SelectionAction[]`, hardcodes armed-delete + clear + "Select all {total}". `total` = **loaded count** (`photos.length`), not filter total. |
| `src/components/photos/PhotoLibraryGrid.tsx` (148 lines) | View router | Owns the shared lightbox via `usePhotoGridLightbox` for flat/list/ticket views; `FoldersView` owns its own. |
| `photo-library-grid/{PhotoCard,PhotoFlatGrid,PhotoListView,PhotoTicketGrid,FoldersView}.tsx` | View bodies | `PhotoFlatGrid` branches on `isLarge = view === 'grid-lg'`. |

### 2.2 State & data hooks

| File | Role | Verified facts |
|------|------|----------------|
| `src/hooks/usePhotoLibraryUrlState.ts` | URL as source of truth | Returns `{ filters, display, patch, setDatePreset, setSourceScope, setView, setPage, clearStructured, clearAll, replaceFilters }`. `patch(partial)` merges + resets page; `setView` keeps page. Writes via `router.replace(..., {scroll:false})`. |
| `src/lib/photos/library-filter-state.ts` | Filter contract | `PhotoLibraryFilterState` (25 optional fields). `PhotoLibraryViewMode = 'grid-sm'\|'grid-lg'\|'grid-ticket'\|'folders'\|'list'` (default `folders`). `PhotoLibrarySourceScope = all\|unboxing\|local_pickup\|packing\|repair\|claims`. `PHOTO_LIBRARY_PAGE_SIZE = 24` (declared but **unused** — see below). No `searchMode` field. |
| `src/hooks/usePhotoLibrary.ts` | Paginated query | `useInfiniteQuery`, key `['photo-library', filters]`, **hardcoded `limit=48`** (ignores `PHOTO_LIBRARY_PAGE_SIZE`), cursor-based. Response `{ photos, nextCursor, hasMore }` — **no `total`**. Returns `{ query, photos }` (flattened). |
| `src/hooks/usePhotoSelection.ts` | Multi-select | Returns `{ selected:Set<number>, selectedPhotos, isActive, isSelected, selectTile, selectAll, clear, resolveDragIds }`. **No `selectIds(ids)`, no select-mode** (mode is page-level). `selectAll()` selects only **loaded** photos. Cross-page persistent in-memory (survives paging, not reload). |
| `src/hooks/usePhotoShareLinks.ts` | Share links / page / ZIP | `{ generateAndCopy, createSharePage, downloadZip, isLoading }`. **Only `generateAndCopy` is wired** (single-photo context menu, `PhotoLibraryPage.tsx:236`). `createSharePage` + `downloadZip` are **built but orphaned**. |
| `src/hooks/usePackerPhotosRealtimeRefresh.ts` | Live GCS refresh | Mounted at `PhotoLibraryPage.tsx:92`; invalidates library on packer upload. |

### 2.3 Viewer / lightbox (more complete than the original outline claimed)

| File | Role | Verified facts |
|------|------|----------------|
| `photo-library-grid/usePhotoGridLightbox.tsx` (52 lines) | Page-level lightbox hook | Holds only `openPhotoId`; derives the PO#-scoped group (`clicked.poRef`, sorted oldest→newest), maps via `toGalleryInputs`, returns `{ openAt, lightbox }`. |
| `photo-library-grid/LightboxPortal.tsx` | Portal mount | Receives already-mapped `PhotoGalleryInput[]`; instantiates `usePhotoGallery`; portals `PhotoViewerModal` into `document.body`. |
| `photo-library-grid/photo-grid-format.ts` | Mapper | `toGalleryInputs(photos, scope)` → `{ id, url:displayUrl, thumbUrl, meta:PhotoMeta }`. **Attaches full `PhotoMeta`.** |
| `shipped/photo-gallery/usePhotoGallery.ts` | Viewer controller | Owns zoom/rotate/delete/`panelOpen`. **Keyboard handler already present** (L105-124): `Esc`, `←`/`→`, `+`/`=`/`-`, `0`, `r`/`R`, `i`/`I`. `hasContext = photoItems.some(p => p.meta != null)`. |
| `shipped/photo-gallery/PhotoViewerModal.tsx` | Viewer UI | Renders `PhotoContextPanel` directly when `g.hasContext && g.panelOpen`; info-toggle button (`i`) already present. |
| `shipped/photo-gallery/PhotoContextPanel.tsx` | Provenance panel | **Already lights up in the library lightbox.** Shows source badge, ref label, Zendesk subject (`useZendeskTicketSubject`), taken-by, captured-at, dimensions (from preload `naturalWidth/Height`), analysis (damage/analyzed), caption. Deep-links: `/ops/photos?sourceScope=…&poRef=…` and `…&entityType=ZENDESK_TICKET&entityId=…`. |

> **Major correction vs the original outline:** the library lightbox already renders the same
> `PhotoViewerModal` + `PhotoContextPanel` as the shipped gallery, and keyboard nav is already wired.
> Phases 1.3/1.4 shrink to *grid-level* shortcuts and *optional* metadata enrichment.

### 2.4 Backend endpoints (verified)

| Endpoint | Method | Gate | Request | Response |
|---|---|---|---|---|
| `/api/photos/library` | GET | `withAuth({ permission: 'photos.view' })` | `cursor,limit(48),sort` + 20 filter params | `{ photos, nextCursor, hasMore }` — **no total** |
| `/api/photos/share` | POST | `withAuth({ permission: 'photos.share' })` | `{ photoIds[], ttlSeconds? }` | `{ links[], expiresAt, missingIds, groupUrl }` |
| `/api/photos/share-packs` | POST | `withAuth({ permission: 'photos.share' })` | `{ photoIds[], title, packType?, poRef?, receivingId?, zendeskTicketId?, expiresInDays?, filenamePrefix? }` | `{ packId, publicToken, shareUrl, expiresAt }` |
| `/api/photos/share-packs/[token]` | GET | **public** (token) | path token | `{ pack, photos[], zipUrl }` (410 if expired) |
| `/api/photos/download-zip` | GET | session-only¹ | `?ids=1,2,3&title=` | `application/zip` buffer |
| `/api/photos/upload` | POST | `withAuth({})` + dynamic `uploadPermissionFor(entityType)` | multipart: `entityType,entityId,file,photoType?,poRef?,linkRole?` | `{ ...uploadResult, url, thumbUrl }` |
| `/api/photos/[id]` | DELETE | per-entity via `PERM_BY_ENTITY_TYPE` | path id | `{ success, id, entityType }` |
| `/api/photos/[id]/content` | GET | `photos.view` (entity fallback) | `?variant=thumb\|full&download=1` | image bytes / 302 redirect |
| `/api/photos/[id]/labels` | GET, PUT | `withAuth` | path id | label CRUD |

¹ `download-zip` calls `requireRoutePerm(request, 'photos.view')` but the `if (gate.denied)` branch is an
**empty no-op** — effective gate is any authenticated org session. Harden this in Phase 1 (§1.1).

> **There is no `GET /api/photos/[id]` JSON detail endpoint.** Only `DELETE`, `/content` (bytes), and
> `/labels` exist per id. Provenance is carried in-memory via `PhotoMeta` from the list payload. A detail
> fetch (dimensions/ticket-subject enrichment) is a *new* endpoint if wanted (Phase 1.4, optional).

### 2.5 Query & domain modules

- `src/lib/photos/queries/library.ts` → `listPhotoLibrary(filters)` returns `{ items, nextCursor, hasMore }`.
  `limit` clamped to `[1,100]`, selects `LIMIT limit+1` for keyset paging. **No `COUNT(*)` anywhere.**
- `src/lib/photos/queries/receiving-list.ts` → `listAllReceivingPhotoIds(...)` returns `number[]` — the only
  existing id-only precedent (reuse the shape for select-all-matching in Phase 2.2).
- `src/lib/photos/entity-permissions.ts` → `UPLOAD_PERM_BY_ENTITY` (scope→perm) + `uploadPermissionFor(t)`.
  `SHARE_PACK → 'photos.share'`. Upload perms: `receiving.upload_photo`, `packing.complete_order`,
  `tech.scan_serial`, `sku_stock.adjust`, `bin.adjust`, `integrations.zendesk`.
- `src/lib/photos/analyze.ts` → `PhotoAnalysisMetadata { ocr_text[], labels[], damage_detected, damage_notes, caption }`.
  Persisted to `photo_analysis`; feature-flagged (`PHOTOS_ANALYZE_ENABLED`, `PHOTOS_ANALYZE_ON_UPLOAD`, default off).

### 2.6 Permissions (verified — `src/lib/auth/permission-registry.ts` L143-145)

```ts
{ id: 'photos.view',   category: 'ops', label: 'View photo library' },
{ id: 'photos.share',  category: 'ops', label: 'Create photo share links' },
{ id: 'photos.manage', category: 'ops', label: 'Manage photo folders (create, organize, assign)' },
```

`photos.manage` is **not referenced by any current endpoint** (library/share/zip use `view`/`share`;
uploads use per-entity perms). It's available to gate saved-view sharing (Phase 2.1).

### 2.7 Reference pattern to copy (Operations saved views)

- Migration: `src/lib/migrations/2026-06-24_operations_saved_views.sql` (exact template — §Phase 2.1).
- Domain: `src/lib/operations/saved-views-queries.ts` — raw SQL via `tenantQuery` + `OrgId`; ownership by `staff_id`.
- Routes: `/api/operations/saved-views` (`withAuth({ permission:'operations.view' })`) + `[id]`
  (`requireRoutePerm(req,'operations.view')` from `dynamic-route-guard.ts`). 8192-char JSONB cap. Audit via
  `recordAudit` + `AUDIT_ACTION.OPERATIONS_SAVED_VIEW_{CREATE,UPDATE,DELETE}` / `AUDIT_ENTITY.OPERATIONS_SAVED_VIEW`.
- Hook: `src/hooks/useOperationsSavedViews.ts` → `{ views, isLoading, create, creating, createError, update, remove, removing }`.
  Applying a view is done by the URL-state hook, not this hook.

### 2.8 Command palette already exists

- `src/components/CommandBar.tsx` — global `⌘K`/`Ctrl+K` (L164) built on `cmdk` (L21), backed by
  `GET /api/global-search`. Deep-link convention: `?open…Id=` (e.g. `/fba?openShipmentId=`,
  `/receiving?mode=receive&openReceivingId=`). **Phase 3.1 extends this — it does not build a new palette.**

### 2.9 Known gaps (re-scored after ground-truth)

| Gap | Severity | Reality |
|-----|----------|---------|
| Bulk share / share-page / ZIP not in toolbar | **High** | Backend + hook methods exist; only single-photo `generateAndCopy` wired. |
| No saved filter presets | **High** | Nothing exists; full copy of Operations pattern. |
| "Select all N" = loaded count only | **High** | `total` absent from library response; `selectIds` absent from selection hook. |
| `download-zip` permission not enforced | **Medium** | Empty `gate.denied` branch — real hole. |
| No grid-level keyboard shortcuts / `?` cheat sheet | **Medium** | Lightbox nav done; grid (view switch, select-all, esc) missing. |
| No upload drop zone in library | **Medium** | `/api/photos/upload` ready; library is view-only. |
| Copy still says "Photo library" in ~15 verified touchpoints | Low | Branding inconsistency (§Phase 0). |
| Lightbox lacks *deep* metadata (exact dimensions pre-open, provenance rail) | Low | Panel already shows most; detail endpoint optional. |
| `PHOTO_LIBRARY_PAGE_SIZE` unused (hook hardcodes 48) | Low (hygiene) | Fix or delete the dead constant. |
| Command palette lacks media-scoped commands | Low | `CommandBar` exists; add entries. |
| `searchMode=ask` stubbed | Low until Phase 4 | Comment-only; no field/parser. |

---

## 3. Architecture Decisions (lock before Phase 1)

| Decision | Recommendation | Rationale |
|----------|----------------|-----------|
| **Route** | Keep `/ops/photos` | Hundreds of deep links (`?receivingId=`, `?entityType=`, `?poRef=`, …); zero migration cost. |
| **Permission ids** | Keep `photos.view` / `photos.manage` / `photos.share` | Renaming requires registry + `route-permission-manifest.test.ts` + role-seed migrations. |
| **Internal code names** | Keep `PhotoLibrary*` until Phase 4 optional cleanup | User-facing rename is decoupled from refactor risk. |
| **"Media" scope** | Phase 0–3: images only; Phase 4: video/PDF | Honest UX: use "photo" in image-specific contexts ("12 photos selected"). |
| **Share TTL** | Default 24h (`DEFAULT_SHARE_TTL_SECONDS`); options picker behind "Share options" | Matches `PhotoLibraryPage.tsx:32`; server clamps 60s…7d. |
| **Saved views storage** | New `media_library_saved_views` table (mirror Operations exactly) | JSONB `filters` bag — no column migration when filters grow. |
| **Select-all-matching** | New id-only endpoint returning `{ ids(≤cap), total, capped }` | Library has no `total`; avoid loading 10k ids client-side; hard cap 500. |
| **Command palette** | Extend existing `CommandBar.tsx` (cmdk) | Already global `⌘K`; add media-scoped nav entries, don't fork. |
| **Release notes** | Ship via a real commit, **not** by hand-editing `release-notes.json` | That file is generated by `scripts/generate-release-notes.mjs` from git log. |
| **Page-size constant** | Make `usePhotoLibrary` import `PHOTO_LIBRARY_PAGE_SIZE` (set it to 48) or delete it | Kill the 24-vs-48 drift while touching the hook in Phase 2.2. |

---

## 4. Phase Overview

```
Phase 0 — Rename & copy harmonization          (~0.5–1 day)   Low risk
Phase 1 — Wire bulk share/ZIP + grid shortcuts (~2–4 days)    Low–med   (smaller than first estimate)
Phase 2 — Saved views + select-all-matching    (~5–8 days)    Medium
Phase 3 — Pro UX (palette, quicklook, upload…) (~7–11 days)   Med–high  (palette already exists → cheaper)
Phase 4 — Platform & true "media"              (~15–25+ days) High
```

Phases 0–2 deliver ~80% of perceived "modern DAM" value. Phase 3 is polish/power-user. Phase 4 is
strategic platform work. Phase 1 and Phase 3 are cheaper than the original outline because the lightbox
inspector, lightbox keyboard nav, and command palette already exist.

---

## Phase 0 — Rename & Copy Harmonization

**Duration:** 0.5–1 day · **Risk:** Low · **Dependencies:** None · **PR:** PR-1

### Reality check

- Nav label + title + permission label all currently say "Photo library" / "Photo Library".
- Nav icon is `Camera` (`sidebar-navigation.ts:9,133`). `Image` icon exists (`src/components/icons/media.tsx:65`);
  **`Images` (plural) does not** — add it or use `Image`.
- `intent-router.ts:128` has `/\bphoto library\b/i` in a regex array — add a `media library` alias, keep the old one.
- `release-notes.json` is **generated**; do not hand-edit (see §3).

### 0.1 User-facing string audit (exact edits)

| File | Line | Change |
|------|------|--------|
| `src/lib/sidebar-navigation.ts` | L133 | `label: 'Media library'` (keep `id:'ops-photos'`, `href`, `requires`) |
| `src/lib/sidebar-navigation.ts` | L9,133 | swap `icon: Camera` → `icon: Images` (after adding `Images`) or `icon: Image` |
| `src/lib/sidebar-titles.ts` | L10 | `'ops-photos': 'Media library'` |
| `src/lib/auth/permission-registry.ts` | L143 | `label: 'View media library'` |
| `src/lib/auth/permission-registry.ts` | L144 | `label: 'Create media share links'` |
| `src/lib/auth/permission-registry.ts` | L145 | `label: 'Manage media library (labels, folders, organize)'` |
| `src/app/ops/photos/page.tsx` | L6-8 | `metadata.title = 'Media Library · USAV'` |
| `src/app/ops/photos/page.tsx` | L13 | fallback text → `Loading media library…` |
| `src/components/photos/PhotoLibrarySidebarPanel.tsx` | filter prop | `filter.label: 'Media filters'` (currently `'Photo filters'`) |
| `src/lib/ai/intent-router.ts` | L128 area | add `/\bmedia library\b/i` to the regex array (keep `photo library`) |
| `src/components/shipped/photo-gallery/PhotoLauncher.tsx` | — | tooltip + aria-label if they say "photo library" |
| `src/components/shipped/photo-gallery/PhotoContextPanel.tsx` | source link | "Open in media library" if that copy exists |
| `src/app/photos/page.tsx` | — | NAS preview cross-link copy (dev surface) |

Grep to find any stragglers (case-insensitive), review each hit before editing:

```bash
grep -rniE "photo library" src/ tests/ --include=*.ts --include=*.tsx
```

**Copy rule:** Generic surfaces → "Media library". Image-specific *actions* keep "photo"
("Delete photo", "12 photos selected", "Copy shareable links", "Add photos to a ticket").

### 0.2 Icon

If using a distinct plural glyph, add `Images` to `src/components/icons/media.tsx` (match the `Camera`/`Image`
stroke weight, `w-6 h-6` default) and it flows through the `@/components/Icons` barrel automatically. Otherwise
reuse the existing `Image`.

### 0.3 Tests

- Update any E2E asserting the heading/title:
  `grep -rniE "photo library" tests/e2e` → change to `/media library/i`.
- `tests/e2e/photos-gcs-upload.spec.ts` — `getByRole('heading', { name: /media library/i })` (verify the spec
  file exists first; the outline named it but confirm before editing).
- Run `route-permission-manifest.test.ts` unchanged (labels aren't asserted there) — permission **ids**
  are untouched, so no manifest churn.

### 0.4 Acceptance criteria

- [ ] Sidebar shows "Media library" with the new icon
- [ ] Browser tab title is "Media Library · USAV"
- [ ] Admin role editor shows "View media library" / "Create media share links"
- [ ] `intent-router` matches both "media library" and "photo library"
- [ ] All photo E2E specs pass with updated copy
- [ ] Deep links (`/ops/photos?receivingId=…`) unchanged and working
- [ ] No internal route or permission-id changes; `route-permission-manifest.test.ts` green

### 0.5 Rollout

- Standalone PR — zero functional change, trivial review.
- Release note is delivered by the merge commit subject (picked up by `generate-release-notes.mjs`); do not
  hand-edit `release-notes.json`.

---

## Phase 1 — Wire Bulk Share/ZIP + Grid Shortcuts

**Duration:** 2–4 days · **Risk:** Low–medium · **Dependencies:** Phase 0 optional (parallelizable) · **PRs:** PR-2, PR-3

### Reality check

- `usePhotoShareLinks` already exposes `generateAndCopy`, `createSharePage`, `downloadZip`, `isLoading`.
  Only `generateAndCopy` (single-photo) is wired. **The bulk work is pure UI wiring.**
- Lightbox keyboard nav + inspector panel **already work** — do **not** rebuild them.
- `SelectionAction<T>` supports `minSelected` / `maxSelected` gating — use it for the ZIP/share caps.
- `Link2`, `ExternalLink`, `Download` are already imported at `PhotoLibraryPage.tsx:5`.

### 1.1 Bulk toolbar: share links, share page, ZIP (PR-2)

**File:** `src/components/photos/PhotoLibraryPage.tsx` — extend the `photoBulkActions`
`useMemo<SelectionAction<LibraryPhoto>[]>` (L311-374).

Add a share gate next to the existing `canZendesk`/`canManagePhotos` (near L76-78):

```ts
const canShare = has('photos.share');
```

Add a title helper (module scope, near `DEFAULT_SHARE_TTL_SECONDS`):

```ts
/** Auto title for a share page / ZIP from the selection's dominant PO. */
function sharePageTitle(rows: LibraryPhoto[]): string {
  const po = rows.find((r) => r.poRef?.trim())?.poRef?.trim();
  return po ? `PO ${po} photos (${rows.length})` : `Photos (${rows.length})`;
}
```

Insert these entries into the actions array (share entries gated on `canShare`, ordered after `zendesk`):

```ts
...(canShare
  ? [
      {
        key: 'copy-links',
        label: 'Copy shareable links',
        icon: <Link2 className="h-4 w-4" />,
        tone: 'blue' as const,
        maxSelected: 200,                       // MAX_PHOTOS_PER_REQUEST (share-links.ts)
        disabledReason: 'Select 200 or fewer to copy links',
        run: (rows: LibraryPhoto[]) =>
          void shareLinks.generateAndCopy(rows.map((r) => r.id), { ttlSeconds: DEFAULT_SHARE_TTL_SECONDS }),
      } satisfies SelectionAction<LibraryPhoto>,
      {
        key: 'share-page',
        label: 'Create share page',
        icon: <ExternalLink className="h-4 w-4" />,
        tone: 'blue' as const,
        maxSelected: 200,
        run: (rows: LibraryPhoto[]) =>
          void shareLinks.createSharePage(rows.map((r) => r.id), { title: sharePageTitle(rows) }),
      } satisfies SelectionAction<LibraryPhoto>,
    ]
  : []),
```

Convert the existing **`download`** action (currently per-file) to be ZIP-aware for multi-select:

```ts
{
  key: 'download',
  label: 'Download selected',
  icon: <Download className="h-4 w-4" />,
  tone: 'blue',
  primary: false,
  run: async (rows: LibraryPhoto[]) => {
    if (rows.length >= 2) {
      shareLinks.downloadZip(rows.map((r) => r.id), { title: sharePageTitle(rows) }); // sync, void
    } else if (rows[0]) {
      await downloadPhotoFile(rows[0]); // existing single-file path
    }
  },
},
```

Add `canShare` and `shareLinks` to the `useMemo` deps array.

**UX details:**

- The toolbar already filters disabled actions via `resolveSelectionAction` (`min/maxSelected`), so a 201-photo
  selection hides the two share actions and shows a hover reason — no extra guards needed.
- `generateAndCopy` / `createSharePage` toggle `shareLinks.isLoading`; the toolbar renders the buttons statically,
  so either (a) pass `isLoading` down for a spinner, or (b) rely on the built-in toast (`Loader2` is already imported).
  Minimal path: rely on toasts for v1; add spinner in PR-2b if requested.
- Also add "Create share page" to the **single-photo context menu** (`photoMenuItems`, L223-280) beside the existing
  "Copy shareable link", so a lone photo can spawn a durable page too.

**Harden `download-zip` (same PR):** in `src/app/api/photos/download-zip/route.ts` (L72-75), replace the empty
`if (gate.denied)` no-op with an actual return:

```ts
const gate = await requireRoutePerm(request, 'photos.view');
if (gate.denied) return gate.denied;
```

**Files touched:** `PhotoLibraryPage.tsx`, `download-zip/route.ts`, (optional) `PhotoLibraryToolbar.tsx`
(spinner), new `tests/e2e/media-library-bulk-share.spec.ts`.

### 1.2 Share options sub-menu (optional within PR-2)

Small dropdown attached to the share actions:

- TTL: 1h / **24h (default)** / 7d → maps to `ttlSeconds` on `generateAndCopy`; days on `createSharePage`.
- Server clamps to `[60s, 7d]` regardless, so the picker is convenience only.

Defer if PR-2 should stay minimal; fixed 24h is a valid v1.

### 1.3 Grid-level keyboard shortcuts + cheat sheet (PR-3)

**Lightbox shortcuts already exist** (`usePhotoGallery` L105-124). This PR only adds **grid/page** shortcuts.

**New file:** `src/hooks/useMediaLibraryShortcuts.ts` — mounted in `PhotoLibraryPage.tsx`. A single
`useEffect` + `window.addEventListener('keydown', …)` with a focus guard.

| Context | Shortcut | Action | Wire to |
|---------|----------|--------|---------|
| Library (grid focused) | `?` | Toggle shortcuts cheat sheet | new `MediaLibraryShortcutsModal` |
| Grid | `⌘/Ctrl+A` | `selectAll()` (only when `selectionActive`) | `usePhotoSelection.selectAll` |
| Grid | `Esc` | `exitSelectMode()` or close open overlay | page-level `exitSelectMode` (L150) |
| Grid | `1`–`5` | Switch view mode | `setView(VIEW_OPTIONS[n-1].id)` |
| Grid | `f` | Jump to search box | focus the sidebar `poFinder` input |

**Focus guard (critical):** skip when the event target is an editable element, so `⌘A` in the search box
selects text and `1`-`5` type into inputs:

```ts
function isEditable(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable);
}
```

`1`–`5` map to `VIEW_OPTIONS` order (`grid-sm, grid-lg, folders, grid-ticket, list`).

**New files:** `src/hooks/useMediaLibraryShortcuts.ts`, `src/components/photos/MediaLibraryShortcutsModal.tsx`
(list both the new grid shortcuts and the existing lightbox ones so the cheat sheet is complete).

### 1.4 Lightbox inspector — enrichment only (optional, PR-3b)

**Already shipped:** the panel renders and the `i` toggle works in the library lightbox (see §2.3). Do **not**
re-wire it. Optional enrichment if ops wants more depth:

1. **Exact dimensions before open / EXIF / file size** — requires a new `GET /api/photos/[id]` JSON detail
   endpoint (does not exist today). Return `{ id, mimeType, bytes, width, height, ticketSubject, links[] }`.
   Lazy-fetch on panel open (one request per open, not per tile — avoids bloating the list query).
2. **Provenance links block** — the panel already shows the "View all from this source" deep link; extend with
   direct `/receiving` and `/support` jumps built from `PhotoMeta` (no new fetch needed for those).

Ship §1.4 only if there's demand; §1.1 + §1.3 are the load-bearing Phase-1 wins.

### 1.5 Acceptance criteria

- [ ] Select 3+ photos → "Copy shareable links" copies a formatted block (respects 200 cap)
- [ ] Select 3+ photos → "Create share page" copies one `/share/photos/:token` URL
- [ ] Select 2+ photos → "Download selected" triggers a single ZIP; 1 photo → direct file
- [ ] Share actions hidden without `photos.share`
- [ ] `download-zip` returns 403 when `photos.view` is denied (regression-tested)
- [ ] Grid `1`–`5` switch view; `⌘A` selects loaded set; `Esc` exits select mode; `?` opens cheat sheet
- [ ] `⌘A` inside the search box selects text, not photos (focus guard)
- [ ] No regression in folder drill, selection, Zendesk attach, label edit, lightbox nav/inspector

---

## Phase 2 — Saved Views + Select-All-Matching + Recents

**Duration:** 5–8 days · **Risk:** Medium · **Dependencies:** Phase 1 complete · **PRs:** PR-5, PR-6, PR-7

### 2.1 Saved views (filter presets) — mirror Operations exactly (PR-5)

#### Database migration

**New file:** `src/lib/migrations/2026-07-XX_media_library_saved_views.sql` — copy the Operations template
verbatim, renaming the table:

```sql
-- Media library saved views — tenant-scoped from birth (mirrors 2026-06-24_operations_saved_views.sql).
-- enforce_tenant_isolation() from 2026-06-14_rls_enforcement_infra.sql. Writers run inside
-- withTenantTransaction (sets app.current_org) AND stamp organization_id explicitly.

CREATE TABLE IF NOT EXISTS media_library_saved_views (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  staff_id        INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  filters         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- PhotoLibraryFilterState + { view }
  is_shared       BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_library_saved_views_name_chk CHECK (length(btrim(name)) > 0),
  CONSTRAINT media_library_saved_views_org_staff_name_uniq UNIQUE (organization_id, staff_id, name)
);

CREATE INDEX IF NOT EXISTS idx_media_library_saved_views_org_staff
  ON media_library_saved_views (organization_id, staff_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_media_library_saved_views_org_shared
  ON media_library_saved_views (organization_id) WHERE is_shared = true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('media_library_saved_views');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — media_library_saved_views left without FORCE RLS';
  END IF;
END $$;
```

Use the `/db-migration-author` skill (dated immutable filename, idempotent DDL) and apply via `/db-migrate`.
**Do not** hand-run against the DB. Run **neon-cost-reviewer** on the migration.

#### Domain queries

**New file:** `src/lib/photos/saved-views-queries.ts` — copy `src/lib/operations/saved-views-queries.ts`
shape exactly (raw SQL, `tenantQuery`, `OrgId`, ownership by `staff_id`):

```ts
import 'server-only';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface MediaSavedView {
  id: number; name: string; filters: Record<string, unknown>;
  is_shared: boolean; sort_order: number; staff_id: number;
  created_at: string; updated_at: string;
}
const COLS = `id, name, filters, is_shared, sort_order, staff_id, created_at, updated_at`;

export async function listMediaSavedViews(orgId: OrgId, staffId: number): Promise<MediaSavedView[]>;
export async function getMediaSavedView(id: number, orgId: OrgId): Promise<MediaSavedView | null>;
export async function createMediaSavedView(
  input: { name: string; filters: Record<string, unknown>; isShared?: boolean; sortOrder?: number },
  orgId: OrgId, staffId: number,
): Promise<MediaSavedView>;
export async function updateMediaSavedView(
  id: number, orgId: OrgId, staffId: number,
  patch: { name?: string; filters?: Record<string, unknown>; isShared?: boolean; sortOrder?: number },
): Promise<MediaSavedView | null>;
export async function deleteMediaSavedView(id: number, orgId: OrgId, staffId: number): Promise<boolean>;
```

- List: `WHERE organization_id = $1 AND (staff_id = $2 OR is_shared = true) ORDER BY sort_order ASC, name ASC`.
- Mutations: `... WHERE id=$1 AND organization_id=$2 AND staff_id=$3` (ownership boundary is `staff_id`).
- Add a DB-free unit test via `/domain-unit-test` (`saved-views-queries.test.ts`).

#### API routes

| Route | Method | Gate |
|-------|--------|------|
| `/api/photos/saved-views` | GET, POST | `withAuth(handler, { permission: 'photos.view' })` |
| `/api/photos/saved-views/[id]` | PATCH, DELETE | `requireRoutePerm(req, 'photos.view')` + ownership (`before.staff_id === ctx.staffId`) or `photos.manage` for shared |

Follow the Operations skeleton exactly:

- Collection `POST`: validate `name` (trim, 400 if empty), `filters` object, reject
  `JSON.stringify(filters).length > 8192` (400), `isShared === true`, numeric `sortOrder`. On success →
  `recordAudit(pool, ctx, req, { source:'media-saved-views-api', action: AUDIT_ACTION.MEDIA_SAVED_VIEW_CREATE, entityType: AUDIT_ENTITY.MEDIA_SAVED_VIEW, entityId: view.id, after: view })`.
  Return `{ success:true, view }` (201). Map `error.code === '23505'` → 409.
- `[id]` PATCH/DELETE: `params: Promise<{id:string}>`, `parseId`, ownership pre-check (404 if not owner),
  TOCTOU re-check, audit UPDATE/DELETE with before/after.

**Audit constants** — add to `src/lib/audit-logs.ts` (mirror the Operations block at L130/L333-335):

```ts
// AUDIT_ENTITY
MEDIA_SAVED_VIEW: 'media_saved_view',
// AUDIT_ACTION
MEDIA_SAVED_VIEW_CREATE: 'media.saved_view.create',
MEDIA_SAVED_VIEW_UPDATE: 'media.saved_view.update',
MEDIA_SAVED_VIEW_DELETE: 'media.saved_view.delete',
```

Update `route-permission-manifest.test.ts` for the two new routes. Run the **api-route-reviewer** and
**permission-registry-guard** agents after adding routes.

#### Client hook + UI

**New file:** `src/hooks/useMediaLibrarySavedViews.ts` — copy `useOperationsSavedViews.ts`:

```ts
return {
  views: list.data ?? [],
  isLoading: list.isLoading,
  create: create.mutate,     // ({ name, filters, isShared? })
  creating: create.isPending,
  createError: /* string | null */,
  update: update.mutate,     // (id, patch)
  remove: remove.mutate,     // (id)
  removing: remove.isPending,
};
```

Query key `['media-saved-views']`, `staleTime: 5*60_000`, `enabled: !!user?.staffId`.

**Serialization** — the JSONB `filters` bag stores the full `PhotoLibraryFilterState` **plus** the view mode
and a schema version for forward compat:

```ts
type SavedViewPayload = { schemaVersion: 1; filters: PhotoLibraryFilterState; view: PhotoLibraryViewMode };
```

**Apply** a saved view via the URL-state hook (matches Operations — the saved-views hook does not apply):

```ts
const { replaceFilters, setView } = usePhotoLibraryUrlState();
function applyView(v: MediaSavedView) {
  const p = v.filters as SavedViewPayload;
  replaceFilters(p.filters ?? {});   // resets page to 1
  if (p.view) setView(p.view);
}
```

**UI — new sidebar section.** Add `src/components/photos/MediaSavedViewsSection.tsx` and render it in
`PhotoLibrarySidebarPanel.tsx` **between** the "Clear all filters" button (L176) and `<PhotoStationFolders/>`
(L177) — a top-of-body section, house-style eyebrow header + `divide-y` rows:

- Row: view name (title) → apply on click → overflow menu (rename, delete, share toggle).
- "Save current view" affordance shown when `countActivePhotoLibraryFilters(filters) > 0` or the view mode
  differs from default (`folders`). Prefill the name from `sharePageTitle`-style context.
- Selected/active row = `bg-blue-50 ring-1 ring-inset ring-blue-400` only (one-row anatomy, no size shift).

#### Acceptance criteria (2.1)

- [ ] Save "Today's unboxing" → reload → one-click restore (filters + view)
- [ ] Shared view (`is_shared: true`) visible org-wide; personal views private
- [ ] Unique name per staff per org enforced (409 on dup)
- [ ] Owner-only edit/delete; shared-view management gated on `photos.manage`
- [ ] Unit tests on query helpers (`/domain-unit-test`)
- [ ] `route-permission-manifest.test.ts` updated; api-route-reviewer clean

### 2.2 Select-all-matching-filter (PR-6)

**Problem:** the toolbar's "Select all {total}" uses `photos.length` (loaded, 48/page). `selectAll()` only
selects loaded photos, and the library response has no `total`.

**Solution — new id-only endpoint + count:**

**New file:** `src/app/api/photos/library/ids/route.ts` (`withAuth({ permission: 'photos.view' })`), accepting
the **same filter query params** as `/api/photos/library`:

```ts
// GET /api/photos/library/ids?<same filters>&cap=500
// → { ids: number[], total: number, capped: boolean }
```

**New query:** `src/lib/photos/queries/library.ts` → `listPhotoLibraryIds(filters, { cap })`:

- `total` via `SELECT COUNT(*)` over the same WHERE clause as `listPhotoLibrary` (factor the WHERE builder so
  the count and list can't drift).
- `ids` via `SELECT id … ORDER BY … LIMIT cap` (cap default 500).
- `capped = total > cap`.

Run **neon-cost-reviewer** — the count is a full scan over the filtered set; ensure the existing filter indexes
(org, date, entity links) cover it.

**Extend `usePhotoSelection`** with a bulk setter (currently absent):

```ts
selectIds: (ids: number[]) => void;   // new — replaces selection with the given set
```

Implement as `setSelected(new Set(ids))` + reset baseline/anchor (mirror `selectAll`'s bookkeeping).

**Toolbar UX** (`PhotoLibraryToolbar.tsx`): when the user clicks "Select all {loaded}" and a lightweight
`total` (fetched via a cheap `?cap=0` count, or reuse the ids call) exceeds the loaded count, show an inline
banner:

> **All 48 on this page selected.** [Select all 412 matching filters]

Confirm → call the ids endpoint (cap 500) → `selectIds(ids)`. If `capped`, toast:
"Selected first 500 of 1,204 — narrow filters to select more."

**Safety:** bulk **delete** on a matched-all selection requires an explicit confirm dialog with the exact count
(the toolbar's armed-delete already double-confirms; add the count to the label when count > loaded).

**Files:** `library/ids/route.ts` (new), `queries/library.ts`, `usePhotoSelection.ts`, `PhotoLibraryToolbar.tsx`,
`PhotoLibraryPage.tsx` (pass `total` + `onSelectAllMatching`).

**Page-size hygiene (same PR):** make `usePhotoLibrary` import `PHOTO_LIBRARY_PAGE_SIZE` and set it to `48`
(or delete the constant). Kill the 24-vs-48 drift while the file is open.

### 2.3 Recents & pinned scopes (PR-7)

**Recents (client-only):**

- `localStorage` key `media-library-recents`; store last 10 `{ poRef?, sourceScope, label?, visitedAt }`
  captured on navigation (in `usePhotoLibraryUrlState.patch`/`setSourceScope`, or a small effect in the page).
- Render a "Recent" section in the sidebar below Saved views; one-click re-applies via `applyView`-style patch.

**Pinned scopes/labels:**

- **Quick:** `is_pinned BOOLEAN` on `media_library_saved_views` — pinned views float to the top (`ORDER BY is_pinned DESC, sort_order`).
- **Alt:** extend `staff_preferences` JSON with `pinnedMediaScopes: string[]` for non-view pins (a raw scope/label without a saved filter set).

Recommend the `is_pinned` column (single source, already tenant-scoped) over the preferences bag.

### 2.4 Acceptance criteria (Phase 2)

- [ ] Saved views CRUD works; shared views visible org-wide; unique-name enforced
- [ ] Applying a saved view restores filters **and** view mode; page resets to 1
- [ ] "Select all matching" selects up to cap 500 with clear over-cap messaging
- [ ] `selectIds` selects a programmatic set; cross-page selection intact
- [ ] Recents show last-visited PO/scope folders; pins float to top
- [ ] neon-cost-reviewer approves the count query and saved-views list (both cheap/indexed)

---

## Phase 3 — Pro UX

**Duration:** 7–11 days · **Risk:** Medium–high · **Dependencies:** Phase 2 (palette benefits from saved views) · **PRs:** PR-8…PR-11

### 3.1 Command palette — extend `CommandBar`, don't fork (PR-8)

**Reality:** `src/components/CommandBar.tsx` is a global `⌘K`/`Ctrl+K` palette (cmdk) backed by
`/api/global-search`. This PR **registers media-scoped commands**, it does not build a palette.

Add media-library entries to CommandBar's static command list, visible/prioritized when on `/ops/photos`
(and available globally as navigations):

| Command | Action |
|---------|--------|
| `Media: Go to PO…` | prompt PO# → navigate `/ops/photos?poFinder=<po>&poFinderKind=po` |
| `Media: Go to ticket…` | ticket# → `/ops/photos?sourceScope=claims&entityType=ZENDESK_TICKET&entityId=<id>` |
| `Media: Today's unboxing` | `/ops/photos?sourceScope=unboxing&dateFrom=<today>&dateTo=<today>&view=folders` |
| `Media: Switch to folders / list / grid` | `patch`/`setView` on the current page (only when already on `/ops/photos`) |
| `Media: Saved view → <name>` | apply saved view (reads `useMediaLibrarySavedViews`) |
| `Media: Toggle selection mode` | flips page-level `selectMode` |

Use the existing `?open…Id=`-style deep-link convention. Cross-page commands emit a URL + `router.push`;
same-page commands call the page's `patch`/`setView`/`applyView` via a small context or an event.

**Guard:** do not steal the `F2` scan hotkey — CommandBar already binds `⌘K`/`Ctrl+K` only, which is safe.

### 3.2 Quick Look (Spacebar) (PR-9a)

macOS-Finder pattern — tap `Space` on a focused/hovered tile → floating single-image preview (no thumbnail
strip); `Esc` closes; "Open" escalates to the full lightbox.

- New `QuickLookOverlay.tsx` (centered modal, `AnimatePresence mode="wait"`, opacity+scale, reduced-motion via
  `useMotionPresence`).
- Add roving `tabIndex` to grid tiles (`PhotoCard`) so keyboard focus has a target; wire `Space` in
  `useMediaLibraryShortcuts` (guard against space-scroll on the grid container).

### 3.3 Compare mode (PR-9b)

Claims/damage review — 2–4 photos side by side.

- Select 2–4 → bulk action **"Compare"** (`SelectionAction` with `minSelected: 2, maxSelected: 4`).
- `CompareView.tsx` replaces the grid body (`divide-x` horizontal split); `Esc` exits back to grid.
- v1: independent pan/zoom per pane (reuse `usePhotoGallery` per pane or a lighter zoom hook). Synced zoom is v2.

### 3.4 Upload drop zone (PR-10)

- Drag files onto the grid scroll region → overlay "Drop to upload".
- Modal: pick target entity (PO search → `RECEIVING`/`RECEIVING_LINE`, serial → `SERIAL_UNIT`, etc.).
- `POST /api/photos/upload` (multipart) per file with progress; reuse the existing upload client.

**Permissions:** the endpoint enforces `uploadPermissionFor(entityType)` dynamically (returns
`403 { error:'FORBIDDEN', permission }`). Mirror that gate client-side so the drop target only offers entity
types the user can upload to (`receiving.upload_photo`, `packing.complete_order`, `tech.scan_serial`, …).

**Files:** new `MediaLibraryDropZone.tsx`; wrap the scroll region in `PhotoLibraryPage.tsx`.

### 3.5 Grid density (PR-11a)

Current density is the discrete `grid-sm` / `grid-lg` pair (`PhotoFlatGrid` branches on `isLarge`). Add a finer
control:

- Header slider (1–5) next to the view toggles; persist as `?density=3` (URL) or `localStorage`.
- Drive `repeat(auto-fill, minmax(Xpx, 1fr))` from the density value; map legacy `grid-sm`→dense,
  `grid-lg`→sparse for back-compat.
- Keep selection styling background+ring only (no size shift) across density changes.

### 3.6 List view upgrades (PR-11b)

**File:** `photo-library-grid/PhotoListView.tsx` (67 lines).

| Enhancement | Detail |
|-------------|--------|
| Sortable columns | Click header → sort by date / filename / uploader (extend `sort` beyond `recent`/`oldest`, or client-sort the loaded set) |
| Inline label chips | Render `PhotoLabelChips` (already used in `PhotoCard`) in each row |
| Row hover actions | Icon buttons: share, download, open entity (reuse `photoMenuItems`) |
| Sticky header | Column header row stays on scroll (`sticky top-0`) |

### 3.7 Hover metadata on grid tiles (PR-11b)

**File:** `photo-library-grid/PhotoCard.tsx`. On hover (desktop only) overlay filename, time, uploader initial,
damage dot; full detail via `HoverTooltip` (body portal — never `title=`).

### 3.8 Acceptance criteria (Phase 3)

- [ ] `⌘K` surfaces media commands; PO jump in <3 keystrokes after open; no F2 collision
- [ ] `Space` quick-look works on a focused tile; `Esc` closes; "Open" escalates
- [ ] Compare works for 2–4 selections; `Esc` exits
- [ ] Drop-upload attaches to the chosen entity with the correct per-entity permission gate
- [ ] Density slider adjusts columns without layout shift on selection
- [ ] List columns sortable; hover actions functional; sticky header holds

---

## Phase 4 — Platform & True "Media"

**Duration:** 15–25+ days (multi-sprint) · **Risk:** High · **Dependencies:** Phases 1–3 stable · **PRs:** PR-12+ (epic)

### 4.1 AI semantic search

- **Current stub:** `searchMode=ask` is a **doc-comment only** in `library-filter-state.ts` — no field, parser,
  or handler. Adding it means a real field on `PhotoLibraryFilterState` + URL parser + a route.
- New `POST /api/photos/search/semantic`: embed the query, vector-search or LLM-filter to an id list, feed
  through the existing `selectIds`/list rendering path.
- Sidebar toggle "Search | Ask"; `intent-router` update for "media library" NL queries.
- Rate-limit + `recordAudit` per staff. Reuse `analyze.ts` outputs (`labels`, `ocr_text`, `caption`) as the
  cheapest first-pass corpus before committing to a `pgvector` column.

### 4.2 Video / PDF support

**Schema** (the `photos` table is polymorphic: `entity_type, entity_id, url, taken_by_staff_id, photo_type`):

- Add `mime_type TEXT`, `media_kind TEXT` (`'image'|'video'|'document'` — CHECK constraint), `duration_ms INTEGER`.
- Storage adapter handles non-image MIME; thumbnail job (ffmpeg first-frame / PDF first-page).
- Migration via `/db-migration-author` (idempotent, tenant-scoped — the table is already org-stamped).

**UI:**

- `PhotoThumb` → `MediaThumb` with a play badge for video; lightbox renders `<video controls>` for video and a
  PDF viewer (or new-tab) for documents.
- Begin the gradual `LibraryPhoto` → `LibraryMedia` type rename (kept internal until this ships).

### 4.3 Duplicate / near-duplicate detection

- Perceptual hash on upload (extend the `analyze` cron; store on `photo_analysis` or a new column).
- Library filter `hasDuplicates=true`; badge on tile; bulk action "Review duplicates".

### 4.4 Activity / provenance rail (inside the inspector)

- The `PhotoContextPanel` already shows source/uploader/analysis. Add a read-only timeline section fed by the
  shared `EventTimeline` primitive (`src/components/ui/EventTimeline.tsx`) via an adapter over `audit_logs` +
  `inventory_events` for the photo's entity: "Uploaded → Analyzed → Mirrored to NAS → Shared". Follow
  `.claude/rules/display/reference-timeline.md` (adapt to `TimelineItem[]`, don't fork a timeline).

### 4.5 Optional internal rename

If video ships: rename `PhotoLibraryPage` → `MediaLibraryPage`, `components/photos` → `components/media`,
`LibraryPhoto` → `LibraryMedia` (large mechanical PR; do last, behind a clean commit).

---

## 5. File Change Map (Summary)

| Phase | New files | Primary edits |
|-------|-----------|---------------|
| 0 | — | `sidebar-navigation.ts`, `sidebar-titles.ts`, `permission-registry.ts`, `ops/photos/page.tsx`, `PhotoLibrarySidebarPanel.tsx`, `intent-router.ts`, E2E specs |
| 1 | `useMediaLibraryShortcuts.ts`, `MediaLibraryShortcutsModal.tsx`, `media-library-bulk-share.spec.ts` | `PhotoLibraryPage.tsx`, `download-zip/route.ts`, (opt) `PhotoLibraryToolbar.tsx` |
| 2 | migration, `saved-views-queries.ts`, `/api/photos/saved-views{,/[id]}/route.ts`, `useMediaLibrarySavedViews.ts`, `MediaSavedViewsSection.tsx`, `/api/photos/library/ids/route.ts` | `audit-logs.ts`, `queries/library.ts`, `usePhotoSelection.ts`, `PhotoLibraryToolbar.tsx`, `PhotoLibrarySidebarPanel.tsx`, `usePhotoLibrary.ts`, `route-permission-manifest.test.ts` |
| 3 | `QuickLookOverlay.tsx`, `CompareView.tsx`, `MediaLibraryDropZone.tsx` | `CommandBar.tsx`, `PhotoCard.tsx`, `PhotoListView.tsx`, `PhotoLibraryHeader.tsx`, `PhotoLibraryPage.tsx` |
| 4 | semantic-search route, mime/media_kind migration, `MediaThumb.tsx`, provenance adapter | storage layer, `queries/library.ts`, `analyze.ts`, `PhotoContextPanel.tsx` |

---

## 6. Testing Strategy

### Unit tests

| Area | File | Tool |
|------|------|------|
| Saved-view filter serialization (round-trip) | `library-filter-state.test.ts` (extend) | node:test |
| Saved-views queries (create/list/update/delete, org+staff scoping) | `saved-views-queries.test.ts` (new) | `/domain-unit-test` |
| `listPhotoLibraryIds` count vs list WHERE parity + cap | `library.ids.test.ts` (new) | node:test |
| Shortcut hook focus guard (input vs grid) | `useMediaLibraryShortcuts.test.ts` (new) | node:test |
| `usePhotoSelection.selectIds` set semantics | extend selection test | node:test |

### E2E (Playwright)

| Spec | Covers |
|------|--------|
| `photos-gcs-upload.spec.ts` (verify exists) | Page load, renamed heading/title |
| `media-library-bulk-share.spec.ts` (new) | Copy links, share page, ZIP from toolbar; 200-cap; `photos.share` gate |
| `media-library-shortcuts.spec.ts` (new) | Grid `1`–`5`, `⌘A`, `Esc`, `?`; focus guard |
| `media-library-saved-views.spec.ts` (new) | Save/apply/rename/delete/share view |
| `media-library-select-all-matching.spec.ts` (new) | Banner → select-all → cap toast |
| `photo-library-folders.spec.ts` (verify) | Folder drill regression |
| `photos-library-deep-link.spec.ts` (new/verify) | Deep links unchanged (`?receivingId=`, `?poRef=`, claims) |

Scaffold new specs with the `/e2e-spec-writer` skill (matches `global-setup.ts` + existing fixtures).

### Manual QA checklist (per phase)

- [ ] Receiving → "Open in media library" deep link resolves
- [ ] Packer realtime refresh still invalidates library (`usePackerPhotosRealtimeRefresh`)
- [ ] Zendesk bulk attach from selection unchanged
- [ ] Label editor bulk apply unchanged
- [ ] NAS/Drive backup footer still works (`PhotoLibraryNasBackup`)
- [ ] Lightbox nav/inspector/`i` toggle unaffected
- [ ] Permission-denied paths: `photos.view`-only user sees no share actions; `download-zip` 403s

---

## 7. Permissions & Audit

| Action | Permission |
|--------|------------|
| View library | `photos.view` |
| Delete photo | per-entity via `PERM_BY_ENTITY_TYPE` (photo DELETE route) |
| Edit labels | `withAuth` on `/labels` route (+ `photos.manage` for bulk label editor) |
| Share links / share page / ZIP | `photos.share` (harden `download-zip` to actually enforce `photos.view`) |
| Upload drop | dynamic `uploadPermissionFor(entityType)` (`receiving.upload_photo`, `packing.complete_order`, `tech.scan_serial`, …) |
| Saved views (personal CRUD) | `photos.view` + ownership (`staff_id`) |
| Saved views (shared management) | `photos.manage` |

**Audit:** saved-view CRUD → `recordAudit()` with new `MEDIA_SAVED_VIEW_{CREATE,UPDATE,DELETE}` /
`MEDIA_SAVED_VIEW` constants. Share endpoints already audit. Never rename existing action/entity values.

---

## 8. Performance & Neon Considerations

| Feature | Risk | Mitigation |
|---------|------|------------|
| `listPhotoLibraryIds` count | Full scan over filtered set | `COUNT(*)` shares the list's WHERE builder; rely on existing org/date/entity-link indexes; cap ids at 500 |
| Saved-views list | Low | One cheap indexed query per page load (`idx_media_library_saved_views_org_staff`) |
| Inspector detail fetch (opt) | N+1 if per-tile | One `GET /api/photos/[id]` per panel open, never per tile |
| Compare mode | 4 full-res images | Use `displayUrl` / `/content?variant=` sized; lazy load |
| Semantic search | High CU | Debounce, cache embeddings, rate-limit per staff, audit |
| Drop-upload | Many concurrent POSTs | Sequential or small concurrency pool; per-file progress |

Run **neon-cost-reviewer** on every Phase 2+ DB/query change (migration, count query, saved-views queries).

---

## 9. Rollout Strategy

| Step | Action |
|------|--------|
| 1 | Phase 0 PR → merge (rename only, zero functional change) |
| 2 | Phase 1 PRs → merge (bulk share/ZIP + zip-perm fix; then grid shortcuts) |
| 3 | Phase 2 PRs → merge (saved views + migration; then select-all-matching; then recents) |
| 4 | Phase 3 split into 3–4 PRs (palette, quicklook+compare, upload, density+list) |
| 5 | Phase 4 as an epic with sub-issues |

**Feature flags:** optional `MEDIA_LIBRARY_SAVED_VIEWS=1` (env, `readBoolEnv`) for a staged Phase-2 rollout, or
per-org via `resolveForOrg`. Not required for Phases 0–1. Semantic search (Phase 4) must be flagged.

**Release notes:** delivered via commit subjects (`generate-release-notes.mjs`), one clear subject per phase.

---

## 10. Success Metrics

| Metric | Baseline | Target (30 days post Phase 2) |
|--------|----------|-------------------------------|
| Time to share 10+ photos | Manual one-by-one | <30s via share page |
| Filter re-application clicks | ~5–8 per session | 1 (saved view) |
| Bulk ZIP downloads/week | 0 (unexposed) | measurable usage |
| "Select all" mismatch complaints | Occasional | ~0 (matching-filter selection) |
| Support tickets mentioning "can't find photos" | Track in Zendesk | −30% |
| Library page sessions/day | PostHog | +20% |

---

## 11. Open Questions

1. **Shared saved views:** can any `photos.view` user create org-shared views, or only `photos.manage` holders?
   (Recommend: create personal freely; `is_shared` toggle requires `photos.manage`.)
2. **Select-all cap:** is 500 enough for the largest bulk-share workflows, or do we need a streamed/chunked path?
3. **Upload in library:** always require a PO/entity, or allow "unlinked" uploads to a staging entity type?
4. **Compare mode:** needed for Phase 3 v1, or defer to 3b?
5. **Video:** is mobile packing already capturing video that will need library support soon (drives Phase 4 priority)?
6. **Permission rename:** ever rename `photos.*` → `media.*`, or keep the ids forever (labels already say "media")?
7. **`download-zip` enforcement:** confirm no external caller relies on the current lax gate before hardening.

---

## 12. Recommended PR Sequence

```
PR-1  feat(media): rename Photo Library → Media Library (Phase 0)
PR-2  feat(media): bulk copy-links, share page, ZIP in toolbar + zip perm fix (Phase 1a)
PR-3  feat(media): grid keyboard shortcuts + cheat sheet (Phase 1b)   [lightbox nav already exists]
PR-4  feat(media): (optional) lightbox detail-fetch enrichment (Phase 1c)
PR-5  feat(media): saved filter views + migration + audit (Phase 2a)
PR-6  feat(media): select-all-matching (ids endpoint + selectIds) + page-size hygiene (Phase 2b)
PR-7  feat(media): recents + pinned sidebar sections (Phase 2c)
PR-8  feat(media): media commands in CommandBar (Phase 3a)   [palette already exists]
PR-9  feat(media): quick look + compare mode (Phase 3b)
PR-10 feat(media): upload drop zone (Phase 3c)
PR-11 feat(media): density slider + list-view upgrades + hover meta (Phase 3d)
PR-12+ epic(media): semantic search, video/PDF, duplicates, provenance rail (Phase 4)
```

---

## 13. Effort Summary

| Phase | Scope | Estimate | Cumulative |
|-------|-------|----------|------------|
| 0 | Rename + copy | 0.5–1 day | ~1 day |
| 1 | Bulk share/ZIP wire + zip-perm fix + grid shortcuts | 2–4 days | ~5 days |
| 2 | Saved views + select-all-matching + recents | 5–8 days | ~13 days |
| 3 | Palette entries, quicklook, compare, upload, density/list | 7–11 days | ~24 days |
| 4 | Semantic search, video/PDF, duplicates, provenance | 15–25+ days | ~49 days |

**Highest-ROI starting point:** PR-1 (rename) → PR-2 (bulk share/ZIP). The entire share/ZIP backend and hook
already exist (`usePhotoShareLinks.createSharePage` / `downloadZip`); PR-2 is mostly wiring three
`SelectionAction`s and hardening one route.

---

## Appendix A — Ground-truth deltas from the original outline

The following outline assumptions were **corrected** after verifying `main` (kept here so reviewers don't
re-introduce them):

| Original claim | Reality |
|----------------|---------|
| "Lightbox lacks context panel" | Panel + `i` toggle already render in the library lightbox (`toGalleryInputs` attaches `PhotoMeta`). |
| "No keyboard shortcuts in grid/lightbox" | Lightbox nav (`Esc`/`←`/`→`/`+`/`-`/`0`/`r`/`i`) already exists in `usePhotoGallery`; only grid-level shortcuts are missing. |
| "No command palette" | `CommandBar.tsx` (cmdk, `⌘K`) already exists app-wide; extend it. |
| "`PHOTO_LIBRARY_PAGE_SIZE = 24`" governs paging | The hook hardcodes `limit=48`; the constant is unused (dead). |
| "Verify library returns `total`" | It does **not** — cursor + `hasMore` only; needs a new count. |
| `usePhotoSelection` has `selectAll`/`exitSelectMode`/`setSelectMode` | Only `selectAll`/`clear` are in the hook; select-mode + `exitSelectMode` are page-level state; **no `selectIds`**. |
| Add a release note to `release-notes.json` | That file is git-log-generated; deliver via commit subject. |
| `download-zip` gated by `photos.view` | The `gate.denied` branch is an empty no-op — effectively session-only; must be hardened. |
| Nav icon options `Images`/`Image` | `Image` exists; `Images` does **not** (add it or use `Image`). Current icon is `Camera`. |
| `GET /api/photos/[id]` detail exists to wire | No JSON detail route exists (only DELETE, `/content`, `/labels`). |
