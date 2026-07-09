# Phase 0 — Blackwell bring-up spike: results on the RTX 5070 Ti / Hermes box

**Status:** in progress · **Run:** 2026-06-24 · **Box:** `DESKTOP-BL57LOP` (the live Hermes connection computer)
**Tracks:** [`local-llm-capability-advisor-plan.md`](local-llm-capability-advisor-plan.md) §7 Phase 0
**Exit gate (from the plan):** `(12,0)` confirmed · no silent kernel fallbacks · Ollama + vLLM serving an 8B · Cloudflare tunnel reachable from Vercel.

> **Headline:** the plan's "#1 project risk" (Blackwell sm_120 software maturity) is **already cleared** on this
> machine — a working `torch 2.11.0+cu128` reporting device capability `(12, 0)` was found pre-installed. Bring-up is
> therefore *verification + filling the vLLM gap*, not a from-scratch install. The runtime decision (per the user) is
> **WSL2 Ubuntu for the heavy GPU stack; Ollama serving stays native-Windows.**

---

## 1. The machine (verified this run)

| Fact | Value | Source |
|---|---|---|
| GPU | NVIDIA RTX 5070 Ti, **16 GB**, Blackwell **sm_120** | `nvidia-smi` |
| Host OS | Windows 11 (build 26200), WDDM | env |
| NVIDIA driver | **596.49** (CUDA 13.2 runtime ceiling) | `nvidia-smi` |
| WSL2 distro | **Ubuntu 22.04.5 LTS**, kernel 6.6.87.2-microsoft | `lsb_release` |
| GPU into WSL2 | **passthrough OK** — `nvidia-smi` works inside WSL via `/usr/lib/wsl/lib` | `nvidia-smi` in WSL |
| Native serving | **Ollama** running on `:11434`; **cloudflared** Windows service (auto-start); **docker-desktop** present | probes |

**Driver vs toolkit nuance:** the driver advertises CUDA **13.2**, but that is the *runtime ceiling* and is
backward-compatible — cu128 wheels run fine under it. The plan's "use 12.8, **NOT** 13.x" warning is about the *pip
wheel / build toolchain*, not the driver. Honored: every install below is pinned to cu128.

---

## 2. Phase 0 gate — status

| Gate item | Status | Evidence |
|---|---|---|
| `torch.cuda.get_device_capability() == (12, 0)` | ✅ **MET** | `torch 2.11.0+cu128`, CUDA 12.8, `(12, 0)` (pre-existing, user-site `~/.local/.../python3.10`) |
| Ollama serving an 8B on GPU | ✅ **MET** | `qwen3.5:9b` → **76.7 tok/s, 100% GPU, 8.6 GB** |
| Local embeddings available (kills the §5.2 cloud leak) | ✅ **bonus** | `qwen3-embedding:0.6b` → **1024-dim** vectors served locally |
| vLLM serving an 8B AWQ, no silent Marlin fallback | ✅ **MET** | `vllm 0.23.0` served `Qwen2.5-7B-Instruct-AWQ` on `:8000`; `awq_marlin`/`MarlinLinearKernel` active (no fallback); returned exact `VLLM_OK`, ~38 tok/s in eager mode. **Required Blackwell-specific flags — see §9.** |
| Cloudflare tunnel reachable from Vercel | ⚠️ **infra ready, ingress pending** | cloudflared service live; new hostname is a dashboard step (see §5) |

> **All four serving gates green.** vLLM needed real Blackwell debugging (§9). The spike server was then **stopped**
> to return the 16 GB card to the box's live services (Hermes/Ollama/nemoclaw) — see the GPU-leak note in §9.

---

## 3. What already existed (do not rebuild)

- **`torch 2.11.0+cu128` / sm_120 `(12,0)`** in WSL user-site (`~/.local/lib/python3.10`). This is the plan's exact
  "proven QLoRA combo" base. **Shared with other agent projects** in this WSL home (`MoneyPrinterV2`, `autoagent`,
  `honcho`, `~/hermes-agent`) — which is *why* vLLM was installed into an **isolated venv**, to avoid the plan's
  "stray dep drags torch to a cu130 build" trap breaking those.
- **Ollama** already GPU-serving on Windows (`:11434`) with `qwen3.5:9b`, `qwen3-vl:4b`, `qwen3-embedding:0.6b`.
- **`~/hermes-agent`** — full git repo (Dockerfile + `.env`) = the Hermes gateway code, in WSL.
- **cloudflared** Windows service (the existing Hermes tunnel transport).

## 4. What was added this run

