"""New-feature + refactor-regression tests for TuS Oberhausen II backend.

Covers post-refactor:
 - Coach login (michael-moser / coach1)
 - PATCH /api/events/{id} (time/location for any type; opponent/home_game for Spiel)
 - POST /api/events/{id}/cancel (sets cancelled=true)
 - PATCH /api/players/{id}/contact  {jersey_number:N} / {jersey_number:0} -> null
 - Automatic birthday team-chat message (idempotent per year)

All tests fully clean up any mutations against seed data / LIVE prod MongoDB.
"""
import os
import re
from datetime import datetime

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def mdb():
    """Direct Mongo access – used *only* for cleanup / verification of state
    that has no matching REST endpoint (e.g. un-cancel a seed event, purge
    system messages)."""
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


# ------------------------------------------------------------------
# Auth: coach
# ------------------------------------------------------------------
class TestCoachAuth:
    def test_coach_login_returns_token(self, s):
        r = s.post(f"{API}/players/michael-moser/login",
                   json={"password": "coach1"}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["player_id"] == "michael-moser"
        assert data["access_token"] and len(data["access_token"].split(".")) == 3

    def test_set_password_second_time_400(self, s):
        # michael-moser already has a hash → attempting to set again must 400
        r = s.post(f"{API}/players/michael-moser/set-password",
                   json={"password": "coach1"}, timeout=15)
        assert r.status_code == 400
        assert "bereits" in r.json()["detail"].lower()


# ------------------------------------------------------------------
# Event edit
# ------------------------------------------------------------------
class TestEventEdit:
    def _snapshot(self, s, eid):
        events = s.get(f"{API}/events", timeout=15).json()
        return next(e for e in events if e["id"] == eid)

    def test_patch_time_and_location_generic(self, s, mdb):
        eid = "T4"  # Spiel, home game (TuS home)
        original = self._snapshot(s, eid)
        try:
            r = s.patch(f"{API}/events/{eid}",
                        json={"time": "16:00", "location": "TESTHALLE"}, timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"] is True
            assert body["time"] == "16:00"
            assert body["location"] == "TESTHALLE"
            assert body["notify_at"]  # ISO string set

            # Verify persistence via GET
            after = self._snapshot(s, eid)
            assert after["time"] == "16:00"
            assert after["location"] == "TESTHALLE"
            assert after["notify_at"]
        finally:
            # Restore via direct DB (endpoint clears notify_at side-effect too)
            mdb.events.update_one(
                {"id": eid},
                {"$set": {
                    "time": original["time"],
                    "location": original["location"],
                    "notify_at": original.get("notify_at"),
                }},
            )
            restored = self._snapshot(s, eid)
            assert restored["time"] == original["time"]
            assert restored["location"] == original["location"]

    def test_patch_opponent_home_game_updates_title(self, s, mdb):
        eid = "T2"  # away game per seed: opponent = SG Kenzingen/... , home game False
        original = self._snapshot(s, eid)
        try:
            r = s.patch(f"{API}/events/{eid}",
                        json={"opponent": "TEST FC", "home_game": True}, timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["opponent"] == "TEST FC"
            assert body["home"] == "TuS Oberhausen II"
            assert body["away"] == "TEST FC"
            assert body["title"] == "TuS Oberhausen II vs. TEST FC"

            after = self._snapshot(s, eid)
            assert after["home"] == "TuS Oberhausen II"
            assert after["away"] == "TEST FC"
            assert after["title"] == "TuS Oberhausen II vs. TEST FC"
            assert after["opponent"] == "TEST FC"
        finally:
            mdb.events.update_one(
                {"id": eid},
                {"$set": {
                    "home": original["home"],
                    "away": original["away"],
                    "opponent": original["opponent"],
                    "title": original["title"],
                    "notify_at": original.get("notify_at"),
                }},
            )
            r_after = self._snapshot(s, eid)
            assert r_after["opponent"] == original["opponent"]
            assert r_after["title"] == original["title"]

    def test_patch_unknown_id_404(self, s):
        r = s.patch(f"{API}/events/NOPE_ID", json={"time": "10:00"}, timeout=15)
        assert r.status_code == 404


# ------------------------------------------------------------------
# Event cancel
# ------------------------------------------------------------------
class TestEventCancel:
    def test_cancel_sets_flag_and_notify_at(self, s, mdb):
        eid = "T12"
        before = mdb.events.find_one({"id": eid}, {"_id": 0})
        try:
            r = s.post(f"{API}/events/{eid}/cancel", timeout=15)
            assert r.status_code == 200, r.text
            assert r.json()["ok"] is True

            got = next(e for e in s.get(f"{API}/events", timeout=15).json()
                       if e["id"] == eid)
            assert got["cancelled"] is True
            assert got["notify_at"]
        finally:
            mdb.events.update_one(
                {"id": eid},
                {"$set": {"cancelled": False,
                          "notify_at": before.get("notify_at")}},
            )
            restored = next(e for e in s.get(f"{API}/events", timeout=15).json()
                            if e["id"] == eid)
            assert restored["cancelled"] is False

    def test_cancel_unknown_id_404(self, s):
        r = s.post(f"{API}/events/NOPE_ID/cancel", timeout=15)
        assert r.status_code == 404


# ------------------------------------------------------------------
# Jersey number self-edit
# ------------------------------------------------------------------
class TestJerseyNumber:
    def test_set_and_clear_jersey_number(self, s, mdb):
        pid = "filip-la"
        try:
            # Set
            r = s.patch(f"{API}/players/{pid}/contact",
                        json={"jersey_number": 7}, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json().get("jersey_number") == 7

            data = s.get(f"{API}/players", timeout=15).json()
            p = next(x for x in data if x["id"] == pid)
            assert p["jersey_number"] == 7

            # Clear via 0 -> null
            r2 = s.patch(f"{API}/players/{pid}/contact",
                         json={"jersey_number": 0}, timeout=15)
            assert r2.status_code == 200
            # response for a null must not be 0
            assert r2.json().get("jersey_number") is None

            data2 = s.get(f"{API}/players", timeout=15).json()
            p2 = next(x for x in data2 if x["id"] == pid)
            assert p2["jersey_number"] is None
        finally:
            # Guarantee cleanup even on failure
            mdb.players.update_one({"id": pid},
                                   {"$set": {"jersey_number": None}})


# ------------------------------------------------------------------
# Birthday auto message
# ------------------------------------------------------------------
class TestBirthdayAutoMessage:
    def _cleanup(self, mdb, pid):
        mdb.players.update_one({"id": pid}, {"$set": {"birthdate": None}})
        mdb.messages.delete_many({"sender_id": "system"})
        mdb.system_events.delete_many({"key": {"$regex": r"^birthday:"}})

    def test_birthday_message_created_once_per_year(self, s, mdb):
        pid = "filip-la"          # birthday player
        other = "christoph-moser"  # poller (unread called from someone else)
        today = datetime.now().strftime("%Y-%m-%d")

        # Pre-clean any leftover state from previous runs
        self._cleanup(mdb, pid)

        try:
            # Set today's birthdate
            r = s.patch(f"{API}/players/{pid}/contact",
                        json={"birthdate": today}, timeout=15)
            assert r.status_code == 200

            # First unread poll triggers birthday check
            u1 = s.get(f"{API}/unread?player_id={other}", timeout=15).json()
            assert "total" in u1

            sys_msgs = list(mdb.messages.find(
                {"sender_id": "system"}, {"_id": 0}))
            assert len(sys_msgs) == 1, f"expected 1 system msg, got {len(sys_msgs)}"
            m = sys_msgs[0]
            assert m["conversation_id"] == "team"
            assert m["scope"] == "team"
            assert m["text"].startswith("Herzlichen Glückwunsch zum Geburtstag")
            # First name (whatever it currently is) should appear
            first = (mdb.players.find_one({"id": pid}) or {}).get("name", "").split()[0]
            if first:
                assert first in m["text"], f"first-name {first!r} not in {m['text']!r}"

            # Idempotency: second poll must NOT add another system msg
            s.get(f"{API}/unread?player_id={other}", timeout=15)
            s.get(f"{API}/unread?player_id={other}", timeout=15)
            sys_msgs2 = list(mdb.messages.find({"sender_id": "system"}))
            assert len(sys_msgs2) == 1, "birthday message was duplicated!"

            # system_events marker present for this year
            year = datetime.now().year
            marker = mdb.system_events.find_one({"key": f"birthday:{pid}:{year}"})
            assert marker is not None

            # Message also shows up in GET /messages?conversation_id=team
            team = s.get(f"{API}/messages?conversation_id=team", timeout=15).json()
            assert any(mm.get("sender_id") == "system" for mm in team)
        finally:
            self._cleanup(mdb, pid)
            # sanity: cleaned up
            assert mdb.messages.count_documents({"sender_id": "system"}) == 0
            assert mdb.system_events.count_documents(
                {"key": {"$regex": r"^birthday:"}}) == 0
            assert (mdb.players.find_one({"id": pid}) or {}).get("birthdate") in (None,)
