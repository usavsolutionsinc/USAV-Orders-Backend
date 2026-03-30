#!/usr/bin/env python3
"""
Jetson CUDA Training Worker

Polls Postgres for new training samples, builds SFT datasets, runs QLoRA
fine-tuning on the Jetson Orin Nano, and exports LoRA adapters.

Hardware target: Jetson Orin Nano (8GB unified memory)
Model target:    Qwen2.5-Coder-3B with 4-bit QLoRA
Training:        peft + trl SFTTrainer with gradient checkpointing

Setup:
  See scripts/jetson/setup.sh for one-time installation.

Run:
  DATABASE_URL="postgresql://..." python3 scripts/jetson/trainer.py

Or as a systemd service:
  sudo systemctl start jetson-trainer
"""

import os
import sys
import time
import json
import logging
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional

import torch
import psycopg2
from psycopg2.extras import RealDictCursor

# ─── Configuration ────────────────────────────────────────────

DB_URL = os.environ.get("DATABASE_URL")
if not DB_URL:
    print("ERROR: DATABASE_URL environment variable is required", file=sys.stderr)
    sys.exit(1)

BASE_MODEL = os.environ.get("PIPELINE_BASE_MODEL", "Qwen/Qwen2.5-Coder-3B")
ADAPTER_DIR = Path(os.environ.get("PIPELINE_ADAPTER_DIR", "/home/jetson/models/adapters"))
EXPORT_DIR = Path(os.environ.get("PIPELINE_EXPORT_DIR", "/home/jetson/models/exports"))
MIN_SAMPLES = int(os.environ.get("PIPELINE_MIN_SAMPLES", "20"))
POLL_INTERVAL = int(os.environ.get("PIPELINE_POLL_INTERVAL", "300"))
RATING_THRESHOLD = int(os.environ.get("PIPELINE_RATING_THRESHOLD", "2"))
DEVICE_ID = os.environ.get("JETSON_DEVICE_ID", "jetson-orin-nano")
MAX_SEQ_LENGTH = int(os.environ.get("PIPELINE_MAX_SEQ_LENGTH", "2048"))

# LoRA hyperparameters
LORA_RANK = int(os.environ.get("PIPELINE_LORA_RANK", "16"))
LORA_ALPHA = int(os.environ.get("PIPELINE_LORA_ALPHA", "32"))
LEARNING_RATE = float(os.environ.get("PIPELINE_LEARNING_RATE", "2e-4"))
EPOCHS = int(os.environ.get("PIPELINE_EPOCHS", "3"))
BATCH_SIZE = int(os.environ.get("PIPELINE_BATCH_SIZE", "1"))
GRAD_ACCUM = int(os.environ.get("PIPELINE_GRAD_ACCUM", "8"))

# Optional: SCP adapter to Mac after training
MAC_SCP_TARGET = os.environ.get("MAC_SCP_TARGET")  # e.g. "user@macbook.local:~/models/adapters/"

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [trainer] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ─── Database Helpers ─────────────────────────────────────────

def get_conn():
    """Create a new database connection."""
    return psycopg2.connect(DB_URL, cursor_factory=RealDictCursor)


