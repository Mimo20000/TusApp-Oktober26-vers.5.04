from datetime import datetime

from fastapi import APIRouter

from auth import CurrentPlayer
from db import db

router = APIRouter()


@router.get("/stats")
async def get_stats(_current: CurrentPlayer, scope: str = "all"):
    players = await db.players.find({}, {"_id": 0}).to_list(500)
    events = await db.events.find({}, {"_id": 0}).to_list(500)
    att = await db.attendance.find({}, {"_id": 0}).to_list(5000)

    now = datetime.now()
    cur_year = f"{now.year:04d}"
    cur_month_prefix = f"{now.year:04d}-{now.month:02d}"
    today_iso = now.strftime("%Y-%m-%d")

    def is_past(e):
        return e.get("date", "") <= today_iso

    games = [e for e in events if e["type"] == "Spiel"]
    all_trainings = [e for e in events if e["type"] == "Training"]

    # ── Golden rule: only PAST events ever count towards the statistics.
    #    A Zusage/Absage for an event in the future is ignored until that
    #    event's date has actually passed. ──────────────────────────────────
    past_games = [e for e in games if is_past(e)]
    past_trainings = [e for e in all_trainings if is_past(e)]

    # Scope toggle: "season" narrows to the current calendar year, "all" spans
    # the entire past history. Everything below is computed within the scope.
    if scope == "season":
        scoped_games = [e for e in past_games if e.get("date", "")[:4] == cur_year]
        scoped_trainings = [e for e in past_trainings if e.get("date", "")[:4] == cur_year]
    else:
        scoped_games = past_games
        scoped_trainings = past_trainings

    game_ids = {e["id"] for e in scoped_games}
    training_ids = {e["id"] for e in scoped_trainings}
    event_ids = game_ids | training_ids  # every past event in scope
    # Current-month past trainings — independent of scope (monthly champion).
    month_training_ids = {
        e["id"] for e in past_trainings if e.get("date", "").startswith(cur_month_prefix)
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

    # Current attendance streak is always all-time (most recent past events
    # first), independent of the selected scope. Only explicit answers count:
    # a "zugesagt" extends the streak, an "abgesagt" ends it, and events the
    # player never answered are skipped over.
    past_all_sorted = sorted(
        past_games + past_trainings, key=lambda e: e.get("date", ""), reverse=True
    )

    def streak_of(pid: str) -> int:
        s = 0
        for e in past_all_sorted:
            st = conf.get((pid, e["id"]))
            if st is None:
                continue
            if st == "zugesagt":
                s += 1
            else:
                break
        return s

    result = []
    for p in players:
        pid = p["id"]
        g_yes = sum(1 for gid in game_ids if conf.get((pid, gid)) == "zugesagt")
        t_yes = sum(1 for tid in training_ids if conf.get((pid, tid)) == "zugesagt")
        drive_count = sum(1 for gid in game_ids if (pid, gid) in drive)
        # Bier-Champion counts every beer brought to any PAST event in scope.
        beer_count = sum(1 for eid in event_ids if (pid, eid) in beers)
        g_total = len(game_ids)
        t_total = len(training_ids)
        total = g_total + t_total
        overall_yes = g_yes + t_yes
        rate = round(100 * overall_yes / total) if total else 0
        # "Treuester Spieler" loyalty — explicit answers only: a forgotten
        # (unanswered) past event is neither a plus nor a minus.
        g_no = sum(1 for gid in game_ids if conf.get((pid, gid)) == "abgesagt")
        t_no = sum(1 for tid in training_ids if conf.get((pid, tid)) == "abgesagt")
        past_confirmed = overall_yes
        past_declined = g_no + t_no
        past_total = past_confirmed + past_declined
        past_rate = round(100 * past_confirmed / past_total) if past_total else 0
        # Current-month training rate (past sessions only).
        month_t_yes = sum(1 for tid in month_training_ids if conf.get((pid, tid)) == "zugesagt")
        month_t_total = len(month_training_ids)
        month_t_rate = round(100 * month_t_yes / month_t_total) if month_t_total else 0
        result.append({
            "id": pid,
            "name": p["name"],
            "position": p.get("position"),
            "games_total": g_total,
            "games_confirmed": g_yes,
            "games_rate": round(100 * g_yes / g_total) if g_total else 0,
            "trainings_total": t_total,
            "trainings_confirmed": t_yes,
            "trainings_rate": round(100 * t_yes / t_total) if t_total else 0,
            "overall_confirmed": overall_yes,
            "overall_total": total,
            "overall_rate": rate,
            "past_confirmed": past_confirmed,
            "past_declined": past_declined,
            "past_total": past_total,
            "past_rate": past_rate,
            "driving_count": drive_count,
            "beer_count": beer_count,
            "streak": streak_of(pid),
            "month_training_confirmed": month_t_yes,
            "month_training_total": month_t_total,
            "month_training_rate": month_t_rate,
        })
    result.sort(key=lambda r: r["past_rate"], reverse=True)
    return {
        "players": result,
        "scope": scope,
        "games_count": len(game_ids),
        "trainings_count": len(training_ids),
        "past_games_count": len(game_ids),
        "past_trainings_count": len(training_ids),
        "month_training_count": len(month_training_ids),
    }
