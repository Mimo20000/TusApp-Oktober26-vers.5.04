import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from db import db
from models import BeerBody, DrivingBody, RSVP
from push import notify_new_message

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
    upd = {"status": rsvp.status, "updated_at": datetime.now(timezone.utc).isoformat()}
    # Only persist the reason for absagen; clear it when the player later switches to zugesagt.
    if rsvp.status == "abgesagt":
        upd["reason"] = reason
    else:
        upd["reason"] = None
    await db.attendance.update_one(
        {"event_id": rsvp.event_id, "player_id": rsvp.player_id},
        {"$set": upd},
        upsert=True,
    )
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
