# Beta Intake Funnel — $50 Refundable Floor-Map Application

**Status:** ~30% SHIPPED (re-verified 2026-07-09; "nothing built yet" was stale) — the lighter
`beta_waitlist` tier is live (2026-06-28 migration, public `/api/beta/{spots,waitlist}` routes,
proxy allowlist, confirmation email). Residual: the $50 refundable `beta_applications` pipeline
(migration + public apply route + review queue + Stripe payment link) is genuinely unbuilt.
**Owner surface:** the CycleForge marketing site (separate repo,
`/Users/icecube/repos/CycleForge`, landing page at `/`) for all visitor-facing UI;
this repo for the apply API + `beta_applications` storage.
**Brand:** CycleForge (decided 2026-06-11; replaced the "Flowstation" placeholder).
**Companion plans:** `docs/operations-studio/operations-studio-plan.md` (the product this
funnel feeds). The landing page was built in this repo on 2026-06-11 and moved to the
CycleForge repo the same day for separation of concerns.

---

## 1 · Why this exists

Deep-research verdict (2026-06-11, 21 verified claims): the "visual ops builder for SMB
used-goods resellers" niche is **open** — no incumbent combines a node canvas, used-goods
modules (grading/QC/repair) beyond electronics, marketplace orientation, and SMB pricing.
The beta funnel's job is to validate demand and harvest structured operational data from
many companies at once **while the Live Loop (engine tap → Studio Live lens) is being
built**, not after.

Key funnel decision: **async-first, no forced calendar slot.** Reseller owners won't
commit to a Calendly call at application time. The synchronous call is an *optional
upgrade* offered in the approval email, not the gate.

Key economic decision: if the $50 doesn't buy a meeting, it must buy a **tangible async
deliverable** or it's refundable-donation theater. The deliverable is *their floor,
mapped*: their operation pre-built as a canvas graph + a short personalized walkthrough
video, delivered by email.

## 2 · The funnel

```
visitor on /welcome
   │
   ├── low intent ──► Waitlist (free): email + 3 picks ──► status: waitlist
   │
   └── high intent ─► Application form (~10–12 q, 3–4 min)
                         │  submit → POST /api/beta/apply → status: applied
                         ▼
                      Stripe Payment Link ($50, "fully refundable, credited at signup")
                         │  paid → status: paid (v1: manual reconcile; v2: webhook)
                         ▼
                      Auto-confirmation email (instant, Resend shim)
                         │  "floor map being built — reply within 48h"
                         ▼
                      APPROVAL EMAIL (manual, ≤48h SLA)        status: approved
                         │  contains: their mapped floor (image/link)
                         │           + 3–5 min personalized walkthrough video
                         │           + cohort spot + founding-pricing lock
                         │           + OPTIONAL booking link (15/45 min, their pick)
                         ▼
              (optional) call booked ── status: call_booked
                         ▼
                      converted → tenant onboarding          status: converted
                      (refunded is a valid exit from any state, no questions)
```

Approval is **manual on purpose**: it keeps "N spots" honest, lets us refund bad fits
instantly, and forces us to actually study one company's operation per approval — which
is the data-gathering point of the whole exercise.

## 3 · The deliverable ($50 = their floor, mapped)

Per approval, produce:
1. **Floor map** — their stations/lanes seeded as a graph using the reseller template
   vocabulary (same ontology as `src/lib/workflow/` definitions + the `/reseller-flow`
   skill). v1: an image/screenshot of the composed canvas; later: a read-only share link
   into the Studio.
2. **Walkthrough video** — 3–5 min screen recording narrating *their* flow on the canvas:
   where units enter, where they stall today, what the system would do at each station.
   Watchable from a phone at the packing table.
3. **Cohort confirmation** — founding pricing locked, $50 credited in full at signup.

Production cost per approval must stay ≤ ~30 min (template doc + graph seed + one-take
recording) or the manual step becomes the funnel's bottleneck.

**Strategic side effect:** every approval is Phase-0 practice — a real company's graph
seeded in the template system. The folder of floor maps doubles as the template library
and roadmap evidence for the Studio build.

## 4 · Application form — ontology-based, not freeform

The form asks questions **in the product's own vocabulary** so answers aggregate
structurally across companies and map directly onto `workflow_definitions/nodes/edges`.

