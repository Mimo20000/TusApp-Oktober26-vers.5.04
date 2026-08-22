import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from db import db
from models import BeerBody, DrivingBody, RSVP
from push import direct_conv_id, notify_new_message

router = APIRouter()


def _fmt_date(d: str) -> str:
    parts = (d or "").split("-")
    if len(parts) == 3:
        return f"{parts[2]}.{parts[1]}.{parts[0]}"
    return d


async def _announce_team(player: dict, text: str):
    """Posts an informational team-chat message on behalf of the player."""
    now_iso = datetime.now(timezone.utc).isoformat()
    msg = {
        "id": "MSG" + uuid.uuid4().hex[:10],
        "conversation_id": "team",
        "scope": "team",
        "sender_id": player["id"],
        "sender_name": player["name"],
        "text": text,
        "created_at": now_iso,
    }
    await db.messages.insert_one(dict(msg))
    # sender has "read" their own announcement
    await db.reads.update_one(
        {"player_id": player["id"], "conversation_id": "team"},
        {"$set": {"last_read": now_iso}},
        upsert=True,
    )
    await notify_new_message("team", "team", player["id"], player["name"], text)


async def _dm_coach_absage(player: dict, event: dict, reason: str) -> None:
    """When a player cancels an event, ping every Coach with a direct message.

    Skips when the sender is the Coach themselves (no self-ping). Idempotent
    by (event, player) — replaces the previous auto-ping in the same 1:1
    conversation so the coach's inbox doesn't spam on quick re-edits.
    """
    coaches = await db.players.find(
        {"position": "Coach", "id": {"$ne": player["id"]}}, {"_id": 0}
    ).to_list(50)
    if not coaches:
        return
    kind = event.get("type") or "Termin"
    opp = event.get("opponent")
    title = f"Spiel gegen {opp}" if kind == "Spiel" and opp else kind
    date_de = _fmt_date(event.get("date") or "")
    time_s = event.get("time") or ""
    when = f"{date_de} um {time_s} Uhr" if time_s else date_de
    text = f"❌ {player.get('name')} hat abgesagt: {title} am {when}\nGrund: {reason}"
    for coach in coaches:
        cid = direct_conv_id(player["id"], coach["id"])
        now_iso = datetime.now(timezone.utc).isoformat()
        # Update-or-insert the auto-ping message so repeated absage edits by
        # the same player for the same event don't spam the coach's chat.
        marker_id = f"absage:{event['id']}:{player['id']}:{coach['id']}"
        await db.messages.update_one(
            {"id": marker_id},
            {
                "$set": {
                    "id": marker_id,
                    "conversation_id": cid,
                    "scope": "direct",
                    "sender_id": player["id"],
                    "sender_name": player["name"],
                    "text": text,
                    "created_at": now_iso,
                }
            },
            upsert=True,
        )
        await notify_new_message(
            "direct", cid, player["id"], player.get("name") or "", text
        )


@router.get("/attendance")
async def get_attendance():
    docs = await db.attendance.find({}, {"_id": 0}).to_list(5000)
    return docs