def fetch_unprocessed_samples():
    """
    Pull all samples eligible for training:
      - Status is 'rated' or 'raw'
      - Rating meets threshold OR tests passed (auto-qualified)
    """
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT id, instruction, input_context, output, source,
                   rating, auto_score, tests_pass
            FROM training_samples
            WHERE status IN ('rated', 'raw')
              AND (
                (rating IS NOT NULL AND rating >= %s)
                OR (rating IS NULL AND tests_pass = true)
              )
            ORDER BY
                rating DESC NULLS LAST,
                created_at ASC
        """, (RATING_THRESHOLD,))
        return cur.fetchall()


def mark_samples_queued(sample_ids: list[int], run_id: int):
    """Mark samples as queued for a specific training run."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE training_samples
            SET status = 'queued', training_run_id = %s
            WHERE id = ANY(%s)
        """, (run_id, sample_ids))
        conn.commit()


def mark_samples_trained(run_id: int):
    """Mark all samples in a run as trained."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE training_samples
            SET status = 'trained'
            WHERE training_run_id = %s AND status = 'queued'
        """, (run_id,))
        conn.commit()


def create_run(sample_count: int) -> int:
    """Create a new training_runs record and return its ID."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO training_runs
                (base_model, sample_count, status, device_id,
                 lora_rank, learning_rate, epochs, started_at)
            VALUES (%s, %s, 'running', %s, %s, %s, %s, NOW())
            RETURNING id
        """, (BASE_MODEL, sample_count, DEVICE_ID, LORA_RANK, LEARNING_RATE, EPOCHS))
        conn.commit()
        return cur.fetchone()["id"]


def complete_run(run_id: int, train_loss: float, adapter_path: str, duration: int):
    """Mark a training run as completed."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE training_runs
            SET status = 'completed',
                train_loss = %s,
                adapter_path = %s,
                duration_seconds = %s,
                completed_at = NOW()
            WHERE id = %s
        """, (train_loss, adapter_path, duration, run_id))
        conn.commit()


def fail_run(run_id: int, error: str):
    """Mark a training run as failed with error details."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE training_runs
            SET status = 'failed',
                error_log = %s,
                completed_at = NOW()
            WHERE id = %s
        """, (str(error)[:4000], run_id))
        conn.commit()
        # Release queued samples back to rated
        cur.execute("""
            UPDATE training_samples
            SET status = 'rated', training_run_id = NULL
            WHERE training_run_id = %s AND status = 'queued'
        """, (run_id,))
        conn.commit()


def register_model_version(run_id: int, adapter_path: str, train_loss: float) -> str:
    """Register a new model version. Returns the version string."""
    with get_conn() as conn, conn.cursor() as cur:
        # Get next version number
        cur.execute("SELECT COUNT(*) as cnt FROM model_versions")
        count = cur.fetchone()["cnt"]
        version = f"v{count + 1}"

        cur.execute("""
            INSERT INTO model_versions
                (run_id, version, base_model, adapter_path, eval_score)
            VALUES (%s, %s, %s, %s, %s)
        """, (run_id, version, BASE_MODEL, adapter_path, train_loss))
        conn.commit()
        return version


# ─── Dataset Builder ──────────────────────────────────────────

def build_dataset(samples: list[dict]):
    """
    Convert database rows to a HuggingFace Dataset in ChatML format.

    ChatML template (used by Qwen models):
      <|im_start|>system\n...<|im_end|>
      <|im_start|>user\n...<|im_end|>
      <|im_start|>assistant\n...<|im_end|>
    """
    from datasets import Dataset

    conversations = []
    for s in samples:
        ctx = s.get("input_context") or ""
        instruction = s["instruction"]
        if ctx:
            instruction = f"{instruction}\n\nContext:\n```\n{ctx}\n```"

        text = (
            "<|im_start|>system\n"
            "You are a senior TypeScript/Next.js engineer. "
            "Write clean, correct code. Fix only what is asked. "
            "Preserve existing style.<|im_end|>\n"
            f"<|im_start|>user\n{instruction}<|im_end|>\n"
            f"<|im_start|>assistant\n{s['output']}<|im_end|>"
        )
        conversations.append({"text": text})

    return Dataset.from_list(conversations)


# ─── Training ─────────────────────────────────────────────────

def run_training(dataset, run_id: int) -> tuple[float, str, int]:
    """
    Execute QLoRA fine-tuning on the dataset.

    Returns: (train_loss, adapter_path, duration_seconds)
    """
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        TrainingArguments,
    )
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from trl import SFTTrainer

    adapter_path = str(ADAPTER_DIR / f"run_{run_id}")
    os.makedirs(adapter_path, exist_ok=True)

    # ─── 4-bit quantization (NF4 for QLoRA) ───
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    # ─── Load base model ───
    log.info(f"Loading {BASE_MODEL} in 4-bit quantization...")
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=bnb_config,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
    )

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Prepare for k-bit training (freeze base, enable gradient on adapters)
    model = prepare_model_for_kbit_training(model)

    # ─── LoRA configuration ───
    lora_config = LoraConfig(
        r=LORA_RANK,
        lora_alpha=LORA_ALPHA,
        lora_dropout=0.05,
        target_modules="all-linear",
        task_type="CAUSAL_LM",
        use_dora=True,
    )
    model = get_peft_model(model, lora_config)

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    log.info(f"Parameters: {trainable:,} trainable / {total:,} total ({100*trainable/total:.2f}%)")

    # ─── Training arguments (tuned for Jetson Orin Nano 8GB) ───
    training_args = TrainingArguments(
        output_dir=adapter_path,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM,
        learning_rate=LEARNING_RATE,
        bf16=True,
        logging_steps=5,
        save_strategy="epoch",
        save_total_limit=2,
        optim="paged_adamw_8bit",
        max_grad_norm=0.3,
        warmup_ratio=0.03,
        lr_scheduler_type="cosine",
        gradient_checkpointing=True,
        dataloader_pin_memory=False,       # Jetson unified memory
        report_to="none",
        remove_unused_columns=True,
    )

    # ─── SFT Trainer ───
    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        args=training_args,
        tokenizer=tokenizer,
        max_seq_length=MAX_SEQ_LENGTH,
    )

    log.info(f"Starting training: {len(dataset)} samples, {EPOCHS} epochs, "
             f"effective batch {BATCH_SIZE * GRAD_ACCUM}")
    start = time.time()
    result = trainer.train()
    duration = int(time.time() - start)

    # Save adapter weights (~50MB, not the full model)
    trainer.save_model(adapter_path)
    tokenizer.save_pretrained(adapter_path)

    # Save training metadata
    metadata = {
        "run_id": run_id,
        "base_model": BASE_MODEL,
        "sample_count": len(dataset),
        "epochs": EPOCHS,
        "lora_rank": LORA_RANK,
        "train_loss": result.training_loss,
        "duration_seconds": duration,
        "timestamp": datetime.utcnow().isoformat(),
        "device": DEVICE_ID,
    }
    with open(os.path.join(adapter_path, "training_metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    log.info(f"Training complete in {duration}s. Loss: {result.training_loss:.4f}")
    log.info(f"Adapter saved to {adapter_path}")

    return result.training_loss, adapter_path, duration


# ─── Adapter Export ───────────────────────────────────────────

def export_adapter(adapter_path: str, run_id: int):
    """
    Optionally SCP the adapter to the Mac for MLX conversion.
    Set MAC_SCP_TARGET env to enable (e.g. "user@macbook.local:~/models/adapters/")
    """
    if not MAC_SCP_TARGET:
        log.info("MAC_SCP_TARGET not set — skipping adapter export (copy manually)")
        return

    target = f"{MAC_SCP_TARGET.rstrip('/')}/run_{run_id}/"
    log.info(f"Exporting adapter to {target}")
    try:
        os.system(f"scp -r {adapter_path} {target}")
        log.info("Export complete")
    except Exception as e:
        log.warning(f"Export failed (non-fatal): {e}")


# ─── Main Loop ────────────────────────────────────────────────

def main():
    ADAPTER_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    log.info("=" * 60)
    log.info("Jetson CUDA Training Worker")
    log.info("=" * 60)
    log.info(f"Base model:      {BASE_MODEL}")
    log.info(f"Adapter dir:     {ADAPTER_DIR}")
    log.info(f"Min samples:     {MIN_SAMPLES}")
    log.info(f"Rating threshold: {RATING_THRESHOLD}")
    log.info(f"Poll interval:   {POLL_INTERVAL}s")
    log.info(f"LoRA rank:       {LORA_RANK}")
    log.info(f"Max seq length:  {MAX_SEQ_LENGTH}")

    if torch.cuda.is_available():
        log.info(f"CUDA device:     {torch.cuda.get_device_name(0)}")
        log.info(f"CUDA memory:     {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB")
    else:
        log.warning("CUDA not available — training will be very slow on CPU")

    # Verify DB connection
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) as cnt FROM training_samples")
            total = cur.fetchone()["cnt"]
            log.info(f"DB connected. {total} total training samples in database.")
    except Exception as e:
        log.error(f"Cannot connect to database: {e}")
        sys.exit(1)

    # Main polling loop
    while True:
        run_id: Optional[int] = None
        try:
            samples = fetch_unprocessed_samples()
            log.info(f"Found {len(samples)} eligible samples (threshold: {MIN_SAMPLES})")

            if len(samples) < MIN_SAMPLES:
                log.info(f"Waiting for more data ({len(samples)}/{MIN_SAMPLES})...")
                time.sleep(POLL_INTERVAL)
                continue

            # Create training run record
            run_id = create_run(len(samples))
            sample_ids = [s["id"] for s in samples]
            mark_samples_queued(sample_ids, run_id)

            log.info(f"Run {run_id}: training on {len(samples)} samples")

            # Build dataset
            dataset = build_dataset(samples)
            log.info(f"Dataset built: {len(dataset)} conversations")

            # Train
            train_loss, adapter_path, duration = run_training(dataset, run_id)

            # Update DB
            complete_run(run_id, train_loss, adapter_path, duration)
            mark_samples_trained(run_id)

            # Register model version
            version = register_model_version(run_id, adapter_path, train_loss)
            log.info(f"Registered model version {version}")

            # Export to Mac
            export_adapter(adapter_path, run_id)

            log.info(f"Run {run_id} complete: loss={train_loss:.4f}, {duration}s, version={version}")

        except KeyboardInterrupt:
            log.info("Interrupted — shutting down")
            break
        except Exception as e:
            log.error(f"Training cycle failed: {e}", exc_info=True)
            if run_id is not None:
                try:
                    fail_run(run_id, str(e))
                except Exception:
                    pass

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
