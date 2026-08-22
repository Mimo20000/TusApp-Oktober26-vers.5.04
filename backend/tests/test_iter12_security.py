"""Iter-12 security hardening tests (JWT auth, RBAC, rate-limit, PII strip, safe MIME).

Covers SEC-001…SEC-005 + rate limits + file safety headers.
"""
import base64
import os
import time
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or os.environ.get("EXPO_BACKEND_URL")
            or "https://mobile-first-stage-71.preview.emergentagent.com").rstrip("/")

JOSH = ("josh-ankermann", "pw12345")
COACH = ("michael-moser", "pw12345")
BIERWART = ("sascha-grins", "test1234")

s = requests.Session()


def _login(pid: str, pw: str) -> str:
    r = s.post(f"{BASE_URL}/api/players/{pid}/login", json={"password": pw}, timeout=15)
    assert r.status_code == 200, f"login {pid} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tokens():
    time.sleep(1)
    return {
        "josh": _login(*JOSH),
        "coach": _login(*COACH),
        "bierwart": _login(*BIERWART),
    }


def _h(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


# ---------------- SEC-001: unauthenticated 401 blocks ----------------
UNAUTH_401_ENDPOINTS = [
    "/api/events",
    "/api/attendance",
    "/api/messages?conversation_id=team",
    "/api/stats",
    "/api/cashboxes",
    "/api/settings/bierwart",
    "/api/payments",
    "/api/conversations",
    "/api/unread",
    "/api/events-unread",
]


@pytest.mark.parametrize("path", UNAUTH_401_ENDPOINTS)
def test_sec001_endpoint_returns_401_without_token(path):
    r = requests.get(f"{BASE_URL}{path}", timeout=15)
    assert r.status_code == 401, f"{path} expected 401 got {r.status_code}: {r.text[:200]}"
    assert r.json().get("detail") == "Bitte anmelden."


def test_sec001_event_overview_401(tokens):
    # Need an event id to call overview — fetch one authed.
    r = s.get(f"{BASE_URL}/api/events", headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 200
    evs = r.json()
    if not evs:
        pytest.skip("no events to check overview")
    eid = evs[0]["id"]
    r2 = requests.get(f"{BASE_URL}/api/events/{eid}/overview", timeout=15)
    assert r2.status_code == 401
    assert r2.json().get("detail") == "Bitte anmelden."


@pytest.mark.parametrize("path", UNAUTH_401_ENDPOINTS)
def test_sec001_endpoint_returns_200_with_token(path, tokens):
    r = s.get(f"{BASE_URL}{path}", headers=_h(tokens["josh"]), timeout=15)
    # /api/payments requires access — josh is not a cashbox recipient, so 403 is
    # expected there; asserted separately in SEC-003.
    if path == "/api/payments":
        assert r.status_code == 403
    else:
        assert r.status_code == 200, f"{path} authed expected 200 got {r.status_code}: {r.text[:200]}"
# ---------------- SEC-002: /contact gating ----------------
def test_sec002_non_owner_non_coach_cannot_edit_contact(tokens):
    other = "sascha-grins"
    r = s.patch(
        f"{BASE_URL}/api/players/{other}/contact",
        json={"email": "attacker@example.com"},
        headers=_h(tokens["josh"]),
        timeout=15,
    )
    assert r.status_code == 403
    assert r.json().get("detail") == "Nicht erlaubt."


def test_sec002_owner_can_edit_own_contact(tokens):
    # Make a benign no-op edit — set spieler_id to a random value then reset.
    marker = f"pytest-{uuid.uuid4().hex[:6]}"
    r = s.patch(
        f"{BASE_URL}/api/players/josh-ankermann/contact",
        json={"spieler_id": marker},
        headers=_h(tokens["josh"]),
        timeout=15,
    )
    assert r.status_code == 200
    # revert
    s.patch(
        f"{BASE_URL}/api/players/josh-ankermann/contact",
        json={"spieler_id": ""},
        headers=_h(tokens["josh"]),
        timeout=15,
    )


def test_sec002_coach_can_edit_others_contact(tokens):
    marker = f"pytest-{uuid.uuid4().hex[:6]}"
    r = s.patch(
        f"{BASE_URL}/api/players/josh-ankermann/contact",
        json={"spieler_id": marker},
        headers=_h(tokens["coach"]),
        timeout=15,
    )
    assert r.status_code == 200
    s.patch(
        f"{BASE_URL}/api/players/josh-ankermann/contact",
        json={"spieler_id": ""},
        headers=_h(tokens["coach"]),
        timeout=15,
    )


# ---------------- SEC-003: no actor_id spoofing ----------------
def test_sec003_bierwart_patch_requires_coach(tokens):
    r = s.patch(
        f"{BASE_URL}/api/settings/bierwart",
        json={"actor_id": "michael-moser", "email": "test@example.com"},
        headers=_h(tokens["josh"]),
        timeout=15,
    )
    assert r.status_code == 403
    assert r.json().get("detail") == "Nur der Trainer darf das."


def test_sec003_bierwart_patch_with_coach_ok(tokens):
    # Read current, re-set the same value to avoid disturbing seed data.
    cur = s.get(f"{BASE_URL}/api/settings/bierwart",
                headers=_h(tokens["coach"]), timeout=15).json()
    email = cur.get("email") or "mm@test.de"
    r = s.patch(
        f"{BASE_URL}/api/settings/bierwart",
        json={"email": email},
        headers=_h(tokens["coach"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text


def test_sec003_cashbox_patch_requires_coach(tokens):
    r = s.get(f"{BASE_URL}/api/cashboxes", headers=_h(tokens["coach"]), timeout=15)
    assert r.status_code == 200
    boxes = r.json()
    if not boxes:
        pytest.skip("no cashboxes")
    key = boxes[0]["key"]
    r2 = s.patch(
        f"{BASE_URL}/api/cashboxes/{key}",
        json={"actor_id": "michael-moser", "recipient_player_id": "sascha-grins"},
        headers=_h(tokens["josh"]),
        timeout=15,
    )
    assert r2.status_code == 403
    assert r2.json().get("detail") == "Nur der Trainer darf das."


def test_sec003_cashbox_patch_with_coach_ok(tokens):
    r = s.get(f"{BASE_URL}/api/cashboxes", headers=_h(tokens["coach"]), timeout=15)
    boxes = r.json()
    key = boxes[0]["key"]
    # Use current label to force an update (harmless roundtrip)
    label = boxes[0].get("label") or "Kasse"
    r2 = s.patch(
        f"{BASE_URL}/api/cashboxes/{key}",
        json={"label": label},
        headers=_h(tokens["coach"]),
        timeout=15,
    )
    assert r2.status_code == 200, r2.text


def test_sec003_payments_post_uses_token_subject(tokens):
    # Fetch a cashbox to pay into
    r = s.get(f"{BASE_URL}/api/cashboxes", headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 200
    boxes = r.json()
    if not boxes:
        pytest.skip("no cashboxes")
    key = boxes[0]["key"]
    # Try to spoof payer_id — server must ignore and use josh from token.
    r2 = s.post(
        f"{BASE_URL}/api/payments",
        json={"cashbox_key": key, "amount": 1, "payer_id": "michael-moser", "note": "pytest"},
        headers=_h(tokens["josh"]),
        timeout=15,
    )
    assert r2.status_code in (200, 201), r2.text
    body = r2.json()
    assert body.get("payer_id") == "josh-ankermann", body


def test_sec003_payments_get_requires_recipient_or_coach(tokens):
    # josh isn't a recipient → 403
    r = s.get(f"{BASE_URL}/api/payments", headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 403
    # bierwart (sascha) IS a recipient → 200
    r2 = s.get(f"{BASE_URL}/api/payments", headers=_h(tokens["bierwart"]), timeout=15)
    assert r2.status_code == 200
    # coach also 200
    r3 = s.get(f"{BASE_URL}/api/payments", headers=_h(tokens["coach"]), timeout=15)
    assert r3.status_code == 200


# ---------------- SEC-004: hard-delete + chat sender ----------------
def test_sec004_event_cancel_requires_coach(tokens):
    r = s.get(f"{BASE_URL}/api/events", headers=_h(tokens["josh"]), timeout=15)
    evs = r.json()
    if not evs:
        pytest.skip("no events")
    eid = evs[0]["id"]
    r2 = s.post(f"{BASE_URL}/api/events/{eid}/cancel", headers=_h(tokens["josh"]),
                json={}, timeout=15)
    assert r2.status_code == 403


def test_sec004_chat_sender_from_token_not_body(tokens):
    # Post as josh but claim to be coach in body — must be overridden.
    payload = {
        "conversation_id": "team",
        "scope": "team",
        "sender_id": "michael-moser",
        "text": f"pytest-msg-{uuid.uuid4().hex[:6]}",
    }
    r = s.post(f"{BASE_URL}/api/messages", json=payload,
               headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code in (200, 201), r.text
    mid = r.json().get("id")
    # Verify via GET
    r2 = s.get(f"{BASE_URL}/api/messages?conversation_id=team",
               headers=_h(tokens["josh"]), timeout=15)
    assert r2.status_code == 200
    msgs = r2.json()
    match = next((m for m in msgs if m.get("id") == mid), None)
    assert match is not None, "posted message not returned by GET"
    assert match["sender_id"] == "josh-ankermann", match


# ---------------- SEC-005: PII stripped from anonymous /players ----------------
def test_sec005_anonymous_players_has_no_pii():
    r = requests.get(f"{BASE_URL}/api/players", timeout=15)
    assert r.status_code == 200
    players = r.json()
    assert players
    for p in players:
        for pii in ("email", "birthdate", "jersey_number", "avatar_file_id", "spieler_id",
                    "password_hash"):
            v = p.get(pii)
            assert v in (None, "", 0) or pii not in p, f"leaked {pii}={v!r} in {p['id']}"


def test_sec005_authed_players_full_has_pii(tokens):
    r = s.get(f"{BASE_URL}/api/players/full", headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 200
    players = r.json()
    # At least one player must have populated email
    assert any(p.get("email") for p in players), "no player has email in /players/full"
    # password_hash never leaked
    assert not any("password_hash" in p for p in players)


# ---------------- Rate limit ----------------
def test_rate_limit_login_429_after_15(tokens):
    # separate endpoint from real login; use bogus pw so we don't rotate token
    hits = []
    for _ in range(20):
        r = requests.post(f"{BASE_URL}/api/players/josh-ankermann/login",
                          json={"password": "wrong"}, timeout=10)
        hits.append(r.status_code)
        if r.status_code == 429:
            assert r.headers.get("Retry-After")
            break
    assert 429 in hits, f"no 429 in 20 attempts: {hits}"
    # allow window to reset for downstream tests
    time.sleep(2)


# ---------------- FILE SAFETY ----------------
def test_file_upload_html_served_as_octet_stream(tokens):
    # Upload a tiny text/html payload via the init/chunk/finalize flow.
    html = b"<html><body><script>alert(1)</script></body></html>"
    b64 = base64.b64encode(html).decode()
    init = s.post(f"{BASE_URL}/api/files/init",
                  json={"filename": "attack.html", "mime": "text/html",
                        "kind": "file"},
                  headers=_h(tokens["josh"]), timeout=15)
    assert init.status_code in (200, 201), init.text
    upload_id = init.json().get("upload_id")
    ch = s.post(f"{BASE_URL}/api/files/chunk",
                json={"upload_id": upload_id, "index": 0, "data": b64},
                headers=_h(tokens["josh"]), timeout=15)
    assert ch.status_code in (200, 201), ch.text
    fin = s.post(f"{BASE_URL}/api/files/finalize",
                 json={"upload_id": upload_id},
                 headers=_h(tokens["josh"]), timeout=15)
    assert fin.status_code in (200, 201), fin.text
    fid = fin.json().get("file_id")
    assert fid, fin.json()

    r = s.get(f"{BASE_URL}/api/files/{fid}/raw",
              headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 200
    ctype = r.headers.get("Content-Type", "").lower()
    assert ctype.startswith("application/octet-stream"), f"Content-Type={ctype!r} headers={dict(r.headers)}"
    assert "attachment" in r.headers.get("Content-Disposition", "").lower()
    assert r.headers.get("X-Content-Type-Options", "").lower() == "nosniff"


def test_files_raw_and_thumbnail_require_auth():
    # Even a non-existent id must challenge for auth before checking DB.
    r = requests.get(f"{BASE_URL}/api/files/does-not-exist/raw", timeout=10)
    assert r.status_code == 401
    r2 = requests.get(f"{BASE_URL}/api/files/does-not-exist/thumbnail", timeout=10)
    assert r2.status_code == 401
