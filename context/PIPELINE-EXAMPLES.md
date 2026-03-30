# Pipeline Examples & How-To Guide

Concrete, copy-pasteable examples for every pipeline operation. Each section shows the exact commands, expected output, and what to do next.

---

## Table of Contents

1. [Day-in-the-Life: Full Autonomous Cycle](#1-day-in-the-life-full-autonomous-cycle)
2. [Manual Sample Injection](#2-manual-sample-injection)
3. [Rating & Feedback Workflows](#3-rating--feedback-workflows)
4. [Monitoring & Observability](#4-monitoring--observability)
5. [Working with Pipeline Branches](#5-working-with-pipeline-branches)
6. [Training Cycle on Jetson](#6-training-cycle-on-jetson)
7. [Loading a Fine-Tuned Model](#7-loading-a-fine-tuned-model)
8. [API Usage Examples](#8-api-usage-examples)
9. [Database Recipes](#9-database-recipes)
10. [Collecting from Git Commits](#10-collecting-from-git-commits)
11. [Collecting from AI Chat](#11-collecting-from-ai-chat)
12. [Tuning the Pipeline](#12-tuning-the-pipeline)
13. [Debugging Real Scenarios](#13-debugging-real-scenarios)
14. [Writing a Custom Discovery Source](#14-writing-a-custom-discovery-source)

---

## 1. Day-in-the-Life: Full Autonomous Cycle

Here's what happens when the pipeline runs unattended for a day.

### Morning: Start everything

```bash
# Mac — start all services
cd ~/repos/USAV-Orders-Backend
npm run pipeline:start

# Verify
pm2 status
```

Expected output:
```
┌────┬──────────────┬─────────┬──────┬───────┬──────────┐
│ id │ name         │ status  │ cpu  │ mem   │ uptime   │
├────┼──────────────┼─────────┼──────┼───────┼──────────┤
│ 0  │ redis        │ online  │ 0.1% │ 8MB   │ 2s       │
│ 1  │ mlx-server   │ online  │ 12%  │ 4.2GB │ 2s       │
│ 2  │ pipeline     │ online  │ 0.3% │ 180MB │ 1s       │
└────┴──────────────┴─────────┴──────┴───────┴──────────┘
```

### Every 10 minutes: Orchestrator runs a cycle

```
[pipeline] 2026-03-28T09:00:00.000Z === Cycle starting ===
[pipeline] 2026-03-28T09:00:00.500Z discovering tasks...
[pipeline] 2026-03-28T09:00:12.100Z found 6 raw tasks
[pipeline] 2026-03-28T09:00:12.300Z 4 actionable tasks after filtering
[pipeline] 2026-03-28T09:00:12.300Z [1/4] Fix TypeScript error in src/lib/shipping/carriers.ts
[pipeline] 2026-03-28T09:00:12.400Z   implementing: Fix TypeScript error in src/lib/shipping/carriers.ts
[pipeline] 2026-03-28T09:00:18.700Z   validating 1 changed files...
[pipeline] 2026-03-28T09:00:38.200Z   Rating 4/5 — typecheck: pass, lint: pass, tests: pass
[pipeline] 2026-03-28T09:00:38.500Z   PASS — committed a1b2c3d on pipeline/typecheck-k7f2
[pipeline] 2026-03-28T09:00:38.600Z [2/4] Fix lint issues in src/components/DashboardTable.tsx
[pipeline] 2026-03-28T09:00:38.700Z   implementing: Fix lint issues in src/components/DashboardTable.tsx
[pipeline] 2026-03-28T09:00:45.100Z   validating 1 changed files...
[pipeline] 2026-03-28T09:01:05.300Z   Rating 2/5 — typecheck: pass, lint: FAIL, tests: FAIL
[pipeline] 2026-03-28T09:01:05.400Z   FAIL — changes discarded, training pair stored
[pipeline] 2026-03-28T09:01:05.500Z [3/4] Resolve: TODO add retry logic for Zoho sync
[pipeline] 2026-03-28T09:01:05.600Z   implementing: Resolve: TODO add retry logic for Zoho sync
[pipeline] 2026-03-28T09:01:14.200Z   no changes produced — skipping
[pipeline] 2026-03-28T09:01:14.300Z [4/4] Fix failing test: dashboard-state
[pipeline] 2026-03-28T09:01:14.400Z   implementing: Fix failing test: dashboard-state
[pipeline] 2026-03-28T09:01:22.800Z   validating 1 changed files...
[pipeline] 2026-03-28T09:01:42.100Z   Rating 4/5 — typecheck: pass, lint: pass, tests: pass
[pipeline] 2026-03-28T09:01:42.400Z   PASS — committed d4e5f6a on pipeline/test_failure-m9p3
[pipeline] 2026-03-28T09:01:42.600Z === Cycle 14 complete: 2 passed, 1 failed, 3 samples, 102s ===
```

### After ~8 hours: 20+ samples accumulated

The Jetson trainer picks them up automatically:

```
[trainer] 2026-03-28T17:00:00 Found 24 eligible samples (threshold: 20)
[trainer] 2026-03-28T17:00:01 Run 1: training on 24 samples
[trainer] 2026-03-28T17:00:01 Dataset built: 24 conversations
[trainer] 2026-03-28T17:00:05 Loading Qwen/Qwen2.5-Coder-3B in 4-bit quantization...
[trainer] 2026-03-28T17:00:45 Parameters: 2,359,296 trainable / 3,090,227,200 total (0.08%)
[trainer] 2026-03-28T17:00:45 Starting training: 24 samples, 3 epochs, effective batch 8
[trainer] 2026-03-28T17:45:30 Training complete in 2685s. Loss: 0.8234
[trainer] 2026-03-28T17:45:31 Adapter saved to /home/jetson/models/adapters/run_1
[trainer] 2026-03-28T17:45:31 Registered model version v1
[trainer] 2026-03-28T17:45:35 Exporting adapter to icecube@macbook.local:~/models/adapters/run_1/
[trainer] 2026-03-28T17:45:40 Export complete
```

### Evening: Load the fine-tuned model (manual step)

```bash
# On Mac — convert and swap
source ~/.venvs/localai/bin/activate
python -m mlx_lm.convert \
  --hf-path Qwen/Qwen2.5-Coder-3B \
  --adapter-path ~/models/adapters/run_1 \
  --mlx-path ~/models/usav-coder-v1

pm2 restart mlx-server -- -m mlx_lm.server --model ~/models/usav-coder-v1 --port 8085

# Promote in DB
curl -X POST http://localhost:3000/api/pipeline/promote | jq .
```

Response:
```json
{
  "ok": true,
  "promoted": true,
  "version": "v1",
  "previousVersion": null,
  "adapterPath": "/home/jetson/models/adapters/run_1",
  "reason": "First model promoted"
}
```

Tomorrow's pipeline cycles now use the improved model.

---

## 2. Manual Sample Injection

Sometimes you want to seed the training DB with known-good examples — for instance, a tricky bug fix you just did manually.

### Insert via SQL (fastest)

```sql
-- A manually-authored bug fix you want the model to learn from
INSERT INTO training_samples (
  instruction,
  input_context,
  output,
  source,
  repo,
  file_paths,
  commit_sha,
  status,
  rating,
  auto_score,
  tests_pass,
  rated_at
) VALUES (
  'Fix race condition in Ably channel subscription where duplicate messages arrive when reconnecting',
  '// Before fix:
export function subscribeToOrders(callback) {
  const channel = ably.channels.get("orders:changes");
  channel.subscribe("update", callback);
}',
  '// After fix — added dedup guard:
const seen = new Set<string>();
export function subscribeToOrders(callback) {
  const channel = ably.channels.get("orders:changes");
  channel.subscribe("update", (msg) => {
    if (seen.has(msg.id)) return;
    seen.add(msg.id);
    if (seen.size > 1000) seen.clear();
    callback(msg);
  });
}',
  'manual',
  'USAV-Orders-Backend',
  '["src/lib/realtime/subscribe.ts"]',
  'abc123f',
  'rated',
  5,
  '1.0',
  true,
  NOW()
);
```

### Insert via Node script

```bash
# One-liner to inject a sample from a recent commit
node -e "
const pg = require('pg');
require('dotenv').config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(\`
  INSERT INTO training_samples (instruction, output, source, repo, commit_sha, status, rating, auto_score, rated_at)
  VALUES (\$1, \$2, 'manual', 'USAV-Orders-Backend', \$3, 'rated', 5, '1.0', NOW())
\`, [
  'Fix the eBay token refresh to handle 401 errors gracefully',
  require('child_process').execSync('git show --format= HEAD', { encoding: 'utf-8' }),
  require('child_process').execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
]).then(() => { console.log('Sample inserted'); pool.end(); });
"
```

### Bulk import from git log

```bash
# Import last 10 commits as training samples
node -e "
const { execSync } = require('child_process');
const pg = require('pg');
require('dotenv').config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const log = execSync('git log --oneline -10', { encoding: 'utf-8' }).trim().split('\n');
(async () => {
  for (const line of log) {
    const [sha, ...rest] = line.split(' ');
    const msg = rest.join(' ');
    const diff = execSync(\`git show --format= \${sha}\`, { encoding: 'utf-8' });
    const files = execSync(\`git diff-tree --no-commit-id --name-only -r \${sha}\`, { encoding: 'utf-8' })
      .trim().split('\n').filter(Boolean);
    await pool.query(\`
      INSERT INTO training_samples (instruction, output, source, repo, commit_sha, file_paths, status, rating, auto_score, rated_at)
      VALUES (\$1, \$2, 'commit', 'USAV-Orders-Backend', \$3, \$4, 'rated', 3, '0.7', NOW())
      ON CONFLICT DO NOTHING
    \`, [\`Implement: \${msg}\`, diff.slice(0, 50000), sha, JSON.stringify(files)]);
    console.log(\`  imported \${sha} — \${msg}\`);
  }
  await pool.end();
  console.log('Done');
})();
"
```

---

## 3. Rating & Feedback Workflows

### Rate a single sample via API

```bash
# First, find unrated samples
curl -s http://localhost:3000/api/pipeline/status | jq '.pipeline.sampleCounts'
# → { "raw": 5, "rated": 18, "trained": 24 }

# Look at raw samples to decide what to rate
psql "$DATABASE_URL" -c "
  SELECT id, LEFT(instruction, 60) as task, source, rating
  FROM training_samples
  WHERE status = 'raw'
  ORDER BY created_at DESC
  LIMIT 10;
"
```

Output:
```
 id  |                            task                            | source  | rating
-----+------------------------------------------------------------+---------+--------
 142 | Fix lint issues in src/components/PackingStation.tsx        | lint    |
 139 | Resolve: FIXME handle edge case for empty SKU              | todo_co |
 137 | Fix TypeScript error in src/lib/ebay/sync.ts               | typechk |
```

```bash
# Rate sample 142 as good (4/5)
curl -s -X POST http://localhost:3000/api/pipeline/feedback \
  -H 'Content-Type: application/json' \
  -d '{"sampleId": 142, "rating": 4}' | jq .
```

Response:
```json
{
  "ok": true,
  "sample": { "id": 142, "rating": 4 }
}
```

### Bulk-rate all passing samples

```sql
-- Auto-promote all 'raw' samples that had tests_pass=true to rated with rating 3
UPDATE training_samples
SET status = 'rated', rating = 3, rated_at = NOW()
WHERE status = 'raw' AND tests_pass = true AND rating IS NULL;
-- → UPDATE 12
```

### Reject bad samples

```sql
-- Mark low-quality samples as rejected so Jetson skips them
UPDATE training_samples
SET status = 'rejected'
WHERE rating = 1 AND status IN ('raw', 'rated');
-- → UPDATE 3
```

### View the full content of a sample

```sql
SELECT
  id,
  instruction,
  LEFT(input_context, 200) as context_preview,
  LEFT(output, 300) as output_preview,
  source,
  rating,
  auto_score,
  tests_pass,
  status,
  created_at
FROM training_samples
WHERE id = 142;
```

---

## 4. Monitoring & Observability

### Quick health check

```bash
npm run pipeline:status
```

Example response:
```json
{
  "ok": true,
  "pipeline": {
    "recentCycles": [
      {
        "id": 14,
        "tasksDiscovered": 6,
        "tasksAttempted": 4,
        "tasksPassed": 2,
        "tasksFailed": 1,
        "samplesCollected": 3,
        "durationSeconds": 102,
        "startedAt": "2026-03-28T09:00:00.000Z",
        "completedAt": "2026-03-28T09:01:42.600Z"
      }
    ],
    "sampleCounts": { "raw": 5, "rated": 18, "trained": 24, "queued": 0, "rejected": 3 },
    "taskCounts": { "pending": 12, "resolved": 28, "skipped": 4, "in_progress": 0 },
    "totalRatedSamples": 50,
    "averageRating": 3.4
  },
  "training": {
    "latestRun": {
      "id": 2,
      "status": "completed",
      "sampleCount": 32,
      "trainLoss": "0.7142",
      "durationSeconds": 3100,
      "deviceId": "jetson-orin-nano"
    },
    "activeModel": {
      "version": "v2",
      "baseModel": "Qwen/Qwen2.5-Coder-3B",
      "promoted": true,
      "evalScore": "0.7142"
    }
  }
}
```

### Watch the orchestrator in real time

```bash
pm2 logs pipeline --lines 50
```

### Track pass rate over time

```sql
SELECT
  DATE(started_at) as day,
  SUM(tasks_attempted) as attempted,
  SUM(tasks_passed) as passed,
  ROUND(100.0 * SUM(tasks_passed) / NULLIF(SUM(tasks_attempted), 0), 1) as pass_pct,
  SUM(samples_collected) as samples
FROM pipeline_cycles
GROUP BY DATE(started_at)
ORDER BY day DESC
LIMIT 14;
```

Output:
```
    day     | attempted | passed | pass_pct | samples
------------+-----------+--------+----------+---------
 2026-03-28 |        38 |     22 |     57.9 |      34
 2026-03-27 |        42 |     19 |     45.2 |      38
 2026-03-26 |        35 |     14 |     40.0 |      30
```

pass_pct should trend upward as the model improves.

### Compare model versions

```sql
SELECT
  mv.version,
  mv.eval_score as loss,
  mv.promoted,
  tr.sample_count,
  tr.duration_seconds,
  tr.completed_at
FROM model_versions mv
JOIN training_runs tr ON tr.id = mv.run_id
ORDER BY mv.created_at DESC
LIMIT 5;
```

```
 version | loss   | promoted | sample_count | duration_seconds |     completed_at
---------+--------+----------+--------------+------------------+------------------------
 v3      | 0.5890 | true     |           78 |             4200 | 2026-03-28 17:45:00+00
 v2      | 0.7142 | false    |           52 |             3100 | 2026-03-27 18:20:00+00
 v1      | 0.8234 | false    |           24 |             2685 | 2026-03-26 17:45:00+00
```

Loss going down = model improving.

---

## 5. Working with Pipeline Branches

The orchestrator creates one branch per passing task.

### List pipeline branches

```bash
git branch | grep pipeline/
```

```
  pipeline/lint-a8f2
  pipeline/test_failure-m9p3
  pipeline/typecheck-k7f2
  pipeline/typecheck-r4v1
```

### Review a pipeline fix

```bash
git log main..pipeline/typecheck-k7f2 --oneline
# → a1b2c3d pipeline(typecheck): Fix TypeScript error in src/lib/shipping/carriers.ts

git diff main..pipeline/typecheck-k7f2
```

### Merge a pipeline branch into main

```bash
git checkout main
git merge pipeline/typecheck-k7f2 --no-ff -m "merge: pipeline fix for carriers.ts type error"
git branch -d pipeline/typecheck-k7f2
```

### Batch-merge all pipeline branches

```bash
for branch in $(git branch | grep 'pipeline/' | tr -d ' '); do
  echo "Merging $branch..."
  git merge "$branch" --no-ff -m "merge: $branch" || {
    echo "CONFLICT in $branch — skipping"
    git merge --abort
    continue
  }
  git branch -d "$branch"
done
```

### Clean up stale pipeline branches

```bash
# Delete all pipeline branches older than 7 days that weren't merged
git for-each-ref --sort=-committerdate --format='%(refname:short) %(committerdate:short)' refs/heads/pipeline/ | while read branch date; do
  if [[ "$date" < "$(date -v-7d +%Y-%m-%d)" ]]; then
    echo "Deleting old branch: $branch ($date)"
    git branch -D "$branch"
  fi
done
```

---

## 6. Training Cycle on Jetson

### Check training status from Mac

```sql
-- Latest run
SELECT id, status, sample_count, train_loss, duration_seconds, started_at, completed_at
FROM training_runs
ORDER BY created_at DESC LIMIT 1;
```

### Check Jetson logs remotely

```bash
ssh jetson@jetson-orin.local 'journalctl -u jetson-trainer --since "1 hour ago" --no-pager'
```

### Force a training run (lower the threshold temporarily)

```bash
# On Jetson — temporarily lower min samples to 5
ssh jetson@jetson-orin.local
sudo systemctl stop jetson-trainer
sudo sed -i 's/PIPELINE_MIN_SAMPLES=20/PIPELINE_MIN_SAMPLES=5/' /etc/jetson-trainer.env
sudo systemctl start jetson-trainer
journalctl -u jetson-trainer -f
# Watch it start training...

# When done, restore the threshold
sudo sed -i 's/PIPELINE_MIN_SAMPLES=5/PIPELINE_MIN_SAMPLES=20/' /etc/jetson-trainer.env
sudo systemctl restart jetson-trainer
```

### Check GPU usage during training

```bash
ssh jetson@jetson-orin.local 'tegrastats --interval 2000' | head -5
```

Output:
```
RAM 6200/7620MB (lfb 0x0) SWAP 0/3810MB CPU [45%@1510,38%@1510,42%@1510,40%@1510] GR3D_FREQ 98%
```

`GR3D_FREQ 98%` = GPU fully utilized during training.

---

## 7. Loading a Fine-Tuned Model

### Full workflow after Jetson completes training

```bash
# Step 1: Check adapter arrived (if SCP configured)
ls -la ~/models/adapters/run_1/
# → adapter_config.json  adapter_model.safetensors  training_metadata.json  tokenizer.json

# Step 2: Read training metadata
cat ~/models/adapters/run_1/training_metadata.json | jq .
```

```json
{
  "run_id": 1,
  "base_model": "Qwen/Qwen2.5-Coder-3B",
  "sample_count": 24,
  "epochs": 3,
  "lora_rank": 16,
  "train_loss": 0.8234,
  "duration_seconds": 2685,
  "device": "jetson-orin-nano"
}
```

```bash
# Step 3: Convert LoRA adapter → MLX format
source ~/.venvs/localai/bin/activate
python -m mlx_lm.convert \
  --hf-path Qwen/Qwen2.5-Coder-3B \
  --adapter-path ~/models/adapters/run_1 \
  --mlx-path ~/models/usav-coder-v1

# Step 4: Test the model before going live
python -m mlx_lm.generate \
  --model ~/models/usav-coder-v1 \
  --prompt "Fix the TypeScript error: Type 'string' is not assignable to type 'number'" \
  --max-tokens 200

# Step 5: Swap the live server
pm2 stop mlx-server
pm2 start mlx-server -- -m mlx_lm.server --model ~/models/usav-coder-v1 --port 8085

# Step 6: Verify
curl -s http://127.0.0.1:8085/v1/models | jq .

# Step 7: Promote in DB
curl -s -X POST http://localhost:3000/api/pipeline/promote | jq .
```

### Rollback to base model if the fine-tune is worse

```bash
pm2 stop mlx-server
pm2 start mlx-server -- -m mlx_lm.server --port 8085
# (no --model flag = uses default base model)

# Demote in DB
psql "$DATABASE_URL" -c "UPDATE model_versions SET promoted = false WHERE promoted = true;"
```

---

## 8. API Usage Examples

### GET /api/pipeline/status — Full dashboard data

```bash
curl -s http://localhost:3000/api/pipeline/status | jq '{
  samples: .pipeline.sampleCounts,
  tasks: .pipeline.taskCounts,
  avgRating: .pipeline.averageRating,
  model: .training.activeModel.version,
  lastCycle: .pipeline.recentCycles[0] | {passed: .tasksPassed, failed: .tasksFailed, duration: .durationSeconds}
}'
```

Output:
```json
{
  "samples": { "raw": 5, "rated": 18, "trained": 24, "queued": 0, "rejected": 3 },
  "tasks": { "pending": 12, "resolved": 28, "skipped": 4 },
  "avgRating": 3.4,
  "model": "v2",
  "lastCycle": { "passed": 2, "failed": 1, "duration": 102 }
}
```

### POST /api/pipeline/trigger — Dry-run discovery

```bash
curl -s -X POST http://localhost:3000/api/pipeline/trigger | jq '.tasks[] | {title, source, priority}'
```

Output:
```json
{ "title": "Fix TypeScript error in src/lib/ebay/sync.ts", "source": "typecheck", "priority": 1 }
{ "title": "Fix failing test: dashboard-state", "source": "test_failure", "priority": 1 }
{ "title": "Fix lint issues in src/components/RepairForm.tsx", "source": "lint", "priority": 2 }
{ "title": "Resolve: TODO implement batch delete for FBA items", "source": "todo_comment", "priority": 3 }
```

### POST /api/pipeline/feedback — Rate samples

```bash
# Rate multiple samples in a loop
for id in 142 143 145 148; do
  curl -s -X POST http://localhost:3000/api/pipeline/feedback \
    -H 'Content-Type: application/json' \
    -d "{\"sampleId\": $id, \"rating\": 4}" | jq -c .
done
```

```
{"ok":true,"sample":{"id":142,"rating":4}}
{"ok":true,"sample":{"id":143,"rating":4}}
{"ok":true,"sample":{"id":145,"rating":4}}
{"ok":true,"sample":{"id":148,"rating":4}}
```

### POST /api/pipeline/promote — Model promotion

```bash
curl -s -X POST http://localhost:3000/api/pipeline/promote | jq .
```

When a better model exists:
```json
{
  "ok": true,
  "promoted": true,
  "version": "v3",
  "previousVersion": "v2",
  "adapterPath": "/home/jetson/models/adapters/run_3",
  "reason": "Improved: 0.5890 < 0.7142"
}
```

When no improvement:
```json
{
  "ok": true,
  "promoted": false,
  "reason": "New loss (0.7500) >= current (0.7142)",
  "currentVersion": "v2"
}
```

---

## 9. Database Recipes

### Training data health dashboard

```sql
SELECT
  'Total samples' as metric,       COUNT(*)::text as value FROM training_samples
UNION ALL SELECT
  'Avg rating',                     ROUND(AVG(rating), 2)::text FROM training_samples WHERE rating IS NOT NULL
UNION ALL SELECT
  'Samples ready for training',     COUNT(*)::text FROM training_samples WHERE status IN ('rated') AND rating >= 2
UNION ALL SELECT
  'Pipeline pass rate (last 7d)',   ROUND(100.0 * SUM(tasks_passed) / NULLIF(SUM(tasks_attempted), 0), 1)::text || '%' FROM pipeline_cycles WHERE started_at > NOW() - INTERVAL '7 days'
UNION ALL SELECT
  'Training runs completed',        COUNT(*)::text FROM training_runs WHERE status = 'completed'
UNION ALL SELECT
  'Active model',                   COALESCE(version, 'none') FROM model_versions WHERE promoted = true
;
```

### Find the most-attempted tasks (model struggles with these)

```sql
SELECT
  task_hash,
  title,
  source,
  attempts,
  status,
  result_rating
FROM pipeline_tasks
WHERE attempts >= 2
ORDER BY attempts DESC, created_at DESC
LIMIT 10;
```

### Top files the pipeline has changed

```sql
SELECT
  f.file_path,
  COUNT(*) as times_changed,
  ROUND(AVG(ts.rating), 1) as avg_rating
FROM training_samples ts,
     LATERAL jsonb_array_elements_text(ts.file_paths) f(file_path)
WHERE ts.source != 'chat'
GROUP BY f.file_path
ORDER BY times_changed DESC
LIMIT 15;
```

### Training data quality by source

```sql
SELECT
  source,
  COUNT(*) as total,
  ROUND(AVG(rating), 2) as avg_rating,
  COUNT(*) FILTER (WHERE rating >= 4) as high_quality,
  COUNT(*) FILTER (WHERE rating <= 2) as low_quality
FROM training_samples
WHERE rating IS NOT NULL
GROUP BY source
ORDER BY total DESC;
```

```
 source      | total | avg_rating | high_quality | low_quality
-------------+-------+------------+--------------+-------------
 typecheck   |    28 |       3.50 |           14 |           4
 lint        |    18 |       2.89 |            6 |           5
 commit      |    15 |       3.20 |            5 |           2
 test_failure|     8 |       3.75 |            5 |           1
 todo_comment|     6 |       2.33 |            1 |           3
 chat        |     4 |       3.50 |            2 |           1
 manual      |     3 |       5.00 |            3 |           0
```

### Reset a stuck task for retry

```sql
-- If a task is stuck in 'in_progress' (orchestrator crashed mid-task)
UPDATE pipeline_tasks
SET status = 'pending', attempts = attempts - 1
WHERE status = 'in_progress'
  AND last_attempt_at < NOW() - INTERVAL '30 minutes';
```

---

## 10. Collecting from Git Commits

The `collectFromCommit()` function in `src/lib/pipeline/collect.ts` can be called from a post-commit hook or a cron script.

### Option A: Git post-commit hook

Create `.git/hooks/post-commit`:

```bash
#!/bin/bash
# Collect training data from every commit
cd "$(git rev-parse --show-toplevel)"
SHA=$(git rev-parse --short HEAD)
MSG=$(git log -1 --format=%s)
DIFF=$(git show --format= HEAD)
FILES=$(git diff-tree --no-commit-id --name-only -r HEAD | jq -R -s 'split("\n") | map(select(. != ""))')

node -e "
const pg = require('pg');
require('dotenv').config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(\`
  INSERT INTO training_samples (instruction, output, source, repo, commit_sha, file_paths, status, rating, auto_score, rated_at)
  VALUES (\$1, \$2, 'commit', 'USAV-Orders-Backend', \$3, \$4, 'rated', 3, '0.7', NOW())
\`, [
  'Implement: $MSG',
  \`$(echo "$DIFF" | head -c 50000 | sed 's/`/\\`/g')\`,
  '$SHA',
  '$FILES'
]).then(() => pool.end()).catch(e => { console.error(e.message); pool.end(); });
" &
# Run in background so commits aren't slowed down
```

### Option B: Scheduled git log scanner (add to QStash or cron)

```typescript
// Example: scan last 24h of commits
import { collectFromCommit } from '@/lib/pipeline/collect';
import { execSync } from 'child_process';

const REPO = '/Users/icecube/repos/USAV-Orders-Backend';
const since = new Date(Date.now() - 86400000).toISOString();
const log = execSync(`git -C ${REPO} log --since="${since}" --format="%H %s" --no-merges`, { encoding: 'utf-8' });

for (const line of log.trim().split('\n').filter(Boolean)) {
  const [sha, ...rest] = line.split(' ');
  const msg = rest.join(' ');
  if (msg.startsWith('pipeline(')) continue; // skip pipeline's own commits
  const diff = execSync(`git -C ${REPO} show --format= ${sha}`, { encoding: 'utf-8' });
  const files = execSync(`git -C ${REPO} diff-tree --no-commit-id --name-only -r ${sha}`, { encoding: 'utf-8' })
    .trim().split('\n').filter(Boolean);
  await collectFromCommit({ message: msg, diff, files, repo: 'USAV-Orders-Backend', sha, testsPass: true });
}
```

---

## 11. Collecting from AI Chat

Wire up the USAV AI chat panel to store interactions as training data.

### In the chat API route (example integration)

```typescript
// In src/app/api/ai/tunnel-chat/route.ts — after getting the AI response:
import { collectFromChat } from '@/lib/pipeline/collect';

// After the response is sent to the user:
// (fire-and-forget, don't block the response)
collectFromChat({
  userMessage: body.message,
  assistantResponse: reply,
  accepted: true, // default to accepted; update via feedback endpoint later
  repo: 'USAV-Orders-Backend',
}).catch(() => {}); // silently ignore failures
```

### Rate chat samples after the fact

The user can thumb-up/down responses in the UI, which calls:

```bash
# User liked the response (sampleId returned from collectFromChat)
curl -X POST http://localhost:3000/api/pipeline/feedback \
  -H 'Content-Type: application/json' \
  -d '{"sampleId": 250, "rating": 5}'

# User didn't like it
curl -X POST http://localhost:3000/api/pipeline/feedback \
  -H 'Content-Type: application/json' \
  -d '{"sampleId": 250, "rating": 1}'
```

---

## 12. Tuning the Pipeline

### Speed up cycles (more aggressive)

```bash
# In .env:
PIPELINE_CYCLE_SEC=300        # 5 min instead of 10
PIPELINE_MAX_TASKS=12         # discover more per cycle
PIPELINE_MAX_IMPL=8           # implement more per cycle
```

Restart: `pm2 restart pipeline`

### Slow down cycles (less resource usage)

```bash
PIPELINE_CYCLE_SEC=1800       # 30 min between cycles
PIPELINE_MAX_IMPL=2           # only 2 implementations per cycle
```

### Enable build validation (stricter quality gate)

```bash
PIPELINE_RUN_BUILD=true       # runs `next build` after tests
```

This catches SSR issues and import errors but adds ~2 min per task.

### Lower training threshold (train sooner)

```bash
# On Jetson in /etc/jetson-trainer.env:
PIPELINE_MIN_SAMPLES=10       # train after just 10 samples
PIPELINE_RATING_THRESHOLD=1   # include even failed attempts
```

### Use a larger model on Jetson (if you have Orin Nano Super 16GB)

```bash
PIPELINE_BASE_MODEL=Qwen/Qwen2.5-Coder-7B
PIPELINE_LORA_RANK=8          # lower rank to fit in memory
PIPELINE_MAX_SEQ_LENGTH=1536  # shorter sequences
```

---

## 13. Debugging Real Scenarios

### Scenario: "The pipeline keeps failing on the same task"

```sql
-- Check which tasks have maxed out attempts
SELECT task_hash, title, source, attempts, status, last_attempt_at
FROM pipeline_tasks
WHERE attempts >= 3
ORDER BY last_attempt_at DESC;
```

```bash
# Look at the training sample for that task to see what the model tried
psql "$DATABASE_URL" -c "
  SELECT id, rating, LEFT(output, 200) as model_output
  FROM training_samples
  WHERE instruction LIKE '%Fix TypeScript error in src/lib/ebay%'
  ORDER BY created_at DESC LIMIT 3;
"
```

Fix: Either fix the issue manually, or reset the task for retry after adjusting the agent prompt:

```sql
UPDATE pipeline_tasks SET status = 'pending', attempts = 0 WHERE task_hash = 'k7f2abc12345';
```

### Scenario: "MLX server returns empty responses"

```bash
# Test the model directly
curl -s http://127.0.0.1:8085/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "default",
    "messages": [
      {"role": "system", "content": "You are a TypeScript engineer."},
      {"role": "user", "content": "Fix this type error: Type string is not assignable to type number"}
    ],
    "temperature": 0.15,
    "max_tokens": 500
  }' | jq '.choices[0].message.content'
```

If empty: check `pm2 logs mlx-server` for OOM or model loading errors.

### Scenario: "Jetson training failed with OOM"

```sql
-- Check the error log
SELECT id, error_log, sample_count FROM training_runs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 1;
```

```bash
# Reduce memory usage on Jetson
ssh jetson@jetson-orin.local
sudo tee -a /etc/jetson-trainer.env <<< "PIPELINE_MAX_SEQ_LENGTH=1024"
sudo tee -a /etc/jetson-trainer.env <<< "PIPELINE_LORA_RANK=8"
sudo systemctl restart jetson-trainer
```

### Scenario: "Pipeline branches conflict with my work"

```bash
# See what the pipeline has pending
git branch | grep pipeline/ | wc -l
# → 12

# Merge the good ones, delete the rest
for b in $(git branch | grep pipeline/); do
  rating=$(psql "$DATABASE_URL" -t -c "SELECT result_rating FROM pipeline_tasks WHERE result_branch = '$b' LIMIT 1" 2>/dev/null | tr -d ' ')
  if [ "$rating" -ge 4 ] 2>/dev/null; then
    echo "Merging $b (rating $rating)"
    git merge "$b" --no-ff -m "merge: $b" && git branch -d "$b"
  else
    echo "Deleting $b (rating $rating)"
    git branch -D "$b"
  fi
done
```

---

## 14. Writing a Custom Discovery Source

Add a new discovery source by editing `src/lib/pipeline/discover.ts`.

### Example: Discover unused exports

```typescript
// Add to discover.ts

function discoverUnusedExports(repoPath: string): DiscoveredTask[] {
  // Use ts-prune or a simple grep heuristic
  const output = exec(
    'npx ts-prune --error 2>/dev/null | grep -v "used in module" | head -10',
    repoPath,
    30_000,
  );
  if (!output?.trim()) return [];

  const tasks: DiscoveredTask[] = [];
  for (const line of output.split('\n').filter(Boolean)) {
    // Format: src/lib/foo.ts:42 - unusedFunction
    const match = line.match(/^(.+?):(\d+)\s+-\s+(.+)$/);
    if (!match) continue;
    const [, file, lineStr, name] = match;

    tasks.push({
      hash: hashString(`unused:${file}:${name}`),
      title: `Remove unused export "${name}" from ${file}`,
      source: 'lint',       // reuse existing enum value
      description: `The export "${name}" at ${file}:${lineStr} is not imported anywhere.`,
      filePaths: [file],
      context: readContext(repoPath, file, parseInt(lineStr, 10)),
      priority: 3,
    });
  }
  return tasks;
}
```

Then add it to the `discoverTasks()` function:

```typescript
export async function discoverTasks(repoPath: string): Promise<DiscoveredTask[]> {
  const allTasks: DiscoveredTask[] = [];
  allTasks.push(...discoverTypeErrors(repoPath));
  allTasks.push(...discoverTestFailures(repoPath));
  allTasks.push(...discoverLintIssues(repoPath));
  allTasks.push(...discoverTodoComments(repoPath));
  allTasks.push(...discoverUnusedExports(repoPath));  // ← add here
  // ... rest unchanged
}
```

### Example: Discover from GitHub Issues

```typescript
function discoverFromGitHubIssues(repoPath: string): DiscoveredTask[] {
  // Requires GITHUB_TOKEN in env
  const output = exec(
    'gh issue list --label "bug" --state open --json title,body,number --limit 5 2>/dev/null',
    repoPath,
    15_000,
  );
  if (!output?.trim()) return [];

  const issues = JSON.parse(output) as Array<{ title: string; body: string; number: number }>;
  return issues.map((issue) => ({
    hash: hashString(`gh:${issue.number}`),
    title: `GH#${issue.number}: ${issue.title.slice(0, 80)}`,
    source: 'manual' as TaskSource,
    description: issue.body?.slice(0, 1000) || issue.title,
    filePaths: [],     // agent will need to figure out which files
    context: '',
    priority: 2,
  }));
}
```

> **Note:** Custom discovery sources that return `filePaths: []` will cause the agent to skip them (no files to read). For GitHub issues, you'd need to enhance the agent to search the codebase for relevant files — that's a more advanced feature.
