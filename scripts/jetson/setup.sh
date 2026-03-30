#!/usr/bin/env bash
#
# Jetson Orin Nano — One-time setup for the CUDA training worker.
#
# Installs:
#   - PyTorch for JetPack 6 (CUDA 12)
#   - Hugging Face transformers, peft, trl, bitsandbytes
#   - PostgreSQL client for DB access
#   - systemd service for auto-start
#
# Usage:
#   chmod +x scripts/jetson/setup.sh
#   scp -r scripts/jetson/ jetson@jetson-orin.local:~/pipeline/
#   ssh jetson@jetson-orin.local
#   cd ~/pipeline && ./setup.sh
#
set -euo pipefail

echo "=== Jetson Training Worker Setup ==="
echo ""

# ─── System packages ─────────────────────────────────────────

echo "[1/5] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    python3-pip \
    python3-venv \
    postgresql-client \
    git \
    > /dev/null

# ─── Python venv ──────────────────────────────────────────────

VENV_DIR="$HOME/.venvs/trainer"
echo "[2/5] Creating Python venv at $VENV_DIR..."
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

# ─── PyTorch for JetPack 6 ───────────────────────────────────

echo "[3/5] Installing PyTorch for JetPack 6 (CUDA 12)..."
pip install --quiet --upgrade pip setuptools wheel

# Use NVIDIA's JetPack-specific PyTorch wheels
pip install --quiet \
    torch torchvision \
    --index-url https://developer.download.nvidia.com/compute/redist/jp/v60

# ─── Training stack ───────────────────────────────────────────

echo "[4/5] Installing training stack..."
pip install --quiet \
    transformers \
    peft \
    trl \
    bitsandbytes \
    datasets \
    psycopg2-binary \
    accelerate \
    sentencepiece \
    protobuf

# ─── Create directories ──────────────────────────────────────

mkdir -p "$HOME/models/adapters"
mkdir -p "$HOME/models/exports"

# ─── systemd service ─────────────────────────────────────────

echo "[5/5] Installing systemd service..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Write the service file
sudo tee /etc/systemd/system/jetson-trainer.service > /dev/null <<UNIT
[Unit]
Description=Jetson LLM Training Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$HOME/pipeline
ExecStart=$VENV_DIR/bin/python3 $SCRIPT_DIR/trainer.py
Restart=always
RestartSec=30

# Environment — set DATABASE_URL in the override file
EnvironmentFile=-/etc/jetson-trainer.env

# Resource limits
LimitNOFILE=65536
OOMScoreAdjust=-500

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=jetson-trainer

[Install]
WantedBy=multi-user.target
UNIT

# Create env file template (user must fill in DATABASE_URL)
if [ ! -f /etc/jetson-trainer.env ]; then
    sudo tee /etc/jetson-trainer.env > /dev/null <<ENV
# Fill in your Neon Postgres connection string:
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require

# Optional overrides (defaults are fine for Orin Nano 8GB):
# PIPELINE_BASE_MODEL=Qwen/Qwen2.5-Coder-3B
# PIPELINE_MIN_SAMPLES=20
# PIPELINE_POLL_INTERVAL=300
# PIPELINE_RATING_THRESHOLD=2
# PIPELINE_LORA_RANK=16
# PIPELINE_EPOCHS=3
# PIPELINE_MAX_SEQ_LENGTH=2048
# JETSON_DEVICE_ID=jetson-orin-nano

# SCP adapter to Mac after training (optional):
# MAC_SCP_TARGET=user@macbook.local:~/models/adapters/
ENV
    echo ""
    echo "  IMPORTANT: Edit /etc/jetson-trainer.env with your DATABASE_URL"
    echo ""
fi

sudo systemctl daemon-reload

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit /etc/jetson-trainer.env with your DATABASE_URL"
echo "  2. Test manually:  source $VENV_DIR/bin/activate && python3 trainer.py"
echo "  3. Enable service: sudo systemctl enable --now jetson-trainer"
echo "  4. View logs:      journalctl -u jetson-trainer -f"
echo ""
echo "Verify CUDA:"
echo "  source $VENV_DIR/bin/activate && python3 -c 'import torch; print(torch.cuda.get_device_name(0))'"
echo ""
