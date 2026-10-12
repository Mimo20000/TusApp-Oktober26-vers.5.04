"""Official league data for TuS Oberhausen from the BWHV / handball4all source.

The BWHV results portal (www.bwhv.org) is a client-rendered AngularJS SPA that
loads its data from the public handball4all JSON service
(``https://spo.handball4all.de/service/if_g_json.php``).

We use two commands:
- ``cmd=pcu`` (public club): all classes/teams a club plays in  -> team switcher.
- ``cmd=ps``  (public schedule): standings + schedule for one class. With
  ``ca=1`` (all games) and ``ct=<teamId>`` it returns the full season schedule
  of a single team.
"""
import httpx
from fastapi import APIRouter, HTTPException

from config import BWHV_ORG_GROUP, BWHV_CLUB_ID, BWHV_DEFAULT_CLASS

router = APIRouter(prefix="/bwhv")

H4A_URL = "https://spo.handball4all.de/service/if_g_json.php"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TuSApp/1.0)",
    "Referer": "https://www.bwhv.org/",
    "Accept": "application/json",
}


async def _fetch(params: dict) -> dict:
    """Call the handball4all JSON service. The load balancer occasionally
    answers ``permission denied`` on a single node, so retry a few times."""
    last = None
    try:
        async with httpx.AsyncClient(timeout=15.0, headers=_HEADERS) as c:
            for _ in range(4):
                r = await c.get(H4A_URL, params=params)
                r.raise_for_status()
                data = r.json()
                doc = data[0] if isinstance(data, list) else data
                if isinstance(doc, dict) and doc.get("status") != -1:
                    return doc
                last = doc
    except Exception:
        raise HTTPException(status_code=502, detail="handball4all nicht erreichbar")
    raise HTTPException(status_code=502, detail=(last or {}).get("statusText") or "handball4all: keine Daten")


def _clean(v) -> str:
    return (str(v).strip() if v is not None else "").strip()


def _to_int(v):
    s = _clean(v)
    return int(s) if s.lstrip("-").isdigit() else None


def _is_own(name) -> bool:
    return "oberhausen" in _clean(name).lower()


def _games_from(node) -> list:
    out: list = []
    if isinstance(node, dict):
        g = node.get("games")
        if isinstance(g, list):
            out += g
    elif isinstance(node, list):
        for it in node:
            if isinstance(it, dict) and isinstance(it.get("games"), list):
                out += it["games"]
    return out


def _iso(gdate: str):
    try:
        dd, mm, yy = _clean(gdate).split(".")
        return f"20{yy}-{mm.zfill(2)}-{dd.zfill(2)}"
    except Exception:
        return None


_LABEL_MAP = [
    ("gemischte F-Jugend", "gem. Jugend F"),
    ("gemischte Jugend", "gem. Jugend"),
    ("männliche Jugend", "m. Jugend"),
    ("weibliche Jugend", "w. Jugend"),
    ("Minihandballspieltage", "Minis"),
    ("Männer", "Herren"),
    ("Frauen", "Frauen"),
]


def _label(lname: str, sname: str) -> str:
    head = _clean(lname).split(",")[0].strip() or _clean(sname)
    for a, b in _LABEL_MAP:
        if head.startswith(a):
            head = b + head[len(a):]
            break
    up = _clean(sname).upper()
    if head.startswith("Herren"):
        if "BOL" in up:
            head += " · BOL"
        elif "2BK" in up:
            head += " · 2. BK"
        elif "BK" in up:
            head += " · BK"
    return head.strip()


def _order_key(sname: str) -> int:
    prefix = _clean(sname).split("-")[0].upper()
    return {"M": 0, "F": 1}.get(prefix, 2)