Question set (~10–12, target 3–4 minutes; deep dive belongs on the optional call):

| # | Question | Type | Maps to |
|---|---|---|---|
| 1 | Business type (eBay store / FBA-heavy / liquidation / repair+resale / mixed) | single pick | segment |
| 2 | Monthly unit volume (bands) | single pick | sizing |
| 3 | Which stations does your floor run? (Receiving, Testing/QC, Repair, Listing, Packing, FBA Prep, Returns/Support) | multi pick | graph nodes |
| 4 | What happens when a unit fails testing? (fix it / part it out / sell as-is / trash) | single pick | repair-loop edges |
| 5 | Sales channels + rough split | multi pick + % | listing lanes |
| 6 | Current tools (spreadsheets / Zoho / SKULabs / Vendoo-ListPerfectly / other) | multi pick | integration priority |
| 7 | What do you scan today, if anything? (tracking / serials / SKUs / nothing) | multi pick | scan-first readiness |
| 8 | Team size on the floor | band | seats |
| 9 | Do you grade condition? How? | single pick + text | grading module |
| 10 | The ONE workflow you'd fix first | free text | roadmap voting (paid-intent weighted) |
| 11 | What would make this a no-brainer? | free text | objection mining |
| 12 | Anything unusual about your operation? | free text, optional | edge cases |

**Waitlist tier** asks only: email, business type, volume band, top pain (pick).

One honest line on the form: *"We use this to map your operation before we reply — it's
not a marketing quiz."* (Also true, also good marketing.)

## 5 · Data model

New table `beta_applications` (org-less — these are **pre-tenants**; no `organization_id`):

```
beta_applications
  id              uuid pk
  email           text not null
  company_name    text
  tier            'waitlist' | 'application'
  answers         jsonb not null          -- keyed by the ontology question ids above
  status          'waitlist' | 'applied' | 'paid' | 'approved'
                  | 'call_booked' | 'converted' | 'refunded' | 'rejected'
  stripe_ref      text                    -- payment link client_reference_id / session id
  approval_note   text                    -- internal: why approved/rejected
  floor_map_url   text                    -- deliverable artifact link (NAS/Blob/share link)
  created_at / updated_at / status_changed_at
```

- Migration goes through the standard `/db-migrate` flow (`db:generate` → reviewed SQL →
  `db:migrate`). No FK into tenant tables; a `converted` application links forward to the
  created org in a later column (`converted_org_id`) when tenant onboarding exists.
- The status column makes this table double as the **pipeline tracker** — no separate CRM.

## 6 · API + routing

- `POST /api/beta/apply` — public, unauthenticated, **in this repo** (the data belongs
  next to the future tenant tables). Zod-validated against the question schema; honeypot
  field + basic rate limit (IP, e.g. 5/hour) since it's an open POST. Writes `applied`
  (or `waitlist`) row, fires auto-confirmation email, returns the Stripe Payment Link URL
  with `client_reference_id=<application id>`.
- The form lives on the CycleForge marketing site and POSTs **cross-origin** to this
  endpoint → the route must send CORS headers allowlisting the marketing domain (and
  localhost:3001 for dev). Alternative considered and rejected for v1: a separate DB in
  the marketing repo (splits pre-tenant data away from the system it converts into).
- Add `/^\/api\/beta\//` to `PUBLIC_PATHS` in `src/proxy.ts` (same pattern as
  `/api/auth/`). No page-route registry changes — all visitor UI is in the other repo.
- Admin read: v1 can be SQL/Drizzle Studio. v2: a small admin list view (status filter,
  answer detail, approve/reject buttons that fire the templated email) — follow the house
  CRUD pattern (see crud-endpoints-initiative memory) when it graduates to UI.

## 7 · Payments — Stripe Payment Link, zero payments code

- One **Payment Link** created in the Stripe dashboard: $50, "Beta floor-map application",
  statement descriptor set, `client_reference_id` passed via URL.
- v1 reconcile is **manual** (Stripe dashboard → flip status to `paid`); volume will be
  tens, not thousands. v2: extend the existing Stripe webhook surface
  (`/api/billing/webhook` is already a public path) with `checkout.session.completed` →
  auto-flip status.
- Refund promise is operational policy, not code: refund from the dashboard, flip status
  to `refunded`. **"Fully refundable, any time, no questions"** appears verbatim on the
  form, the payment page, and both emails.

