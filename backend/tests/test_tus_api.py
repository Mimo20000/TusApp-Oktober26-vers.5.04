"""Backend API regression tests for TuS Oberhausen II handball team app.

Covers: players, events (GET+POST), attendance, RSVP, driving, beer, stats,
holidays, league-table, chat (messages, conversations, unread, push register),
password auth (set-password / login).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- Players ----------
class TestPlayers:
    def test_get_players_18_and_no_hash_leak(self, s):
        r = s.get(f"{API}/players", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) == 18
        ids = {p["id"] for p in data}
        assert {"lukas-schwarz", "christoph-moser", "filip-la", "michael-moser"} <= ids
        for p in data:
            assert "_id" not in p
            assert "password_hash" not in p  # never leak hash
            assert "has_password" in p


# ---------- Events ----------
class TestEvents:
    def test_events_sorted_and_thursday_trainings_19_00(self, s):
        r = s.get(f"{API}/events", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 26
        spiele = [e for e in data if e["type"] == "Spiel"]
        trainings = [e for e in data if e["type"] == "Training"]
        assert len(spiele) >= 12
        # Trainings must all be Thursday @ 19:00
        import datetime as dt
        for t in trainings:
            d = dt.date.fromisoformat(t["date"])
            assert d.weekday() == 3, f"Training {t['id']} on {t['date']} not Thursday"
            assert t["time"] == "19:00"
        keys = [(e["date"], e["time"]) for e in data]
        assert keys == sorted(keys)

    def test_create_event_treffen_and_persist(self, s):
        payload = {"type": "Treffen", "date": "2027-06-01", "time": "20:00", "location": "Vereinsheim"}
        r = s.post(f"{API}/events", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        ev = r.json()
        assert ev["type"] == "Treffen" and ev["date"] == "2027-06-01" and ev["time"] == "20:00"
        eid = ev["id"]
        # Verify persistence
        all_ev = s.get(f"{API}/events", timeout=15).json()
        assert any(e["id"] == eid for e in all_ev)

    def test_create_event_invalid_type_400(self, s):
        r = s.post(f"{API}/events", json={"type": "Party", "date": "2027-01-01", "time": "20:00"}, timeout=15)
        assert r.status_code == 400


# ---------- Attendance / RSVP ----------
class TestAttendanceRsvp:
    def test_attendance_list(self, s):
        r = s.get(f"{API}/attendance", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_rsvp_upsert(self, s):
        p = {"event_id": "T2", "player_id": "christoph-moser", "status": "zugesagt"}
        r = s.post(f"{API}/rsvp", json=p, timeout=15)
        assert r.status_code == 200 and r.json()["status"] == "zugesagt"
        att = s.get(f"{API}/attendance", timeout=15).json()
        m = [a for a in att if a["event_id"] == "T2" and a["player_id"] == "christoph-moser"]
        assert len(m) == 1 and m[0]["status"] == "zugesagt"
        p["status"] = "abgesagt"
        r2 = s.post(f"{API}/rsvp", json=p, timeout=15)
        assert r2.status_code == 200

    def test_rsvp_invalid_400(self, s):
        r = s.post(f"{API}/rsvp", json={"event_id": "T1", "player_id": "lukas-schwarz", "status": "x"}, timeout=15)
        assert r.status_code == 400

    def test_driving_toggle_persists(self, s):
        pid = "lukas-schwarz"
        r = s.post(f"{API}/driving", json={"event_id": "T1", "player_id": pid, "driving": True}, timeout=15)
        assert r.status_code == 200
        att = s.get(f"{API}/attendance", timeout=15).json()
        m = [a for a in att if a["event_id"] == "T1" and a["player_id"] == pid]
        assert m and m[0].get("driving") is True

    def test_beer_toggle_persists(self, s):
        # Find first training id
        events = s.get(f"{API}/events", timeout=15).json()
        tr = next(e for e in events if e["type"] == "Training")
        r = s.post(f"{API}/beer", json={"event_id": tr["id"], "player_id": "filip-la", "beer": True}, timeout=15)
        assert r.status_code == 200
        att = s.get(f"{API}/attendance", timeout=15).json()
        m = [a for a in att if a["event_id"] == tr["id"] and a["player_id"] == "filip-la"]
        assert m and m[0].get("beer") is True


# ---------- Stats ----------
class TestStats:
    def test_stats(self, s):
        r = s.get(f"{API}/stats", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["games_count"] >= 12
        assert d["trainings_count"] >= 14
        players = d["players"]
        assert len(players) == 18
        rates = [p["overall_rate"] for p in players]
        assert rates == sorted(rates, reverse=True)
        for k in ("id", "name", "games_rate", "trainings_rate", "overall_rate"):
            assert k in players[0]


# ---------- Holidays ----------
class TestHolidays:
    def test_holidays_bw(self, s):
        r = s.get(f"{API}/holidays", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d, list) and len(d) > 20
        kinds = {x["kind"] for x in d}
        assert "feiertag" in kinds and "ferien" in kinds
        names = {x["name"] for x in d}
        assert "Karfreitag" in names
        assert "Sommerferien" in names
        # sorted by date
        dates = [x["date"] for x in d]
        assert dates == sorted(dates)


# ---------- League table ----------
class TestLeague:
    def test_league_table_shape(self, s):
        r = s.get(f"{API}/league-table", timeout=20)
        # Upstream handball.net can 502 rarely; treat that as skip
        if r.status_code == 502:
            pytest.skip("Upstream handball.net not reachable")
        assert r.status_code == 200
        d = r.json()
        assert "rows" in d and "tournament" in d
        assert isinstance(d["rows"], list)


# ---------- Chat ----------
class TestChat:
    def test_send_team_message_and_get(self, s):
        text = f"TEST_{uuid.uuid4().hex[:6]}"
        r = s.post(f"{API}/messages", json={
            "conversation_id": "team", "scope": "team",
            "sender_id": "lukas-schwarz", "text": text,
        }, timeout=15)
        assert r.status_code == 200
        msg = r.json()
        assert msg["text"] == text and msg["sender_name"]
        # GET
        got = s.get(f"{API}/messages?conversation_id=team", timeout=15).json()
        assert any(m["text"] == text for m in got)

    def test_empty_message_400(self, s):
        r = s.post(f"{API}/messages", json={
            "conversation_id": "team", "scope": "team",
            "sender_id": "lukas-schwarz", "text": "   ",
        }, timeout=15)
        assert r.status_code == 400

    def test_direct_message_flow_and_unread(self, s):
        a, b = "lukas-schwarz", "christoph-moser"
        cid = "d:" + "__".join(sorted([a, b]))
        text = f"TEST_D_{uuid.uuid4().hex[:6]}"
        # a sends -> b should have unread
        s.post(f"{API}/messages", json={
            "conversation_id": cid, "scope": "direct",
            "sender_id": a, "text": text,
        }, timeout=15)
        u = s.get(f"{API}/unread?player_id={b}", timeout=15).json()
        assert u["total"] >= 1
        # b reads
        r = s.post(f"{API}/messages/read", json={"player_id": b, "conversation_id": cid}, timeout=15)
        assert r.status_code == 200
        # b's unread for cid now 0 (team may still be >0)
        conv = s.get(f"{API}/conversations?player_id={b}", timeout=15).json()
        my_direct = next(d for d in conv["directs"] if d["player_id"] == a)
        assert my_direct["unread"] == 0

    def test_conversations_shape(self, s):
        d = s.get(f"{API}/conversations?player_id=filip-la", timeout=15).json()
        assert "team" in d and "directs" in d
        assert len(d["directs"]) == 17

    def test_push_register(self, s):
        r = s.post(f"{API}/push/register", json={"player_id": "filip-la", "token": "ExpoPushToken[TEST]"}, timeout=15)
        assert r.status_code == 200
        r2 = s.post(f"{API}/push/register", json={"player_id": "nope-nobody", "token": "x"}, timeout=15)
        assert r2.status_code == 404


# ---------- Auth (password) ----------
class TestAuth:
    def test_login_filip_known(self, s):
        r = s.post(f"{API}/players/filip-la/login", json={"password": "test123"}, timeout=15)
        assert r.status_code == 200, r.text
        assert "access_token" in r.json()

    def test_login_wrong_password_401(self, s):
        r = s.post(f"{API}/players/filip-la/login", json={"password": "wrong-pass"}, timeout=15)
        assert r.status_code == 401

    def test_set_password_then_second_time_400(self, s):
        # Use a player unlikely used elsewhere. Try josh-ankermann (may or may not be set).
        pid = "josh-ankermann"
        players = s.get(f"{API}/players", timeout=15).json()
        josh = next(p for p in players if p["id"] == pid)
        if josh["has_password"]:
            # Already set from previous run - second call must be 400
            r = s.post(f"{API}/players/{pid}/set-password", json={"password": "pw12345"}, timeout=15)
            assert r.status_code == 400
        else:
            r = s.post(f"{API}/players/{pid}/set-password", json={"password": "pw12345"}, timeout=15)
            assert r.status_code == 200
            assert "access_token" in r.json()
            # confirm has_password now true
            players2 = s.get(f"{API}/players", timeout=15).json()
            j2 = next(p for p in players2 if p["id"] == pid)
            assert j2["has_password"] is True
            # 2nd time -> 400
            r2 = s.post(f"{API}/players/{pid}/set-password", json={"password": "pw12345"}, timeout=15)
            assert r2.status_code == 400

    def test_set_password_too_short_400(self, s):
        # unknown-player will 404 first; use a fresh id that doesn't exist -> 404
        # Use christoph-moser which may have hash; if so we get 400 (already set) not "too short"
        players = s.get(f"{API}/players", timeout=15).json()
        target = next((p for p in players if not p["has_password"] and p["id"] != "josh-ankermann"), None)
        if not target:
            pytest.skip("No player without password to test length validation")
        r = s.post(f"{API}/players/{target['id']}/set-password", json={"password": "x"}, timeout=15)
        assert r.status_code == 400


# ---------- Contact ----------
class TestContact:
    def test_patch_contact(self, s):
        r = s.patch(f"{API}/players/lukas-schwarz/contact",
                    json={"email": "TEST_lukas@example.com", "birthdate": "1995-01-15"}, timeout=15)
        assert r.status_code == 200
        players = s.get(f"{API}/players", timeout=15).json()
        p = next(x for x in players if x["id"] == "lukas-schwarz")
        assert p["email"] == "TEST_lukas@example.com"
        assert p["birthdate"] == "1995-01-15"

    def test_patch_status_admin(self, s):
        r = s.patch(f"{API}/players/tim-wild/status", json={"status": "Aktiv"}, timeout=15)
        assert r.status_code == 200
        r2 = s.patch(f"{API}/players/tim-wild/status", json={"status": "Bogus"}, timeout=15)
        assert r2.status_code == 400
