"""FastAPI service. The browser POSTs a captured frame to /identify (LAN-direct,
same shape as the NAS photo PUT) and gets ranked SKU candidates back.
"""
from __future__ import annotations

import io

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from .config import settings
from .engine import get_engine

app = FastAPI(title="USAV Vision", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _check_token(x_vision_token: str | None) -> None:
    if settings.vision_token and x_vision_token != settings.vision_token:
        raise HTTPException(status_code=401, detail="invalid vision token")


async def _read_image(file: UploadFile) -> Image.Image:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")
    try:
        return Image.open(io.BytesIO(raw))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"unreadable image: {exc}") from exc


@app.on_event("startup")
def _warm() -> None:
    get_engine()  # load model + index up front


@app.get("/health")
def health() -> dict:
    return {"ok": True, **get_engine().status()}


@app.post("/identify")
async def identify(
    file: UploadFile = File(...),
    x_vision_token: str | None = Header(default=None),
) -> dict:
    _check_token(x_vision_token)
    image = await _read_image(file)
    candidates = get_engine().identify(image)
    return {"candidates": candidates}


@app.post("/enroll")
async def enroll(
    sku: str = Form(...),
    files: list[UploadFile] = File(...),
    x_vision_token: str | None = Header(default=None),
) -> dict:
    _check_token(x_vision_token)
    sku = sku.strip()
    if not sku:
        raise HTTPException(status_code=400, detail="sku is required")
    engine = get_engine()
    added = 0
    for f in files:
        image = await _read_image(f)
        added += engine.enroll_image(sku, image)
    return {"sku": sku, "added": added, **engine.status()}


@app.post("/reindex")
def reindex(x_vision_token: str | None = Header(default=None)) -> dict:
    _check_token(x_vision_token)
    added = get_engine().reindex()
    return {"reindexed": added, **get_engine().status()}
