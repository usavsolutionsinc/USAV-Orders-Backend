/**
 * PM2 Ecosystem Config — Self-Improving Pipeline
 *
 * Manages the local Mac processes for the autonomous code pipeline:
 *   - Redis:       Job queue backend
 *   - MLX Server:  Local LLM inference (Apple Silicon)
 *   - Pipeline:    The orchestrator loop (discover → implement → validate → collect)
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs pipeline          # watch the orchestrator
 *   pm2 stop all               # stop everything
 *   pm2 save && pm2 startup    # persist across reboots
 *
 * The USAV web app continues to run on Vercel.
 * The Jetson trainer runs as a systemd service (see scripts/jetson/).
 */

const path = require('path');

// Load .env for DATABASE_URL and other vars
require('dotenv').config({ path: path.join(__dirname, '.env') });

module.exports = {
  apps: [
    // ─── Redis ─────────────────────────────────────────────
    {
      name: 'redis',
      script: 'redis-server',
      args: '--port 6379 --maxmemory 256mb --maxmemory-policy allkeys-lru',
      autorestart: true,
      max_restarts: 10,
    },

    // ─── MLX LM Server ────────────────────────────────────
    // Serves the local model (base or fine-tuned) on port 8085.
    // Change --model path after Jetson produces a new adapter.
    {
      name: 'mlx-server',
      script: path.join(process.env.HOME, '.venvs/localai/bin/python'),
      args: '-m mlx_lm.server --port 8085',
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      env: {
        // Default: use base model. After fine-tuning, update to adapter path:
        // MLX_MODEL_PATH: '~/models/usav-coder-v1'
      },
    },

    // ─── Pipeline Orchestrator ─────────────────────────────
    // The main autonomous loop. Discovers tasks, implements via LLM,
    // validates with tests/lint/typecheck, and collects training data.
    {
      name: 'pipeline',
      script: 'npx',
      args: 'tsx src/lib/pipeline/orchestrator.ts',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
      // Don't start automatically — run `pm2 start pipeline` manually
      // until you've verified the setup works.
      autorestart: true,
      env: {
        DATABASE_URL: process.env.DATABASE_URL,
        MLX_BASE_URL: 'http://127.0.0.1:8085/v1',
        MLX_MODEL: 'default',
        PIPELINE_REPO_PATH: __dirname,
        PIPELINE_CYCLE_SEC: '600',
        PIPELINE_MAX_TASKS: '8',
        PIPELINE_MAX_IMPL: '5',
        PIPELINE_RUN_BUILD: 'false',
        NODE_OPTIONS: '--max-old-space-size=4096',
      },
    },
  ],
};