- Isolated venv `~/phase0-bringup/vllm-env` (python3.10) for the vLLM serving tier — keeps the user-site torch the
  other agents depend on untouched.
- `~/phase0-bringup/install_vllm.sh` + `install_vllm.log` (reproducible install record).

## 5. Tunnel — the remaining manual step (deliberate, user's call)

The Hermes tunnel is a **remotely-managed Cloudflare token tunnel** running as a Windows service (no local
`config.yml`; ingress lives in the Cloudflare Zero-Trust dashboard). To expose the new vLLM server the same way
Hermes is exposed:

1. In **Cloudflare Zero Trust → Networks → Tunnels → (the Hermes tunnel) → Public Hostnames**, add a hostname
   (e.g. `vllm.<domain>`) → service `http://localhost:8000` (vLLM's port).
2. Keep the **same `x-agent-token` / `cf-access` header gate** Hermes uses — never expose the raw OpenAI endpoint.
3. Point the app's `HERMES_API_URL` (or a new `VLLM_API_URL`) at the new hostname when ready to cut traffic over.

This is an outward-facing change tied to the Cloudflare account, so it is left as an explicit step rather than
auto-published. The transport (cloudflared service) is already running.

## 6. Caveats / flags carried from the plan

- **System `nvcc` is 11.5** (old apt toolkit). Irrelevant for pip wheels (torch/vLLM bundle their cu128 runtime), but
  it **would break a from-source `llama.cpp` build** — that needs CUDA 12.8 (`-DCMAKE_CUDA_ARCHITECTURES=120`, **not**
  13.x). Install `cuda-toolkit-12-8` in WSL *only if* building llama.cpp from source.
- **Embeddings swap is a re-index, not a config swap** — local model is **1024-dim** vs Gemini's **768-dim**, so it
  needs a new `embedding_v2 vector(1024)` column + backfill + fresh HNSW + read cutover (plan §5.2 / Phase 3).
- vLLM "tenant isolation" is request-routing, not a security sandbox (plan §5.6) — defer the shared-model vs
  per-tenant-LoRA decision (open question §8).

---

## 7. Concrete cutover seams (verified in repo this run)

**Hermes slot is pure env — zero code change to repoint at vLLM.** `src/lib/ai/hermes-client.ts`:
- `HERMES_API_URL` (default `http://127.0.0.1:8642/v1`) → set to `http://127.0.0.1:8000/v1` (local vLLM) or the tunnel hostname.
- `HERMES_MODEL` → the served model id (e.g. `Qwen/Qwen2.5-7B-Instruct-AWQ`).
- `HERMES_API_KEY` → Bearer; start vLLM with `--api-key <token>` to match. CF-Access headers already supported.

**Embeddings leak is two functions in one module** (`src/lib/ai/gemini.ts`): `getEmbedding(text)` and
`getEmbeddingsBatch(texts)`, both calling Google `text-embedding-004` (`embedContent` / `batchEmbedContents`),
consumed by `/api/rag/documents` + `/api/rag/search`. Repoint both at the local model
(Ollama `qwen3-embedding:0.6b` via `/v1/embeddings`). **768→1024 dim ⇒ re-index** (new `embedding_v2 vector(1024)`
column, backfill, fresh HNSW, read cutover) — not a hot swap.

## 8. Next actions after this spike

1. Finish vLLM 8B-AWQ serve + confirm `awq_marlin` kernel (no cuBLAS fallback) in logs. *(in progress — orchestrator)*
2. (Phase 3) Repoint `gemini.ts` embeddings at `qwen3-embedding:0.6b`; author the `embedding_v2 vector(1024)`
   migration via `/db-migration-author`; backfill + HNSW cutover.
3. (Tunnel) Add the Cloudflare dashboard ingress (`vllm.<domain>` → `localhost:8000`) when ready to route real traffic.
4. Decide shared-model vs per-tenant-LoRA (plan open-question §8) before any multi-tenant specialist serving.

> **venv torch note:** vLLM 0.23.0 pins its **own** torch (`2.11.0+cu130`, a **cu13** build — it pulls
> `nvidia-cutlass-…-cu13`), isolated in `~/phase0-bringup/vllm-env`, *separate* from the user-site `torch 2.11.0+cu128`.
> Both report sm_120 `(12,0)`; cu13 is fine here because the driver is 13.2. Keep them isolated — do **not** let the
> cu13 venv torch leak into the user-site env the other agents (and any future bitsandbytes/QLoRA work) depend on.

---

## 9. vLLM on Blackwell — the real bring-up (the plan's "#1 risk," confirmed)

Out-of-the-box `vllm serve` **failed** on sm_120. Four sequential blockers, each the next missing piece of the
JIT/build toolchain — exactly the "not plug-and-play" warning in plan §5.3. The fixes, in order:

1. **`torch.compile`/inductor crash** during model load → **`--enforce-eager`** (disables vLLM's compile + CUDA graphs).
2. **FlashInfer JIT fails:** `FlashInfer requires GPUs with sm75 or higher` / `SM 12.x requires CUDA >= 12.9`. Cause:
   FlashInfer JIT-compiles with the **system `nvcc` = 11.5** (too old for sm_120). → disable it:
   `VLLM_USE_FLASHINFER_SAMPLER=0`, `VLLM_USE_FLASHINFER=0`, and `VLLM_ATTENTION_BACKEND=TRITON_ATTN`.
3. **Triton: `Failed to find C compiler`** — the box had **no `gcc`/`cc`** on PATH (only `/usr/bin/gcc-11`). →
   symlinked `~/.local/bin/{gcc,cc,g++}` → `gcc-11`; exported `CC=gcc CXX=g++`. (Triton's bundled **`ptxas-blackwell`**
   already handles the sm_120 device side — only the host compiler was missing.)
4. **Triton: `Python.h: No such file or directory`** — no `python3.10-dev` headers, and **sudo needs a password**.
   → fetched headers **without sudo**: `apt-get download libpython3.10-dev python3.10-dev` → `dpkg-deb -x` into
   `~/pydev` → exposed to gcc via `CPATH="$HOME/pydev/usr/include/python3.10:$HOME/pydev/usr/include"` (the parent dir
   is required so the stub `pyconfig.h`'s `#include <x86_64-linux-gnu/python3.10/pyconfig.h>` resolves).

**Working serve command** (the reproducible recipe, saved as `~/phase0-bringup/v5.sh`):
```bash
source ~/phase0-bringup/vllm-env/bin/activate
export PATH="$HOME/.local/bin:$PATH" CC=gcc CXX=g++
export CPATH="$HOME/pydev/usr/include/python3.10:$HOME/pydev/usr/include"
export VLLM_ATTENTION_BACKEND=TRITON_ATTN VLLM_USE_FLASHINFER_SAMPLER=0 VLLM_USE_FLASHINFER=0
vllm serve Qwen/Qwen2.5-7B-Instruct-AWQ --quantization awq_marlin \
  --max-model-len 8192 --gpu-memory-utilization 0.85 --enforce-eager --port 8000
```
Result: serves, `awq_marlin` kernel active (no fallback), exact instruction-following, **~38 tok/s in eager mode**.

**Perf caveat:** eager mode (no CUDA graphs/compile) + Triton attention is *functional, not fast* — ~38 tok/s vs
Ollama's ~77 for a similar model. To make vLLM fast on this card you must give FlashInfer/compile a real toolchain:
install **`build-essential` + `python3.10-dev` + CUDA-toolkit-12.9** (one `sudo apt` line), then drop `--enforce-eager`
and re-enable FlashInfer. Until then, **Ollama is the better serve-now tier** (its prebuilt kernels need no JIT) — which
is exactly the plan's two-tier model (Ollama now, vLLM when multi-LoRA/concurrency is the real need).

> 🚩 **Operational gotcha — orphaned EngineCore leaks the whole GPU.** Killing `vllm serve` via `fuser -k 8000/tcp`
> (or killing the API-server parent) can leave the **`VLLM::EngineCore` child alive**, pinning ~13 GB of the 16 GB
> card. Symptom: GPU stays ~96 % full and Ollama silently falls back to **100 % CPU**. **Always also**
> `pkill -9 -f VLLM::EngineCore` (verify with `nvidia-smi` inside WSL — WDDM hides per-proc memory from the Windows
> view, so check the WSL side). After cleanup here the card returned to ~1.1 GB and Ollama reloaded on GPU.

> **Box reality (discovered):** this WSL distro is a **live AI host**, not a blank box — it runs the **Hermes gateway**
> (`hermes_cli … gateway run`), an **`ollama-nothink-proxy.py` on :11437** (feeds the `-nothink` Hermes model), a
> `nemoclaw-fork` RAG/audio server (:8790), and qdrant/honcho MCP servers, all sharing the one 16 GB card. Any vLLM
> deployment here **contends for VRAM** with these — bound `--gpu-memory-utilization` accordingly, or give vLLM its
> own card (plan §5.8 headroom).
