"""Runtime config, loaded from vision/.env (see config.example.txt)."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# vision/ root, so relative data paths resolve regardless of CWD.
ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    embed_model: str = "facebook/dinov2-base"
    device: str = "auto"  # "auto" | "cuda" | "cpu"
    top_k: int = 5
    score_agg: str = "max"  # "max" | "mean"

    use_detector: bool = False
    detector_model: str = "yolo11n.pt"

    reference_dir: str = "data/reference"
    index_path: str = "data/index/index.npz"

    allowed_origins: str = "http://localhost:3000"
    vision_token: str = ""

    @property
    def reference_path(self) -> Path:
        return (ROOT / self.reference_dir).resolve()

    @property
    def index_file(self) -> Path:
        return (ROOT / self.index_path).resolve()

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
