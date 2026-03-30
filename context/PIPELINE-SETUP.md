# Pipeline Setup Guide

Step-by-step instructions for setting up the self-improving AI training pipeline on your Mac and Jetson Orin Nano.

## Prerequisites

| Machine | Requirement |
|---------|-------------|
| Mac | Apple Silicon, Node 22+, Python 3.11+, `~/.venvs/localai/` venv with `mlx_lm` |
| Jetson | Orin Nano (8GB), JetPack 6 (CUDA 12), network access to Neon Postgres |
| Database | Neon Postgres with `DATABASE_URL` in `.env` |

---

## Part 1: Database Migration (Mac, one-time)

### 1.1 Run the migration

```bash
cd ~/repos/USAV-Orders-Backend
npm run pipeline:migrate
```

Expected output:
```
✓ Tables created:
    model_versions
    pipeline_cycles
    pipeline_tasks
    training_runs
    training_samples
✓ Enums created:
    pipeline_task_source
    training_run_status
    training_sample_status
```

The migration is idempotent — safe to re-run. Uses `IF NOT EXISTS` on everything.

### 1.2 Verify with E2E tests

```bash
npm run pipeline:test
```

Expected: `24 passed, 0 failed`

This runs 24 tests covering:
- All 5 tables exist with correct columns
- All 3 enums exist and reject invalid values
- CRUD operations (insert, read, update, status transitions)
- Foreign key integrity (training_samples → training_runs, model_versions → training_runs)
- Unique constraint on `pipeline_tasks.task_hash`
- Discovery module (tsc error parsing, hash determinism, grep against real repo)
- Scoring module (all 5 rating levels verified)

All test data is automatically cleaned up.

### 1.3 Verify with API tests (optional, needs dev server)

```bash
# Terminal 1: start dev server
npm run dev

# Terminal 2: run full test suite including API endpoints
npm run pipeline:test:api
```

This adds tests for:
- `GET /api/pipeline/status` returns cycle history and sample counts
- `POST /api/pipeline/trigger` runs discovery and returns tasks
- `POST /api/pipeline/feedback` rates a training sample
- `POST /api/pipeline/promote` checks model promotion logic

---

## Part 2: Mac Setup (Orchestrator + Inference)

### 2.1 Install PM2

```bash
npm install -g pm2
```

### 2.2 Install Redis

```bash
brew install redis
```

### 2.3 Verify MLX LM server works

```bash
source ~/.venvs/localai/bin/activate
python -m mlx_lm.server --port 8085
# In another terminal:
curl http://127.0.0.1:8085/v1/models
# Should return a JSON list of available models
```

### 2.4 Create adapter directory

```bash
mkdir -p ~/models/adapters
```

### 2.5 Set pipeline env vars

These should already be in `.env` after the previous implementation step. Verify:

```bash
grep PIPELINE .env
```

Expected:
```
MLX_BASE_URL=http://127.0.0.1:8085/v1
MLX_MODEL=default
PIPELINE_REPO_PATH=/Users/icecube/repos/USAV-Orders-Backend
PIPELINE_CYCLE_SEC=600
PIPELINE_MAX_TASKS=8
PIPELINE_MAX_IMPL=5
PIPELINE_MAX_ATTEMPTS=3
PIPELINE_RUN_BUILD=false
PIPELINE_ADAPTER_DIR=/Users/icecube/models/adapters
PIPELINE_BASE_MODEL=Qwen/Qwen2.5-Coder-3B
PIPELINE_MIN_SAMPLES=20
PIPELINE_RATING_THRESHOLD=2
```

### 2.6 Start the pipeline

**Option A: PM2 (recommended for persistent operation)**

```bash
cd ~/repos/USAV-Orders-Backend
npm run pipeline:start
```

This starts 3 processes:
- `redis` — job queue backend on :6379
- `mlx-server` — local LLM inference on :8085
- `pipeline` — the orchestrator loop

Monitor:
```bash
pm2 logs pipeline          # watch orchestrator output
pm2 logs mlx-server        # watch inference logs
pm2 status                 # see all process states
```

Persist across reboots:
```bash
pm2 save
pm2 startup                # generates a launchd command — run what it prints
```

**Option B: Direct execution (for testing)**

```bash
# Start Redis and MLX manually first, then:
npm run pipeline:orchestrator
```

### 2.7 Verify it's working

