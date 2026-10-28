import httpx

from db import db

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def direct_conv_id(a: str, b: str) -> str:
    return "d:" + "__".join(sorted([a, b]))


async def _send_push(messages: list):
    if not messages:
        return
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            await c.post(
                EXPO_PUSH_URL,
                json=messages,
                headers={"Content-Type": "application/json"},
            )
    except Exception:
        pass


async def notify_new_message(scope: str, conversation_id: str, sender_id: str, sender_name: str, text: str):
    if scope == "team":
        recips = await db.players.find(
            {"id": {"$ne": sender_id}, "push_token": {"$ne": None}}
        ).to_list(500)
        title = "Team-Chat"
    else:
        ids = [i for i in conversation_id[2:].split("__") if i != sender_id]
        recips = await db.players.find(
            {"id": {"$in": ids}, "push_token": {"$ne": None}}
        ).to_list(10)
        title = sender_name
    messages = [
        {
            "to": r["push_token"],
            "title": title,
            "body": f"{sender_name}: {text}"[:140],
            "sound": "default",
            "data": {"conversation_id": conversation_id},
        }
        for r in recips
        if r.get("push_token")
    ]
    await _send_push(messages)


async def notify_event(ev: dict, title: str):
    recips = await db.players.find({"push_token": {"$ne": None}}).to_list(500)
    label = f"vs. {ev.get('opponent')}" if ev.get("type") == "Spiel" else ev.get("type")
    body_txt = f"{label} am {ev.get('date')} um {ev.get('time')} Uhr"
    messages = [
        {
            "to": r["push_token"],
            "title": title,
            "body": body_txt[:140],
            "sound": "default",
            "data": {"type": "event"},
        }
        for r in recips
        if r.get("push_token")
    ]
    await _send_push(messages)
