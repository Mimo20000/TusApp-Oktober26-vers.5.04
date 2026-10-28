"""Automatic RSVP reminder emails.

For every upcoming Spiel/Training/Treffen in the next 48 hours, we email every
player who has not yet answered (rsvp is neither zugesagt nor abgesagt) and has
a valid email address. Reminders are sent every 3 hours (48h/45h/…/3h before
the event) — never more often thanks to an atomic upsert marker per 3-hour
slot per player+event. Once a player answers, they stop receiving reminders.
"""
import logging
import re
from datetime import datetime, timedelta, timezone

from db import db
from email_service import send_rsvp_reminder

logger = logging.getLogger(__name__)

# Send from 48h down to 3h before the event, one per 3-hour window.
MAX_HOURS_AHEAD = 48
STEP_HOURS = 3


def _to_dt(date_s: str, time_s: str) -> datetime | None:
    """Return an aware UTC datetime for an event stored as (YYYY-MM-DD, HH:MM).

    Events are recorded in local (Europe/Berlin) time; we assume the same
    server timezone for comparison. Using naive→aware conversion at UTC is
    good enough here because both sides use the same reference frame.
    """
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_s or ""):
        return None
    if not re.match(r"^\d{2}:\d{2}$", time_s or ""):
        return None
    try:
        return datetime.fromisoformat(f"{date_s}T{time_s}:00").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


async def check_and_send_rsvp_reminders() -> int:
    """Idempotent scan; safe to call as often as callers wish.

    Returns the number of reminder emails actually queued in this run.
    """
    # Debounce: at most one full scan per 5 minutes across all callers.
    slot_key = "reminder_scan:" + datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")[:15] + "0"
    lock = await db.system_events.update_one(
        {"key": slot_key},
        {"$setOnInsert": {"key": slot_key, "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    if lock.upserted_id is None:
        return 0  # another poll already ran the scan in this 5-minute window

    now = datetime.now(timezone.utc)
    horizon = now + timedelta(hours=MAX_HOURS_AHEAD)

    events = await db.events.find(
        {
            "$or": [{"cancelled": {"$exists": False}}, {"cancelled": False}],
            "date": {"$gte": now.strftime("%Y-%m-%d"), "$lte": horizon.strftime("%Y-%m-%d")},
        },
        {"_id": 0},
    ).to_list(500)

    sent = 0
    for ev in events:
        dt = _to_dt(ev.get("date"), ev.get("time"))
        if not dt:
            continue
        hours_left = (dt - now).total_seconds() / 3600
        if hours_left <= 0 or hours_left > MAX_HOURS_AHEAD:
            continue
        slot = int(hours_left // STEP_HOURS)  # 0..15 (0 = final 3h window)

        # Players with an email address, still Aktiv, who haven't responded.
        players = await db.players.find(
            {
                "email": {"$nin": [None, ""], "$exists": True},
                "status": {"$ne": "Inaktiv"},
            },
            {"_id": 0, "id": 1, "name": 1, "email": 1},
        ).to_list(500)
        if not players:
            continue
        pids = [p["id"] for p in players]
        answered = await db.attendance.find(
            {"event_id": ev["id"], "player_id": {"$in": pids}, "status": {"$in": ["zugesagt", "abgesagt"]}},
            {"_id": 0, "player_id": 1},
        ).to_list(500)
        answered_ids = {a["player_id"] for a in answered}

        for p in players:
            if p["id"] in answered_ids:
                continue
            email = (p.get("email") or "").strip()
            if "@" not in email:
                continue
            marker = f"rsvp_reminder:{ev['id']}:{p['id']}:slot{slot}"
            res = await db.system_events.update_one(
                {"key": marker},
                {"$setOnInsert": {
                    "key": marker,
                    "event_id": ev["id"],
                    "player_id": p["id"],
                    "slot": slot,
                    "created_at": now.isoformat(),
                }},
                upsert=True,
            )
            if res.upserted_id is None:
                continue  # already sent this window
            try:
                send_rsvp_reminder(
                    email=email,
                    name=p.get("name") or "",
                    event=ev,
                    hours_left=round(hours_left),
                )
                sent += 1
            except Exception as e:  # pragma: no cover — network failures logged only
                logger.warning("RSVP reminder failed for %s / %s: %s", p["id"], ev["id"], e)
    if sent:
        logger.info("Sent %d RSVP reminder email(s)", sent)
    return sent