```bash
# Check all 3 services are online
pm2 status
# Expected: redis=online, mlx-server=online, pipeline=online

# Test MLX inference directly
curl -s http://127.0.0.1:8085/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "Say hello in TypeScript"}],
    "max_tokens": 50
  }' | jq '.choices[0].message.content'
# Expected: a short TypeScript snippet

# Check pipeline status (requires dev server running for API)
curl -s http://localhost:3000/api/pipeline/status | jq '.pipeline.sampleCounts'
# Expected: { "raw": 0, "rated": 0, "trained": 0, "queued": 0, "rejected": 0 }

# Manually trigger a discovery cycle
curl -s -X POST http://localhost:3000/api/pipeline/trigger | jq '{found: .tasksDiscovered, tasks: [.tasks[] | .title]}'
# Expected: { "found": 3, "tasks": ["Fix TypeScript error in ...", "Fix lint..."] }
```

### 2.8 Observe the first cycle

Watch the pipeline logs for the first 10 minutes:

```bash
pm2 logs pipeline --lines 200
```

You should see:
```
[pipeline] Pipeline orchestrator starting
[pipeline] Repo: /Users/icecube/repos/USAV-Orders-Backend
[pipeline] === Cycle starting ===
[pipeline] discovering tasks...
[pipeline] found N raw tasks
[pipeline] M actionable tasks after filtering
[pipeline] [1/M] Fix TypeScript error in ...
[pipeline]   implementing: ...
[pipeline]   validating 2 changed files...
[pipeline]   Rating 4/5 — typecheck: pass, lint: pass, tests: pass
[pipeline]   PASS — committed abc1234 on pipeline/typecheck-a3f2
[pipeline] === Cycle 1 complete: 2 passed, 1 failed, 3 samples, 45s ===
```

---

## Part 3: Jetson Orin Nano Setup (Training Worker)

### 3.1 Copy scripts to Jetson

```bash
scp -r ~/repos/USAV-Orders-Backend/scripts/jetson/ jetson@jetson-orin.local:~/pipeline/
```

### 3.2 Run setup script

```bash
ssh jetson@jetson-orin.local
cd ~/pipeline
chmod +x setup.sh
./setup.sh
```

This installs:
- Python venv at `~/.venvs/trainer/`
- PyTorch for JetPack 6 (CUDA 12)
- transformers, peft, trl, bitsandbytes, datasets
- systemd service `jetson-trainer`

### 3.3 Configure DATABASE_URL

```bash
sudo vim /etc/jetson-trainer.env
```

Set your Neon connection string:
```
DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@ep-XXXXX-pooler.YOUR_REGION.aws.neon.tech/neondb?sslmode=require
```

Optional overrides (defaults are fine for 8GB Orin Nano):
```
PIPELINE_BASE_MODEL=Qwen/Qwen2.5-Coder-3B
PIPELINE_MIN_SAMPLES=20
PIPELINE_POLL_INTERVAL=300
PIPELINE_RATING_THRESHOLD=2
PIPELINE_LORA_RANK=16
PIPELINE_EPOCHS=3
MAC_SCP_TARGET=icecube@macbook.local:~/models/adapters/
```

### 3.4 Verify CUDA

```bash
source ~/.venvs/trainer/bin/activate
python3 -c "import torch; print(f'CUDA: {torch.cuda.is_available()}, Device: {torch.cuda.get_device_name(0)}')"
```

Expected: `CUDA: True, Device: Orin (nvgpu)`

### 3.5 Test trainer manually

```bash
source ~/.venvs/trainer/bin/activate
export DATABASE_URL="postgresql://..."
python3 ~/pipeline/trainer.py
```

It should connect to the DB and show:
```
[trainer] Jetson CUDA Training Worker
[trainer] Base model: Qwen/Qwen2.5-Coder-3B
[trainer] DB connected. N total training samples in database.
[trainer] Found M eligible samples (threshold: 20)
[trainer] Waiting for more data (M/20)...
```

Press `Ctrl+C` to stop once verified.

### 3.6 Enable as a service

```bash
sudo systemctl enable --now jetson-trainer
```

Monitor:
```bash
journalctl -u jetson-trainer -f
```

### 3.7 Set up SCP key (for auto-export)

If you set `MAC_SCP_TARGET`, set up passwordless SSH:

```bash
# On Jetson:
ssh-keygen -t ed25519 -N ""
ssh-copy-id icecube@macbook.local
```

Test: `ssh icecube@macbook.local 'echo ok'`

---

## Part 4: After Fine-Tuning — Loading the Adapter

When the Jetson completes a training run, you'll see in its logs:
```
[trainer] Run 1 complete: loss=0.8234, 2700s, version=v1
[trainer] Exporting adapter to icecube@macbook.local:~/models/adapters/run_1/
```

