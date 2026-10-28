import random
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from auth import (
    CoachPlayer,
    CurrentPlayer,
    OptionalPlayer,
    forgot_password_limit,
    login_limit,
    set_password_limit,
)
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


async def _is_coach(pid: str) -> bool:
    p = await db.players.find_one({"id": pid})
    return bool(p and p.get("position") == "Coach")


@router.get("/players", response_model=List[Player])
async def get_players(current_player_id: OptionalPlayer):
    docs = await db.players.find({}, {"_id": 0}).to_list(500)
    for d in docs:
        d["has_password"] = bool(d.get("password_hash"))
        d.pop("password_hash", None)
        if current_player_id is None:
            for k in ("email", "birthdate", "jersey_number", "avatar_file_id", "spieler_id"):
                d.pop(k, None)
    docs.sort(key=lambda p: p["name"])
    return docs


@router.get("/players/me", response_model=Player)
async def get_me(current_player_id: CurrentPlayer):
    p = await db.players.find_one({"id": current_player_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    p["has_password"] = bool(p.get("password_hash"))
    p.pop("password_hash", None)
    return p


@router.get("/players/full", response_model=List[Player])
async def get_players_full(_current: CurrentPlayer):
    docs = await db.players.find({}, {"_id": 0}).to_list(500)
    for d in docs:
        d["has_password"] = bool(d.get("password_hash"))
        d.pop("password_hash", None)
    docs.sort(key=lambda p: p["name"])
    return docs


@router.post("/players", response_model=Player)
async def create_player(body: PlayerCreate, _coach: CoachPlayer):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name erforderlich")
    base = slug(name) or "spieler"
    pid = base
    n = 1
    while await db.players.find_one({"id": pid}):
        n += 1
        pid = f"{base}-{n}"
    
    new_player = {
        "id": pid,
        "name": name,
        "number": body.number,
        "position": body.position,
        "email": body.email,
        "birthdate": body.birthdate,
        "jersey_number": body.jersey_number,
        "avatar_file_id": body.avatar_file_id,
        "spieler_id": body.spieler_id,
        "password_hash": None,
    }
    await db.players.insert_one(new_player)
    new_player.pop("_id", None)
    new_player["has_password"] = False
    return new_player


@router.patch("/players/{player_id}", response_model=Player)
async def update_player(player_id: str, body: PlayerUpdate, current_player_id: CurrentPlayer):
    p = await db.players.find_one({"id": player_id})
    if not p:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    
    is_c = await _is_coach(current_player_id)
    if current_player_id != player_id and not is_c:
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    
    update_data = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if update_data:
        await db.players.update_one({"id": player_id}, {"$set": update_data})
    
    updated = await db.players.find_one({"id": player_id}, {"_id": 0})
    updated["has_password"] = bool(updated.get("password_hash"))
    updated.pop("password_hash", None)
    return updated


@router.delete("/players/{player_id}")
async def delete_player(player_id: str, current_player_id: CurrentPlayer):
    is_c = await _is_coach(current_player_id)
    if not is_c:
        raise HTTPException(status_code=403, detail="Nur Trainer können Spieler löschen")
    res = await db.players.delete_one({"id": player_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    return {"ok": True}


@router.patch("/players/{player_id}/contact", response_model=Player)
async def update_player_contact(player_id: str, body: ContactUpdate, current_player_id: CurrentPlayer):
    p = await db.players.find_one({"id": player_id})
    if not p:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    is_c = await _is_coach(current_player_id)
    if current_player_id != player_id and not is_c:
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    
    await db.players.update_one(
        {"id": player_id},
        {"$set": {"email": body.email, "birthdate": body.birthdate, "spieler_id": body.spieler_id}}
    )
    updated = await db.players.find_one({"id": player_id}, {"_id": 0})
    updated["has_password"] = bool(updated.get("password_hash"))
    updated.pop("password_hash", None)
    return updated


@router.patch("/players/{player_id}/status", response_model=Player)
async def update_player_status(player_id: str, body: StatusUpdate, current_player_id: CurrentPlayer):
    p = await db.players.find_one({"id": player_id})
    if not p:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    is_c = await _is_coach(current_player_id)
    if current_player_id != player_id and not is_c:
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    
    await db.players.update_one({"id": player_id}, {"$set": {"status": body.status}})
    updated = await db.players.find_one({"id": player_id}, {"_id": 0})
    updated["has_password"] = bool(updated.get("password_hash"))
    updated.pop("password_hash", None)
    return updated


@router.post("/players/{player_id}/set-password", dependencies=[Depends(set_password_limit)])
async def set_password(player_id: str, body: PasswordBody):
    p = await db.players.find_one({"id": player_id})
    if not p:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Passwort muss mind. 4 Zeichen haben")
    
    safe_password = body.password[:72]
    
    await db.players.update_one(
        {"id": player_id}, {"$set": {"password_hash": pwd_context.hash(safe_password)}}
    )
    return {"access_token": create_token(player_id), "player_id": player_id}


@router.post("/players/{player_id}/login", dependencies=[Depends(login_limit)])
async def login(player_id: str, body: PasswordBody):
    p = await db.players.find_one({"id": player_id})
    if not p or not p.get("password_hash"):
        raise HTTPException(status_code=401, detail="Anmeldung fehlgeschlagen")
    
    safe_password = body.password[:72]
    
    if not pwd_context.verify(safe_password, p["password_hash"]):
        raise HTTPException(status_code=401, detail="Anmeldung fehlgeschlagen")
    return {"access_token": create_token(player_id), "player_id": player_id}


@router.post("/players/{player_id}/forgot-password", dependencies=[Depends(forgot_password_limit)])
async def forgot_password(player_id: str, background_tasks: BackgroundTasks):
    p = await db.players.find_one({"id": player_id})
    if not p:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    email = p.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Keine E-Mail-Adresse für diesen Spieler hinterlegt.")
    
    code = f"{random.randint(0, 999999):06d}"
    code_hash = pwd_context.hash(code)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
    
    await db.reset_codes.update_one(
        {"player_id": player_id},
        {"$set": {"code_hash": code_hash, "expires_at": expires_at, "attempts": 0}},
        upsert=True,
    )
    background_tasks.add_task(send_reset_code, email, code)
    return {"ok": True, "masked_email": _mask_email(email)}


@router.post("/players/{player_id}/reset-password", dependencies=[Depends(forgot_password_limit)])
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
    
    safe_password = body.password[:72]
    
    await db.players.update_one(
        {"id": player_id}, {"$set": {"password_hash": pwd_context.hash(safe_password)}}
    )
    await db.reset_codes.delete_one({"player_id": player_id})
    return {"access_token": create_token(player_id), "player_id": player_id}