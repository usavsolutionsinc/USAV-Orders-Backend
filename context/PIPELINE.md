# AI Training Pipeline

Self-improving code pipeline that discovers issues, implements fixes via a local LLM, validates with tests/lint/typecheck, collects training data, and fine-tunes the model on a Jetson Orin Nano.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Mac (Apple Silicon) — Inference + Orchestration                   │
│                                                                    │
│  ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌─────┐  ┌──────┐│
│  │ Discover  │──▶│ Implement │──▶│ Validate │──▶│Score│─▶│Collect││
│  └──────────┘   └───────────┘   └──────────┘   └─────┘  └──────┘│
│       │              │                                      │     │
│       │         MLX LM :8085                           writes to  │
│       │         (local model)                               │     │
│       │                                                     ▼     │
│  reads repo                                         ┌────────────┐│
│  (tsc, lint,                                        │  Neon PG   ││
│   tests, grep)                                      │  training_ ││
│                                                     │  samples   ││
│                                                     └──────┬─────┘│
└────────────────────────────────────────────────────────────┼──────┘
                                                             │
┌────────────────────────────────────────────────────────────┼──────┐
│  Jetson Orin Nano — CUDA Training                          │      │
│                                                            ▼      │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  trainer.py                                                  │ │
│  │  poll DB → build dataset → QLoRA fine-tune → export adapter  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                     │                                             │
│                     ▼                                             │
│           SCP adapter to Mac → MLX reload → loop                  │
└───────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/lib/pipeline/
├── config.ts        # All tunables: paths, timeouts, thresholds, model config
├── types.ts         # Shared interfaces: DiscoveredTask, Implementation, ValidationResult, etc.
├── discover.ts      # Scans repo for typecheck errors, lint issues, test failures, TODOs
├── agent.ts         # Sends task + code to MLX model, parses JSON, writes files
├── validate.ts      # Runs tsc, next lint, tests; optional build check
├── scoring.ts       # Converts validation → rating (1-5) + autoScore (0.0-1.0)
├── collect.ts       # Stores training pairs in DB (pipeline, git commit, and chat sources)
└── orchestrator.ts  # Main loop: discover → implement → validate → score → collect → sleep

src/app/api/pipeline/
├── status/route.ts  # GET  — cycle history, sample counts, active model
├── trigger/route.ts # POST — manual discovery cycle
├── feedback/route.ts# POST — human rating for a training sample
└── promote/route.ts # POST — auto-promote best model version

scripts/jetson/
├── trainer.py       # CUDA training worker (QLoRA on Qwen2.5-Coder-3B)
└── setup.sh         # One-time Jetson setup (PyTorch, deps, systemd)

ecosystem.config.cjs  # PM2 config for Mac (redis, mlx-server, pipeline)
```

## Database Tables

All in the existing Neon Postgres, defined in `src/lib/drizzle/schema.ts`:

| Table | Purpose |
|-------|---------|
| `training_samples` | Raw + rated training pairs from pipeline, commits, and chat |
| `training_runs` | Fine-tuning job records (status, loss, adapter path, device) |
| `model_versions` | Registered adapters with promotion status |
| `pipeline_tasks` | Discovered tasks with dedup hash, attempts, status |
| `pipeline_cycles` | Per-cycle metrics (tasks found/attempted/passed/failed) |

### training_samples status flow

```
raw → rated (auto or human) → queued (picked for training) → trained
                             → rejected (rating < threshold)
```

### pipeline_tasks status flow

```
pending → in_progress → resolved (passed validation, committed)
                      → pending  (failed, will retry)
                      → skipped  (maxed out attempts)
```

## Pipeline Cycle (10-minute default)

1. **Discover**: Run `tsc --noEmit`, `next lint`, test scripts, `grep TODO/FIXME`
2. **Filter**: Deduplicate against DB (by hash), skip exhausted tasks
3. **For each task** (up to 5 per cycle):
   a. Create git branch `pipeline/{source}-{hash}`
   b. Send task + file contents to MLX model
   c. Parse JSON response, write changed files
   d. Run typecheck → lint → tests (bail early on type errors)
   e. Score: 1-5 rating based on what passed
   f. Store training pair (pass OR fail — both are useful)
   g. If all pass: commit to branch. If fail: discard changes
4. **Log cycle** to `pipeline_cycles` table
5. **Sleep** for `PIPELINE_CYCLE_SEC` seconds

## Scoring

| Rating | Meaning | Included in training? |
|--------|---------|----------------------|
| 5 | All pass + build | Yes (high quality) |
| 4 | Typecheck + lint + tests pass | Yes (merge-ready) |
| 3 | Typecheck + tests pass, lint issues | Yes (good enough) |
| 2 | Typecheck passes, other failures | Yes (teaches partial) |
| 1 | Typecheck fails | Only with threshold=1 |

Auto-score weights: typecheck 30%, lint 20%, tests 30%, build 20%.

## Training (Jetson)

**Hardware**: Jetson Orin Nano, 8GB unified memory, Ampere GPU, CUDA 12
**Model**: Qwen2.5-Coder-3B with 4-bit QLoRA (NF4)
**LoRA**: rank=16, alpha=32, DoRA enabled, target=all-linear
**Memory**: batch=1, grad_accum=8, gradient checkpointing, paged_adamw_8bit

### Training cycle

1. Poll DB every 5 minutes for samples with `rating >= 2` and status `rated`/`raw`
2. When `>= 20` samples available, start a run
3. Build ChatML dataset, train 3 epochs
4. Save adapter (~50MB) to `/home/jetson/models/adapters/run_N/`
5. SCP to Mac (if `MAC_SCP_TARGET` set)
6. Register model version in DB

### Converting adapter for MLX (on Mac)

```bash
python -m mlx_lm.convert \
  --hf-path Qwen/Qwen2.5-Coder-3B \
  --adapter-path ~/models/adapters/run_42 \
  --mlx-path ~/models/usav-coder-v1

