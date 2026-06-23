# Local specialist LLM (RTX 5070 Ti / CUDA) + contextual capability advisor — plan

**Status:** proposal · **Created:** 2026-06-22 · **Owner:** platform / ops-studio · **GPU target:** NVIDIA RTX 5070 Ti (Blackwell, sm_120, 16 GB)
**Scope:** one connected initiative with three parts — (A) a **four-layer capability model** that drives an **adaptive-chrome mobile nav**; (B) a **capability advisor** that recommends the business's next hardware/process investment; and (C) a **specialized local LLM served on the 5070 Ti** that drives the advisor's prose and **negates per-tenant cloud LLM calls**. Records what already exists so we don't rebuild it.

> **TL;DR** — You already run a self-hosted, OpenAI-compatible **Hermes gateway**, so ~90% of "no cloud LLM calls" is *done*: the only true cloud LLM leak is **Google Gemini embeddings** (RAG) + optional GCP Vision. The 5070 Ti effort is therefore **not a from-scratch pretrain** (impractical on one card) — it is **specialize-a-small-base (Qwen3-4B-class, QLoRA) and drop it into the existing Hermes slot**. Three layers of the capability model (**entitlement, assignment** via `staff_stations`, and the **Hermes/Ably/tunnel plumbing**) already exist; the only net-new layer is a **capability inventory** (what hardware the org/device physically has). The two loudest risks to flag: **Blackwell sm_120 software maturity** (works on Linux with deliberate version pinning — the "nightly-only" claim is *outdated*, but it is *not* plug-and-play) and the **16 GB three-way contention** (model size × context × {embeddings, multi-LoRA} — you cannot maximize all three). Treat **cloud fallback as a permanent component**, not a crutch, and gate the whole thing on a **Blackwell bring-up spike + a real-traffic eval set** before committing to any economics.

---

## 0. Origin & scope

Surfaced from a mobile-nav design question ("the bottom nav bar is getting crowded") that expanded into: (1) make nav **contextual and permission-safe** so staff can't reach stations they aren't allowed on; (2) make the system **configurable per-station/per-business** so it "catches businesses where they are and grows with them" (some have phone scanner cases, some are photo-only + desktop scan); (3) **train a specialized local model** so tenants' AI runs on owned hardware instead of cloud APIs; and (4) have the system **advise owners on what to buy next** with **trustworthy, real product links**.

This plan was grounded by two verified deep-research sweeps (26 threads, adversarial fact-check on each) plus a code-seam map and a cloud-LLM usage inventory of this repo. Claims below carry confidence tags where the research flagged a caveat.

---

## 1. What already exists (don't rebuild) — verified against the codebase

| Concern | Already in place | Canonical files |
|---|---|---|
| **Self-hosted LLM** | OpenAI-compatible **Hermes gateway** on `127.0.0.1:8642`, reached from Vercel via Cloudflare tunnel + `x-agent-token`. Powers chat, PO-email extraction, claim drafting, seller messages, disposition classify, sourcing research, photo metadata. **All already local.** | `src/lib/ai/hermes-client.ts`, `src/lib/ai/hermes-tool-call.ts` |
| **Entitlement layer (Layer 1)** | `getEntitlements(orgId)` / `hasFeature()`, `organizations.plan` (trial/starter/growth/pro/enterprise), `organization_feature_flags` table, `resolveForOrg()` (30 s cache), `readBoolEnv()`. `aiCopilot` already gates AI features. | `src/lib/billing/entitlements.ts`, `plans.ts`, `feature-gate.ts`, `src/lib/feature-flags.ts` |
| **Assignment layer (Layer 3)** | `permission-registry.ts` (SoT), `withAuth({permission})`, `effectivePermissionsForStaff()`, and a real **`staff_stations`** table with `getStaffStations()` (`is_primary`). Station assignment is *already modeled*. | `src/lib/auth/permission-registry.ts`, `permissions.ts`, `src/lib/neon/staff-stations-queries.ts` |
| **Companion-scan realtime** | `org:{orgId}:packer:{staffId}` carries a `scan_ready` desktop→phone hand-off; `org:{orgId}:phone:{staffId}` is the phone→desktop photo bridge. "**Phone photo-only, desktop scans, phone updates live**" is *current behavior*. | `src/lib/realtime/channels.ts`, `publish.ts` |
| **Station/node config** | `BlockDefinition` / `NodeDefinition` registries with `configSchema[]`, `requiredPermissions[]`, data-source + action registries. The place a capability slot attaches. | `src/lib/stations/contract.ts`, `src/lib/workflow/contract.ts`, `registry.ts` |
| **Mobile shell** | `SidebarShell`, `HorizontalButtonSlider` (the mode switcher), `?mode=` URL-state. No dedicated bottom-nav component yet. | `src/components/layout/SidebarShell.tsx`, `src/components/ui/HorizontalButtonSlider.tsx` |
| **Vetted SKU catalog (SoT)** | `items` / `sku_catalog` already the identity SoT — the natural grounding catalog for product recommendations. | per `.claude/rules/source-of-truth.md` |

