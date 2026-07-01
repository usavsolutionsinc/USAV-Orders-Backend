# Cycle Forge — SaaS branding & naming plan

> **Status:** Approved direction, implementation not started.  
> **Goal:** Transition from dogfood (USAV-hardcoded copy) to industry-standard multi-tenant SaaS branding: **Cycle Forge** as the platform product; **workspace name from the database** for tenant-specific surfaces.

---

## 1. Executive summary

The app is moving from a single-tenant internal tool toward a commercial SaaS. Branding must follow the standard **product / workspace** split:

| Layer | Name (dogfood tenant) | Source of truth |
|-------|----------------------|-----------------|
| **Product (platform)** | Cycle Forge | Code constants + env |
| **Workspace (tenant)** | USAV Solutions | `organizations.name` |
| **Tenant letterhead** | USAV address, phone, email | `organizations.settings` (new fields) |
| **Platform support** | support@cycleforge.ai | Code constant |

**Rule:** If every customer sees the same thing → **Cycle Forge**. If it answers “whose warehouse is this?” → **workspace from DB**.

---

## 2. Decisions log (interview, 2026-07-01)

| Topic | Decision |
|-------|----------|
| Product vs workspace visibility | **Standard SaaS split** — Cycle Forge on install/login/chrome; workspace name in-app |
| Dogfood workspace name | Keep **`USAV Solutions`** (`organizations.name`) |
| Printed repair forms & receipts | **Workspace/org name** + tenant letterhead (not platform branding) |
| Desktop app & PWA install name | **Cycle Forge** (one app for all workspaces) |
| Platform support email | **support@cycleforge.ai** |
| Browser tab (authenticated) | **`{Page} · {Org name}`** — e.g. `Receiving · USAV Solutions` |
| AI assistant | **Cycle Forge AI** (platform, same for all tenants) |
| Warehouse bin/rack labels | **`{Org name} Warehouse Rack/Location`** from `organizations.name` |
| Favicon | **Cycle Forge only** — no per-tenant favicon; orgs may upload **logo** for in-app use |
| Signup field label | Rename **Company name** → **Workspace name** → `organizations.name` |
| Tenant letterhead | **Add org settings** for address, phone, email, logo (used on repair forms & receipts) |
| Passkeys (WebAuthn RP name) | **Cycle Forge** |
| Implementation order | **Plan first** — code in phased rollout after sign-off |

### Open items (confirm before Phase 1 code)

| # | Question | Options / notes |
|---|----------|-----------------|
| 1 | PWA `short_name` | `Cycle Forge` vs `CF` vs `Forge` |
| 2 | `settings.brand.name` vs `organizations.name` | Same value, or short alias (e.g. org = legal name, brand = “USAV”)? |
| 3 | Dogfood tenant receipt email | Keep `info@usavsolutions.com` in letterhead vs new address? |
| 4 | External integration copy | Zendesk comments: “closed in **Cycle Forge**” vs “USAV Orders”? |
| 5 | Icon assets | Cycle Forge favicon / 192×512 PWA assets ready, or placeholder until design? |

---

## 3. Architecture

```mermaid
flowchart TB
  subgraph platform ["Cycle Forge (platform — code constants)"]
    P1[Login / Signup / Marketing]
    P2[Desktop & PWA install name]
    P3[Favicon & WebAuthn RP name]
    P4[Cycle Forge AI]
    P5[support@cycleforge.ai]
  end

  subgraph workspace ["Workspace (per tenant — database)"]
    W1["organizations.name"]
    W2["settings.letterhead + brand.logoUrl"]
    W3[Browser tab suffix]
    W4[Repair forms & walk-in receipts]
    W5[Warehouse label eyebrows]
  end

  platform -->|"user signs in"| workspace
```

### Comparison to industry patterns

| App | Product | Workspace | Tab title pattern |
|-----|---------|-----------|-------------------|
| Notion | Notion | Acme Corp | Page in app; workspace in sidebar |
| Linear | Linear | Acme | Issue · Team |
| **Cycle Forge** | Cycle Forge | USAV Solutions | `{Page} · {Org name}` |

---

## 4. Data model

### 4.1 Existing (underused)

| Field | Location | Today |
|-------|----------|-------|
| Workspace display name | `organizations.name` | Seeded `USAV Solutions`; used in auth session, workspace switcher, invite flow |
| Brand stub | `organizations.settings.brand` | `name`, `logoUrl`, `primaryColor` — editable in Settings → Branding, **not read by any UI renderer** |

### 4.2 New — tenant letterhead

Extend `OrgSettingsSchema` in `src/lib/tenancy/settings.ts`:

```ts
letterhead: z.object({
  addressLine1: z.string().max(120).default(''),
  addressLine2: z.string().max(120).default(''),  // city, state, zip, country
  phone: z.string().max(40).default(''),
  email: z.string().email().or(z.literal('')).default(''),
}).default({}),
```

`brand.logoUrl` continues to serve in-app logo; letterhead fields drive print and on-screen company blocks.

