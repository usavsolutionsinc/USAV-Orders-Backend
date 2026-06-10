# Visual Receiving Identify — plan

Camera-based product recognition wired into the receiving flow. During receiving
(local-pickup intake and **unfound / unmatched cartons**), an operator points the
camera at a physical product (e.g. an older Bose model); the system identifies the
SKU and auto-pairs it to a receiving line — replacing manual Ecwid search / typing.

Architecture choice: **detect-then-identify with embeddings** (not one big
multi-class YOLO). Adding a new product = drop a few reference photos and re-embed.
**No model retraining** to grow the catalog — critical for a catalog that keeps
expanding from pickups.

---

## Why embeddings, not a multi-class detector

- Bose models are **fine-grained**: QC35 vs QC45, SoundLink Mini I vs II look nearly
  identical. A multi-class YOLO needs lots of labeled data per class and a **full
  retrain every time a SKU is added**.
- Embeddings (DINOv2) give a generic visual fingerprint. Identification = nearest
  neighbor against enrolled reference photos. Add a product → embed its photos →
  insert into the index. Zero retraining.
- A detector still helps (crop the product out of a cluttered intake bench), but it
  can be generic/open-vocab and stays fixed. v1 can run full-frame; the detector is
  an optional accuracy booster.

## Hardware reality (RTX 5070 Ti — Blackwell, sm_120)

The 5070 Ti is **Blackwell**. Default PyTorch wheels do **not** include Blackwell
kernels — you get `CUDA error: no kernel image is available` or a silent CPU
fallback. You **must** install PyTorch built for **CUDA 12.8+** (cu128, torch ≥ 2.7):

```
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
```

This is the single most common "my new GPU won't train/infer" failure. See
`vision/README.md`. 16 GB VRAM is ample for DINOv2 inference and for fine-tuning a
detector later.

---

## The three pieces

### 1. Vision service — `vision/` (runs on the 5070 Ti box, on the LAN)

Same deployment shape as the NAS photo server: a LAN service, optionally fronted by
Cloudflare, that the **browser** calls directly. FastAPI, two real endpoints:

- `POST /enroll` — register reference photos for a `sku` → DINOv2 embeddings appended
  to the index. No retraining.
- `POST /identify` — image in → (optional) crop → DINOv2 embed → cosine kNN over
  enrolled vectors → ranked `[{ sku, score }]`.

Index is a persisted numpy store (`data/index/*.npz`) keyed by SKU. FAISS is a
drop-in scale-up but unnecessary for thousands of vectors. GPU does the embedding;
the index lookup is cheap.

### 2. Vercel glue (additive — mirrors the NAS pattern)

- `GET /api/vision-config` → `{ baseUrl }` — runtime base URL of the active vision
  box (admin flips test/prod without a rebuild), mirroring `/api/nas-config`.
- `src/lib/vision-identify.ts` — client helper. Browser captures a frame, POSTs the
  blob **direct** to `${baseUrl}/identify` (full-res image stays on the LAN), gets
  `[{ sku, score }]`.
- `POST /api/receiving/visual-identify` — takes those candidate SKUs + `receiving_id`,
  enriches each against `sku_catalog` (+ `sku_platform_ids`) server-side (auth-guarded
  DB read), returns display-ready candidates `{ sku_catalog_id, sku, product_title,
  image_url, score }`. The heavy image never touches Vercel.

### 3. UI hook (follow-up — touches the receiving workspace)

Two surfaces, both reuse the existing camera capture (`PhotoCaptureSurface`):

- **Unfound/unmatched cartons** (`UnmatchedItemsSection` / `CartonAddPopover`): an
  "Identify with camera" path alongside the Ecwid search. On confirm → existing
  `POST /api/receiving/add-unmatched-line` with the resolved `sku_catalog_id`.
- **`LineEditPanel`** (per-line): an "Identify" button near the serial/condition card.
  On confirm with high confidence → patch the line's `sku` / `item_name` /
  `sku_catalog_id`; on ambiguity → show the ranked candidate picker.

`LineEditPanel.tsx` is ~1048 lines and under active god-component refactor, so the
behavior lands in `line-edit/hooks/useVisualIdentify.ts` + a small
`VisualIdentifyButton` component, matching the existing `useLineSerials` slice
pattern — not inline.

---

## Data flow (unfound carton, the highest-value case)

1. Operator opens an unmatched carton, taps **Identify with camera**.
2. Browser captures a frame, POSTs it to `${visionBaseUrl}/identify` (LAN/Cloudflare,
   `credentials: 'include'` so the Cloudflare Access cookie rides along, exactly like
   the NAS PUT).
3. Vision box returns `[{ sku: "BOSE-QC35-II", score: 0.91 }, ...]`.
4. Browser POSTs the candidates to `/api/receiving/visual-identify` → enriched with
   catalog title/image/`sku_catalog_id`.
5. Operator confirms the top candidate (or picks from the ranked list).
6. Browser calls `POST /api/receiving/add-unmatched-line` with the chosen
   `sku_catalog_id` / `sku` / `item_name` — the existing, idempotent pairing path.
7. Operator scans serials via the existing `/api/receiving/scan-serial`.

No new pairing logic — visual identify only *suggests the SKU*; pairing reuses what
already exists.

---

## Enrolling products (no retraining)

```
vision/data/reference/
  BOSE-QC35-II/      img1.jpg img2.jpg img3.jpg ...
  BOSE-SOUNDLINK-MINI-II/  ...
```

`python -m vision.scripts.enroll_folder data/reference` embeds every image and writes
the index. Seed from Google/eBay/official photos to bootstrap, but **add real intake
photos early** — listing shots (white background) won't match a cluttered receiving
bench, and that domain gap is the main accuracy risk. The receiving flow already
captures photos to the NAS; those become free enrollment data over time (a future
"confirm identify" can auto-enroll the confirmed crop).

The `sku` folder name should equal `sku_catalog.sku` so `/api/receiving/visual-identify`
resolves it directly. (Or enroll by `sku_catalog_id` — pick one and keep it consistent.)

---

## Status / phasing

- [x] Plan
- [ ] Vision service scaffold (`vision/`) — embedder, index, enroll, FastAPI server
- [ ] Vercel glue — `/api/vision-config`, `src/lib/vision-identify.ts`,
      `/api/receiving/visual-identify`
- [ ] Seed enrollment (10–15 popular discontinued models) for a first win
- [ ] UI: unfound-carton identify path (`UnmatchedItemsSection`)
- [ ] UI: `LineEditPanel` per-line identify (`useVisualIdentify` hook)
- [ ] Optional: fine-tuned/open-vocab detector crop for cluttered scenes
- [ ] Optional: auto-enroll confirmed crops back into the index (active learning)

## Open decisions

- Enroll key: `sku_catalog.sku` (string) vs `sku_catalog_id` (int). Default: `sku`.
- Confidence threshold for auto-fill vs always-show-picker. Default: show picker
  unless top score ≥ 0.85 and margin over #2 ≥ 0.1.
- Vision box exposure: Cloudflare tunnel (matches NAS) vs LAN-only. Default: mirror NAS.