**Net-new work is narrow:** one **capability-inventory layer**, the **advisor/recommender**, the **embeddings migration**, and the **specialist-model train+serve loop**. Everything else is composition over existing seams.

---

## 2. The two halves and how they connect

```
                        ┌─────────────────────────────────────────────┐
   Capability model     │  Layer1 Entitlement  (plan / org flags)      │  ← exists
   (resolves at render) │  Layer2 Capability inventory (HW the org HAS)│  ← NEW
                        │  Layer3 Assignment  (roles × staff_stations) │  ← exists
                        │  Layer4 Device      (what THIS phone can do) │  ← NEW (small)
                        └───────────────┬─────────────────────────────┘
                                        │ resolves
            ┌───────────────────────────┼────────────────────────────┐
            ▼                           ▼                            ▼
   Adaptive-chrome nav         Scan-slot resolution           Capability advisor
   (focus/action/browse)       device-scan / companion /       "what to buy next"
                               manual  (default=companion)      (tabular + grounded LLM prose)
                                                                        │
                                                          prose generated by ▼
                                              Specialized local LLM on the 5070 Ti
                                              (drops into the existing Hermes slot)
```

The capability model is the spine: it decides **what nav chrome renders**, **how scanning resolves per device**, and **what the advisor recommends**. The advisor's *explanations* (and the existing Hermes features) run on the local 5070 Ti model — which is also what removes the cloud dependency.

---

## 3. Part A — the capability model & adaptive-chrome nav

### 3.1 Four layers (model physical capability as a THIRD axis)

The research is unambiguous: **physical capability is a distinct axis from permission and from entitlement** — the browser precedent (`getAvailability()` vs `requestDevice()` vs Permissions-Policy) and IoT/printer ecosystems all model it separately. Keep three independently-queryable facts:

- **presence** — "this org/device *has* a label printer / can scan" (durable),
- **operational state** — "it is online/reachable right now" (telemetry),
- **entitlement/permission** — "this actor *may* use it".

They fail for different reasons (buy hardware vs power it on vs grant access) and need different UX remedies. **Do not collapse capability into the permissions table** (confused-deputy / wrong-SoT trap — a printer breaking should not require a permission edit).

| Layer | Question | Status | Attach point |
|---|---|---|---|
| 1 Entitlement | What is the plan *able* to do? | exists | add `capabilities:{…}` to `Entitlements`; gate with `hasFeature()` |
| 2 **Capability inventory** | What does the org/device physically *have*? | **NEW** | new registry table (below) |
| 3 Assignment | Which actor may act, at which station? | exists | `permission-registry` + `staff_stations` |
| 4 **Device** | What can *this* phone do right now? | **NEW (small)** | per-session capability flags |

### 3.2 The new capability-inventory layer (schema sketch)

Model capability as **typed attributes on an asset/device record**, inherited from an asset-model template (the Snipe-IT / DTDL pattern), not as a config boolean buried in code:

```sql
-- org-level capability inventory (what the business owns)
CREATE TABLE IF NOT EXISTS org_capabilities (
  organization_id  uuid NOT NULL,
  capability       text NOT NULL,         -- 'label_printer_zpl' | 'barcode_scanner_bt' | 'phone_scan_case' | 'paired_desktop'
  count            int  NOT NULL DEFAULT 0,
  meta             jsonb,                 -- model, firmware, asset tag
  PRIMARY KEY (organization_id, capability)
);

-- per-device capability (what THIS phone/station can do)
CREATE TABLE IF NOT EXISTS device_capabilities (
  organization_id  uuid NOT NULL,
  device_id        text NOT NULL,         -- session/device fingerprint
  capabilities     text[] NOT NULL,       -- ['camera_scan','photo','scanner_case']
  updated_at       timestamptz DEFAULT now(),
  PRIMARY KEY (organization_id, device_id)
);
```