### 4.3 Dogfood seed (migration)

For org `00000000-0000-0000-0000-000000000001`:

| Field | Value |
|-------|-------|
| `organizations.name` | `USAV Solutions` (unchanged) |
| `settings.letterhead.addressLine1` | `16161 Gothard St. Suite A` |
| `settings.letterhead.addressLine2` | `Huntington Beach, CA 92647, United States` |
| `settings.letterhead.phone` | `(714) 596-6888` |
| `settings.letterhead.email` | `info@usavsolutions.com` (pending open item #3) |

Do **not** edit historical migration files; add a new forward migration.

### 4.4 Signup

- UI label: **Workspace name** (replaces “Company name” on `src/app/signup/page.tsx`).
- API: `companyName` body field may be renamed to `workspaceName` (or keep key, change label only — prefer rename for API clarity in a follow-up if breaking clients matters).
- Creates `organizations.name` directly.

---

## 5. Code constants (new module)

Proposed: `src/lib/branding/constants.ts`

```ts
export const PRODUCT_NAME = 'Cycle Forge';
export const PRODUCT_NAME_AI = 'Cycle Forge AI';
export const PLATFORM_SUPPORT_EMAIL = 'support@cycleforge.ai';
export const WEBAUTHN_RP_NAME_DEFAULT = PRODUCT_NAME;
```

Proposed: `src/lib/branding/letterhead.ts`

- `getOrgLetterhead(org: { name: string; settings: OrgSettings })` → merged display block for screen + print HTML.
- Single consumer for repair paper, walk-in receipts, repair UI headers.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `WEBAUTHN_RP_NAME` | `Cycle Forge` | Passkey registration prompt |
| `NEXT_PUBLIC_PRODUCT_NAME` | `Cycle Forge` | Client-visible product name (optional) |

Add blanks to `.env.example`; never commit real secrets.

---

## 6. Copy mapping

### 6.1 Platform-fixed → Cycle Forge

| File | Current | Target |
|------|---------|--------|
| `src/app/layout.tsx` | `USAV Solutions` title/meta (all routes) | **Signed-out:** Cycle Forge. **Signed-in:** `{page} · {org}` via metadata helper |
| `public/manifest.json` | `name`, `description` | Cycle Forge + product tagline |
| `src/lib/auth/webauthn.ts` | RP name `USAV Solutions` | `Cycle Forge` |
| `src/components/settings/sections/AboutSection.tsx` | `USAV Orders`, `support@usavsolutions.com` | Cycle Forge, `support@cycleforge.ai` |
| `src/app/desktop-app/page.tsx` | Install USAV Orders… | Install Cycle Forge… |
| `src/components/desktop-app/DesktopAppDownload.tsx` | USAV Orders CTA | Cycle Forge |
| `electron/main.js` | Window title, offline page, update dialog | Cycle Forge |
| `electron-builder.yml` | `productName: USAV Orders` | `productName: Cycle Forge` |
| `electron-builder.mac-intel-legacy.yml` | same | same |
| `src/components/ai/AiChatConversation.tsx` | USAV Assistant | Cycle Forge AI |
| `src/components/sidebar/AiChatSidebarPanel.tsx` | USAV Assistant | Cycle Forge AI |
| `src/app/ai/page.tsx`, `src/app/ai-chat/page.tsx` | AI Chat — USAV | AI Chat · Cycle Forge |
| `src/lib/email/send.ts` | `USAV Orders <…>` dev From | `Cycle Forge <…>` |
| `src/app/api/warranty/claims/[id]/close/route.ts` | closed in USAV Orders | closed in Cycle Forge (pending open item #4) |
| `src/components/quick-access/PinThisPageButton.tsx` | sentinel `USAV Solutions` | sentinel `Cycle Forge` |
| `src/components/station/InstallPrompt.tsx` | USAV Solutions | Cycle Forge |
| `src/lib/mobile-context-navigation.ts` | fallback `USAV` | `Cycle Forge` |

**Note:** Changing Electron `productName` changes log/data paths (`~/Library/Logs/Cycle Forge/`). Document for existing desktop users.

### 6.2 Workspace-dynamic → database

| File | Current | Target |
|------|---------|--------|
| `src/lib/repair/repair-paper-html.ts` | Hardcoded USAV Solutions + address | `getOrgLetterhead()` |
| `src/app/api/repair-service/print/[id]/route.tsx` | Uses `repairPaperLetterheadHtml()` | Pass org context into letterhead helper |
| `src/components/repair/RepairServiceForm.tsx` | Hardcoded header | Org name + letterhead from session/API |
| `src/components/repair/RepairAgreement.tsx` | Hardcoded header | Same |
| `src/app/api/walk-in/receipt/[id]/route.tsx` | Hardcoded footer | Org name + letterhead |
| `src/components/barcode/bin-label-printer/PrintLabel.tsx` | USAV Warehouse Location | `{org.name} Warehouse Location` |
| `src/components/barcode/bin-label-printer/GiantPreviewPanel.tsx` | same | same |
| `src/components/barcode/rack-printer/RackPrintLabel.tsx` | USAV Warehouse Rack | `{org.name} Warehouse Rack` |
| `src/components/barcode/rack-printer/GiantRackPreviewPanel.tsx` | same | same |
| `src/components/sidebar/WarehouseSidebarPanel.tsx` | USAV INV | Derive from org or generic “Inventory” |
| `src/components/inventory/sidebar/InventorySidebarFooter.tsx` | USAV INVENTORY | `{org.name}` or shortened brand |
| `src/components/settings/sections/OrganizationSection.tsx` | brand placeholder `USAV` | `USAV Solutions` or empty |

Surfaces **already correct** (read `user.organizationName`):

- Workspace switcher, sign-in picker, invite flow, Quick Access popover org eyebrow.

### 6.3 Tests & fixtures

| File | Change |
|------|--------|
| `tests/e2e/repair-intake-flow.spec.ts` | Assert org name from seed (USAV Solutions) or fixture |
| `vision/scripts/test_golden.py` | Update OCR golden if printed letterhead text changes |
| `tests/e2e/receiving-silent-print.spec.ts` | Test markers only — optional rename |

---

## 7. Out of scope (do not rename)

These are identifiers, infrastructure, or historical records — not user-facing product branding.

| Category | Examples |
|----------|----------|
| Tenancy constants | `USAV_ORG_ID`, `DOGFOOD_ORG_ID` |
| GitHub / package IDs | `usavsolutionsinc`, `USAV-Orders-Backend`, `usav-orders` |
| NAS infrastructure | `/Volumes/USAV Media`, hostname `USAVSolutions` |
| Platform account slugs | `EBAY_USAV`, `EBAY_REFRESH_TOKEN_USAV` |
| Email domains (unless explicitly migrated) | GitHub `author: usavsolutionsinc` in release-notes.json |
| Event bus / code identifiers | `USAV_REFRESH_DATA` |
| Product SKUs / inventory | `USAV-CBL-04`, unit UID format |
| Historical SQL migrations | `2026-05-22_organizations_tenancy.sql` — use new migration instead |
| Observability | `app: 'usav-orders'`, UPS `transactionSrc` |

---

## 8. Implementation phases

| Phase | Scope | Deliverables | Est. files |
|-------|--------|--------------|------------|
| **0** | Spec sign-off | This doc + open items resolved | — |
| **1** | Branding module | `src/lib/branding/constants.ts`, `letterhead.ts`, types | ~3 new |
| **2** | Org settings + migration | Letterhead schema, dogfood seed, admin profile API | migration + settings + API |
| **3** | Auth-aware metadata | Tab title: signed-out = Cycle Forge; signed-in = `{page} · {org}` | `layout.tsx`, metadata helper |
| **4** | Remove hardcoded USAV Solutions | Repair, receipt, InstallPrompt, WebAuthn, manifest, PinThisPage | ~12 |
| **5** | Product rename | USAV Orders → Cycle Forge (Electron, About, desktop, email From) | ~8 |
| **6** | Dynamic labels | Warehouse labels, AI, signup field, sidebar footers | ~10 |
| **7** | Icon assets | Cycle Forge favicon, `icon-192.png`, `icon-512.png`, desktop icons | `public/*`, electron-builder |
| **8** | Wire `brand.logoUrl` | Header/settings/invite surfaces read org logo | ~5 |

**Dependency order:** 1 → 2 → 3 → 4 (letterhead) can parallel 5 (product rename). Phase 7 can slip until design assets exist.

### Acceptance criteria (Phase 4–6 complete)

- [ ] No remaining `USAV Solutions` string literals in `src/` (except tests/fixtures referencing dogfood org name from DB).
- [ ] Signed-in browser tab shows `{Page} · USAV Solutions` on dogfood tenant.
- [ ] Repair print + walk-in receipt render letterhead from org settings.
- [ ] About page shows Cycle Forge + support@cycleforge.ai.
- [ ] Passkey registration shows “Cycle Forge” in password manager.
- [ ] PWA manifest `name` is Cycle Forge.
- [ ] E2E repair intake still passes.

---

## 9. Prior audit reference

Full grep inventory from initial scan (2026-07-01): 17 files with exact `USAV Solutions`, ~35–40 files for full user-facing rebrand. See git history or re-run:

```bash
rg -i 'USAV Solutions' --glob '!node_modules'
rg 'USAV Orders' src/ electron/ public/
```

---

## 10. Related docs

- `docs/CYCLE-FORGE-WAVE-REVIEW.md` — roadmap wave review (engineering tasks)
- `docs/second-tenant-onboarding-checklist.md` — multi-tenant onboarding
- `src/lib/tenancy/settings.ts` — org settings schema (brand stub today)
- `src/components/settings/sections/OrganizationSection.tsx` — Branding UI (editor only)

---

## 11. Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-07-01 | Branding interview + audit | Initial spec from stakeholder decisions |
