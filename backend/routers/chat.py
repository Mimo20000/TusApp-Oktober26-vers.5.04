import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from db import db
from models import MessageBody, PushRegisterBody, ReadBody
from push import direct_conv_id, notify_new_message
from birthday import check_and_send_birthdays
from reminders import check_and_send_rsvp_reminders

router = APIRouter()


@router.get("/messages")
async def get_messages(conversation_id: str, limit: int = 200):
    docs = await db.messages.find({"conversation_id": conversation_id}, {"_id": 0}).to_list(2000)
    docs.sort(key=lambda m: m["created_at"])
    return docs[-limit:]


@router.post("/messages")
async def post_message(body: MessageBody):
    p = await db.players.find_one({"id": body.sender_id})
    if not p:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    if not body.text.strip() and not body.attachment:
        raise HTTPException(status_code=400, detail="Leere Nachricht")
    now = datetime.now(timezone.utc).isoformat()
    msg = {
        "id": "MSG" + uuid.uuid4().hex[:10],
        "conversation_id": body.conversation_id,
        "scope": body.scope,
        "sender_id": body.sender_id,
        "sender_name": p["name"],
        "text": body.text.strip(),
        "attachment": body.attachment,
        "created_at": now,
    }
    await db.messages.insert_one(dict(msg))
    await db.reads.update_one(
        {"player_id": body.sender_id, "conversation_id": body.conversation_id},
        {"$set": {"last_read": now}},
        upsert=True,
    )
    if body.text.strip():
        preview = body.text.strip()
    elif body.attachment and body.attachment.get("kind") == "image":
        preview = "📷 Foto"
    else:
        preview = "📎 Datei"
    await notify_new_message(body.scope, body.conversation_id, body.sender_id, p["name"], preview)
    return msg


@router.post("/messages/read")
async def mark_read(body: ReadBody):
    await db.reads.update_one(
        {"player_id": body.player_id, "conversation_id": body.conversation_id},
        {"$set": {"last_read": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True}


async def _unread_for(player_id: str, conversation_id: str) -> int:
    rd = await db.reads.find_one({"player_id": player_id, "conversation_id": conversation_id})
    last = rd["last_read"] if rd else ""
    return await db.messages.count_documents({
        "conversation_id": conversation_id,
        "sender_id": {"$ne": player_id},
        "created_at": {"$gt": last},
    })


async def _last_msg(conversation_id: str):
    docs = await db.messages.find({"conversation_id": conversation_id}, {"_id": 0}).to_list(2000)
    if not docs:
        return None
    docs.sort(key=lambda m: m["created_at"])
    return docs[-1]


@router.get("/conversations")
async def conversations(player_id: str):
    team = {
        "conversation_id": "team",
        "last": await _last_msg("team"),
        "unread": await _unread_for(player_id, "team"),
    }
    players = await db.players.find({"id": {"$ne": player_id}}, {"_id": 0, "password_hash": 0}).to_list(500)
    directs = []
    for p in players:
        cid = direct_conv_id(player_id, p["id"])
        directs.append({
            "player_id": p["id"],
            "name": p["name"],
            "position": p.get("position"),
            "conversation_id": cid,
            "last": await _last_msg(cid),
            "unread": await _unread_for(player_id, cid),
        })
    directs.sort(key=lambda d: (0 if d["unread"] else 1, d["name"]))
    return {"team": team, "directs": directs}


@router.get("/unread")
async def unread_total(player_id: str):
    await check_and_send_birthdays()
    await check_and_send_rsvp_reminders()
    total = await _unread_for(player_id, "team")
    players = await db.players.find({"id": {"$ne": player_id}}, {"_id": 0, "id": 1}).to_list(500)
    for p in players:
        total += await _unread_for(player_id, direct_conv_id(player_id, p["id"]))
    return {"total": total}


@router.post("/push/register")
async def push_register(body: PushRegisterBody):
    res = await db.players.update_one({"id": body.player_id}, {"$set": {"push_token": body.token}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    return {"ok": True}