Follow this repo's tenancy invariants: `organization_id NOT NULL`, per-org keys, `enforce_tenant_isolation()`, written via `withTenantTransaction(orgId, …)` (see `/db-migration-author`). Resolve at session hydration with the same ~60 s cache pattern as roles. Where possible **discover** capability (an IPP/eSCL handshake, a camera-API feature test) and persist it on enrollment rather than hand-configuring.

### 3.3 Adaptive-chrome nav — three shells, resolved per task

Instead of one crowded bottom bar everywhere, a screen declares which **shell** it renders in:

1. **Focus shell** — pure capture (receiving/packing photos). **No bottom bar.** Only a deliberate top **Done/Close**. The operator can't wander or mis-tap into another station. *Rule: the exit must be obvious and deliberate — never a hidden gesture.*
2. **Action shell** — busy pages with many avenues (picks). Bottom bar = **persistent center Scan + 2–3 quick actions + "More" overflow**. Keep the Scan anchor in the **same center position on every page** (muscle memory); filter the surrounding actions by permission.
3. **Browse/hub shell** — a home launcher of cards showing **only the stations this operator is assigned/allowed**.

Built by composing existing primitives (`SidebarShell` + `HorizontalButtonSlider` + `?mode=`), not a new nav system. Per the `sidebar-mode` skill, new surfaces become **modes**, not ad-hoc panels.

**Scan slot = a resolved capability, not a fixed button.** The center scan element resolves per (station × device × inventory):

| Resolution | When | Phone shows |
|---|---|---|
| `device-scan` | phone has scanner case / camera-scan enabled for clean labels at low volume | center Scan button, live |
| **`companion-scan`** (default) | photo-only phone; desktop scans | **no scan button** — photo capture + live `scan_ready` update over the existing Ably channel |
| `manual-entry` | fallback | type-the-number field |

**Default = `companion-scan`**, which is *exactly today's behavior* — so nothing breaks; buying scanner cases simply *promotes* a station to `device-scan` on capable devices, with **no code change**. Camera-scan eligibility must be gated on **label condition + volume** (see §4.2 camera-scan finding): allow it for clean 1D/QR at low volume; force photo-only for damaged/glare/high-throughput cartons.

> ⚠️ **Security, not just UX:** hiding a tab is the courtesy layer; the `withAuth({permission})` route gate is the enforcement layer. Generate nav server-side from the *same* permission resolution the routes use, and keep both. Never trust a client-supplied station/adapter id.

---

## 4. Part B — the capability advisor ("what to buy next")

### 4.1 The ops-maturity ladder (the recommendation backbone)

Five rungs, decoupling "what equipment to add" from "whether to outsource" (all [high] confidence):

1. **Manual + shipping software** (rate-shop + label generation).
2. **4×6 direct-thermal label printer** — the first capital buy; Rollo/Brother entry → Zebra/Citizen as volume rises.
3. **Scan-to-verify-and-print** at a fixed pack station — WMS-grade validation *without* a WMS (ShipStation/ShipBob native); just needs a barcode scanner + UPC/SKU on product records.
4. **Mobile/cordless (→ wearable) scanning** as pick paths lengthen / zones multiply.
5. **Full WMS** at multi-zone / long pick paths / strict bin accuracy / (3PL) 3+ clients.

Volume bands are **soft guideposts, not hard rules**: <50 orders/day = comfortably in-house, printer/scanner territory; the WMS/3PL conversation sharpens at ~300–500+ orders/month. **Trigger on operational signals** (mis-ship rate, fulfillment >25–30% of team time, longer pick paths) — *no source supplies a defensible single orders/day WMS threshold*, so the advisor must not invent one.

### 4.2 Advisor architecture — tabular decision + grounded LLM prose (NOT an LLM deciding)

