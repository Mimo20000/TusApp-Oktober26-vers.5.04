from datetime import datetime

from fastapi import APIRouter

from auth import CurrentPlayer
from db import db

router = APIRouter()


@router.get("/stats")
async def get_stats(_current: CurrentPlayer):
    players = await db.players.find({}, {"_id": 0}).to_list(500)
    events = await db.events.find({}, {"_id": 0}).to_list(500)
    att = await db.attendance.find({}, {"_id": 0}).to_list(5000)

    games = [e for e in events if e["type"] == "Spiel"]
    now = datetime.now()
    cur_year = f"{now.year:04d}"
    cur_month_prefix = f"{now.year:04d}-{now.month:02d}"
    today_iso = now.strftime("%Y-%m-%d")
    trainings = [e for e in events if e["type"] == "Training" and (e.get("date", "")[:4] == cur_year)]
    game_ids = {e["id"] for e in games}
    training_ids = {e["id"] for e in trainings}
    # "Trainings Champion" ranking must ignore future zusagen — fairness for
    # players who joined mid-season / have not yet had a chance to attend the
    # scheduled but upcoming sessions. We keep only trainings in the current
    # month whose date is on or before today.
    month_training_ids = {
        e["id"]
        for e in trainings
        if e.get("date", "").startswith(cur_month_prefix) and e.get("date", "") <= today_iso
    }

    conf = {}  # (player_id, event_id) -> status
    drive = set()  # (player_id, event_id) with driving
    beers = set()  # (player_id, event_id) with beer
    for a in att:
        st = a.get("status")
        if st is not None:
            conf[(a["player_id"], a["event_id"])] = st
        if a.get("driving"):
            drive.add((a["player_id"], a["event_id"]))
        if a.get("beer"):
            beers.add((a["player_id"], a["event_id"]))

    result = []
    for p in players:
        g_yes = sum(1 for gid in game_ids if conf.get((p["id"], gid)) == "zugesagt")
        t_yes = sum(1 for tid in training_ids if conf.get((p["id"], tid)) == "zugesagt")
        drive_count = sum(1 for gid in game_ids if (p["id"], gid) in drive)
        beer_count = sum(1 for tid in training_ids if (p["id"], tid) in beers)
        total = len(game_ids) + len(training_ids)
        overall_yes = g_yes + t_yes
        rate = round(100 * overall_yes / total) if total else 0
        # Current-month training rate (past sessions only) — powers the
        # "Trainings Champion" tile on the Termine home screen.
        month_t_yes = sum(1 for tid in month_training_ids if conf.get((p["id"], tid)) == "zugesagt")
        month_t_total = len(month_training_ids)
        month_t_rate = round(100 * month_t_yes / month_t_total) if month_t_total else 0
        result.append({
            "id": p["id"],
            "name": p["name"],
            "position": p.get("position"),
            "games_total": len(game_ids),
            "games_confirmed": g_yes,
            "games_rate": round(100 * g_yes / len(game_ids)) if game_ids else 0,
            "trainings_total": len(training_ids),
            "trainings_confirmed": t_yes,
            "trainings_rate": round(100 * t_yes / len(training_ids)) if training_ids else 0,
            "overall_confirmed": overall_yes,
            "overall_total": total,
            "overall_rate": rate,
            "driving_count": drive_count,
            "beer_count": beer_count,
            "month_training_confirmed": month_t_yes,
            "month_training_total": month_t_total,
            "month_training_rate": month_t_rate,
        })
    result.sort(key=lambda r: r["overall_rate"], reverse=True)
    return {
        "players": result,
        "games_count": len(games),
        "trainings_count": len(trainings),
        "month_training_count": len(month_training_ids),
    }
