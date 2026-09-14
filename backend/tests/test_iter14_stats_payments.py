"""Iteration 14 — verify:
  1. GET /api/stats (default | scope=all | scope=season) excludes future events,
     provides per-player streak, past_rate/past_confirmed/past_total, beer_count
     over past-only events, and response-level scope/games_count/trainings_count.
  2. GET /api/payments now returns `monthly_open` aggregated over OPEN payments,
     sorted by month desc, with German month_label.
"""
import os
from datetime import datetime

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL missing from env")

API = f"{BASE_URL}/api"
TODAY = datetime.now().strftime("%Y-%m-%d")
CUR_YEAR = f"{datetime.now().year:04d}"


def _login(pid: str, pw: str) -> str:
    r = requests.post(f"{API}/players/{pid}/login", json={"password": pw}, timeout=15)
    assert r.status_code == 200, f"login {pid} -> {r.status_code}: {r.text}"
    tok = r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def josh_headers():
    return {"Authorization": f"Bearer {_login('josh-ankermann', 'pw12345')}"}


@pytest.fixture(scope="module")
def sascha_headers():
    return {"Authorization": f"Bearer {_login('sascha-grins', 'test1234')}"}


@pytest.fixture(scope="module")
def all_events(josh_headers):
    r = requests.get(f"{API}/events", headers=josh_headers, timeout=15)
    assert r.status_code == 200
    return r.json()


# ─── Stats ────────────────────────────────────────────────────────────────────

