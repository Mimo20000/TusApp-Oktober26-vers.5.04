"""Iteration 5 features:
- Hard-delete cancel (no strikethrough leftovers) + attendance cascade
- RSVP reminder scheduler (48h window, 3h slots, debounce, idempotent markers)
- Photo thumbnail regression
"""
import os
import sys
import time
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Load /app/backend/.env explicitly (for MONGO_URL / DB_NAME)
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://mobile-first-stage-71.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

JOSH = "josh-ankermann"
JOSH_PW = "pw12345"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


async def _clear_markers(mongo):
    await mongo.system_events.delete_many({"key": {"$regex": "^(reminder_scan:|rsvp_reminder:)"}})


# ---- 1) Hard delete cancel ----------------------------------------------------
class TestCancelHardDelete:
    def test_create_cancel_and_verify_removed(self, api, mongo):
        # Create Auswärtsspiel event
        payload = {
            "type": "Spiel",
            "date": (datetime.now(timezone.utc) + timedelta(days=10)).strftime("%Y-%m-%d"),
            "time": "18:00",
            "opponent": "DeleteMe SV",
            "home_game": False,
            "location": "Test Halle",
        }
        r = api.post(f"{BASE_URL}/api/events", json=payload)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]

        # attendance seed for cascade test
        asyncio.get_event_loop().run_until_complete(
            mongo.attendance.insert_one({"event_id": eid, "player_id": JOSH, "status": "zugesagt"})
        )

        # GET returns it
        r2 = api.get(f"{BASE_URL}/api/events")
        assert any(e["id"] == eid for e in r2.json())

        # Cancel = hard delete
        r3 = api.post(f"{BASE_URL}/api/events/{eid}/cancel")
        assert r3.status_code == 200, r3.text
        j = r3.json()
        assert j == {"ok": True, "deleted": True}

        # GET no longer returns
        r4 = api.get(f"{BASE_URL}/api/events")
        assert not any(e["id"] == eid for e in r4.json())

        # Attendance cascade
        remaining = asyncio.get_event_loop().run_until_complete(
            mongo.attendance.count_documents({"event_id": eid})
        )
        assert remaining == 0

    def test_get_events_filters_legacy_soft_cancelled(self, api, mongo):
        loop = asyncio.get_event_loop()
        eid = f"EVLEGACY{int(time.time())}"
        loop.run_until_complete(mongo.events.insert_one({
            "id": eid,
            "type": "Spiel",
            "date": (datetime.now(timezone.utc) + timedelta(days=15)).strftime("%Y-%m-%d"),
            "time": "10:00",
            "home": "X", "away": "TuS Oberhausen II", "opponent": "X",
            "title": "legacy",
            "cancelled": True,
        }))
        try:
            r = api.get(f"{BASE_URL}/api/events")
            assert r.status_code == 200
            assert not any(e["id"] == eid for e in r.json()), "legacy cancelled event must be filtered"
        finally:
            loop.run_until_complete(mongo.events.delete_one({"id": eid}))


