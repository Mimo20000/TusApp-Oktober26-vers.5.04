"""Iteration 16 — BWHV league endpoints + coach-set attendance guards."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://mobile-first-stage-71.preview.emergentagent.com").rstrip("/")

JOSH = ("josh-ankermann", "pw12345")
SASCHA = ("sascha-grins", "test1234")


def _login(pid, pw):
    r = requests.post(f"{BASE_URL}/api/players/{pid}/login", json={"password": pw}, timeout=15)
    assert r.status_code == 200, f"login failed for {pid}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# use sascha as the target player; josh is the acting coach
TARGET_PID = "sascha-grins"


@pytest.fixture(scope="module")
def josh_token():
    return _login(*JOSH)


@pytest.fixture(scope="module")
def sascha_token():
    return _login(*SASCHA)


# ─── BWHV endpoints ──────────────────────────────────────────────────────

class TestBwhvTeams:
    def test_teams_envelope(self):
        r = requests.get(f"{BASE_URL}/api/bwhv/teams", timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "club" in j and "teams" in j
        assert isinstance(j["teams"], list) and len(j["teams"]) > 0
        for t in j["teams"]:
            assert "class_id" in t and "label" in t and "is_default" in t
        defaults = [t for t in j["teams"] if t["is_default"]]
        assert len(defaults) == 1, f"expected exactly one default, got {len(defaults)}"
        assert defaults[0]["class_id"] == "166871", f"default should be 166871, got {defaults[0]['class_id']}"


class TestBwhvClass:
    def test_class_166871(self):
        r = requests.get(f"{BASE_URL}/api/bwhv/class/166871", timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "class_name" in j and "team_name" in j and "table" in j and "games" in j
        # Standings has exactly one is_own=true (TuS Oberhausen 2)
        own_rows = [row for row in j["table"] if row.get("is_own")]
        assert len(own_rows) == 1, f"expected exactly one is_own row, got {len(own_rows)}"
        assert "oberhausen" in own_rows[0]["team"].lower()
        # Every game has a TuS Oberhausen participant
        assert len(j["games"]) > 0
        for g in j["games"]:
            assert ("oberhausen" in g["home"].lower()) or ("oberhausen" in g["guest"].lower()), f"non-TuS game: {g}"
            if g["played"]:
                assert isinstance(g["home_goals"], int) and isinstance(g["guest_goals"], int)
            else:
                assert g["played"] is False


# ─── Coach-set attendance ────────────────────────────────────────────────

@pytest.fixture(scope="module")
def past_event(josh_token):
    r = requests.get(f"{BASE_URL}/api/events", headers=_auth(josh_token), timeout=15)
    assert r.status_code == 200, r.text
    import datetime as _dt
    today = _dt.date.today().isoformat()
    past = [e for e in r.json() if e.get("type") in ("Spiel", "Training")
            and not e.get("cancelled") and (e.get("date") or "") < today]
    assert past, "no past event in DB"
    past.sort(key=lambda x: x["date"], reverse=True)
    return past[0]


@pytest.fixture(scope="module")
def future_event(josh_token):
    r = requests.get(f"{BASE_URL}/api/events", headers=_auth(josh_token), timeout=15)
    assert r.status_code == 200, r.text
    import datetime as _dt
    today = _dt.date.today().isoformat()
    fut = [e for e in r.json() if (e.get("date") or "") > today and not e.get("cancelled")]
    assert fut, "no future event in DB"
    fut.sort(key=lambda x: x["date"])
    return fut[0]


class TestCoachSetGuards:
    def test_no_auth_401(self, past_event):
        r = requests.post(f"{BASE_URL}/api/attendance/coach-set",
                          json={"event_id": past_event["id"], "player_id": TARGET_PID, "status": "zugesagt"},
                          timeout=15)
        assert r.status_code == 401, r.status_code

    def test_non_coach_403(self, sascha_token, past_event):
        r = requests.post(f"{BASE_URL}/api/attendance/coach-set",
                          json={"event_id": past_event["id"], "player_id": "josh-ankermann", "status": "zugesagt"},
                          headers=_auth(sascha_token), timeout=15)
        assert r.status_code == 403, f"{r.status_code} {r.text}"

    def test_future_event_400(self, josh_token, future_event):
        r = requests.post(f"{BASE_URL}/api/attendance/coach-set",
                          json={"event_id": future_event["id"], "player_id": TARGET_PID, "status": "zugesagt"},
                          headers=_auth(josh_token), timeout=15)
        assert r.status_code == 400, f"{r.status_code} {r.text}"


class TestCoachSetFlows:
    def _get_att(self, event_id, player_id):
        r = requests.get(f"{BASE_URL}/api/attendance",
                         headers=_auth(_login(*JOSH)), timeout=15)
        assert r.status_code == 200
        for a in r.json():
            if a.get("event_id") == event_id and a.get("player_id") == player_id:
                return a
        return None

    def test_zugesagt(self, josh_token, past_event):
        r = requests.post(f"{BASE_URL}/api/attendance/coach-set",
                          json={"event_id": past_event["id"], "player_id": TARGET_PID, "status": "zugesagt"},
                          headers=_auth(josh_token), timeout=15)
        assert r.status_code == 200, r.text
        a = self._get_att(past_event["id"], TARGET_PID)
        assert a and a.get("status") == "zugesagt" and (a.get("reason") in (None, ""))

    def test_abgesagt_with_reason(self, josh_token, past_event):
        r = requests.post(f"{BASE_URL}/api/attendance/coach-set",
                          json={"event_id": past_event["id"], "player_id": TARGET_PID, "status": "abgesagt",
                                "reason": "Krank"},
                          headers=_auth(josh_token), timeout=15)
        assert r.status_code == 200, r.text
        a = self._get_att(past_event["id"], TARGET_PID)
        assert a and a["status"] == "abgesagt" and a["reason"] == "Krank"

    def test_abgesagt_no_reason(self, josh_token, past_event):
        r = requests.post(f"{BASE_URL}/api/attendance/coach-set",
                          json={"event_id": past_event["id"], "player_id": TARGET_PID, "status": "abgesagt"},
                          headers=_auth(josh_token), timeout=15)
        assert r.status_code == 200, r.text
        a = self._get_att(past_event["id"], TARGET_PID)
        # reason optional -> empty / None stored, status abgesagt
        assert a and a["status"] == "abgesagt"
        assert (a.get("reason") in (None, ""))

    def test_switch_to_zugesagt_clears_reason(self, josh_token, past_event):
        # first ensure there's a reason set
        requests.post(f"{BASE_URL}/api/attendance/coach-set",
                      json={"event_id": past_event["id"], "player_id": TARGET_PID, "status": "abgesagt",
                            "reason": "Urlaub"},
                      headers=_auth(josh_token), timeout=15)
        r = requests.post(f"{BASE_URL}/api/attendance/coach-set",
                          json={"event_id": past_event["id"], "player_id": TARGET_PID, "status": "zugesagt"},
                          headers=_auth(josh_token), timeout=15)
        assert r.status_code == 200, r.text
        a = self._get_att(past_event["id"], TARGET_PID)
        assert a and a["status"] == "zugesagt" and a.get("reason") is None

    def test_null_clears_to_open(self, josh_token, past_event):
        r = requests.post(f"{BASE_URL}/api/attendance/coach-set",
                          json={"event_id": past_event["id"], "player_id": TARGET_PID, "status": None},
                          headers=_auth(josh_token), timeout=15)
        assert r.status_code == 200, r.text
        a = self._get_att(past_event["id"], TARGET_PID)
        assert a and a.get("status") is None and a.get("reason") is None
