"""Backend tests for iteration 7: /api/settings/bierwart GET + PATCH.

Covers:
  - GET returns default lj-sascha@web.de when no override / after reset
  - PATCH by non-Coach returns 403 with the exact German detail and does not mutate
  - PATCH by Coach with valid email persists and returns via GET
  - PATCH with invalid email returns 400 and does not mutate
  - Reset at end
"""
import os

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
DEFAULT_EMAIL = "lj-sascha@web.de"
COACH_ID = "michael-moser"
NON_COACH_ID = "josh-ankermann"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module", autouse=True)
def _ensure_reset(api):
    # ensure the DB starts + ends at default
    api.patch(f"{BASE_URL}/api/settings/bierwart",
              json={"email": DEFAULT_EMAIL, "actor_id": COACH_ID})
    yield
    api.patch(f"{BASE_URL}/api/settings/bierwart",
              json={"email": DEFAULT_EMAIL, "actor_id": COACH_ID})


def test_get_default_email(api):
    r = api.get(f"{BASE_URL}/api/settings/bierwart")
    assert r.status_code == 200
    body = r.json()
    assert "email" in body
    assert body["email"] == DEFAULT_EMAIL


def test_patch_non_coach_forbidden(api):
    r = api.patch(f"{BASE_URL}/api/settings/bierwart",
                  json={"email": "hacker@evil.com", "actor_id": NON_COACH_ID})
    assert r.status_code == 403
    body = r.json()
    assert body.get("detail") == "Nur der Trainer darf den Bierwart ändern."
    # value must not have changed
    g = api.get(f"{BASE_URL}/api/settings/bierwart").json()
    assert g["email"] == DEFAULT_EMAIL


def test_patch_invalid_email_rejected(api):
    # Requirement explicitly lists 'foo' and 'no-at'.
    for bad in ["foo", "no-at", "", "missing@dot"]:
        r = api.patch(f"{BASE_URL}/api/settings/bierwart",
                      json={"email": bad, "actor_id": COACH_ID})
        assert r.status_code == 400, f"{bad} unexpectedly accepted"
    g = api.get(f"{BASE_URL}/api/settings/bierwart").json()
    assert g["email"] == DEFAULT_EMAIL


def test_patch_coach_valid_email_persists(api):
    new_email = "test-bierwart@web.de"
    r = api.patch(f"{BASE_URL}/api/settings/bierwart",
                  json={"email": new_email, "actor_id": COACH_ID})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("email") == new_email

    g = api.get(f"{BASE_URL}/api/settings/bierwart").json()
    assert g["email"] == new_email

    # cleanup — reset to default
    r2 = api.patch(f"{BASE_URL}/api/settings/bierwart",
                   json={"email": DEFAULT_EMAIL, "actor_id": COACH_ID})
    assert r2.status_code == 200
    g2 = api.get(f"{BASE_URL}/api/settings/bierwart").json()
    assert g2["email"] == DEFAULT_EMAIL


def test_patch_unknown_actor_forbidden(api):
    r = api.patch(f"{BASE_URL}/api/settings/bierwart",
                  json={"email": "x@y.de", "actor_id": "does-not-exist"})
    assert r.status_code == 403
