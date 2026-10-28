"""Iteration 8: cashboxes + payments API tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://mobile-first-stage-71.preview.emergentagent.com").rstrip("/")
API = BASE_URL + "/api"

COACH = "michael-moser"
PLAYER = "josh-ankermann"

EXPECTED_ORDER = ["bierwart", "mannschaft_spiele", "mannschaft_training", "trainer"]


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Cashboxes: seed + list ------------------------------------------------

class TestCashboxList:
    def test_list_has_four_boxes_correct_order(self, client):
        r = client.get(f"{API}/cashboxes", timeout=30)
        assert r.status_code == 200, r.text
        docs = r.json()
        assert isinstance(docs, list)
        keys = [d["key"] for d in docs]
        assert keys == EXPECTED_ORDER, f"order mismatch: {keys}"

    def test_bierwart_defaults(self, client):
        docs = client.get(f"{API}/cashboxes").json()
        b = next(x for x in docs if x["key"] == "bierwart")
        assert b["email"] == "lj-sascha@web.de"
        assert b["recipient_player_id"] == "sascha-grins"
        assert b.get("recipient_name") == "Sascha GRINS"

    def test_trainer_recipient(self, client):
        docs = client.get(f"{API}/cashboxes").json()
        t = next(x for x in docs if x["key"] == "trainer")
        assert t["recipient_player_id"] == "michael-moser"
        assert t.get("recipient_name")

    def test_mannschaft_spiele_empty_email(self, client):
        docs = client.get(f"{API}/cashboxes").json()
        m = next(x for x in docs if x["key"] == "mannschaft_spiele")
        assert m.get("email", "") == ""


# --- Cashboxes: PATCH ------------------------------------------------------

class TestCashboxPatch:
    def test_non_coach_forbidden(self, client):
        r = client.patch(f"{API}/cashboxes/bierwart",
                         json={"actor_id": PLAYER, "email": "foo@bar.de"})
        assert r.status_code == 403
        assert "Nur der Trainer" in r.json().get("detail", "")

        # value unchanged
        docs = client.get(f"{API}/cashboxes").json()
        b = next(x for x in docs if x["key"] == "bierwart")
        assert b["email"] == "lj-sascha@web.de"

    def test_invalid_email_400(self, client):
        r = client.patch(f"{API}/cashboxes/bierwart",
                         json={"actor_id": COACH, "email": "foo"})
        assert r.status_code == 400

    def test_unknown_recipient_400(self, client):
        r = client.patch(f"{API}/cashboxes/bierwart",
                         json={"actor_id": COACH, "recipient_player_id": "does-not-exist"})
        assert r.status_code == 400
        assert "Spieler nicht gefunden" in r.json().get("detail", "")

    def test_coach_changes_recipient_then_resets(self, client):
        # change to josh
        r = client.patch(f"{API}/cashboxes/bierwart",
                         json={"actor_id": COACH, "recipient_player_id": "josh-ankermann"})
        assert r.status_code == 200, r.text

        docs = client.get(f"{API}/cashboxes").json()
        b = next(x for x in docs if x["key"] == "bierwart")
        assert b["recipient_player_id"] == "josh-ankermann"
        assert b.get("recipient_name") == "Josh ANKERMANN"

        # reset
        r2 = client.patch(f"{API}/cashboxes/bierwart",
                          json={"actor_id": COACH, "recipient_player_id": "sascha-grins"})
        assert r2.status_code == 200
        docs = client.get(f"{API}/cashboxes").json()
        b = next(x for x in docs if x["key"] == "bierwart")
        assert b["recipient_player_id"] == "sascha-grins"


# --- Payments --------------------------------------------------------------

class TestPayments:
    created_ids: list = []

    def test_create_payment_ok(self, client):
        r = client.post(f"{API}/payments",
                        json={"payer_id": PLAYER, "cashbox_key": "bierwart",
                              "amount": 3.5, "note": "TEST_iter8"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "open"
        assert d["payer_name"] == "Josh ANKERMANN"
        assert d["cashbox_key"] == "bierwart"
        assert d["amount"] == 3.5
        assert d["id"].startswith("PAY")
        TestPayments.created_ids.append(d["id"])

    def test_create_payment_unknown_box(self, client):
        r = client.post(f"{API}/payments",
                        json={"payer_id": PLAYER, "cashbox_key": "unknown_box",
                              "amount": 1})
        assert r.status_code == 404

    def test_create_payment_unknown_payer(self, client):
        r = client.post(f"{API}/payments",
                        json={"payer_id": "no-such-player", "cashbox_key": "bierwart",
                              "amount": 1})
        assert r.status_code == 404

    def test_list_payments_requires_coach(self, client):
        r = client.get(f"{API}/payments", params={"actor_id": PLAYER})
        assert r.status_code == 403

    def test_list_payments_coach_sees_row_and_sums(self, client):
        r = client.get(f"{API}/payments", params={"actor_id": COACH})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "payments" in data and "sums" in data
        # persistence: the row we created is present
        ids = [p["id"] for p in data["payments"]]
        for cid in TestPayments.created_ids:
            assert cid in ids, f"created row {cid} missing from list"
        # sums has an entry for bierwart with numeric total >= 3.5
        bw = next((s for s in data["sums"] if s["cashbox_key"] == "bierwart"), None)
        assert bw is not None
        assert isinstance(bw["total"], (int, float))
        assert bw["total"] >= 3.5
        assert isinstance(bw["count"], int) and bw["count"] >= 1

    def test_cleanup(self, client):
        # best-effort cleanup via direct Mongo
        try:
            from pymongo import MongoClient
            m = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = m[os.environ.get("DB_NAME", "test_database")]
            if TestPayments.created_ids:
                db.payments.delete_many({"id": {"$in": TestPayments.created_ids}})
        except Exception as e:
            pytest.skip(f"cleanup skipped: {e}")


# --- Regression checks (from prior iterations) -----------------------------

class TestRegression:
    def test_events_endpoint_alive(self, client):
        r = client.get(f"{API}/events")
        assert r.status_code == 200

    def test_players_endpoint_alive(self, client):
        r = client.get(f"{API}/players")
        assert r.status_code == 200