python -m mlx_lm.server --model ~/models/usav-coder-v1 --port 8085
```

## Configuration

All config in `src/lib/pipeline/config.ts`. Env var overrides:

| Variable | Default | Description |
|----------|---------|-------------|
| `MLX_BASE_URL` | `http://127.0.0.1:8085/v1` | MLX inference endpoint |
| `MLX_MODEL` | `default` | Model name in completions request |
| `PIPELINE_REPO_PATH` | `/Users/icecube/repos/USAV-Orders-Backend` | Repo to improve |
| `PIPELINE_CYCLE_SEC` | `600` | Seconds between cycles |
| `PIPELINE_MAX_TASKS` | `8` | Max tasks discovered per cycle |
| `PIPELINE_MAX_IMPL` | `5` | Max implementations per cycle |
| `PIPELINE_MAX_ATTEMPTS` | `3` | Retries per task before skip |
| `PIPELINE_RUN_BUILD` | `false` | Run `next build` in validation |
| `PIPELINE_BASE_MODEL` | `Qwen/Qwen2.5-Coder-3B` | Training base model |
| `PIPELINE_MIN_SAMPLES` | `20` | Min samples before training |
| `PIPELINE_RATING_THRESHOLD` | `2` | Min rating for training data |
| `PIPELINE_ADAPTER_DIR` | `~/models/adapters` | Adapter output directory |
| `JETSON_DEVICE_ID` | `jetson-orin-nano` | Device label in DB |
| `MAC_SCP_TARGET` | (unset) | SCP target for adapter export |

## Running

### Mac (orchestrator + inference)

```bash
# Option A: PM2 (recommended for persistent use)
npm run pipeline:start     # starts redis, mlx-server, pipeline
pm2 logs pipeline          # watch output
pm2 save && pm2 startup    # persist across reboots

# Option B: Direct (for testing)
npm run pipeline:orchestrator
```

### Jetson (training worker)

```bash
# One-time setup
scp -r scripts/jetson/ jetson@jetson-orin.local:~/pipeline/
ssh jetson@jetson-orin.local
cd ~/pipeline && ./setup.sh
sudo vim /etc/jetson-trainer.env   # set DATABASE_URL

# Start
sudo systemctl enable --now jetson-trainer
journalctl -u jetson-trainer -f    # watch output
```

### API endpoints

```bash
# Pipeline health
curl http://localhost:3000/api/pipeline/status

# Manual discovery
curl -X POST http://localhost:3000/api/pipeline/trigger

# Rate a sample
curl -X POST http://localhost:3000/api/pipeline/feedback \
  -H 'Content-Type: application/json' \
  -d '{"sampleId": 42, "rating": 5}'

# Promote latest model
curl -X POST http://localhost:3000/api/pipeline/promote
```

## Data Collection Sources

Training data enters from three paths:

1. **Pipeline** (automatic): Every implementation attempt → training pair with auto-score
2. **Git commits** (hookable): `collectFromCommit()` — attach to post-commit hook or scheduled scan
3. **Chat** (interactive): `collectFromChat()` — when users accept/reject AI responses

## Safety

- Agent only writes to files within `src/` (path validation in `agent.ts`)
- Each task runs on its own git branch — main is never modified directly
- Failed changes are discarded (git checkout), only the training pair persists
- Tasks have a max attempt limit (default 3) to prevent infinite retries
- Working tree is stashed before each task execution
- The orchestrator runs sequentially (concurrency=1) — no race conditions

## Related Docs

- **[PIPELINE-SETUP.md](./PIPELINE-SETUP.md)** — Step-by-step installation for Mac + Jetson, migration, verification
- **[PIPELINE-EXAMPLES.md](./PIPELINE-EXAMPLES.md)** — Detailed how-to examples: day-in-the-life walkthrough, manual sample injection, rating workflows, DB recipes, monitoring, debugging, custom discovery sources

## Key Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/pipeline/orchestrator.ts` | ~230 | Main loop, git management, cycle execution |
| `src/lib/pipeline/discover.ts` | ~220 | TypeScript, lint, test, TODO discovery |
| `src/lib/pipeline/agent.ts` | ~170 | LLM prompt building, response parsing, file writes |
| `src/lib/pipeline/validate.ts` | ~110 | tsc, lint, test, build execution |
| `src/lib/pipeline/scoring.ts` | ~60 | Rating and auto-score computation |
| `src/lib/pipeline/collect.ts` | ~100 | DB inserts for pipeline, commit, chat data |
| `src/lib/pipeline/config.ts` | ~100 | Central configuration with env overrides |
| `src/lib/pipeline/types.ts` | ~90 | All shared interfaces |
| `scripts/jetson/trainer.py` | ~380 | CUDA QLoRA training worker |
| `scripts/jetson/setup.sh` | ~90 | Jetson one-time setup |
| `ecosystem.config.cjs` | ~60 | PM2 process management |