The research is decisive: **boolean/categorical "which investment next" decisioning is a tabular problem, not an LLM job.** Gradient-boosted trees (XGBoost/LightGBM/CatBoost) are SOTA on medium tabular data (Grinsztajn 2022); a general LLM scored **F1 ~0.43 vs XGBoost ~0.87** on a comparable numeric decision. So:

- **Decision engine = tabular / rules.** Ship as an **additive stack** in this order (don't jump to bandits — you can't evaluate them without logged data):
  1. **Rules/heuristics** (day-one recommendations + policy guardrails; the ladder above encodes these),
  2. **Propensity/uplift scorecard** once features exist — prefer **uplift/causal** where the action is costly (buying hardware *is* costly),
  3. **Contextual bandit** for online personalization (Vowpal Wabbit `--cb_explore_adf`, or David Cortes's `contextualbandits`),
  4. optional learned/agentic top layer later.
  - **Log propensities from the very first rules version** — the single non-negotiable prerequisite for safe off-policy evaluation later.
  - **Multi-tenant cold-start** = partial pooling: a shared global prior across tenants that specializes per-tenant as outcomes accrue. New tenants inherit the fleet prior. (You already have a multi-tenant fleet to learn from.)
- **Explanation engine = the local LLM.** The 5070 Ti model writes the owner-facing "*here's why a label printer is your next best ROI*" prose. This is the *only* place an LLM touches the advisor — and it's exactly the kind of narrow generation a specialized small model does well.
- **TabPFN-2.5** is worth evaluating for the small-data regime (single forward pass, strong vs default XGBoost under ~50k rows / 2k features) — it is **not** an LLM.

### 4.3 The product catalog — vetted, real links, no hallucination

**Never let the LLM emit product URLs token-by-token.** Constrain it to **SELECT a catalog item id**, then resolve the canonical URL by **lookup in a vetted catalog** (your `items`/`sku_catalog` SoT discipline extended to a curated hardware catalog). This makes hallucinated links *structurally impossible*. Make **abstention first-class** ("no good match" beats inventing one). Gate in CI on groundedness: every recommended item exists in catalog, every URL equals the catalog's canonical URL, FTC affiliate disclosure rendered adjacent to any monetized link (16 CFR; effective Oct 2024 rules ban fake/AI reviews). Prefer **manufacturer/primary vendor pages** over "best-X" listicles (Google demotes thin-affiliate/parasite-SEO — feeding them in propagates junk).

**Seed catalog (real vendor URLs, verified in research):**

| Category | Pick | Price (verify at purchase) | URL | Note |
|---|---|---|---|---|
| Label printer (entry) | Rollo USB | $199.99 | rollo.com/product/rollo-printer | USB sidesteps Rollo's wireless-flakiness complaints |
| Label printer (budget) | Munbyn RW941BP | $129.99–199.99 | munbyn.com | accepts generic rolls |
| Label printer (industrial) | **Zebra ZD421** | several-hundred | zebra.com (ZD400 series) | **do NOT buy EOL GK420d/ZD420** |
| Scanner (station, default) | Zebra DS2278 | ~$150–350 | zebra.com (DS2200) | 3-yr warranty, HID keyboard-wedge → drops into existing scan-resolve routes, no SDK |
| Scanner (budget handheld) | Honeywell Voyager 1250g | ~$70–130 | honeywell | 1D only |
| Phone/tablet BT scanner | Socket Mobile S720 / D720 | $285 / $335 | socketmobile.com | MFi/iOS first-class |
| Phone case/sled | Socket DuraSled DS840 | ~$255–360 | socketmobile.com | per-iPhone-gen lock-in |
| Budget BT (secondary) | Inateck / Tera 2D | ~$30–90 | amazon | verify HID mode; "Swiss-founded" Tera claim is **unverified marketing** |
| Camera-scan SDK | ML Kit (free) → Dynamsoft (~$1.4k, AI-deblur) → Scandit (enterprise) | — | developers.google.com/ml-kit | **Scandit is software, not a sled.** `BarcodeDetector` web API **fails silently on iOS** — don't rely on it cross-platform |

**Avoid tier:** unbranded white-label Amazon scanners with no named manufacturer / no warranty / no firmware — *that* is the real junk tier (distinct from Inateck/Tera).

### 4.4 ROI framing (honest, owner-legible)

Lead with one sentence: *"Costs $X, saves $Y/yr → pays for itself in Z months,"* Z inside 1–3 yr (ideally <12 mo). Build $Y from a transparent labor model using a **fully-burdened rate (base × 1.3–1.6)** — naive base-wage math understates the case 30–60%, which makes you look *conservative*. Present conservative/expected/optimistic scenarios; decide on the conservative one. A thermal printer is the strongest concrete case (sub-second vs 10–60 s print; ~$0.07 vs ~$0.30/label; 3–6 mo payback).

> ⚠️ **Refuted stats to NOT cite:** the "Zebra 62% faster / NRF 20–40% productivity / 20–30% labor cut" figures are **misattributed marketing**; the peer-reviewed record (NBER "Raising the Barcode Scanner") found early scanners raised labor productivity only **~4.5%**. Cite the *direction* (scanning helps) and ShipStation's documented scan-to-verify workflow as the primary-source anchor; label vendor accuracy figures (92% manual vs 98–99.5% scanned) as vendor-published.

---

## 5. Part C — the specialized local LLM on the 5070 Ti (CUDA)

### 5.1 Current AI surface — already local

Hermes already serves chat, PO-email extraction, Zendesk claim drafting, seller messages, disposition classify, sourcing research, and photo metadata. **The specialist model replaces the *model behind the Hermes slot*, not the architecture** — point `HERMES_API_URL`/`HERMES_MODEL` at the new server.

### 5.2 The only real cloud leak: embeddings (+ optional Vision)

`src/lib/ai/gemini.ts` uses Google **`text-embedding-004` (768-dim)** for `/api/rag/documents` + `/api/rag/search`; GCP Vision is an optional photo-analysis provider (already has a Hermes fallback — just flip priority). **This is the cloud call to kill.**

- **Drop-in (no schema churn): EmbeddingGemma-300m** — 768-dim like `text-embedding-004`, so the pgvector **column type is reusable** (you still must re-embed). Serve via **Ollama** (OpenAI-compatible `/v1/embeddings`).
- **Quality upgrade (dimension change): Qwen3-Embedding-0.6B** or **BGE-M3** (both 1024-dim, under pgvector's 2000-dim HNSW ceiling).
- **It's a re-index, not a config swap:** embeddings are *not* cross-model compatible. Add a new column (`embedding_v2 vector(768|1024)`), backfill the whole corpus, build a fresh HNSW index, cut reads over, drop the old column. Use **TEI's experimental sm_120 image** (`…:120-1.9`) for the one-time bulk backfill (faster batching), then keep Ollama for steady-state.

> 💡 **Economics caveat:** cloud embeddings are *so cheap* (OpenAI `text-embedding-3-small` ~$0.02/1M tokens) that self-hosting them **rarely pays back on cost alone** — justify the embeddings migration on **data-privacy / keeping tenant data off third parties**, not dollars. (Local LLM *generation* is where volume + privacy actually move the needle.)

### 5.3 ⚠️ Blackwell sm_120 stack — the gating risk (read first)

The 5070 Ti is **sm_120 / CUDA compute 12.0**. The widely-repeated "**stable PyTorch lacks sm_120, use nightly**" claim is **OUTDATED** (fact-check **refuted** it): PyTorch has shipped **stable cu128 wheels with sm_120 kernels since 2.7.0 (Apr 2025)** — but Blackwell support is labelled **prototype-grade**, and downstream libs that pin old torch lag. So it **works on Linux with deliberate version pinning; it is not plug-and-play.**

**Known-good base install (Linux, mid-2026):**
```bash
# fresh venv, Python 3.12/3.13
pip install torch --index-url https://download.pytorch.org/whl/cu128   # NOT plain "pip install torch"
python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.get_device_capability())"
# want CUDA 12.8/12.9 and (12, 0). If it prints 12.4 → wrong wheel → 'no kernel image' / ptxas 'sm_120 not defined'
```
- **Driver ≥570** (Linux 570.26+), **CUDA Toolkit 12.8/12.9** (mature; *not* the weak link).
- **Proven QLoRA combo:** `torch 2.11.0+cu129` + `bitsandbytes 0.49.2` (or the **Unsloth Studio distribution**, which bundles Blackwell-correct kernels and sidesteps the dependency hell). **Don't let a stray dep drag torch to a cu130 build** — that breaks bnb (`libnvJitLink.so.13 not found`).
- **FlashAttention is the weak link:** FA3 excludes Blackwell; official FA2 wheels lack sm_120. **Use PyTorch SDPA (cuDNN flash backend)** — the gap to hand-built FA2 is small (~160 TFLOPS reported on a 5070 Ti).
- **Avoid bitsandbytes INT8 on sm_120** (corrupted output). **Prefer Linux** (Ubuntu Server 24.04 LTS); Windows is materially rougher (Triton Linux-only; bnb Windows wheels problematic).

**This is the #1 project risk. Gate everything on a bring-up spike that verifies every kernel/format/server on the actual card before committing economics.**

### 5.4 Serving, quant, model sizing

**Serving (two-tier):** start on **Ollama** (auto-detects sm_120, zero flags, OpenAI-compatible — perfect to prototype and to serve the new Hermes-slot model quickly) → graduate to **vLLM** for concurrency + multi-LoRA. **Skip TGI** (maintenance/redirect mode) and **TensorRT-LLM** (datacenter-first, consumer sm_120 lags). If self-building **llama.cpp**: `-DCMAKE_CUDA_ARCHITECTURES=120`, **CUDA 12.8 (NOT 13.x)**, wipe `build/` — the CUDA-13 / stale-cache trap silently costs **~5–6×** prompt throughput.

**Quant (16 GB):** **AWQ-INT4 (`awq_marlin`) is the stable default on vLLM** for sm_120. **NVFP4** is the only format using the native 5th-gen FP4 tensor cores (big *prefill* throughput, ~near-zero single-stream decode gain) — use it once on vLLM 0.13.x / llama.cpp b8967+; produce it with **TensorRT-Model-Optimizer or LLM Compressor**. For single-user llama.cpp, **Q4_K_M / Q5_K_M** are battle-tested.

**Model sizing on 16 GB (verified, with corrections):** 8B Q4 fits comfortably *with long context* (~10–11 GB free for KV after ~4.7 GB weights → 32k single-stream); **14B Q4** fits with *reduced* context; **gpt-oss-20B MXFP4** fits (~11–12 GB — note: **because total quantized weights are small, NOT because "only active experts load"** — all experts must be VRAM-resident; sparsity cuts *compute*, not footprint); **27B at Q4_K_M is a tight ~15 GB fit** (the "27B needs Q3" claim was **refuted**). Dense ≥12B in higher precision does **not** fit single-GPU.

### 5.5 Specializing the model (don't pretrain — distill/fine-tune)

- **Student: Qwen3-4B-Instruct-2507** — benchmarked **#1 fine-tuning base**, QLoRA fits comfortably in 16 GB, rivals far larger cloud models on narrow ops tasks post-tuning. Drop to Qwen3-1.7B / Llama-3.2-1B (biggest tuning-gainer) for the narrowest fixed-label tasks once accuracy holds.
- **Method: hard-label synthetic distillation** (not logit distillation — you only get text from a cloud teacher). Take real sampled ops inputs (orders, receiving lines, repair intake, claim replies), have a strong teacher emit the exact JSON/label, SFT the student.
- **Data volume by task:** classification 100–300/class; extraction 200–500; short structured generation 500–2,000; **1k–5k only for complex conversational tasks** (the "1k–5k floor for all LoRA" claim was **refuted** — many ops tasks succeed on a few hundred clean examples). Quality/consistency beats count.
- **Data pipeline:** JSONL chat-messages schema; **loss-mask everything except the assistant turn**; **Presidio PII scrub with format-preserving surrogates** (NOT `<PERSON>` labels or constant pseudonyms — both poison the model); **dedup before split, split by entity (customer/order), add a time-based test slice**, rebalance only after split. Hold out a **real (non-synthetic) eval set** — pure-synthetic training is the #1 cause of real-world brittleness. Trainer: **Unsloth** (single-GPU, ~50% less VRAM) or Axolotl; same JSONL is portable between them.

> ⚠️ **ToS flag:** distilling from a cloud teacher (Gemini/OpenAI/Anthropic) may violate that provider's anti-distillation terms. Confirm the teacher's license permits training before building the dataset.

### 5.6 Multi-tenant serving + the tenancy-governance collision

Per-tenant **LoRA adapters on one shared base** is proven on the exact 16 GB 5070 Ti (2026 benchmark: Qwen3-8B + adapters, vLLM 0.12, ~660 TPS) — **but only with a quantized base** (NVFP4/AWQ; an FP16 8B leaves no KV room). vLLM: `--max-loras` (hot adapters in GPU) + `--max-cpu-loras` (CPU LRU pool); per-adapter cost is ~tens of MB, so **tenant count is bounded by CPU RAM, not VRAM**.

> 🚩 **Hard governance flag (from the completeness critic):** multi-tenant training data + a *single shared model* collides with this repo's RLS/GUC tenancy invariants. vLLM "tenant isolation" is **logical request-routing, not a security sandbox** — all tenants share one process/KV pool. Decide explicitly:
> - **shared specialist model** trained only on PII-scrubbed, aggregated, consented data (simplest; weakest isolation), **or**
> - **per-tenant LoRA adapters** (strong isolation; but competes for the 16 GB multi-LoRA budget and the §5.7 contention).
> Enforce the adapter→`organization_id` mapping in your auth layer (consistent with `withTenantTransaction` / `ctx.organizationId`); never trust a client-supplied adapter id.

### 5.7 Eval + permanent cloud fallback (non-negotiable)

- **Build a golden eval set FIRST** from real captured cloud traffic (20–30+ cases incl. failure modes), score the incumbent cloud model as the bar, gate the local swap on parity. **promptfoo** in CI (re-runs on any weights/prompt/config change); **lm-evaluation-harness** pointed at the local vLLM server for standardized regression tracking. **Eval precedes the economics decision** — "good enough to replace cloud" is otherwise unfalsifiable.
- **Roll out:** shadow → canary (auto-rollback on TTFT/quality regression) → ramp. Version weights+tokenizer+prompt+inference-config as **one immutable deployment id**.
- **LiteLLM gateway** in front of the single GPU = local-first, **cloud fallback on error/timeout/cooldown/low-confidence**, with `request_timeout`, `num_retries`, `allowed_fails`+`cooldown`, health-check routing, and a warm-up cron for the 5–10 s cold start. Bound concurrency with vLLM `--max-num-seqs`; spill to cloud on queue-depth / KV-cache saturation / `/health` failure.
- **Confidence fallback = a calibrated cascade** (logprob/perplexity/self-consistency below an empirically-tuned threshold), *not* verbalized self-confidence (unreliable).
- **A single consumer card (no ECC, no failover) is a real availability risk for a SaaS dependency** — design for it being *down*, not just slow. Cloud fallback is **permanent**, and the economics must be re-run assuming it fires on some % of traffic.

### 5.8 Economics + hardware headroom

- **Embeddings → keep on cloud** unless privacy-mandated (cloud is effectively free). **Local LLM generation wins** only at ~**2,000–5,000+ quality-tier requests/day** or a hard privacy requirement; below a few hundred/day, `gpt-4o-mini`/`4.1-nano` is cheaper than an idle amortized GPU.
- **Costs:** GPU ~$950 (street, not $749 MSRP); full box ~$1,800–2,400; power ~$125–470/yr (**a rounding error** — amortization + the Blackwell-stack DevOps time dominate). **Lead the business case with data privacy** for multi-tenant data (clean answer to GDPR residency / customer DPAs / the cloud log-preservation risk).
- **Headroom ("buy this when you outgrow 16 GB"):** keep the 5070 Ti for **≤14B Q4 / ≤32k ctx** (spend $0). First upgrade = **used RTX 3090 (24 GB, ~$800–1,100)** — best VRAM/$, most mature sm_86 CUDA path, unlocks 24–32B inference + 13B QLoRA. **RTX 5090 (32 GB)** only near $2,000–2,500 (street is brutal). **Skip used 4090** in 2026 (costs more than a 5090 FE for less VRAM). **Dual/quad 3090** for local 70B (a real PSU/cooling systems project). **RTX PRO 6000 (96 GB, ~$8.4–13.3k)** only if large local LLM work is core business. **Most cost-rational:** 5070 Ti for everyday ≤14B + one used 3090 for the 24–32B/QLoRA-13B tier + **rent cloud GPUs for occasional 70B fine-tunes** rather than sinking $8k+ into idle hardware.

---

## 6. Hard flags & contradictions to resolve (don't let these hide)

1. **Blackwell sm_120 maturity** is the central single point of failure — every serving/quant choice must be **verified on the actual card**, version-pinned in a Dockerfile, with logs checked for silent Marlin/cuBLAS fallbacks. *Gate: bring-up spike.*
2. **16 GB three-way contention** — model size × context × {embeddings, multi-LoRA} can't all be maximized. Pick explicitly: e.g., **move embeddings to a separate process/host**, cap context, or bound adapter count. Likely: embeddings on Ollama (or stay cloud), generation on vLLM.
3. **"Negate cloud" vs tenant isolation** — points toward per-tenant LoRA, which fights the 16 GB budget. Decide shared-scrubbed-model vs per-tenant adapters (§5.6).
4. **Headroom spend vs savings thesis** — buying a 3090/5090 erodes the cost case; re-state break-even *including* hardware amortization + power + maintenance hours, not just per-token deltas.
5. **Embeddings swap is a re-index migration**, not a config change — budget dual-running (extra VRAM) during cutover.
6. **Distillation ToS** + **multi-tenant PII governance** are compliance gates, not afterthoughts.

---

## 7. Phased roadmap

| Phase | Deliverable | Gate to exit |
|---|---|---|
| **0. Bring-up spike** | Linux box, pinned torch cu128/cu129, Ollama + vLLM serving an 8B AWQ model, verified sm_120 kernels, Cloudflare tunnel like Hermes | `(12,0)` confirmed; no silent fallbacks; tunnel reachable from Vercel |
| **1. Capability layer** | `org_capabilities` + `device_capabilities` migrations (tenant-from-birth); resolver wired into session; capability surfaced to stations/nav | scan slot resolves device/companion/manual; default = companion (no behavior change) |
| **2. Adaptive nav** | Focus / Action / Browse shells over `SidebarShell`+`HorizontalButtonSlider`; permission-filtered, server-generated | operator can't reach unassigned stations (nav *and* route) |
| **3. Embeddings off cloud** | EmbeddingGemma-300m (or Qwen3-0.6B) on Ollama/TEI; `embedding_v2` column + backfill + HNSW cutover | RAG parity on golden set; Gemini embeddings removed |
| **4. Eval harness + fallback** | Golden set from real Hermes traffic; promptfoo CI; LiteLLM gateway local-first + cloud fallback | parity bar met; fallback fires correctly on induced GPU-down |
| **5. Specialist model** | Distillation dataset (PII-scrubbed, split-by-entity); QLoRA Qwen3-4B via Unsloth; drop into Hermes slot behind eval gate | beats incumbent on golden set; shadow→canary clean |
| **6. Advisor** | Tabular rules engine + ladder + vetted catalog (grounded SELECT-id, FTC disclosure); local-LLM prose; propensity logging | recommendations grounded (CI groundedness gate); owner-legible ROI |
| **7. Advisor learning** | Propensity→uplift scorecard → contextual bandit (partial-pooled, multi-tenant) | off-policy eval (DR/IPS) gate before any learned-policy promotion |

---

## 8. Open questions

- **Shared specialist model vs per-tenant adapters** — which side of the isolation/16 GB tradeoff? (Blocks §5.6.)
- **Is the scan center button global-entry-contextual-behavior or per-station?** (Drives whether the Action shell's center slot is one shared component or a per-shell slot.)
- **Where does the inference box physically live** — co-located with the existing NAS/Hermes host, or separate? (Affects tunnel/failover.)
- **Single-card availability** — is a non-ECC consumer GPU acceptable as a SaaS dependency, given a permanent cloud fallback? Or is the 3090/second-card failover needed at launch?
- **Catalog ownership** — who curates the vetted hardware catalog and keeps prices/links fresh (vendor feed vs manual)?

---

*Sources: two verified deep-research sweeps (26 threads, adversarial fact-check per claim) + a repo code-seam map + a cloud-LLM usage inventory, 2026-06-22. Claims carry the research's confidence/refutation notes inline; vendor prices and Blackwell stack versions move fast — re-verify at implementation time.*