### 4.1 Convert adapter to MLX format (on Mac)

```bash
source ~/.venvs/localai/bin/activate
python -m mlx_lm.convert \
  --hf-path Qwen/Qwen2.5-Coder-3B \
  --adapter-path ~/models/adapters/run_1 \
  --mlx-path ~/models/usav-coder-v1
```

### 4.2 Restart MLX with the fine-tuned model

```bash
pm2 stop mlx-server
pm2 start mlx-server -- -m mlx_lm.server --model ~/models/usav-coder-v1 --port 8085
# Or update ecosystem.config.cjs and restart
```

### 4.3 Auto-promote via API

```bash
curl -X POST http://localhost:3000/api/pipeline/promote
```

This checks if the new model's loss is better than the current one and promotes it.

---

## Quick Reference

### npm scripts

| Script | Description |
|--------|-------------|
| `npm run pipeline:migrate` | Create pipeline tables (idempotent) |
| `npm run pipeline:test` | Run 24 E2E tests against live DB |
| `npm run pipeline:test:api` | Run full tests including API endpoints |
| `npm run pipeline:start` | Start pipeline via PM2 (redis + mlx + orchestrator) |
| `npm run pipeline:stop` | Stop the pipeline orchestrator |
| `npm run pipeline:logs` | Tail pipeline orchestrator logs |
| `npm run pipeline:status` | Fetch pipeline status from API |
| `npm run pipeline:trigger` | Manually trigger a discovery cycle |
| `npm run pipeline:orchestrator` | Run orchestrator directly (not PM2) |

### Jetson commands

```bash
sudo systemctl start jetson-trainer    # Start training worker
sudo systemctl stop jetson-trainer     # Stop training worker
sudo systemctl status jetson-trainer   # Check status
journalctl -u jetson-trainer -f        # Follow logs
sudo vim /etc/jetson-trainer.env       # Edit config
```

### Useful DB queries

```sql
-- Training data overview
SELECT status, COUNT(*), ROUND(AVG(rating), 1) as avg_rating
FROM training_samples
GROUP BY status ORDER BY status;

-- Recent pipeline cycles
SELECT id, tasks_discovered, tasks_passed, tasks_failed,
       samples_collected, duration_seconds, started_at
FROM pipeline_cycles ORDER BY started_at DESC LIMIT 10;

-- Training runs
SELECT id, status, sample_count, train_loss, duration_seconds,
       device_id, started_at
FROM training_runs ORDER BY created_at DESC LIMIT 5;

-- Active model version
SELECT * FROM model_versions WHERE promoted = true;

-- Tasks by status
SELECT status, COUNT(*) FROM pipeline_tasks GROUP BY status;
```

---

## Troubleshooting

### Pipeline orchestrator crashes on startup

**"Cannot access repo"** — Check `PIPELINE_REPO_PATH` in `.env` points to the correct repo.

**"git: not on main"** — The orchestrator switches to main automatically, but if there are uncommitted changes it will stash them. Check `git status`.

### MLX server not responding

```bash
pm2 logs mlx-server          # check for errors
curl http://127.0.0.1:8085/v1/models   # test directly
```

Common issues:
- Model not downloaded yet: `python -m mlx_lm.download --model Qwen/Qwen2.5-Coder-3B`
- Port conflict: `lsof -i :8085`

### Jetson trainer "Waiting for more data"

This is normal — the trainer waits until `PIPELINE_MIN_SAMPLES` (default 20) rated samples accumulate before starting a training run. Run the orchestrator for a while to build up data.

### Training OOM on Jetson

Reduce memory usage:
```bash
# In /etc/jetson-trainer.env:
PIPELINE_MAX_SEQ_LENGTH=1024    # default 2048
PIPELINE_BATCH_SIZE=1           # already minimal
PIPELINE_LORA_RANK=8            # default 16
```

### E2E tests fail on "table does not exist"

Run the migration first: `npm run pipeline:migrate`

### API returns 500 on pipeline endpoints

Check that the Drizzle schema is in sync:
```bash
npm run db:push -- --dry-run
```
If it shows pipeline table changes, the migration didn't run. Run `npm run pipeline:migrate`.

---

## Related Docs

- **[PIPELINE.md](./PIPELINE.md)** — Architecture, data flow, scoring, training, configuration reference
- **[PIPELINE-EXAMPLES.md](./PIPELINE-EXAMPLES.md)** — Detailed how-to examples: day-in-the-life walkthrough, manual sample injection, rating workflows, DB recipes, monitoring, debugging, custom discovery sources
