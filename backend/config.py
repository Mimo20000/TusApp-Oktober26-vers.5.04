import os
from pathlib import Path
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import load_dotenv
from passlib.context import CryptContext

# CryptContext Konfiguration
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__ident="2b"  # Verhindert den internen Legacy-Test von passlib
)
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
# JWT signing secret MUST come from the environment. No insecure fallback:
# a predictable default ("change-me") makes every token forgeable. Fail fast
# on startup if it is missing or too short for HS256 (< 32 bytes).
JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET or len(JWT_SECRET.encode("utf-8")) < 32:
    raise RuntimeError(
        "JWT_SECRET must be set to a strong value (>= 32 bytes). "
        "Refusing to start with a missing or insecure signing secret."
    )
JWT_ALG = os.environ.get("JWT_ALGORITHM", "HS256")

CLUB = "TuS Oberhausen II"
HANDBALL_TEAM_ID = "handball4all.baden-wuerttemberg.1499726"

# Official BWHV / handball4all identifiers (www.bwhv.org results portal).
# ogId = Organisationsgruppe (216 = BWHV), club = TuS Oberhausen (773),
# default class = Männer, 2. Bezirksklasse, Gruppe Süd (TuS Oberhausen 2).
BWHV_ORG_GROUP = os.environ.get("BWHV_ORG_GROUP", "216")
BWHV_CLUB_ID = os.environ.get("BWHV_CLUB_ID", "773")
BWHV_DEFAULT_CLASS = os.environ.get("BWHV_DEFAULT_CLASS", "166871")


def create_token(pid: str) -> str:
    return jwt.encode(
        {"sub": pid, "exp": datetime.now(timezone.utc) + timedelta(days=30)},
        JWT_SECRET,
        algorithm=JWT_ALG,
    )