## 8 · Emails

Transport: existing shim `src/lib/email/send.ts` (Resend when `RESEND_API_KEY` set,
console in dev). Needs `EMAIL_FROM` + a real Resend domain before launch.

1. **Auto-confirmation** (instant, code): receipt of application + payment expectations +
   the SLA — *"Your floor map is being built. You'll hear from a human within 48 hours."*
2. **Approval** (manual, templated doc — not code in v1): deliverable links + cohort
   confirmation + optional booking links (15-min and 45-min variants) + refund reminder.
3. **Rejection** (manual, rare): instant refund + honest one-liner + waitlist placement.

**SLA discipline is the trust mechanism of an async funnel**: a refundable $50 followed by
silence generates chargebacks and bad word-of-mouth. 48h response, no exceptions; if
volume exceeds capacity, close applications ("cohort full") rather than slip the SLA.

## 9 · Landing page changes (CycleForge repo, `src/components/`)

All in the marketing repo (`/Users/icecube/repos/CycleForge`):

- Hero secondary CTA: "Book $50 beta demo call" → **"Get your floor mapped — $50,
  fully refundable"** → routes to the application form (new `/apply` page or inline
  section; the whole site is public, no registry work needed).
- Beta section (`src/components/social.tsx`): reframe perk list from call-framing to
  deliverable-framing (floor map, walkthrough video, founding pricing, optional call,
  credit-at-signup). The booking card becomes the application CTA.
- **Spots counter**: currently hardcoded "7 of 20 spots left" — must become data-driven
  (count of `approved` + `paid` rows, via the apply API) or be removed. A fake counter is
  the one thing in the funnel that can torch trust if discovered.
- Waitlist form stub in `social.tsx`: wire to `POST /api/beta/apply` (`tier: 'waitlist'`,
  cross-origin).
- `BETA_CALL_URL` constant in `src/components/ui.tsx`: repurpose as `APPLY_URL`; real
  booking links move into the approval email only. `TRIAL_URL` needs the real product
  signup URL once the app domain is settled.

## 10 · Aggregation — the actual point

Because answers share one schema, cross-company insight is a query:

- Station prevalence → which template nodes are table stakes vs optional.
- Test-fail handling distribution → how central the repair loop is.
- Tool stack → integration priority ranked by **paid intent** (application tier) vs
  interest (waitlist tier). This is the Zoho-adapter go/no-go evidence.
- Free-text fields (Q10/Q11) reviewed manually per approval; periodic AI summarization
  across all rows can ride the existing hermes-tool-call helper later — not v1.

Funnel metrics worth watching from day one: applied→paid rate (price/deliverable fit),
paid→approved time (SLA), approved→call-booked rate (validates async-first), refund rate.

## 11 · Phasing

- **P-1a (≤1 day):** migration + `POST /api/beta/apply` + proxy public path + waitlist wire-up.
- **P-1b (≤1 day):** application form UI on `/welcome` + Stripe Payment Link constant +
  auto-confirmation email + copy/CTA rework incl. spots-counter fix.
- **P-1c (ops, not code):** approval email template doc, floor-map production checklist,
  refund policy note, Resend domain + `EMAIL_FROM` env.

Runs **in parallel with** Studio Phases 0–3 (seed graph → engine tap → ST1 shell → ST2
Live lens). The funnel collects paid, pre-mapped demand while the loop becomes demoable;
intake data feeds Phase 0 template decisions directly.

## 12 · Non-goals (bloat guard)

No payments code, no scheduling code (links only), no CRM, no admin UI in v1, no AI
summarization in v1, no automated floor-map generation (manual seeding IS the research),
no marketing-email sequences — transactional only.

## 13 · Open questions

1. ~~Brand name~~ — **decided: CycleForge** (2026-06-11). Domain still to register;
   placeholders assume cycleforge.com (`metadataBase`, `TRIAL_URL`, contact email,
   Cal.com slug — all in the CycleForge repo).
2. Price point — $50 chosen for calendar-seriousness; revisit if applied→paid craters.
3. Where deliverable artifacts live (NAS like internal photos vs Vercel Blob vs simple
   share link) — decide at P-1c.
4. Does `waitlist` tier deserve a drip email at cohort-open time, and via what (manual
   BCC v1?).
