# USAV Vision — visual product identify

Detect-then-identify product recognition for the receiving flow. Runs on the
RTX 5070 Ti box on the office LAN; the browser posts a captured frame here and gets
back ranked SKU candidates. The Vercel app never sees the full-res image (same
deployment shape as the NAS photo server).

**Approach:** DINOv2 image embeddings + nearest-neighbor over enrolled reference
photos. Add a product by dropping in photos and re-embedding — **no retraining**.

---

## 1. Install (RTX 5070 Ti / Blackwell — read this first)

The 5070 Ti is Blackwell (sm_120). Stock PyTorch wheels lack Blackwell kernels and
will fail with `CUDA error: no kernel image is available` or silently fall back to
CPU. Install the **CUDA 12.8** build:

```bash
cd vision
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate

# 1) PyTorch FIRST, from the cu128 index (Blackwell support)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128

# 2) Everything else
pip install -r requirements.txt
```

Verify the GPU is actually usable (not just "available"):

```bash
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no cuda'); \
x=torch.randn(8,8,device='cuda'); print('matmul ok', (x@x).sum().item())"
```

If the matmul line errors, your torch build doesn't support Blackwell — reinstall
from the cu128 index. `torch.cuda.is_available()` returning `True` is **not** enough.

## 2. Enroll products (no retraining)

```
vision/data/reference/
  BOSE-QC35-II/                 photo1.jpg photo2.jpg ...
  BOSE-SOUNDLINK-MINI-II/       ...
```

Folder name = the SKU (match `sku_catalog.sku` so the Vercel side resolves it).

```bash
python -m vision.scripts.enroll_folder data/reference
# add more later, incrementally:
python -m vision.scripts.enroll_folder data/reference/BOSE-901-VI
```

## 3. Run the service

```bash
uvicorn vision.app.server:app --host 0.0.0.0 --port 8700
```

- `GET  /health`   → model + index status
- `POST /identify` (multipart `file=@photo.jpg`) → `{ candidates: [{ sku, score }] }`
- `POST /enroll`   (multipart `sku=...&file=@a.jpg&file=@b.jpg`) → appends to index
- `POST /reindex`  → rebuild the index from `data/reference/`

Quick test:

```bash
python -m vision.scripts.identify_image path/to/test.jpg
# or
curl -F file=@test.jpg http://localhost:8700/identify
```

## 4. Expose to the app

Mirror the NAS: put it behind Cloudflare (so the browser's Access cookie rides along)
or keep it LAN-only. Set the URL the browser uses via `NEXT_PUBLIC_VISION_BASE_URL`
in the Next.js app (see `/api/vision-config`). The service must answer the CORS
preflight for the app origin (`ALLOWED_ORIGINS` in `.env`).

## Config

Copy `config.example.env` → `.env`. Key knobs: `EMBED_MODEL`, `DEVICE`, `TOP_K`,
`USE_DETECTOR`, `ALLOWED_ORIGINS`. See that file for the rest.

## Notes

- Index is `data/index/index.npz` (vectors + sku labels) — small, numpy-based. For
  >~100k vectors switch to FAISS (`faiss-gpu`); the interface in `app/index.py` is a
  drop-in seam.
- DINOv2 needs no labels and no fine-tuning to be useful — it generalizes to unseen
  products. Fine-tune only if accuracy on near-identical models plateaus.
- Detector (`USE_DETECTOR=1`) crops the largest object via Ultralytics YOLO before
  embedding — helps on cluttered benches. Off by default (full-frame) for v1.
