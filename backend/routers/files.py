import base64
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Response
from PIL import Image

from db import db
from models import FileChunk, FileFinalize, FileInit

router = APIRouter()

MAX_FILE_BYTES = 15 * 1024 * 1024  # 15 MB cap
THUMB_SIZE = 192  # px on the longer side — used for Kader avatars / chat previews


def _make_thumbnail(raw: bytes) -> bytes | None:
    """Return JPEG-encoded thumbnail bytes for the given image, or None on failure."""
    try:
        im = Image.open(io.BytesIO(raw))
        im = im.convert("RGB")
        im.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, format="JPEG", quality=78, optimize=True)
        return out.getvalue()
    except Exception:
        return None


@router.post("/files/init")
async def files_init(body: FileInit):
    upload_id = "UP" + uuid.uuid4().hex[:12]
    await db.uploads.insert_one({
        "upload_id": upload_id,
        "filename": body.filename,
        "mime": body.mime,
        "kind": body.kind,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"upload_id": upload_id}


@router.post("/files/chunk")
async def files_chunk(body: FileChunk):
    up = await db.uploads.find_one({"upload_id": body.upload_id})
    if not up:
        raise HTTPException(status_code=404, detail="Upload nicht gefunden")
    await db.upload_chunks.update_one(
        {"upload_id": body.upload_id, "index": body.index},
        {"$set": {"data": body.data}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/files/finalize")
async def files_finalize(body: FileFinalize):
    up = await db.uploads.find_one({"upload_id": body.upload_id})
    if not up:
        raise HTTPException(status_code=404, detail="Upload nicht gefunden")
    chunks = await db.upload_chunks.find({"upload_id": body.upload_id}).sort("index", 1).to_list(100000)
    b64 = "".join(c["data"] for c in chunks)
    try:
        raw = base64.b64decode(b64)
    except Exception:
        await db.upload_chunks.delete_many({"upload_id": body.upload_id})
        await db.uploads.delete_one({"upload_id": body.upload_id})
        raise HTTPException(status_code=400, detail="Ungültige Datei")
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Leere Datei")
    if len(raw) > MAX_FILE_BYTES:
        await db.upload_chunks.delete_many({"upload_id": body.upload_id})
        await db.uploads.delete_one({"upload_id": body.upload_id})
        raise HTTPException(status_code=413, detail="Datei zu groß (max. 15 MB)")
    file_id = "F" + uuid.uuid4().hex[:14]
    doc = {
        "id": file_id,
        "filename": up["filename"],
        "mime": up["mime"],
        "kind": up["kind"],
        "data_b64": b64,
        "size": len(raw),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    # Eagerly generate the thumbnail for images so the first Kader/chat render is
    # instant. Non-image kinds skip this.
    if up["kind"] == "image":
        thumb = _make_thumbnail(raw)
        if thumb:
            doc["thumb_b64"] = base64.b64encode(thumb).decode("ascii")
            doc["thumb_size"] = len(thumb)
    await db.files.insert_one(doc)
    await db.upload_chunks.delete_many({"upload_id": body.upload_id})
    await db.uploads.delete_one({"upload_id": body.upload_id})
    return {
        "file_id": file_id,
        "mime": up["mime"],
        "filename": up["filename"],
        "kind": up["kind"],
        "size": len(raw),
    }


@router.get("/files/{file_id}/meta")
async def files_meta(file_id: str):
    f = await db.files.find_one({"id": file_id}, {"_id": 0, "data_b64": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    return f


@router.get("/files/{file_id}/raw")
async def files_raw(file_id: str):
    f = await db.files.find_one({"id": file_id}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    raw = base64.b64decode(f["data_b64"])
    headers = {
        "Cache-Control": "public, max-age=31536000",
        "Content-Disposition": f'inline; filename="{f.get("filename", "datei")}"',
    }
    return Response(content=raw, media_type=f.get("mime") or "application/octet-stream", headers=headers)


@router.get("/files/{file_id}/thumbnail")
async def files_thumbnail(file_id: str):
    """Return a small JPEG thumbnail for image files.

    Uses a Mongo-cached copy so we only generate the thumbnail once. Non-image
    files fall back to the raw response so callers can use one URL everywhere.
    """
    f = await db.files.find_one({"id": file_id}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if f.get("kind") != "image":
        raw = base64.b64decode(f["data_b64"])
        return Response(
            content=raw,
            media_type=f.get("mime") or "application/octet-stream",
            headers={"Cache-Control": "public, max-age=31536000"},
        )
    thumb_b64 = f.get("thumb_b64")
    if not thumb_b64:
        # Lazy-generate for images uploaded before the thumbnail cache existed.
        raw = base64.b64decode(f["data_b64"])
        thumb = _make_thumbnail(raw)
        if thumb:
            thumb_b64 = base64.b64encode(thumb).decode("ascii")
            await db.files.update_one(
                {"id": file_id},
                {"$set": {"thumb_b64": thumb_b64, "thumb_size": len(thumb)}},
            )
        else:
            # Give up and serve the original — better than 500.
            return Response(
                content=raw,
                media_type=f.get("mime") or "image/jpeg",
                headers={"Cache-Control": "public, max-age=31536000"},
            )
    return Response(
        content=base64.b64decode(thumb_b64),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
