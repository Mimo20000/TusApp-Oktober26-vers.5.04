import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from auth import CurrentPlayer
from db import db
from models import MessageBody, PushRegisterBody, ReadBody
from push import direct_conv_id, notify_new_message
from birthday import check_and_send_birthdays
from reminders import check_and_send_rsvp_reminders
from chat_retention import cleanup_old_chats_if_due

router = APIRouter()


@router.get("/messages")
async def get_messages(conversation_id: str, _current: CurrentPlayer, limit: int = 200):
    # Enforce the 14-day chat retention lazily on every fetch. Throttled
    # internally to once every 6 hours so we don't hit MongoDB constantly.
    await cleanup_old_chats_if_due()
    docs = await db.messages.find({"conversation_id": conversation_id}, {"_id": 0}).to_list(2000)
    docs.sort(key=lambda m: m["created_at"])
    return docs[-limit:]


@router.post("/messages")
async def post_message(body: MessageBody, current_player_id: CurrentPlayer):
    body.sender_id = current_player_id
    p = await db.players.find_one({"id": current_player_id})
    if not p:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    if not body.text.strip() and not body.attachment:
        raise HTTPException(status_code=400, detail="Leere Nachricht")
    now = datetime.now(timezone.utc).isoformat()
    msg = {
        "id": "MSG" + uuid.uuid4().hex[:10],
        "conversation_id": body.conversation_id,
        "scope": body.scope,
        "sender_id": current_player_id,
        "sender_name": p["name"],
        "text": body.text.strip(),
        "attachment": body.attachment,
        "created_at": now,
    }
    await db.messages.insert_one(dict(msg))
    await db.reads.update_one(
        {"player_id": current_player_id, "conversation_id": body.conversation_id},
        {"$set": {"last_read": now}},
        upsert=True,
    )
    if body.text.strip():
        preview = body.text.strip()
    elif body.attachment and body.attachment.get("kind") == "image":
        preview = "📷 Foto"
    else:
        preview = "📎 Datei"
    await notify_new_message(body.scope, body.conversation_id, current_player_id, p["name"], preview)
    return msg


@router.post("/messages/read")
async def mark_read(body: ReadBody, current_player_id: CurrentPlayer):
    await db.reads.update_one(
        {"player_id": current_player_id, "conversation_id": body.conversation_id},
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
async def conversations(current_player_id: CurrentPlayer):
    player_id = current_player_id
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
async def unread_total(current_player_id: CurrentPlayer):
    await check_and_send_birthdays()
    await check_and_send_rsvp_reminders()
    player_id = current_player_id
    total = await _unread_for(player_id, "team")
    players = await db.players.find({"id": {"$ne": player_id}}, {"_id": 0, "id": 1}).to_list(500)
    for p in players:
        total += await _unread_for(player_id, direct_conv_id(player_id, p["id"]))
    return {"total": total}


@router.post("/push/register")
async def push_register(body: PushRegisterBody, current_player_id: CurrentPlayer):
    res = await db.players.update_one({"id": current_player_id}, {"$set": {"push_token": body.token}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden")
    return {"ok": True}


@router.post("/messages/{msg_id}/vote-sekt")
async def toggle_sekt_vote(msg_id: str, current_player_id: CurrentPlayer):
    """Toggle the current player's 🥂 vote on a birthday poll message.

    Returns the updated poll (voters + count) so the client can render
    the new state without refetching the whole conversation.
    """
    msg = await db.messages.find_one({"id": msg_id}, {"_id": 0})
    if not msg or not msg.get("poll") or msg["poll"].get("kind") != "sekt":
        raise HTTPException(status_code=404, detail="Keine Sekt-Abstimmung.")
    voters: list[str] = list(msg["poll"].get("voters") or [])
    if current_player_id in voters:
        voters.remove(current_player_id)
    else:
        voters.append(current_player_id)
    await db.messages.update_one({"id": msg_id}, {"$set": {"poll.voters": voters}})
    return {"ok": True, "voters": voters, "count": len(voters)}


class TeamPollBody(BaseModel):
    question: str
    options: list[str]


@router.post("/messages/team-poll")
async def create_team_poll(body: TeamPollBody, current_player_id: CurrentPlayer):
    """Post a new custom team poll in the "team" conversation.

    The client only supplies free-text `question` + a small list of option
    labels. We generate stable option IDs on the server so vote toggles
    don't drift when the label is edited elsewhere. Single-choice voting
    is enforced later in `/vote-team`.
    """
    q = (body.question or "").strip()
    opts = [o.strip() for o in (body.options or []) if o and o.strip()]
    if not q:
        raise HTTPException(status_code=400, detail="Frage darf nicht leer sein.")
    if len(opts) < 2:
        raise HTTPException(status_code=400, detail="Mindestens 2 Antwortoptionen nötig.")
    if len(opts) > 6:
        raise HTTPException(status_code=400, detail="Höchstens 6 Antwortoptionen erlaubt.")
    author = await db.players.find_one({"id": current_player_id}, {"_id": 0, "name": 1})
    sender_name = author.get("name") if author else "Team-Umfrage"
    now_iso = datetime.now(timezone.utc).isoformat()
    msg = {
        "id": "MSG" + uuid.uuid4().hex[:10],
        "conversation_id": "team",
        "scope": "team",
        "sender_id": current_player_id,
        "sender_name": sender_name,
        "text": q,
        "created_at": now_iso,
        "poll": {
            "kind": "team",
            "question": q,
            "author_id": current_player_id,
            "options": [
                {"id": "O" + uuid.uuid4().hex[:6], "label": o, "voters": []}
                for o in opts
            ],
        },
    }
    await db.messages.insert_one(dict(msg))
    await notify_new_message("team", "team", current_player_id, sender_name, f"📊 {q}")
    return msg


class TeamVoteBody(BaseModel):
    option_id: str


@router.post("/messages/{msg_id}/vote-team")
async def toggle_team_vote(msg_id: str, body: TeamVoteBody, current_player_id: CurrentPlayer):
    """Single-choice vote on a team poll. Tapping the same option unvotes;
    tapping a different option moves the vote atomically.
    """
    msg = await db.messages.find_one({"id": msg_id}, {"_id": 0})
    if not msg or not msg.get("poll") or msg["poll"].get("kind") != "team":
        raise HTTPException(status_code=404, detail="Keine Team-Umfrage.")
    options = list(msg["poll"].get("options") or [])
    target = next((o for o in options if o["id"] == body.option_id), None)
    if not target:
        raise HTTPException(status_code=400, detail="Antwort nicht gefunden.")
    already_here = current_player_id in (target.get("voters") or [])
    for o in options:
        voters = [v for v in (o.get("voters") or []) if v != current_player_id]
        if o["id"] == body.option_id and not already_here:
            voters.append(current_player_id)
        o["voters"] = voters
    await db.messages.update_one({"id": msg_id}, {"$set": {"poll.options": options}})
    return {"ok": True, "options": options}