# ---- 2) RSVP reminder scheduler ----------------------------------------------
class TestRsvpReminders:
    def test_reminder_flow_full(self, api, mongo):
        loop = asyncio.get_event_loop()
        # cleanup markers
        loop.run_until_complete(_clear_markers(mongo))
        # ensure josh has an email
        p = loop.run_until_complete(mongo.players.find_one({"id": JOSH}))
        assert p, "josh player missing"
        if not p.get("email"):
            loop.run_until_complete(mongo.players.update_one(
                {"id": JOSH}, {"$set": {"email": "josh.test@example.com"}}
            ))
        # ensure not Inaktiv
        if p.get("status") == "Inaktiv":
            loop.run_until_complete(mongo.players.update_one(
                {"id": JOSH}, {"$set": {"status": "Aktiv"}}
            ))

        # Event 25h in future
        target = datetime.now(timezone.utc) + timedelta(hours=25)
        payload = {
            "type": "Spiel", "date": target.strftime("%Y-%m-%d"),
            "time": target.strftime("%H:%M"),
            "opponent": "ReminderOpp", "home_game": False, "location": "H",
        }
        r = api.post(f"{BASE_URL}/api/events", json=payload)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]

        # remove josh's attendance for this event so he counts as un-answered
        loop.run_until_complete(mongo.attendance.delete_many({"event_id": eid, "player_id": JOSH}))

        try:
            # trigger scan
            r2 = api.get(f"{BASE_URL}/api/unread", params={"player_id": JOSH})
            assert r2.status_code == 200

            # Should have inserted rsvp_reminder marker for (event, josh, slot*)
            markers = loop.run_until_complete(mongo.system_events.find(
                {"key": {"$regex": f"^rsvp_reminder:{eid}:{JOSH}:slot"}}
            ).to_list(20))
            assert len(markers) >= 1, "expected atomic rsvp_reminder marker to be inserted"
            initial_count = len(markers)

            # Second call within same 5-min debounce → no new scan
            scan_before = loop.run_until_complete(mongo.system_events.count_documents(
                {"key": {"$regex": "^reminder_scan:"}}
            ))
            r3 = api.get(f"{BASE_URL}/api/unread", params={"player_id": JOSH})
            assert r3.status_code == 200
            scan_after = loop.run_until_complete(mongo.system_events.count_documents(
                {"key": {"$regex": "^reminder_scan:"}}
            ))
            # scan marker should exist (>=1) and stable
            assert scan_before >= 1
            assert scan_after == scan_before

            # marker count for (event,player) unchanged (same slot)
            markers2 = loop.run_until_complete(mongo.system_events.find(
                {"key": {"$regex": f"^rsvp_reminder:{eid}:{JOSH}:slot"}}
            ).to_list(20))
            assert len(markers2) == initial_count

            # Now insert answered attendance and clear debounce marker to force a fresh scan
            loop.run_until_complete(mongo.attendance.update_one(
                {"event_id": eid, "player_id": JOSH},
                {"$set": {"event_id": eid, "player_id": JOSH, "status": "zugesagt"}},
                upsert=True,
            ))
            loop.run_until_complete(mongo.system_events.delete_many({"key": {"$regex": "^reminder_scan:"}}))
            # also delete existing markers so we can prove no NEW one is added
            loop.run_until_complete(mongo.system_events.delete_many(
                {"key": {"$regex": f"^rsvp_reminder:{eid}:{JOSH}:"}}
            ))

            r4 = api.get(f"{BASE_URL}/api/unread", params={"player_id": JOSH})
            assert r4.status_code == 200
            markers3 = loop.run_until_complete(mongo.system_events.find(
                {"key": {"$regex": f"^rsvp_reminder:{eid}:{JOSH}:slot"}}
            ).to_list(20))
            assert markers3 == [], "answered player must not receive new marker"
        finally:
            api.post(f"{BASE_URL}/api/events/{eid}/cancel")
            loop.run_until_complete(_clear_markers(mongo))

    def test_reminder_scope_out_of_bounds(self, api, mongo):
        """Events >48h in future should not generate a marker."""
        loop = asyncio.get_event_loop()
        loop.run_until_complete(_clear_markers(mongo))
        target = datetime.now(timezone.utc) + timedelta(days=5)  # far in future
        r = api.post(f"{BASE_URL}/api/events", json={
            "type": "Spiel", "date": target.strftime("%Y-%m-%d"),
            "time": "12:00", "opponent": "FarFuture", "home_game": False, "location": "H",
        })
        assert r.status_code == 200
        eid = r.json()["id"]
        try:
            loop.run_until_complete(mongo.attendance.delete_many({"event_id": eid}))
            api.get(f"{BASE_URL}/api/unread", params={"player_id": JOSH})
            markers = loop.run_until_complete(mongo.system_events.count_documents(
                {"key": {"$regex": f"^rsvp_reminder:{eid}:"}}
            ))
            assert markers == 0, "event >48h must not generate reminder markers"
        finally:
            api.post(f"{BASE_URL}/api/events/{eid}/cancel")
            loop.run_until_complete(_clear_markers(mongo))


# ---- 3) Thumbnail regression -------------------------------------------------
class TestThumbnailRegression:
    def test_josh_avatar_still_set(self, api):
        r = api.get(f"{BASE_URL}/api/players")
        assert r.status_code == 200
        josh = next((p for p in r.json() if p["id"] == JOSH), None)
        assert josh is not None
        assert josh.get("avatar_file_id"), "avatar_file_id should still be set from previous iteration"

    def test_thumbnail_endpoint(self, api):
        r = api.get(f"{BASE_URL}/api/players")
        josh = next(p for p in r.json() if p["id"] == JOSH)
        fid = josh["avatar_file_id"]
        raw = api.get(f"{BASE_URL}/api/files/{fid}/raw")
        assert raw.status_code == 200
        raw_size = len(raw.content)

        thumb = api.get(f"{BASE_URL}/api/files/{fid}/thumbnail")
        assert thumb.status_code == 200, thumb.text
        assert thumb.headers.get("content-type", "").startswith("image/"), thumb.headers
        assert len(thumb.content) <= raw_size or len(thumb.content) < 10000  # tiny image edge case
