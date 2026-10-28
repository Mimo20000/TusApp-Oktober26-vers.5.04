"""
Tests for avatar photo save flow:
- GET /api/players returns avatar_file_id key
- File upload chain (init/chunk/finalize) then PATCH /api/players/{id}/contact
  persists avatar_file_id and it is visible on subsequent GET /api/players
"""
import base64
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://mobile-first-stage-71.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# 1x1 red PNG
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
)


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Player model shape ---
class TestPlayerListShape:
    def test_get_players_returns_avatar_file_id_key(self, api_client):
        r = api_client.get(f"{API}/players")
        assert r.status_code == 200, r.text
        players = r.json()
        assert isinstance(players, list) and len(players) > 0
        for p in players:
            assert "avatar_file_id" in p, f"player {p.get('id')} missing 'avatar_file_id' key"
            # Value must be None or non-empty string
            v = p["avatar_file_id"]
            assert v is None or (isinstance(v, str) and len(v) > 0)

    def test_josh_ankermann_exists(self, api_client):
        r = api_client.get(f"{API}/players")
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()]
        assert "josh-ankermann" in ids


# --- File upload chain + PATCH contact -> avatar persisted ---
class TestAvatarPersistence:
    player_id = "josh-ankermann"

    @pytest.fixture(scope="class")
    def uploaded_file_id(self, api_client):
        # init
        r = api_client.post(f"{API}/files/init", json={
            "filename": "TEST_avatar.png",
            "mime": "image/png",
            "kind": "image",
        })
        assert r.status_code == 200, r.text
        upload_id = r.json()["upload_id"]

        # chunk (single)
        r = api_client.post(f"{API}/files/chunk", json={
            "upload_id": upload_id,
            "index": 0,
            "data": TINY_PNG_B64,
        })
        assert r.status_code == 200, r.text

        # finalize
        r = api_client.post(f"{API}/files/finalize", json={"upload_id": upload_id})
        assert r.status_code == 200, r.text
        file_id = r.json()["file_id"]
        assert isinstance(file_id, str) and file_id.startswith("F")
        return file_id

    def test_raw_endpoint_serves_image(self, api_client, uploaded_file_id):
        r = api_client.get(f"{API}/files/{uploaded_file_id}/raw")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")
        # decoded body equals our tiny png
        assert r.content == base64.b64decode(TINY_PNG_B64)

    def test_patch_contact_sets_avatar_file_id(self, api_client, uploaded_file_id):
        r = api_client.patch(
            f"{API}/players/{self.player_id}/contact",
            json={"avatar_file_id": uploaded_file_id},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("avatar_file_id") == uploaded_file_id

    def test_avatar_file_id_visible_in_get_players(self, api_client, uploaded_file_id):
        r = api_client.get(f"{API}/players")
        assert r.status_code == 200
        found = next((p for p in r.json() if p["id"] == self.player_id), None)
        assert found is not None
        assert found.get("avatar_file_id") == uploaded_file_id, (
            f"Expected avatar_file_id={uploaded_file_id} on josh-ankermann, got {found.get('avatar_file_id')}"
        )


# --- Login regression ---
class TestLoginRegression:
    def test_josh_login_still_works(self, api_client):
        r = api_client.post(
            f"{API}/players/josh-ankermann/login",
            json={"password": "pw12345"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("player_id") == "josh-ankermann"
        assert "access_token" in data and isinstance(data["access_token"], str)
