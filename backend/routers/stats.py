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
    all_trainings = [e for e in events if e["type"] == "Training"]
    now = datetime.now()
    cur_year = f"{now.year:04d}"
    cur_month_prefix = f"{now.year:04d}-{now.month:02d}"
    today_iso = now.strftime("%Y-%m-%d")
    # Season view (current-year) trainings — powers the year-based
    # trainings_total / trainings_rate columns on the Statistik tab.
    trainings = [e for e in all_trainings if e.get("date", "")[:4] == cur_year]
    game_ids = {e["id"] for e in games}
    training_ids = {e["id"] for e in trainings}
    # "Treuester Spieler" & "Bier-Champion" must ignore future events (fairness
    # for players who joined mid-season), but otherwise span the FULL history —
    # ALL past games and ALL past trainings across every year/month, not just
    # the current season. `month_training_ids` stay current-month only for the
    # monthly training champion.
    past_game_ids = {e["id"] for e in games if e.get("date", "") <= today_iso}
    past_training_ids = {e["id"] for e in all_trainings if e.get("date", "") <= today_iso}
    # Every past event (games + trainings) — used for the all-time Bier-Champion.
    past_event_ids = past_game_ids | past_training_ids
    month_training_ids = {
        eid
        for eid in past_training_ids
        if next((e.get("date", "") for e in all_trainings if e["id"] == eid), "").startswith(cur_month_prefix)
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
        # Bier-Champion counts every beer brought to any PAST event (games +
        # trainings) across all months/years — not just the current season.
        beer_count = sum(1 for eid in past_event_ids if (p["id"], eid) in beers)
        total = len(game_ids) + len(training_ids)
        overall_yes = g_yes + t_yes
        rate = round(100 * overall_yes / total) if total else 0
        # Past-only "loyalty" rate — powers the "Treuester Spieler" tile on
        # the Termine home screen and any future-fair rankings. Excludes
        # future events entirely, and ALSO excludes past events where the
        # player never responded at all (status stays None). Only explicit
        # zugesagt / abgesagt answers factor into the denominator, so a
        # player who joined mid-season isn't punished for events they
        # simply never saw, and a player who forgot to respond isn't
        # counted as absent by default.
        past_g_yes = sum(1 for gid in past_game_ids if conf.get((p["id"], gid)) == "zugesagt")
        past_t_yes = sum(1 for tid in past_training_ids if conf.get((p["id"], tid)) == "zugesagt")
        past_g_no = sum(1 for gid in past_game_ids if conf.get((p["id"], gid)) == "abgesagt")
        past_t_no = sum(1 for tid in past_training_ids if conf.get((p["id"], tid)) == "abgesagt")
        past_confirmed = past_g_yes + past_t_yes
        past_declined = past_g_no + past_t_no
        past_total = past_confirmed + past_declined  # only explicit responses count
        past_rate = round(100 * past_confirmed / past_total) if past_total else 0
        # Current-month training rate (past sessions only).
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
            "past_confirmed": past_confirmed,
            "past_declined": past_declined,
            "past_total": past_total,
            "past_rate": past_rate,
            "driving_count": drive_count,
            "beer_count": beer_count,
            "month_training_confirmed": month_t_yes,
            "month_training_total": month_t_total,
            "month_training_rate": month_t_rate,
        })
    result.sort(key=lambda r: r["past_rate"], reverse=True)
    return {
        "players": result,
        "games_count": len(games),
        "trainings_count": len(trainings),
        "past_games_count": len(past_game_ids),
        "past_trainings_count": len(past_training_ids),
        "month_training_count": len(month_training_ids),
    }
