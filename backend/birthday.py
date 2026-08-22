import re
import uuid
from datetime import datetime, timezone

from db import db
from push import notify_new_message


async def check_and_send_birthdays():
    """Posts a team-chat birthday message once per player per year.

    Triggered lazily from frequently-polled endpoints. The insert into
    ``system_events`` is an atomic upsert, so concurrent polls can never
    create duplicate messages.
    """
    now = datetime.now()
    year = now.year
    suffix = now.strftime("-%m-%d")  # birthdate stored as YYYY-MM-DD
    players = await db.players.find(
        {"birthdate": {"$regex": re.escape(suffix) + "$"}}, {"_id": 0}
    ).to_list(500)
    for p in players:
        bd = p.get("birthdate") or ""
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", bd):
            continue
        marker = f"birthday:{p['id']}:{year}"
        now_iso = datetime.now(timezone.utc).isoformat()
        res = await db.system_events.update_one(
            {"key": marker},
            {"$setOnInsert": {"key": marker, "created_at": now_iso}},
            upsert=True,
        )
        if res.upserted_id is None:
            continue  # message already sent this year
        name = (p.get("name") or "").strip()
        first = name.split()[0] if name else "Sportsfreund"
        text = (
            f"Herzlichen Glückwunsch zum Geburtstag {first}! 🎉 "
            f"Denk an die Kiste Bier im nächsten Training 🍺 "
            f"Stoßt gemeinsam an — tippt 🥂!"
        )
        msg = {
            "id": "MSG" + uuid.uuid4().hex[:10],
            "conversation_id": "team",
            "scope": "team",
            "sender_id": "system",
            "sender_name": "TuS Oberhausen 🎉",
            "text": text,
            "created_at": now_iso,
            "poll": {
                "kind": "sekt",
                "target_player_id": p["id"],
                "target_name": name or first,
                "year": year,
                "voters": [],
            },
        }
        await db.messages.insert_one(dict(msg))
        await notify_new_message("team", "team", "system", "TuS Oberhausen 🎉", text)
