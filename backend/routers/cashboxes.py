"""Cash-box + payment-log endpoints.

Two collections:

* ``cashboxes`` — one document per named cash box (Bierwart, Mannschaftskasse
  Spiele/Training, Trainer). Each holds the recipient's PayPal email and the
  player currently assigned to it.
* ``payments`` — one document per payment intent. Because the app currently
  uses a deep-link PayPal flow (no PayPal API keys yet) rows are inserted with
  ``status="open"``. Once real PayPal API credentials arrive we simply flip
  the row to ``"completed"`` from the capture callback.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import db

router = APIRouter()


DEFAULT_BOXES = [
    {"key": "bierwart", "label": "Bierwart",
     "email": "lj-sascha@web.de", "recipient_player_id": "sascha-grins"},
    {"key": "mannschaft_spiele", "label": "Mannschaftskasse Spiele",
     "email": "", "recipient_player_id": None},
    {"key": "mannschaft_training", "label": "Mannschaftskasse Training",
     "email": "", "recipient_player_id": None},
    {"key": "trainer", "label": "Trainer-Kasse",
     "email": "", "recipient_player_id": "michael-moser"},
]


async def seed_cashboxes_if_empty() -> None:
    if await db.cashboxes.count_documents({}) == 0:
        await db.cashboxes.insert_many([dict(b) for b in DEFAULT_BOXES])


async def _is_coach(actor_id: str) -> bool:
    actor = await db.players.find_one({"id": actor_id})
    return bool(actor and actor.get("position") == "Coach")


async def _can_view_payments(actor_id: str) -> bool:
    """Coach OR any player who is currently listed as a cashbox recipient
    (Bierwart, Mannschaftskassen-Verwalter, Trainer-Kasse) — everyone with
    an operational responsibility for a cash box may see the full list."""
    if await _is_coach(actor_id):
        return True
    hit = await db.cashboxes.find_one({"recipient_player_id": actor_id})
    return bool(hit)


async def _attach_recipient(box: dict) -> dict:
    pid = box.get("recipient_player_id")
    if pid:
        p = await db.players.find_one({"id": pid}, {"_id": 0, "name": 1, "avatar_file_id": 1})
        if p:
            box["recipient_name"] = p.get("name")
            box["recipient_avatar_file_id"] = p.get("avatar_file_id")
    return box


class CashboxUpdate(BaseModel):
    actor_id: str
    email: Optional[str] = None
    recipient_player_id: Optional[str] = None
    label: Optional[str] = None


class PaymentCreate(BaseModel):
    payer_id: str
    cashbox_key: str
    amount: Optional[float] = None
    note: Optional[str] = None
    event_id: Optional[str] = None


@router.get("/cashboxes")
async def list_cashboxes():
    docs = await db.cashboxes.find({}, {"_id": 0}).to_list(50)
    for d in docs:
        await _attach_recipient(d)
    order = {b["key"]: i for i, b in enumerate(DEFAULT_BOXES)}
    docs.sort(key=lambda b: order.get(b["key"], 99))
    return docs


@router.patch("/cashboxes/{key}")
async def update_cashbox(key: str, body: CashboxUpdate):
    if not await _is_coach(body.actor_id):
        raise HTTPException(status_code=403, detail="Nur der Trainer darf Kassen ändern.")
    box = await db.cashboxes.find_one({"key": key})
    if not box:
        raise HTTPException(status_code=404, detail="Kasse nicht gefunden.")
    upd: dict = {}
    if body.email is not None:
        e = body.email.strip()
        if e and ("@" not in e or "." not in e.split("@", 1)[1]):
            raise HTTPException(status_code=400, detail="Bitte gültige E-Mail-Adresse eingeben.")
        upd["email"] = e
    if body.recipient_player_id is not None:
        pid = body.recipient_player_id.strip()
        if pid and not await db.players.find_one({"id": pid}):
            raise HTTPException(status_code=400, detail="Spieler nicht gefunden.")
        upd["recipient_player_id"] = pid or None
    if body.label:
        upd["label"] = body.label.strip()
    if not upd:
        raise HTTPException(status_code=400, detail="Keine Änderungen.")
    upd["updated_by"] = body.actor_id
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.cashboxes.update_one({"key": key}, {"$set": upd})
    return await _attach_recipient({**box, **upd, "_id": None})


@router.post("/payments")
async def log_payment(body: PaymentCreate):
    box = await db.cashboxes.find_one({"key": body.cashbox_key})
    if not box:
        raise HTTPException(status_code=404, detail="Kasse nicht gefunden.")
    payer = await db.players.find_one({"id": body.payer_id})
    if not payer:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden.")
    doc = {
        "id": "PAY" + uuid.uuid4().hex[:12],
        "cashbox_key": body.cashbox_key,
        "payer_id": body.payer_id,
        "payer_name": payer.get("name"),
        "amount": float(body.amount) if body.amount else None,
        "note": (body.note or "").strip() or None,
        "event_id": body.event_id,
        "status": "open",  # flipped to "completed" when PayPal capture succeeds
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.payments.insert_one(dict(doc))
    return doc


@router.get("/payments")
async def list_payments(actor_id: str):
    if not await _can_view_payments(actor_id):
        raise HTTPException(status_code=403, detail="Nur Trainer und Kassenwarte dürfen Zahlungen einsehen.")
    docs = await db.payments.find({}, {"_id": 0}).to_list(2000)
    boxes = {b["key"]: b for b in await db.cashboxes.find({}, {"_id": 0}).to_list(50)}
    for d in docs:
        d["cashbox_label"] = boxes.get(d.get("cashbox_key"), {}).get("label") or d.get("cashbox_key")
    docs.sort(key=lambda p: p.get("created_at", ""), reverse=True)
    # Summary per cashbox
    sums: dict = {}
    for d in docs:
        k = d.get("cashbox_key")
        s = sums.setdefault(k, {"cashbox_key": k, "cashbox_label": boxes.get(k, {}).get("label") or k, "total": 0.0, "count": 0})
        s["count"] += 1
        if d.get("amount"):
            s["total"] += float(d["amount"])
    return {"payments": docs, "sums": list(sums.values())}
