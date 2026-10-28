import logging
import re
from datetime import datetime, timedelta

from config import CLUB
from db import db
from models import Event, Player

logger = logging.getLogger(__name__)


def slug(name: str) -> str:
    s = name.lower()
    s = s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


PLAYERS_SEED = [
    ("Fabian GALAU", "TW", "Verletzt", "mimo2@gmx.net"),
    ("Lukas SCHWARZ", "TW", "Aktiv", None),
    ("Dennis KL", "RL", "Aktiv", None),
    ("Filip LA", "LA", "Aktiv", None),
    ("Tim WILD", "RA", "Inaktiv", None),
    ("Ralf STEHLIN", "RM", "Verletzt", None),
    ("Michael MOSER", "Coach", "Aktiv", None),
    ("Juliann BÄUERLE", "RM", "Aktiv", None),
    ("Michel JÖRNS", "KL", "Aktiv", None),
    ("Phips MAURER", "LA", "Aktiv", None),
    ("Florian NN", "RM", "Aktiv", None),
    ("Josh ANKERMANN", "RA", "Aktiv", None),
    ("Stefan MOSER", "RM", "Aktiv", None),
    ("Thorsten KIRSCHLING", "RR", "Aktiv", None),
    ("Korinn SCHULER", "RL", "Inaktiv", None),
    ("Sascha GRINS", "KL", "Aktiv", None),
    ("Peter HAHNER", "RA", "Verletzt", None),
    ("Christoph MOSER", "RL", "Aktiv", None),
]

# (id, home, away, location, date, time)
GAMES_SEED = [
    ("T1", "TuS Oberhausen II", "HG Müllheim/Neuenburg III", "Rheinhausen/Rheinmatthalle", "2026-10-11", "14:30"),
    ("T2", "SG Kenzingen/Herbolzheim III", "TuS Oberhausen II", "Herbolzheim/Breisgauhalle", "2026-10-24", "14:30"),
    ("T3", "TSV March II", "TuS Oberhausen II", "March-Buchheim/Sporthalle", "2026-11-07", "14:30"),
    ("T4", "TuS Oberhausen II", "SG Maulburg/Steinen II", "Rheinhausen/Rheinmatthalle", "2026-11-21", "14:30"),
    ("T5", "SG Freiburg IV", "TuS Oberhausen II", "Freiburg/Wentzingerhalle", "2026-11-28", "13:00"),
    ("T6", "TuS Oberhausen II", "SG Waldkirch/Denzlingen III", "Rheinhausen/Rheinmatthalle", "2026-12-05", "14:30"),
    ("T7", "HG Müllheim/Neuenburg III", "TuS Oberhausen II", "Neuenburg/Sporthalle Zähringer-Schule", "2027-02-28", "13:00"),
    ("T8", "TuS Oberhausen II", "SG Kenzingen/Herbolzheim III", "Rheinhausen/Rheinmatthalle", "2027-03-07", "14:30"),
    ("T9", "SG Waldkirch/Denzlingen III", "TuS Oberhausen II", "Waldkirch/Kastelberghalle", "2027-03-14", "13:00"),
    ("T10", "TuS Oberhausen II", "TSV March II", "Rheinhausen/Rheinmatthalle", "2027-03-21", "14:30"),
    ("T11", "TuS Oberhausen II", "SG Freiburg IV", "Rheinhausen/Rheinmatthalle", "2027-04-11", "14:30"),
    ("T12", "SG Maulburg/Steinen II", "TuS Oberhausen II", "Steinen/Sporthalle", "2027-04-24", "18:00"),
]


def build_events():
    events = []
    for gid, home, away, loc, date, time in GAMES_SEED:
        opp = away if home == CLUB else home
        events.append(Event(
            id=gid, type="Spiel", date=date, time=time, home=home, away=away,
            opponent=opp, location=loc,
            title=f"{home} vs. {away}",
        ))
    # Trainings: every Thursday 19:00 starting today, running for years
    now = datetime.now()
    d = datetime(now.year, now.month, now.day)
    while d.weekday() != 3:  # 3 = Thursday
        d += timedelta(days=1)
    end = datetime(2031, 12, 31)
    i = 0
    while d <= end:
        events.append(Event(
            id=f"TR{i+1}", type="Training", date=d.strftime("%Y-%m-%d"), time="19:00",
            home=None, away=None, opponent=None, location="Rheinhausen/Rheinmatthalle",
            title="Training",
        ))
        i += 1
        d += timedelta(weeks=1)
    return events


async def seed_if_empty():
    if await db.players.count_documents({}) == 0:
        docs = []
        for name, pos, status, email in PLAYERS_SEED:
            docs.append(Player(id=slug(name), name=name, position=pos, status=status, email=email).dict())
        await db.players.insert_many(docs)
        logger.info("Seeded %d players", len(docs))
    if await db.events.count_documents({}) == 0:
        docs = [e.dict() for e in build_events()]
        await db.events.insert_many(docs)
        logger.info("Seeded %d events", len(docs))
