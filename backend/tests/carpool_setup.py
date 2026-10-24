# Helper: set/reset RSVP+driving on away game for carpool UI tests. Usage: python carpool_setup.py setup|reset|show
import os, sys, requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
EV = "T2"


def tok(pid, pw):
    r = requests.post(f"{BASE}/players/{pid}/login", json={"password": pw})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


j = tok("josh-ankermann", "pw12345")
f = tok("filip-la", "test1234")
mode = sys.argv[1]
if mode == "setup":
    print(requests.post(f"{BASE}/rsvp", headers=j, json={"event_id": EV, "player_id": "josh-ankermann", "status": "zugesagt"}).text)
    print(requests.post(f"{BASE}/driving", headers=j, json={"event_id": EV, "player_id": "josh-ankermann", "driving": True}).text)
    print(requests.post(f"{BASE}/rsvp", headers=f, json={"event_id": EV, "player_id": "filip-la", "status": "zugesagt"}).text)
    print(requests.put(f"{BASE}/carpool/{EV}", headers=j, json={"seats": {}, "assignments": {}}).text)
elif mode == "reset":
    print(requests.post(f"{BASE}/driving", headers=j, json={"event_id": EV, "player_id": "josh-ankermann", "driving": False}).text)
    print(requests.post(f"{BASE}/rsvp/reset", headers=j, json={"event_id": EV, "player_id": "josh-ankermann"}).text)
    print(requests.post(f"{BASE}/rsvp/reset", headers=f, json={"event_id": EV, "player_id": "filip-la"}).text)
    print(requests.put(f"{BASE}/carpool/{EV}", headers=j, json={"seats": {}, "assignments": {}}).text)
ov = requests.get(f"{BASE}/events/{EV}/overview", headers=j).json()
print([(p["id"], p.get("rsvp"), p.get("driving")) for p in ov["players"] if p.get("rsvp")])
print(requests.get(f"{BASE}/carpool/{EV}", headers=j).json())
