"""Iteration 15 — Bierwart cash-box management endpoints:
  * GET /api/payments now returns per_player_open, monthly_open, manageable_cashboxes
  * POST /api/payments with payer_id (on-behalf) — Bierwart OK, non-recipient 403
  * PATCH /api/payments/{id} status open<->completed — Bierwart OK, non-recipient 403
  * DELETE /api/payments/{id} — Bierwart OK, non-recipient 403
  * GET /api/payments/my-open — accessible to normal players; correct grouping.
  * GET /api/stats — verify each player has numeric streak, and scope toggle.
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL missing from env")

API = f"{BASE_URL}/api"


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


# Track payments we create so we can clean up on teardown
_created_ids: list[str] = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup(sascha_headers):
    yield
    for pid in _created_ids:
        try:
            requests.delete(f"{API}/payments/{pid}", headers=sascha_headers, timeout=10)
        except Exception:
            pass


# ─── /api/payments response envelope ─────────────────────────────────────────

class TestPaymentsEnvelope:
    def test_sascha_gets_new_keys(self, sascha_headers):
        r = requests.get(f"{API}/payments", headers=sascha_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("payments", "sums", "monthly_open", "per_player_open", "manageable_cashboxes"):
            assert k in d, f"missing key {k}"
        assert isinstance(d["per_player_open"], list)
        assert isinstance(d["manageable_cashboxes"], list)

    def test_manageable_for_sascha_is_bierwart_only(self, sascha_headers):
        d = requests.get(f"{API}/payments", headers=sascha_headers, timeout=15).json()
        assert d["manageable_cashboxes"] == ["bierwart"], (
            f"expected ['bierwart'], got {d['manageable_cashboxes']}"
        )

    def test_per_player_open_shape(self, sascha_headers):
        d = requests.get(f"{API}/payments", headers=sascha_headers, timeout=15).json()
        for row in d["per_player_open"]:
            assert set(("payer_id", "payer_name", "total", "count")).issubset(row.keys())
            assert isinstance(row["count"], int) and row["count"] >= 1
            assert isinstance(row["total"], (int, float)) and row["total"] >= 0

    def test_per_player_open_matches_raw_open_payments(self, sascha_headers):
        d = requests.get(f"{API}/payments", headers=sascha_headers, timeout=15).json()
        expected: dict = {}
        for p in d["payments"]:
            if p.get("status") != "open":
                continue
            pid = p.get("payer_id")
            e = expected.setdefault(pid, {"count": 0, "total": 0.0})
            e["count"] += 1
            if p.get("amount"):
                e["total"] += float(p["amount"])
        got = {r["payer_id"]: {"count": r["count"], "total": r["total"]} for r in d["per_player_open"]}
        assert set(got.keys()) == set(expected.keys())
        for k, v in expected.items():
            assert got[k]["count"] == v["count"]
            assert abs(got[k]["total"] - v["total"]) < 1e-6


# ─── my-open for normal players ──────────────────────────────────────────────

class TestMyOpen:
    def test_josh_can_fetch(self, josh_headers):
        r = requests.get(f"{API}/payments/my-open", headers=josh_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "by_cashbox" in d and "total" in d
        assert isinstance(d["by_cashbox"], list)
        assert isinstance(d["total"], (int, float))
        for row in d["by_cashbox"]:
            assert set(("cashbox_key", "total", "count")).issubset(row.keys())
            assert row["count"] >= 1

    def test_my_open_requires_auth(self):
        r = requests.get(f"{API}/payments/my-open", timeout=15)
        assert r.status_code in (401, 403)


# ─── POST /api/payments — on-behalf RBAC ────────────────────────────────────

class TestCreateOnBehalf:
    def test_sascha_can_add_for_josh_in_bierwart(self, sascha_headers):
        body = {
            "cashbox_key": "bierwart",
            "payer_id": "josh-ankermann",
            "amount": 1.5,
            "note": "TEST_iter15 on-behalf",
        }
        r = requests.post(f"{API}/payments", headers=sascha_headers, json=body, timeout=15)
        assert r.status_code == 200, r.text
        pay = r.json()
        assert pay["payer_id"] == "josh-ankermann"
        assert pay["cashbox_key"] == "bierwart"
        assert pay["status"] == "open"
        assert pay["amount"] == 1.5
        _created_ids.append(pay["id"])

    def test_sascha_can_add_for_self(self, sascha_headers):
        body = {"cashbox_key": "bierwart", "amount": 0.5, "note": "TEST_iter15 self"}
        r = requests.post(f"{API}/payments", headers=sascha_headers, json=body, timeout=15)
        assert r.status_code == 200
        pay = r.json()
        assert pay["payer_id"] == "sascha-grins"
        _created_ids.append(pay["id"])

    def test_josh_cannot_add_for_someone_else(self, josh_headers):
        body = {
            "cashbox_key": "bierwart",
            "payer_id": "sascha-grins",
            "amount": 2.0,
            "note": "TEST_iter15 forbidden",
        }
        r = requests.post(f"{API}/payments", headers=josh_headers, json=body, timeout=15)
        assert r.status_code == 403, r.text

    def test_josh_can_add_for_self(self, josh_headers):
        body = {"cashbox_key": "bierwart", "amount": 0.75, "note": "TEST_iter15 josh self"}
        r = requests.post(f"{API}/payments", headers=josh_headers, json=body, timeout=15)
        assert r.status_code == 200
        pay = r.json()
        assert pay["payer_id"] == "josh-ankermann"
        _created_ids.append(pay["id"])


# ─── PATCH status / DELETE — RBAC + persistence ──────────────────────────────

class TestPatchDelete:
    @pytest.fixture(scope="class")
    def entry_id(self, sascha_headers):
        body = {
            "cashbox_key": "bierwart",
            "payer_id": "josh-ankermann",
            "amount": 3.0,
            "note": "TEST_iter15 for patch",
        }
        r = requests.post(f"{API}/payments", headers=sascha_headers, json=body, timeout=15)
        assert r.status_code == 200
        pid = r.json()["id"]
        _created_ids.append(pid)
        return pid

    def test_josh_patch_forbidden(self, entry_id, josh_headers):
        r = requests.patch(
            f"{API}/payments/{entry_id}",
            headers=josh_headers,
            json={"status": "completed"},
            timeout=15,
        )
        assert r.status_code == 403

    def test_sascha_patch_to_completed_sets_paid_by(self, entry_id, sascha_headers):
        r = requests.patch(
            f"{API}/payments/{entry_id}",
            headers=sascha_headers,
            json={"status": "completed"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "completed"
        assert d.get("paid_by") == "sascha-grins"
        assert d.get("paid_at")
        # Verify persistence via list endpoint
        listed = requests.get(f"{API}/payments", headers=sascha_headers, timeout=15).json()
        row = next((p for p in listed["payments"] if p["id"] == entry_id), None)
        assert row and row["status"] == "completed" and row.get("paid_by") == "sascha-grins"

    def test_sascha_patch_back_to_open_clears_paid_by(self, entry_id, sascha_headers):
        r = requests.patch(
            f"{API}/payments/{entry_id}",
            headers=sascha_headers,
            json={"status": "open"},
            timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "open"
        assert d.get("paid_by") in (None, "")
        assert d.get("paid_at") in (None, "")

    def test_invalid_status_rejected(self, entry_id, sascha_headers):
        r = requests.patch(
            f"{API}/payments/{entry_id}",
            headers=sascha_headers,
            json={"status": "banana"},
            timeout=15,
        )
        assert r.status_code == 400

    def test_josh_delete_forbidden(self, entry_id, josh_headers):
        r = requests.delete(f"{API}/payments/{entry_id}", headers=josh_headers, timeout=15)
        assert r.status_code == 403

    def test_sascha_delete_ok(self, entry_id, sascha_headers):
        r = requests.delete(f"{API}/payments/{entry_id}", headers=sascha_headers, timeout=15)
        assert r.status_code == 200
        # Verify gone
        listed = requests.get(f"{API}/payments", headers=sascha_headers, timeout=15).json()
        assert not any(p["id"] == entry_id for p in listed["payments"])


# ─── /api/stats — streak + scope toggle sanity checks ────────────────────────

class TestStatsBrief:
    def test_streak_field_present(self, josh_headers):
        d = requests.get(f"{API}/stats?scope=all", headers=josh_headers, timeout=15).json()
        assert d.get("scope") == "all"
        for p in d["players"]:
            assert "streak" in p and isinstance(p["streak"], int) and p["streak"] >= 0

    def test_scope_season(self, josh_headers):
        d = requests.get(f"{API}/stats?scope=season", headers=josh_headers, timeout=15).json()
        assert d["scope"] == "season"
        assert isinstance(d["games_count"], int)
        assert isinstance(d["trainings_count"], int)
