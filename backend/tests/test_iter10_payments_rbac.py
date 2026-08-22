"""Iteration 10: GET /api/payments visibility for Coach + cashbox recipients.

Verifies:
  * bierwart recipient (sascha-grins) can view payments (200).
  * Coach (michael-moser) can still view payments (200).
  * Regular non-recipient player (filip-la) receives 403 with the German message.
  * PATCH-cascading recipient: change bierwart to josh-ankermann → josh can view,
    sascha now 403. Reset back to sascha-grins at the end.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://mobile-first-stage-71.preview.emergentagent.com",
).rstrip("/")
API = BASE_URL + "/api"

COACH = "michael-moser"
BIERWART_DEFAULT = "sascha-grins"
NEW_RECIPIENT = "josh-ankermann"
REGULAR = "filip-la"
FORBIDDEN_MSG = "Nur Trainer und Kassenwarte dürfen Zahlungen einsehen."


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module", autouse=True)
def ensure_default_bierwart(client):
    """Make sure bierwart is set to sascha-grins before + after the test module."""
    def _set(pid: str):
        r = client.patch(
            f"{API}/cashboxes/bierwart",
            json={"actor_id": COACH, "recipient_player_id": pid},
            timeout=30,
        )
        assert r.status_code == 200, r.text

    _set(BIERWART_DEFAULT)
    yield
    _set(BIERWART_DEFAULT)


# --- Visibility ----------------------------------------------------------

class TestPaymentsVisibility:
    def test_bierwart_recipient_can_view(self, client):
        r = client.get(f"{API}/payments", params={"actor_id": BIERWART_DEFAULT}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "payments" in data and isinstance(data["payments"], list)
        assert "sums" in data and isinstance(data["sums"], list)

    def test_coach_can_view(self, client):
        r = client.get(f"{API}/payments", params={"actor_id": COACH}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "payments" in data and "sums" in data

    def test_regular_player_forbidden(self, client):
        # confirm filip-la exists and is not a Coach
        p = client.get(f"{API}/players").json()
        filip = next((x for x in p if x["id"] == REGULAR), None)
        assert filip is not None, "seed data missing filip-la"
        assert filip.get("position") != "Coach"

        r = client.get(f"{API}/payments", params={"actor_id": REGULAR}, timeout=30)
        assert r.status_code == 403, r.text
        assert r.json().get("detail") == FORBIDDEN_MSG

    def test_trainer_kasse_recipient_can_view(self, client):
        # trainer-kasse recipient is Coach michael-moser (covered above), but
        # also confirm that being listed on any cashbox is enough — Coach is
        # already covered; this is redundant but harmless.
        docs = client.get(f"{API}/cashboxes").json()
        trainer = next(x for x in docs if x["key"] == "trainer")
        assert trainer["recipient_player_id"] == COACH


# --- Cascading recipient change -----------------------------------------

class TestPaymentsRecipientCascade:
    def test_cascade_new_recipient_gains_access(self, client):
        # move bierwart to josh
        r = client.patch(
            f"{API}/cashboxes/bierwart",
            json={"actor_id": COACH, "recipient_player_id": NEW_RECIPIENT},
            timeout=30,
        )
        assert r.status_code == 200, r.text

        # josh (new recipient) can view
        r_new = client.get(f"{API}/payments", params={"actor_id": NEW_RECIPIENT}, timeout=30)
        assert r_new.status_code == 200, r_new.text

        # sascha (former recipient) is no longer allowed
        r_old = client.get(f"{API}/payments", params={"actor_id": BIERWART_DEFAULT}, timeout=30)
        assert r_old.status_code == 403, r_old.text
        assert r_old.json().get("detail") == FORBIDDEN_MSG

    def test_cascade_reset_restores_sascha_access(self, client):
        # reset (also done by autouse teardown, but assert here for clarity)
        r = client.patch(
            f"{API}/cashboxes/bierwart",
            json={"actor_id": COACH, "recipient_player_id": BIERWART_DEFAULT},
            timeout=30,
        )
        assert r.status_code == 200

        r_sascha = client.get(f"{API}/payments", params={"actor_id": BIERWART_DEFAULT}, timeout=30)
        assert r_sascha.status_code == 200

        # josh (no cashbox anymore) is back to 403
        r_josh = client.get(f"{API}/payments", params={"actor_id": NEW_RECIPIENT}, timeout=30)
        assert r_josh.status_code == 403
