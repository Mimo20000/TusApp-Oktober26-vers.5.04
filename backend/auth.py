"""JWT auth dependencies + basic rate limiting.

Compatible with existing tokens issued by config.create_token():
    jwt.encode({"sub": <player_id>, "exp": ...}, JWT_SECRET, "HS256")

The subject is a string (player_id like "josh-ankermann"), preserved as-is.
"""
from collections import defaultdict, deque
from threading import Lock
from time import monotonic
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import JWT_ALG, JWT_SECRET
from db import db

bearer = HTTPBearer(auto_error=False)


def _unauth() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Bitte anmelden.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_player_id(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauth()
    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALG],
            options={"require": ["exp", "sub"], "verify_sub": False},
        )
    except jwt.InvalidTokenError:
        raise _unauth()
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub:
        raise _unauth()
    return sub


async def require_coach(
    current_player_id: Annotated[str, Depends(get_current_player_id)],
) -> str:
    p = await db.players.find_one({"id": current_player_id})
    if not p or p.get("position") != "Coach":
        raise HTTPException(status_code=403, detail="Nur der Trainer darf das.")
    return current_player_id


CurrentPlayer = Annotated[str, Depends(get_current_player_id)]
CoachPlayer = Annotated[str, Depends(require_coach)]


# ---------- Rate limiting (in-memory; suitable for single-process backend) ----------
_lock = Lock()
_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)


def throttle(name: str, limit: int, window_seconds: int):
    async def dependency(request: Request):
        fwd = request.headers.get("x-forwarded-for")
        ip = (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown"))
        now = monotonic()
        key = (name, ip)
        with _lock:
            q = _hits[key]
            while q and now - q[0] >= window_seconds:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(
                    status_code=429,
                    detail="Zu viele Anfragen. Bitte gleich nochmal probieren.",
                    headers={"Retry-After": str(window_seconds)},
                )
            q.append(now)
    return dependency


login_limit = throttle("login", limit=15, window_seconds=60)
forgot_password_limit = throttle("forgot-password", limit=5, window_seconds=300)
set_password_limit = throttle("set-password", limit=10, window_seconds=300)
