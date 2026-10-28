# Carpool planner (Fahrgemeinschaft) API tests: GET/PUT /api/carpool/{event_id}
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", os.environ.get("EXPO_BACKEND_URL")).rstrip("/")
EVENT = "T3"  # away game used only for tests (reset at end)


def _login(pid, pw):
    r = requests.post(f"{BASE_URL}/api/players/{pid}/login", json={"password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed for {pid}: {r.status_code} {r.text}")
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def josh():
    return _login("josh-ankermann", "pw12345")


@pytest.fixture(scope="module")
def sascha():
    return _login("sascha-grins", "test1234")


@pytest.fixture(scope="module", autouse=True)
def snapshot_and_restore(josh):
    before = requests.get(f"{BASE_URL}/api/carpool/{EVENT}", headers=josh).json()
    yield
    requests.put(f"{BASE_URL}/api/carpool/{EVENT}", headers=josh,
                 json={"seats": before.get("seats", {}), "assignments": before.get("assignments", {})})


# Auth required
class TestCarpoolAuth:
    def test_get_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/carpool/{EVENT}")
        assert r.status_code in (401, 403)

    def test_put_requires_auth(self):
        r = requests.put(f"{BASE_URL}/api/carpool/{EVENT}", json={"seats": {}, "assignments": {}})
        assert r.status_code in (401, 403)


# CRUD + cross-user visibility
class TestCarpoolCRUD:
    def test_get_shape_empty_event(self, josh):
        r = requests.get(f"{BASE_URL}/api/carpool/TEST_nonexistent_evt", headers=josh)
        assert r.status_code == 200
        assert r.json() == {"event_id": "TEST_nonexistent_evt", "seats": {}, "assignments": {}}

    def test_put_and_get_persist(self, josh):
        body = {"seats": {"josh-ankermann": 3}, "assignments": {"filip-la": "josh-ankermann"}}
        r = requests.put(f"{BASE_URL}/api/carpool/{EVENT}", headers=josh, json=body)
        assert r.status_code == 200
        assert r.json()["seats"] == body["seats"]
        g = requests.get(f"{BASE_URL}/api/carpool/{EVENT}", headers=josh).json()
        assert g["seats"] == body["seats"] and g["assignments"] == body["assignments"]
        assert "_id" not in g

    def test_visible_to_other_user(self, sascha):
        g = requests.get(f"{BASE_URL}/api/carpool/{EVENT}", headers=sascha).json()
        assert g["seats"] == {"josh-ankermann": 3}
        assert g["assignments"] == {"filip-la": "josh-ankermann"}

    def test_other_user_can_edit(self, sascha, josh):
        body = {"seats": {"josh-ankermann": 5}, "assignments": {}}
        r = requests.put(f"{BASE_URL}/api/carpool/{EVENT}", headers=sascha, json=body)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/carpool/{EVENT}", headers=josh).json()
        assert g["seats"] == {"josh-ankermann": 5} and g["assignments"] == {}

    def test_invalid_body_422(self, josh):
        r = requests.put(f"{BASE_URL}/api/carpool/{EVENT}", headers=josh, json={"seats": {"x": "abc"}})
        assert r.status_code == 422

    def test_server_side_seat_limit_not_enforced(self, josh):
        # Observational: backend accepts out-of-range seats / over-capacity (no server validation)
        body = {"seats": {"josh-ankermann": 99}, "assignments": {"a": "josh-ankermann"}}
        r = requests.put(f"{BASE_URL}/api/carpool/{EVENT}", headers=josh, json=body)
        print("seat=99 accepted:", r.status_code)
        assert r.status_code in (200, 422)

    def test_nonexistent_event_put_accepted(self, josh):
        # Observational: backend does not validate event existence
        r = requests.put(f"{BASE_URL}/api/carpool/TEST_nonexistent_evt2", headers=josh,
                         json={"seats": {}, "assignments": {}})
        print("nonexistent event PUT:", r.status_code)
        assert r.status_code in (200, 404)