@router.post("/rsvp")
async def set_rsvp(rsvp: RSVP):
    if rsvp.status not in ("zugesagt", "abgesagt"):
        raise HTTPException(status_code=400, detail="Ungültiger Status")
    reason = (rsvp.reason or "").strip()
    if rsvp.status == "abgesagt" and not reason:
        raise HTTPException(status_code=400, detail="Bitte gib einen Grund für die Absage an.")

    prev = await db.attendance.find_one({"event_id": rsvp.event_id, "player_id": rsvp.player_id})

    upd = {"status": rsvp.status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if rsvp.status == "abgesagt":
        upd["reason"] = reason
    else:
        upd["reason"] = None
    await db.attendance.update_one(
        {"event_id": rsvp.event_id, "player_id": rsvp.player_id},
        {"$set": upd},
        upsert=True,
    )

    # Auto-DM the coach whenever a player absagt (fresh or reason changed).
    # Skip when nothing user-visible changed to avoid duplicate pings.
    if rsvp.status == "abgesagt":
        prev_status = (prev or {}).get("status")
        prev_reason = (prev or {}).get("reason") or ""
        if prev_status != "abgesagt" or prev_reason != reason:
            player = await db.players.find_one({"id": rsvp.player_id})
            event = await db.events.find_one({"id": rsvp.event_id})
            if player and event:
                await _dm_coach_absage(player, event, reason)

    return {
        "ok": True,
        "event_id": rsvp.event_id,
        "player_id": rsvp.player_id,
        "status": rsvp.status,
        "reason": upd.get("reason"),
    }


@router.post("/driving")
async def set_driving(body: DrivingBody):
    prev = await db.attendance.find_one({"event_id": body.event_id, "player_id": body.player_id})
    was = bool(prev.get("driving")) if prev else False
    await db.attendance.update_one(
        {"event_id": body.event_id, "player_id": body.player_id},
        {"$set": {"driving": body.driving}},
        upsert=True,
    )
    # Announce to team only when newly turning ON.
    if body.driving and not was:
        player = await db.players.find_one({"id": body.player_id})
        event = await db.events.find_one({"id": body.event_id})
        if player and event:
            first = (player.get("name") or "").split()[0] or player.get("name")
            opp = event.get("opponent")
            gegner = f" gegen {opp}" if opp else ""
            text = f"🚗 {first} fährt zum Spiel{gegner} am {_fmt_date(event.get('date'))}."
            await _announce_team(player, text)
    # Announce when turning OFF (was driving, now not).
    elif was and not body.driving:
        player = await db.players.find_one({"id": body.player_id})
        event = await db.events.find_one({"id": body.event_id})
        if player and event:
            first = (player.get("name") or "").split()[0] or player.get("name")
            opp = event.get("opponent")
            gegner = f" gegen {opp}" if opp else ""
            text = f"🚗❌ {first} fährt doch nicht zum Spiel{gegner} am {_fmt_date(event.get('date'))}."
            await _announce_team(player, text)
    return {"ok": True}


@router.post("/beer")
async def set_beer(body: BeerBody):
    prev = await db.attendance.find_one({"event_id": body.event_id, "player_id": body.player_id})
    was = bool(prev.get("beer")) if prev else False
    await db.attendance.update_one(
        {"event_id": body.event_id, "player_id": body.player_id},
        {"$set": {"beer": body.beer}},
        upsert=True,
    )
    # Announce to team only when newly turning ON.
    if body.beer and not was:
        player = await db.players.find_one({"id": body.player_id})
        event = await db.events.find_one({"id": body.event_id})
        if player and event:
            first = (player.get("name") or "").split()[0] or player.get("name")
            if event.get("type") == "Spiel":
                opp = event.get("opponent")
                gegner = f" gegen {opp}" if opp else ""
                text = f"🍺 {first} bringt Bier zum Spiel{gegner} am {_fmt_date(event.get('date'))}."
            else:
                text = f"🍺 {first} bringt Bier zum Training am {_fmt_date(event.get('date'))}."
            await _announce_team(player, text)
    # Announce when turning OFF (was bringing beer, now not).
    elif was and not body.beer:
        player = await db.players.find_one({"id": body.player_id})
        event = await db.events.find_one({"id": body.event_id})
        if player and event:
            first = (player.get("name") or "").split()[0] or player.get("name")
            if event.get("type") == "Spiel":
                opp = event.get("opponent")
                gegner = f" gegen {opp}" if opp else ""
                text = f"🍺❌ {first} bringt doch kein Bier zum Spiel{gegner} am {_fmt_date(event.get('date'))}."
            else:
                text = f"🍺❌ {first} bringt doch kein Bier zum Training am {_fmt_date(event.get('date'))}."
            await _announce_team(player, text)
    return {"ok": True}
