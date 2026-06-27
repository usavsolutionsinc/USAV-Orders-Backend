# Docs-update work order — Google Drive photo backup

What needs to change in `docs/` (and a couple of repo files) so the documentation reflects the
Google Drive photo-backup integration shipped 2026-06-26. The feature code is done; this is the
**documentation** follow-up.

Legend — **Type:** `NEW` (create) · `EDIT` (hand-edit) · `REGEN` (run a generator) · `MANUAL`
(blocked from tooling, edit by hand). **Priority:** P1 = do before/with merge · P2 = soon · P3 = nice-to-have.

---

## P1 — Integrations catalog (the canonical home for this feature)

The integrations docs follow a fixed pattern: an index table in `docs/integrations/README.md` that
links each provider to a per-provider doc. Google Drive must slot into that pattern.

### 1. `docs/integrations/google-drive.md` — **NEW** (P1)
Create the per-provider doc, mirroring the shape of `docs/integrations/google-sheets.md` /
`amazon.md` / `zoho.md`. It should cover (most of this can be lifted from
`docs/google-drive-backup-setup.md`, which stays as the deep setup runbook):
- **Purpose:** per-tenant "Sign in with Google" backup of photo originals to storage the tenant owns
  (GCS-cost offload).
- **Auth model:** OAuth `authKind: 'oauth'`, scope `drive.file` only; tokens in the
  `organization_integrations` vault (provider `google_drive`); shared app client via
  `GOOGLE_DRIVE_CLIENT_ID/SECRET/REDIRECT_URI`.
- **Routes:** `/api/integrations/google-drive/{connect,callback,health}`,
  `/api/photos/drive-backup`, cron `/api/cron/photos/drive-mirror`.
- **Storage model:** a non-primary `photo_storage` row (`provider='google_drive'`,
  `object_key=<driveFileId>`); read-back fallback in `read-bytes.ts`.
- **Permission:** `integrations.google_drive`.
- **Status:** Live (Phase 1 = mirror). Phase 2 (GCS eviction) = planned.
- **Link out** to `../google-drive-backup-setup.md` for the Google Cloud Console steps.

### 2. `docs/integrations/README.md` — **EDIT** (P1)
- Add a **"Storage & Backup"** entry/section and a provider-index table row:

  | **Google Drive** | Storage & Backup | `oauth` | oauth | — (backup) | **Live** (Phase 1 mirror) | [google-drive.md](./google-drive.md) |

- In the intro, the line _"A `Record<IntegrationProvider,…>` makes missing a provider here a compile
  error"_ is now satisfied for `google_drive` — no change needed, but verify the prose still reads true.
- Optionally note Drive under "The two integration patterns" as a **hand-built OAuth** provider (not Nango).

### 3. `docs/integrations/token-sot-consolidation-plan.md` — **EDIT** (P1)
This doc enumerates the per-provider vault credential shapes. Add the `GoogleDriveCredentials` shape
(`clientId, clientSecret, refreshToken, accessToken?, expiresAt?, accountEmail?, rootFolderId, scope`)
and note it's OAuth-connected with **no env fallback** (unlike USAV's legacy providers).

---

## P1 — Repo files that pair with the docs

### 4. `.env.example` — **MANUAL** (P1, hook-blocked)
The `.env*` edit hook blocks tooling. Add these blank keys by hand (full notes in
`docs/google-drive-backup-setup.md` §2):
```
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REDIRECT_URI=
PHOTOS_DRIVE_FOLDER_NAME=
PHOTOS_DRIVE_MIRROR_AFTER_DAYS=
PHOTOS_DRIVE_BACKUP_ENABLED=
```

### 5. `docs/google-drive-backup-setup.md` — **already created** (P1, verify)
The Google Cloud Console runbook + env table + ops flow. No change needed unless §1–§3 above want to
de-duplicate; keep this as the single deep setup reference and link to it from `google-drive.md`.

---

## P2 — Generated docs (re-run the generator; do not hand-edit)

### 6. `docs/security/route-permissions.json` — **REGEN** (P2, already done once)
Regenerated during the build (`npm run audit-route-auth:emit`, 686 → 689 routes). Re-run if routes
change again. Generated artifact — never hand-edit.

### 7. `docs/tenancy/*.generated.*` — **REGEN** (P2)
`coverage.generated.json`, `org-id-coverage.generated.md`, `route-scoping-audit.generated.md`,
`route-audit.generated.json` enumerate every route/table for tenant-scope coverage. The 6 new routes
+ the new `organization_integrations`-read paths should appear. Regenerate with:
```
npm run tenancy:audit   # node scripts/tenancy-coverage.mjs && node scripts/tenancy-route-audit.mjs
```
Confirm the Drive routes land correctly (callback is an intentional OAuth exemption).

---

## P3 — Architecture / photo-storage / cross-references (nice-to-have)

### 8. Photo cold-storage cross-reference — **EDIT** (P3)
There is no single "photo storage architecture" doc; the closest is
`docs/nas-photos-production-plan.md` (the GCS→NAS cold-storage mirror). Add a short note there (or in a
new `docs/photo-storage-providers.md`) that Google Drive is now a **parallel cold-storage target** with
the same job/cron/`photo_storage`-row machinery — so future readers see both mirror destinations in
one place.

### 9. Hand-maintained diagrams — **EDIT** (P3, already stale)
`docs/diagrams/02-api-surface.md` and `03-page-to-api.md` are hand-drawn mermaid with hardcoded route
counts (they say "264 routes" vs ~689 actual — already stale). Adding the Drive routes is optional and
low-value until those diagrams are refreshed wholesale. `05-module-graph.*` is depcruise-generated
(`npm run diagrams`) and will pick up the new modules on next regen.

### 10. `docs/auth-coverage.md` — **no change** (P3)
This is a dated Phase-0 baseline **snapshot** (2026-05-17), not a live per-route inventory — leave it.
Live route-gating truth is `docs/security/route-permissions.json` (item 6).

### 11. `docs/settings-registry.md` — **no change** (P3)
Drive backup is gated by the presence of an active `google_drive` vault connection, **not** a Settings
Registry key, so nothing to add here. (Flagged explicitly so a reader doesn't go looking.)

### 12. Roadmap / commercialization — **EDIT** (P3, optional)
`docs/saas-commercialization-plan.md` (and/or `docs/roadmap/gap-closure-plan.md`): "bring-your-own-Drive
storage offload" is a billing/positioning angle worth a line, and **Phase 2 (GCS eviction)** is an open
roadmap item — see `docs/google-drive-backup-setup.md` §5.

---

## Quick checklist

- [ ] P1 — `docs/integrations/google-drive.md` created
- [ ] P1 — `docs/integrations/README.md` index row + "Storage & Backup" added
- [ ] P1 — `docs/integrations/token-sot-consolidation-plan.md` shape added
- [ ] P1 — `.env.example` keys added (manual)
- [ ] P2 — `npm run audit-route-auth:emit` (done) + `npm run tenancy:audit` re-run
- [ ] P3 — photo cold-storage cross-reference; diagrams; roadmap note
