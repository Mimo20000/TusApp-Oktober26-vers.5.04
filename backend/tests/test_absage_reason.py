"""Backend tests for the mandatory Absage reason feature."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://mobile-first-stage-71.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

PLAYER_ID = "josh-ankermann"


@pytest.fixture(scope="module")
def event_id():
    """Pick a future event id from the events list (no cancelled ones)."""
    r = requests.get(f"{API}/events", timeout=15)
    assert r.status_code == 200, r.text
    events = r.json()
    assert events, "No events available for testing"
    # prefer a Training/Treffen so we don't disturb Spiel data too much
    ev = next((e for e in events if e["type"] != "Spiel"), events[0])
    return ev["id"]


@pytest.fixture(scope="module", autouse=True)
def cleanup(event_id):
    """After all tests: reset josh back to zugesagt on the used event."""
    yield
    try:
        requests.post(
            f"{API}/rsvp",
            json={"event_id": event_id, "player_id": PLAYER_ID, "status": "zugesagt"},
            timeout=10,
        )
    except Exception:
        pass


class TestRSVPReason:
    def test_absagen_without_reason_returns_400(self, event_id):
        r = requests.post(
            f"{API}/rsvp",
            json={"event_id": event_id, "player_id": PLAYER_ID, "status": "abgesagt"},
            timeout=10,
        )
        assert r.status_code == 400
        assert r.json().get("detail") == "Bitte gib einen Grund für die Absage an."

    def test_absagen_with_empty_reason_returns_400(self, event_id):
        r = requests.post(
            f"{API}/rsvp",
            json={"event_id": event_id, "player_id": PLAYER_ID, "status": "abgesagt", "reason": "   "},
            timeout=10,
        )
        assert r.status_code == 400
        assert "Grund" in r.json().get("detail", "")

    def test_absagen_with_reason_persists(self, event_id):
        reason = f"Krank-{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/rsvp",
            json={"event_id": event_id, "player_id": PLAYER_ID, "status": "abgesagt", "reason": reason},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["status"] == "abgesagt"
        assert body["reason"] == reason

        # Verify via GET /api/attendance
        att = requests.get(f"{API}/attendance", timeout=10).json()
        mine = [
            a for a in att
            if a.get("event_id") == event_id and a.get("player_id") == PLAYER_ID
        ]
        assert mine, "Attendance row missing"
        assert mine[0].get("status") == "abgesagt"
        assert mine[0].get("reason") == reason

    def test_overview_returns_reason_for_absagen(self, event_id):
        # ensure absagen with reason first
        reason = f"Familientermin-{uuid.uuid4().hex[:5]}"
        requests.post(
            f"{API}/rsvp",
            json={"event_id": event_id, "player_id": PLAYER_ID, "status": "abgesagt", "reason": reason},
            timeout=10,
        )
        r = requests.get(f"{API}/events/{event_id}/overview", timeout=10)
        assert r.status_code == 200, r.text
        players = r.json()["players"]
        josh = next((p for p in players if p["id"] == PLAYER_ID), None)
        assert josh is not None
        assert josh["rsvp"] == "abgesagt"
        assert josh["reason"] == reason

    def test_zusagen_clears_reason(self, event_id):
        # first set absagen with a reason
        requests.post(
            f"{API}/rsvp",
            json={"event_id": event_id, "player_id": PLAYER_ID, "status": "abgesagt", "reason": "Krank"},
            timeout=10,
        )
        # now zusagen (reason passed should be ignored)
        r = requests.post(
            f"{API}/rsvp",
            json={"event_id": event_id, "player_id": PLAYER_ID, "status": "zugesagt", "reason": "SHOULD_BE_IGNORED"},
            timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "zugesagt"
        assert body["reason"] in (None, "", None)

        # Verify via /attendance
        att = requests.get(f"{API}/attendance", timeout=10).json()
        mine = [a for a in att if a["event_id"] == event_id and a["player_id"] == PLAYER_ID][0]
        assert mine.get("reason") in (None, "")

        # Verify via overview
        ov = requests.get(f"{API}/events/{event_id}/overview", timeout=10).json()
        josh = next(p for p in ov["players"] if p["id"] == PLAYER_ID)
        assert josh["rsvp"] == "zugesagt"
        assert josh.get("reason") in (None, "")

    def test_invalid_status_returns_400(self, event_id):
        r = requests.post(
            f"{API}/rsvp",
            json={"event_id": event_id, "player_id": PLAYER_ID, "status": "vielleicht"},
            timeout=10,
        )
        assert r.status_code == 400
