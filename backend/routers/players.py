import random
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, BackgroundTasks, HTTPException

from config import create_token, pwd_context
from db import db
from email_service import send_reset_code
from models import (
    ContactUpdate,
    PasswordBody,
    Player,
    PlayerCreate,
    PlayerUpdate,
    ResetPasswordBody,
    StatusUpdate,
)
from seed import slug

router = APIRouter()


def _mask_email(e: str) -> str:
    try:
        name, dom = e.split("@", 1)
        head = name[0] if name else "*"
        return f"{head}***@{dom}"
    except Exception:
        return e


@router.get("/players", response_model=List[Player])
async def get_players():
    docs = await db.players.find({}, {"_id": 0}).to_list(500)
    for d in docs:
        d["has_password"] = bool(d.get("password_hash"))
        d.pop("password_hash", None)
    docs.sort(key=lambda p: p["name"])
    return docs


@router.post("/players", response_model=Player)
async def create_player(body: PlayerCreate):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name erforderlich")
    base = slug(name) or "spieler"
    pid = base
    n = 1
    while await db.players.find_one({"id": pid}):
        n += 1
        pid = f"{base}-{n}"
    doc = Player(id=pid, name=name, position=(body.position or None), status=body.status or "Aktiv").dict()
    await db.players.insert_one(doc)
    doc["has_password"] = False
    return doc


@router.patch("/players/{player_id}")
async def update_player(player_id: str, body: PlayerUpdate):
    upd = {}
    if body.name is not None and body.name.strip():
        upd["name"] = body.name.strip()
    if body.position is not None:
        upd["position"] = body.position.strip() or None
    if not upd:
        raise HTTPException(status_code=400, detail="Keine Daten")
    res = await db.players.update_one({"id": player_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    return {"ok": True, "id": player_id, **upd}


@router.delete("/players/{player_id}")
async def delete_player(player_id: str):
    res = await db.players.delete_one({"id": player_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    await db.attendance.delete_many({"player_id": player_id})
    return {"ok": True}


@router.patch("/players/{player_id}/contact")
async def update_player_contact(player_id: str, body: ContactUpdate):
    upd = {}
    if body.email is not None:
        upd["email"] = body.email.strip() or None
    if body.birthdate is not None:
        upd["birthdate"] = body.birthdate.strip() or None
    if body.jersey_number is not None:
        upd["jersey_number"] = body.jersey_number if body.jersey_number > 0 else None
    if body.avatar_file_id is not None:
        upd["avatar_file_id"] = body.avatar_file_id or None
    if body.spieler_id is not None:
        upd["spieler_id"] = body.spieler_id.strip() or None
    if not upd:
        raise HTTPException(status_code=400, detail="Keine Daten")
    res = await db.players.update_one({"id": player_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    return {"ok": True, "id": player_id, **upd}


@router.patch("/players/{player_id}/status")
async def update_player_status(player_id: str, body: StatusUpdate):
    if body.status not in ("Aktiv", "Verletzt", "Inaktiv"):
        raise HTTPException(status_code=400, detail="Ungültiger Status")
    res = await db.players.update_one({"id": player_id}, {"$set": {"status": body.status}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    return {"ok": True, "id": player_id, "status": body.status}


@router.post("/players/{player_id}/set-password")
async def set_password(player_id: str, body: PasswordBody):
    p = await db.players.find_one({"id": player_id})
    if not p:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    if p.get("password_hash"):
        raise HTTPException(status_code=400, detail="Passwort bereits gesetzt")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Passwort muss mind. 4 Zeichen haben")
    await db.players.update_one(
        {"id": player_id}, {"$set": {"password_hash": pwd_context.hash(body.password)}}
    )
    return {"access_token": create_token(player_id), "player_id": player_id}


@router.post("/players/{player_id}/login")
async def login(player_id: str, body: PasswordBody):
    p = await db.players.find_one({"id": player_id})
    if not p or not p.get("password_hash"):
        raise HTTPException(status_code=404, detail="Kein Passwort gesetzt")
    if not pwd_context.verify(body.password, p["password_hash"]):
        raise HTTPException(status_code=401, detail="Falsches Passwort")
    return {"access_token": create_token(player_id), "player_id": player_id}


@router.post("/players/{player_id}/forgot-password")
async def forgot_password(player_id: str, background_tasks: BackgroundTasks):
    p = await db.players.find_one({"id": player_id})
    if not p:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    email = (p.get("email") or "").strip()
    if not email:
        raise HTTPException(
            status_code=400,
            detail="Für dich ist keine E-Mail hinterlegt. Bitte kontaktiere den Coach.",
        )
    code = f"{random.randint(0, 999999):06d}"
    expires = datetime.now(timezone.utc) + timedelta(minutes=15)
    await db.reset_codes.update_one(
        {"player_id": player_id},
        {"$set": {"code_hash": pwd_context.hash(code), "expires_at": expires.isoformat(), "attempts": 0}},
        upsert=True,
    )
    background_tasks.add_task(send_reset_code, email, code, p.get("name") or "")
    return {"ok": True, "email_hint": _mask_email(email)}


@router.post("/players/{player_id}/reset-password")
async def reset_password(player_id: str, body: ResetPasswordBody):
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Passwort muss mind. 4 Zeichen haben")
    rec = await db.reset_codes.find_one({"player_id": player_id})
    if not rec:
        raise HTTPException(status_code=400, detail="Kein Code angefordert. Bitte neuen Code anfordern.")
    try:
        exp = datetime.fromisoformat(rec["expires_at"])
    except Exception:
        exp = None
    if not exp or datetime.now(timezone.utc) > exp:
        await db.reset_codes.delete_one({"player_id": player_id})
        raise HTTPException(status_code=400, detail="Code abgelaufen. Bitte neuen Code anfordern.")
    if rec.get("attempts", 0) >= 5:
        await db.reset_codes.delete_one({"player_id": player_id})
        raise HTTPException(status_code=429, detail="Zu viele Versuche. Bitte neuen Code anfordern.")
    if not pwd_context.verify(body.code.strip(), rec["code_hash"]):
        await db.reset_codes.update_one({"player_id": player_id}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=401, detail="Falscher Code.")
    await db.players.update_one(
        {"id": player_id}, {"$set": {"password_hash": pwd_context.hash(body.password)}}
    )
    await db.reset_codes.delete_one({"player_id": player_id})
    return {"access_token": create_token(player_id), "player_id": player_id}
