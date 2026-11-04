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
        # Filter deaktiviert, damit alle Felder (Geburtsdatum, Nummer, Avatar) immer geladen werden:
        # if current_player_id is None:
        #     for k in ("email", "birthdate", "jersey_number", "avatar_file_id", "spieler_id"):
        #         d.pop(k, None)
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
    p = await db