class TestStats:
    def test_stats_default_shape(self, josh_headers):
        r = requests.get(f"{API}/stats", headers=josh_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "players" in d and isinstance(d["players"], list) and len(d["players"]) > 0
        # response-level scope + counts
        assert d.get("scope") == "all"
        assert "games_count" in d and "trainings_count" in d
        assert isinstance(d["games_count"], int)
        assert isinstance(d["trainings_count"], int)
        # per-player required keys
        p = d["players"][0]
        for k in [
            "id", "name", "games_total", "games_confirmed", "trainings_total",
            "trainings_confirmed", "overall_total", "overall_confirmed",
            "past_confirmed", "past_declined", "past_total", "past_rate",
            "beer_count", "driving_count", "streak",
        ]:
            assert k in p, f"missing key {k}"
        assert isinstance(p["streak"], int)

    def test_scope_all_matches_default(self, josh_headers):
        r_def = requests.get(f"{API}/stats", headers=josh_headers, timeout=15).json()
        r_all = requests.get(f"{API}/stats?scope=all", headers=josh_headers, timeout=15).json()
        assert r_def["games_count"] == r_all["games_count"]
        assert r_def["trainings_count"] == r_all["trainings_count"]
        assert r_all["scope"] == "all"

    def test_future_events_excluded(self, josh_headers, all_events):
        # Ground truth: count past games/trainings ourselves
        past_games = [e for e in all_events if e["type"] == "Spiel" and e.get("date", "") <= TODAY]
        past_trainings = [e for e in all_events if e["type"] == "Training" and e.get("date", "") <= TODAY]
        d = requests.get(f"{API}/stats?scope=all", headers=josh_headers, timeout=15).json()
        assert d["games_count"] == len(past_games), (
            f"games_count={d['games_count']} but past_games={len(past_games)}"
        )
        assert d["trainings_count"] == len(past_trainings), (
            f"trainings_count={d['trainings_count']} but past_trainings={len(past_trainings)}"
        )
        # every player's totals must match too
        for p in d["players"]:
            assert p["games_total"] == len(past_games)
            assert p["trainings_total"] == len(past_trainings)
            assert p["overall_total"] == len(past_games) + len(past_trainings)

    def test_scope_season_narrows_to_current_year(self, josh_headers, all_events):
        past_year_games = [
            e for e in all_events
            if e["type"] == "Spiel" and e.get("date", "") <= TODAY
            and e.get("date", "").startswith(CUR_YEAR)
        ]
        past_year_trainings = [
            e for e in all_events
            if e["type"] == "Training" and e.get("date", "") <= TODAY
            and e.get("date", "").startswith(CUR_YEAR)
        ]
        d = requests.get(f"{API}/stats?scope=season", headers=josh_headers, timeout=15).json()
        assert d["scope"] == "season"
        assert d["games_count"] == len(past_year_games)
        assert d["trainings_count"] == len(past_year_trainings)
        # scope=season <= scope=all
        d_all = requests.get(f"{API}/stats?scope=all", headers=josh_headers, timeout=15).json()
        assert d["games_count"] <= d_all["games_count"]
        assert d["trainings_count"] <= d_all["trainings_count"]

    def test_past_rate_uses_explicit_answers_only(self, josh_headers):
        d = requests.get(f"{API}/stats?scope=all", headers=josh_headers, timeout=15).json()
        for p in d["players"]:
            assert p["past_total"] == p["past_confirmed"] + p["past_declined"]
            # explicit-only ⇒ past_total ≤ overall_total (unanswered excluded)
            assert p["past_total"] <= p["overall_total"], (
                f"{p['name']}: past_total={p['past_total']} > overall_total={p['overall_total']}"
            )
            if p["past_total"] == 0:
                assert p["past_rate"] == 0
            else:
                expected = round(100 * p["past_confirmed"] / p["past_total"])
                assert p["past_rate"] == expected

    def test_streak_non_negative_and_capped(self, josh_headers):
        d = requests.get(f"{API}/stats?scope=all", headers=josh_headers, timeout=15).json()
        max_past = d["games_count"] + d["trainings_count"]
        for p in d["players"]:
            s = p["streak"]
            assert isinstance(s, int) and s >= 0
            assert s <= max_past

    def test_josh_streak_present(self, josh_headers):
        d = requests.get(f"{API}/stats?scope=all", headers=josh_headers, timeout=15).json()
        josh = next(p for p in d["players"] if p["id"] == "josh-ankermann")
        assert josh["streak"] >= 0

    def test_beer_and_drive_non_negative(self, josh_headers):
        d = requests.get(f"{API}/stats?scope=all", headers=josh_headers, timeout=15).json()
        for p in d["players"]:
            assert p["beer_count"] >= 0
            assert p["driving_count"] >= 0
            # bounded by past events in scope
            assert p["beer_count"] <= d["games_count"] + d["trainings_count"]
            assert p["driving_count"] <= d["games_count"]

    def test_stats_requires_auth(self):
        r = requests.get(f"{API}/stats", timeout=15)
        assert r.status_code in (401, 403)


# ─── Payments monthly_open ───────────────────────────────────────────────────

class TestPaymentsMonthly:
    def test_sascha_can_read_payments(self, sascha_headers):
        r = requests.get(f"{API}/payments", headers=sascha_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "payments" in d and "sums" in d and "monthly_open" in d
        assert isinstance(d["monthly_open"], list)

    def test_monthly_open_shape_and_sort(self, sascha_headers):
        d = requests.get(f"{API}/payments", headers=sascha_headers, timeout=15).json()
        months = d["monthly_open"]
        # sorted desc
        assert months == sorted(months, key=lambda m: m["month"], reverse=True)
        for m in months:
            assert set(["month", "month_label", "total", "count"]).issubset(m.keys())
            assert len(m["month"]) == 7 and m["month"][4] == "-"
            year, mm = m["month"].split("-")
            de = [
                "Januar", "Februar", "März", "April", "Mai", "Juni",
                "Juli", "August", "September", "Oktober", "November", "Dezember",
            ]
            assert m["month_label"] == f"{de[int(mm) - 1]} {year}"
            assert m["count"] >= 1
            assert isinstance(m["total"], (int, float)) and m["total"] >= 0

    def test_monthly_open_excludes_completed(self, sascha_headers):
        d = requests.get(f"{API}/payments", headers=sascha_headers, timeout=15).json()
        # Ground truth from raw payment list
        expected = {}
        for p in d["payments"]:
            if p.get("status") != "open":
                continue
            mo = (p.get("created_at") or "")[:7]
            if len(mo) != 7:
                continue
            expected.setdefault(mo, {"count": 0, "total": 0.0})
            expected[mo]["count"] += 1
            if p.get("amount"):
                expected[mo]["total"] += float(p["amount"])
        got = {m["month"]: {"count": m["count"], "total": m["total"]} for m in d["monthly_open"]}
        assert set(got.keys()) == set(expected.keys()), (
            f"months mismatch got={list(got)} expected={list(expected)}"
        )
        for mo, ex in expected.items():
            assert got[mo]["count"] == ex["count"], f"{mo} count mismatch"
            # tolerate float rounding
            assert abs(got[mo]["total"] - ex["total"]) < 1e-6, f"{mo} total mismatch"

    def test_josh_forbidden(self, josh_headers):
        r = requests.get(f"{API}/payments", headers=josh_headers, timeout=15)
        assert r.status_code == 403