@router.get("/teams")
async def bwhv_teams():
    doc = await _fetch({"cmd": "pcu", "og": BWHV_ORG_GROUP, "c": BWHV_CLUB_ID})
    classes = (doc.get("content") or {}).get("classes") or []
    teams = []
    for cl in classes:
        sname = _clean(cl.get("gClassSname"))
        lname = _clean(cl.get("gClassLname"))
        team_name = None
        for g in cl.get("games", []) or []:
            for t in (g.get("gHomeTeam"), g.get("gGuestTeam")):
                if _is_own(t):
                    team_name = _clean(t)
        cid = _clean(cl.get("gClassID"))
        teams.append({
            "class_id": cid,
            "name": lname,
            "short": sname,
            "label": _label(lname, sname),
            "gender": _clean(cl.get("gClassGender")),
            "team_name": team_name,
            "is_default": cid == _clean(BWHV_DEFAULT_CLASS),
        })
    teams.sort(key=lambda t: (_order_key(t["short"]), t["label"]))
    if teams and not any(t["is_default"] for t in teams):
        teams[0]["is_default"] = True
    club = _clean((doc.get("head") or {}).get("name")) or "TuS Oberhausen"
    return {"club": club, "teams": teams}


@router.get("/class/{class_id}")
async def bwhv_class(class_id: str):
    base = {"cmd": "ps", "og": BWHV_ORG_GROUP, "cl": class_id}
    doc = await _fetch(base)
    content = doc.get("content") or {}
    head = doc.get("head") or {}

    table = []
    own_team_id = None
    own_name = None
    last_rank = 0
    for s in content.get("score") or []:
        name = _clean(s.get("tabTeamname"))
        own = _is_own(name)
        if own:
            own_team_id = _clean(s.get("tabTeamID"))
            own_name = name
        rank = _to_int(s.get("tabScore"))
        if rank is None:
            rank = last_rank or (len(table) + 1)
        else:
            last_rank = rank
        gs = _to_int(s.get("numGoalsShot")) or 0
        ga = _to_int(s.get("numGoalsGot")) or 0
        pp = _to_int(s.get("pointsPlus"))
        pm = _to_int(s.get("pointsMinus"))
        table.append({
            "rank": rank,
            "team": name,
            "games": _to_int(s.get("numPlayedGames")),
            "won": _to_int(s.get("numWonGames")),
            "draw": _to_int(s.get("numEqualGames")),
            "lost": _to_int(s.get("numLostGames")),
            "goals": gs,
            "goals_against": ga,
            "goal_diff": gs - ga,
            "points": pp,
            "points_str": f"{pp}:{pm}" if pp is not None and pm is not None else None,
            "is_own": own,
        })

    # Full season schedule of the own team (falls back to the class window).
    if own_team_id:
        gdoc = await _fetch({**base, "ca": 1, "ct": own_team_id})
        gc = gdoc.get("content") or {}
    else:
        gc = content
    raw = _games_from(gc.get("actualGames")) + _games_from(gc.get("futureGames"))

    seen = set()
    games = []
    for g in raw:
        gid = _clean(g.get("gID"))
        if gid and gid in seen:
            continue
        # When the class has a TuS team, only keep that team's own games.
        if own_team_id and not (_is_own(g.get("gHomeTeam")) or _is_own(g.get("gGuestTeam"))):
            continue
        seen.add(gid)
        hg = _to_int(g.get("gHomeGoals"))
        ag = _to_int(g.get("gGuestGoals"))
        games.append({
            "id": gid,
            "date": _clean(g.get("gDate")),
            "iso": _iso(g.get("gDate")),
            "weekday": _clean(g.get("gWDay")),
            "time": _clean(g.get("gTime")),
            "home": _clean(g.get("gHomeTeam")),
            "guest": _clean(g.get("gGuestTeam")),
            "home_goals": hg,
            "guest_goals": ag,
            "played": hg is not None and ag is not None,
            "is_home": _is_own(g.get("gHomeTeam")),
            "gym": _clean(g.get("gGymnasiumName")),
            "town": _clean(g.get("gGymnasiumTown")),
        })
    games.sort(key=lambda x: (x["iso"] or "9999-99-99", x["time"] or "99:99"))

    return {
        "class_id": class_id,
        "class_name": _clean(head.get("headline2")) or _clean(head.get("name")),
        "team_name": own_name,
        "table": table,
        "games": games,
    }
