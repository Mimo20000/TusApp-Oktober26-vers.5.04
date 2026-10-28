"""Iteration 11 — backend tests for SL SpielerID (spieler_id) on Player model.

Feature: editable spieler_id on every player, updatable via
PATCH /api/players/{id}/contact.  Trimming applied; empty string clears.
"""
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ------------ helpers ------------
def _players(api):
    r = api.get(f"{BASE_URL}/api/players", timeout=15)
    assert r.status_code == 200
    return r.json()


def _by_id(players, pid):
    return next((p for p in players if p["id"] == pid), None)


# ------------ tests ------------
class TestSpielerIdSchema:
    """GET returns spieler_id for every player (null when unset)."""

    def test_get_players_contains_spieler_id_key(self, api):
        players = _players(api)
        assert players, "expected at least one seeded player"
        for p in players:
            assert "spieler_id" in p, f"{p['id']} missing spieler_id key"


class TestSpielerIdPatchFlow:
    """Set → GET → clear → GET round-trip for josh-ankermann."""

    PID = "josh-ankermann"

    def test_1_set_value_with_trim(self, api):
        body = {"spieler_id": "  SL-12345678  "}
        r = api.patch(f"{BASE_URL}/api/players/{self.PID}/contact", json=body, timeout=15)
        assert r.status_code == 200, r.text
        js = r.json()
        assert js.get("ok") is True
        assert js.get("spieler_id") == "SL-12345678", f"trim not applied: {js}"

    def test_2_get_after_set_reflects_value(self, api):
        p = _by_id(_players(api), self.PID)
        assert p is not None
        assert p["spieler_id"] == "SL-12345678"

    def test_3_partial_update_only_spieler_id_keeps_other_fields(self, api):
        # snapshot other contact fields
        before = _by_id(_players(api), self.PID)
        email_before = before.get("email")
        jersey_before = before.get("jersey_number")
        birth_before = before.get("birthdate")

        r = api.patch(
            f"{BASE_URL}/api/players/{self.PID}/contact",
            json={"spieler_id": "SL-PARTIAL-1"},
            timeout=15,
        )
        assert r.status_code == 200, r.text

        after = _by_id(_players(api), self.PID)
        assert after["spieler_id"] == "SL-PARTIAL-1"
        assert after.get("email") == email_before, "email leaked / mutated"
        assert after.get("jersey_number") == jersey_before, "jersey mutated"
        assert after.get("birthdate") == birth_before, "birthdate mutated"

    def test_4_clear_with_empty_string(self, api):
        r = api.patch(
            f"{BASE_URL}/api/players/{self.PID}/contact",
            json={"spieler_id": ""},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("spieler_id") is None

    def test_5_get_after_clear_is_null(self, api):
        p = _by_id(_players(api), self.PID)
        assert p is not None
        assert p["spieler_id"] is None


class TestSpielerIdFilipCoachFlow:
    """Simulate Coach editing another player's spieler_id and cleanup."""

    PID = "filip-la"

    def test_1_set_from_coach_view(self, api):
        r = api.patch(
            f"{BASE_URL}/api/players/{self.PID}/contact",
            json={"spieler_id": "SL-9999"},
            timeout=15,
        )
        assert r.status_code == 200, r.text

    def test_2_persisted(self, api):
        p = _by_id(_players(api), self.PID)
        assert p["spieler_id"] == "SL-9999"

    def test_3_cleanup_reset_null(self, api):
        r = api.patch(
            f"{BASE_URL}/api/players/{self.PID}/contact",
            json={"spieler_id": ""},
            timeout=15,
        )
        assert r.status_code == 200
        p = _by_id(_players(api), self.PID)
        assert p["spieler_id"] is None


class TestLegacyCompat:
    """Ensure no schema error when spieler_id absent in DB doc."""

    def test_all_players_deserialize(self, api):
        players = _players(api)
        # If schema were broken, /api/players would return 500 (handled above).
        for p in players:
            assert p.get("spieler_id") is None or isinstance(p["spieler_id"], str)


class TestEmptyPatchStillRejected:
    """Sanity: PATCH with truly nothing → 400 (regression)."""

    def test_empty_body(self, api):
        r = api.patch(
            f"{BASE_URL}/api/players/josh-ankermann/contact",
            json={},
            timeout=15,
        )
        assert r.status_code == 400
