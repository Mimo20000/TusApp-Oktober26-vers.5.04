"""Iteration 6 tests:
- Beer button end-to-end for AWAY Spiel event: toggle on -> attendance beer=true, chat msg with '🍺' and 'Spiel' (NOT 'Training').
- Toggle off -> chat msg with '🍺❌' and 'Spiel'.
- Version 3.0 across manifest.json / sw.js / package.json / app.json (with unchanged manifest.id == 'Mimos App').
- Regressions: /api/attendance persists beer flag, player thumbnail 200, delete-event hard delete still works.
"""
import os
import json
import time
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else "https://mobile-first-stage-71.preview.emergentagent.com"
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

JOSH = "josh-ankermann"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------- 1) Version 3.0 static assets ----------
class TestVersionBump:
    def test_manifest_json(self, api):
        r = api.get(f"{BASE_URL}/manifest.json")
        assert r.status_code == 200
        m = r.json()
        assert m["name"] == "Tus2 by Mimo 3.0", m
        assert "Version 3.0" in m["description"], m
        # PWA identity MUST remain the same so installed v2 users get an update, not a fresh install
        assert m["id"] == "Mimos App", m

    def test_sw_js(self, api):
        r = api.get(f"{BASE_URL}/sw.js")
        assert r.status_code == 200
        body = r.text
        assert 'SW_VERSION = "3.0.0"' in body, body[:200]
        assert "tus2-mimo-${SW_VERSION}" in body or "tus2-mimo-3.0.0" in body

    def test_package_and_app_json(self):
        with open("/app/frontend/package.json") as f:
            pkg = json.load(f)
        assert pkg["version"] == "3.0.0", pkg["version"]
        with open("/app/frontend/app.json") as f:
            app = json.load(f)
        assert app["expo"]["version"] == "3.0.0", app["expo"]["version"]


# ---------- 2) Beer flow for Spiel ----------
class TestBeerForSpielEvent:
    def _seed_away_spiel(self, api):
        payload = {
            "type": "Spiel",
            "date": (datetime.now(timezone.utc) + timedelta(days=12)).strftime("%Y-%m-%d"),
            "time": "17:00",
            "opponent": "BierGegner FC",
            "home_game": False,
            "location": "Auswärts Halle",
        }
        r = api.post(f"{BASE_URL}/api/events", json=payload)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_beer_on_then_off_for_spiel_event(self, api, mongo):
        eid = self._seed_away_spiel(api)
        try:
            # Clear any existing attendance / recent messages baseline
            _run(mongo.attendance.delete_many({"event_id": eid, "player_id": JOSH}))
            ts0 = datetime.now(timezone.utc).isoformat()

            # Toggle ON
            r = api.post(f"{BASE_URL}/api/beer", json={
                "event_id": eid, "player_id": JOSH, "beer": True,
            })
            assert r.status_code == 200, r.text
            assert r.json().get("ok") is True

            # Attendance persisted with beer=true
            att = api.get(f"{BASE_URL}/api/attendance")
            assert att.status_code == 200
            row = next((a for a in att.json() if a.get("event_id") == eid and a.get("player_id") == JOSH), None)
            assert row is not None, "attendance row must exist after /beer"
            assert row.get("beer") is True, row

            # Chat message with 🍺 AND 'Spiel' (NOT 'Training')
            msgs_on = _run(mongo.messages.find({
                "conversation_id": "team",
                "sender_id": JOSH,
                "created_at": {"$gte": ts0},
                "text": {"$regex": "🍺"},
            }).to_list(20))
            assert msgs_on, "expected a team chat message on beer=true"
            on_text = msgs_on[-1]["text"]
            assert "🍺" in on_text and "Spiel" in on_text and "Training" not in on_text, on_text
            assert "❌" not in on_text, on_text

            # Toggle OFF
            ts1 = datetime.now(timezone.utc).isoformat()
            r2 = api.post(f"{BASE_URL}/api/beer", json={
                "event_id": eid, "player_id": JOSH, "beer": False,
            })
            assert r2.status_code == 200, r2.text

            # Attendance beer flipped to false
            att2 = api.get(f"{BASE_URL}/api/attendance").json()
            row2 = next(a for a in att2 if a.get("event_id") == eid and a.get("player_id") == JOSH)
            assert row2.get("beer") is False, row2

            msgs_off = _run(mongo.messages.find({
                "conversation_id": "team",
                "sender_id": JOSH,
                "created_at": {"$gte": ts1},
                "text": {"$regex": "🍺❌"},
            }).to_list(20))
            assert msgs_off, "expected chat message on beer=false"
            off_text = msgs_off[-1]["text"]
            assert "🍺❌" in off_text and "Spiel" in off_text and "Training" not in off_text, off_text
        finally:
            # cleanup: hard-delete event + attendance + related messages
            api.post(f"{BASE_URL}/api/events/{eid}/cancel")
            _run(mongo.attendance.delete_many({"event_id": eid}))


# ---------- 3) Regressions ----------
class TestRegressions:
    def test_thumbnail_endpoint(self, api):
        r = api.get(f"{BASE_URL}/api/players")
        assert r.status_code == 200
        josh = next((p for p in r.json() if p["id"] == JOSH), None)
        assert josh is not None
        fid = josh.get("avatar_file_id")
        if not fid:
            pytest.skip("no avatar_file_id set on josh (env reset?)")
        t = api.get(f"{BASE_URL}/api/files/{fid}/thumbnail")
        assert t.status_code == 200, t.text
        assert t.headers.get("content-type", "").startswith("image/")

    def test_delete_event_hard_delete_still_works(self, api):
        payload = {
            "type": "Spiel",
            "date": (datetime.now(timezone.utc) + timedelta(days=20)).strftime("%Y-%m-%d"),
            "time": "20:00",
            "opponent": "RegDelete FC",
            "home_game": False,
            "location": "X",
        }
        r = api.post(f"{BASE_URL}/api/events", json=payload)
        assert r.status_code == 200
        eid = r.json()["id"]
        c = api.post(f"{BASE_URL}/api/events/{eid}/cancel")
        assert c.status_code == 200
        assert c.json() == {"ok": True, "deleted": True}
        listing = api.get(f"{BASE_URL}/api/events").json()
        assert not any(e["id"] == eid for e in listing)

    def test_unread_scan_no_error(self, api):
        r = api.get(f"{BASE_URL}/api/unread", params={"player_id": JOSH})
        assert r.status_code == 200
        assert "count" in r.json() or "unread" in r.json() or isinstance(r.json(), dict)
