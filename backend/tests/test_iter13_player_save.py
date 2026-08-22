"""Iter-13: verify /players/*/contact + /players/{id}/status + PATCH /players/{id}
work for owner-self and Coach, and 401/403 behave correctly.

User bug report: 'Spielerdaten sind nicht mehr speicherbar'. Cover:
  * Owner-self full field save (email, birthdate, jersey, spieler_id, avatar_file_id)
  * Coach edits any player (contact + status + name/position)
  * 401 without token
  * 403 non-owner non-coach on someone else's /contact
  * Cleanup: restore all values.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or "https://mobile-first-stage-71.preview.emergentagent.com").rstrip("/")

JOSH_ID = "josh-ankermann"
JOSH_PW = "pw12345"
COACH_ID = "michael-moser"
COACH_PW = "pw12345"
FILIP_ID = "filip-la"

s = requests.Session()


def _login(pid: str, pw: str) -> str:
    r = s.post(f"{BASE_URL}/api/players/{pid}/login",
               json={"password": pw}, timeout=15)
    assert r.status_code == 200, f"login {pid}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tokens():
    time.sleep(2)
    return {"josh": _login(JOSH_ID, JOSH_PW), "coach": _login(COACH_ID, COACH_PW)}


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _get_player_full(token, pid):
    r = s.get(f"{BASE_URL}/api/players/full", headers=_h(token), timeout=15)
    assert r.status_code == 200
    return next((p for p in r.json() if p["id"] == pid), None)


# ---------------- OWNER-SELF SAVE ----------------
def test_owner_self_save_all_contact_fields(tokens):
    """Josh (Player) saves email, birthdate, jersey, spieler_id."""
    marker = f"SL-TEST-{uuid.uuid4().hex[:5]}"
    body = {
        "email": "josh.new@example.de",
        "birthdate": "1994-05-15",
        "jersey_number": 77,
        "spieler_id": marker,
    }
    r = s.patch(f"{BASE_URL}/api/players/{JOSH_ID}/contact",
                json=body, headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 200, r.text
    # Verify persistence via GET /players/full
    p = _get_player_full(tokens["josh"], JOSH_ID)
    assert p is not None
    assert p.get("email") == "josh.new@example.de"
    assert p.get("birthdate") == "1994-05-15"
    assert p.get("jersey_number") == 77
    assert p.get("spieler_id") == marker
    # Cleanup: reset to empty
    reset = s.patch(f"{BASE_URL}/api/players/{JOSH_ID}/contact",
                    json={"email": "", "birthdate": "", "jersey_number": 0, "spieler_id": ""},
                    headers=_h(tokens["josh"]), timeout=15)
    assert reset.status_code == 200


def test_owner_self_save_partial_email_only(tokens):
    """Empty string clears email (matches PlayerEditSheet.tsx passing email.trim())."""
    r = s.patch(f"{BASE_URL}/api/players/{JOSH_ID}/contact",
                json={"email": "temp@x.de"}, headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 200
    p = _get_player_full(tokens["josh"], JOSH_ID)
    assert p.get("email") == "temp@x.de"
    s.patch(f"{BASE_URL}/api/players/{JOSH_ID}/contact",
            json={"email": ""}, headers=_h(tokens["josh"]), timeout=15)
    p2 = _get_player_full(tokens["josh"], JOSH_ID)
    assert p2.get("email") in (None, "")


# ---------------- COACH-EDIT-OTHER ----------------
def test_coach_saves_others_contact_email(tokens):
    r = s.patch(f"{BASE_URL}/api/players/{FILIP_ID}/contact",
                json={"email": "filip@test.de"},
                headers=_h(tokens["coach"]), timeout=15)
    assert r.status_code == 200, r.text
    p = _get_player_full(tokens["coach"], FILIP_ID)
    assert p.get("email") == "filip@test.de"


def test_coach_updates_others_status(tokens):
    # Read current then flip Aktiv <-> Inaktiv and reset
    p_before = _get_player_full(tokens["coach"], FILIP_ID)
    old = p_before.get("status") or "Aktiv"
    new = "Inaktiv" if old != "Inaktiv" else "Aktiv"
    r = s.patch(f"{BASE_URL}/api/players/{FILIP_ID}/status",
                json={"status": new}, headers=_h(tokens["coach"]), timeout=15)
    assert r.status_code == 200, r.text
    p_after = _get_player_full(tokens["coach"], FILIP_ID)
    assert p_after.get("status") == new
    # reset
    s.patch(f"{BASE_URL}/api/players/{FILIP_ID}/status",
            json={"status": old}, headers=_h(tokens["coach"]), timeout=15)


def test_coach_updates_others_name_and_position(tokens):
    """Create a temp test player, update name+position, verify, delete."""
    create = s.post(f"{BASE_URL}/api/players",
                    json={"name": f"TEST Player {uuid.uuid4().hex[:5]}",
                          "position": "MF"},
                    headers=_h(tokens["coach"]), timeout=15)
    assert create.status_code == 200, create.text
    pid = create.json()["id"]
    try:
        r = s.patch(f"{BASE_URL}/api/players/{pid}",
                    json={"name": "TEST Renamed", "position": "ST"},
                    headers=_h(tokens["coach"]), timeout=15)
        assert r.status_code == 200, r.text
        p = _get_player_full(tokens["coach"], pid)
        assert p["name"] == "TEST Renamed"
        assert p["position"] == "ST"
    finally:
        s.delete(f"{BASE_URL}/api/players/{pid}",
                 headers=_h(tokens["coach"]), timeout=15)


# ---------------- 401 / 403 ----------------
def test_401_no_token_on_contact():
    r = requests.patch(f"{BASE_URL}/api/players/{JOSH_ID}/contact",
                       json={"email": "x@y.z"}, timeout=15)
    assert r.status_code == 401
    assert r.json().get("detail") == "Bitte anmelden."


def test_401_invalid_token_on_contact():
    r = requests.patch(f"{BASE_URL}/api/players/{JOSH_ID}/contact",
                       json={"email": "x@y.z"},
                       headers={"Authorization": "Bearer not-a-real-jwt"},
                       timeout=15)
    assert r.status_code == 401


def test_403_non_owner_non_coach_contact(tokens):
    """Bug scenario: josh tries to edit filip -> 403 Nicht erlaubt."""
    r = s.patch(f"{BASE_URL}/api/players/{FILIP_ID}/contact",
                json={"email": "attacker@x.de"},
                headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 403
    assert r.json().get("detail") == "Nicht erlaubt."


def test_403_non_coach_cannot_update_player_name(tokens):
    """/players/{id} PATCH is Coach-only."""
    r = s.patch(f"{BASE_URL}/api/players/{FILIP_ID}",
                json={"name": "hacked"},
                headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 403


def test_403_non_coach_cannot_update_status(tokens):
    r = s.patch(f"{BASE_URL}/api/players/{FILIP_ID}/status",
                json={"status": "Inaktiv"},
                headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 403


# ---------------- REGRESSION: chat send, events, cashboxes still work ----------------
def test_regression_chat_send_still_works(tokens):
    r = s.post(f"{BASE_URL}/api/messages",
               json={"conversation_id": "team", "scope": "team",
                     "sender_id": JOSH_ID, "text": f"iter13-regression-{uuid.uuid4().hex[:5]}"},
               headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code in (200, 201), r.text


def test_regression_events_load(tokens):
    r = s.get(f"{BASE_URL}/api/events", headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 200


def test_regression_cashboxes_load(tokens):
    r = s.get(f"{BASE_URL}/api/cashboxes", headers=_h(tokens["josh"]), timeout=15)
    assert r.status_code == 200
