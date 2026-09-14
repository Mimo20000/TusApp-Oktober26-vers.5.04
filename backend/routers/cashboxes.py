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

from auth import CoachPlayer, CurrentPlayer
from db import db

router = APIRouter()


MONTHS_DE = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
]


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
    if await _is_coach(actor_id):
        return True
    hit = await db.cashboxes.find_one({"recipient_player_id": actor_id})
    return bool(hit)


async def _can_manage_cashbox(actor_id: str, cashbox_key: str) -> bool:
    """Coach may manage every cash box; a cash-box recipient may manage only
    their own box (mark paid/open, add on behalf, delete)."""
    if await _is_coach(actor_id):
        return True
    box = await db.cashboxes.find_one({"key": cashbox_key})
    return bool(box and box.get("recipient_player_id") == actor_id)


async def _attach_recipient(box: dict) -> dict:
    pid = box.get("recipient_player_id")
    if pid:
        p = await db.players.find_one({"id": pid}, {"_id": 0, "name": 1, "avatar_file_id": 1})
        if p:
            box["recipient_name"] = p.get("name")
            box["recipient_avatar_file_id"] = p.get("avatar_file_id")
    return box


class CashboxUpdate(BaseModel):
    email: Optional[str] = None
    recipient_player_id: Optional[str] = None
    label: Optional[str] = None


class PaymentCreate(BaseModel):
    cashbox_key: str
    amount: Optional[float] = None
    note: Optional[str] = None
    event_id: Optional[str] = None
    payer_id: Optional[str] = None  # set by Bierwart/Coach to log on behalf


class PaymentStatusUpdate(BaseModel):
    status: str  # "open" | "completed"


@router.get("/cashboxes")
async def list_cashboxes(_current: CurrentPlayer):
    docs = await db.cashboxes.find({}, {"_id": 0}).to_list(50)
    for d in docs:
        await _attach_recipient(d)
    order = {b["key"]: i for i, b in enumerate(DEFAULT_BOXES)}
    docs.sort(key=lambda b: order.get(b["key"], 99))
    return docs


@router.patch("/cashboxes/{key}")
async def update_cashbox(key: str, body: CashboxUpdate, coach_id: CoachPlayer):
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
    upd["updated_by"] = coach_id
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.cashboxes.update_one({"key": key}, {"$set": upd})
    return await _attach_recipient({**box, **upd, "_id": None})


@router.post("/payments")
async def log_payment(body: PaymentCreate, current_player_id: CurrentPlayer):
    box = await db.cashboxes.find_one({"key": body.cashbox_key})
    if not box:
        raise HTTPException(status_code=404, detail="Kasse nicht gefunden.")
    payer_id = (body.payer_id or "").strip() or current_player_id
    # Logging on behalf of another player is reserved for the cash-box
    # recipient (Bierwart) or a coach.
    if payer_id != current_player_id and not await _can_manage_cashbox(current_player_id, body.cashbox_key):
        raise HTTPException(status_code=403, detail="Nur Kassenwart oder Trainer dürfen Einträge für andere anlegen.")
    payer = await db.players.find_one({"id": payer_id})
    if not payer:
        raise HTTPException(status_code=404, detail="Spieler nicht gefunden.")
    doc = {
        "id": "PAY" + uuid.uuid4().hex[:12],
        "cashbox_key": body.cashbox_key,
        "payer_id": payer_id,
        "payer_name": payer.get("name"),
        "amount": float(body.amount) if body.amount else None,
        "note": (body.note or "").strip() or None,
        "event_id": body.event_id,
        "status": "open",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_player_id,
    }
    await db.payments.insert_one(dict(doc))
    return doc


@router.patch("/payments/{payment_id}")
async def set_payment_status(payment_id: str, body: PaymentStatusUpdate, current_player_id: CurrentPlayer):
    pay = await db.payments.find_one({"id": payment_id})
    if not pay:
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden.")
    if body.status not in ("open", "completed"):
        raise HTTPException(status_code=400, detail="Ungültiger Status.")
    if not await _can_manage_cashbox(current_player_id, pay.get("cashbox_key")):
        raise HTTPException(status_code=403, detail="Nur Kassenwart oder Trainer dürfen den Status ändern.")
    upd = {"status": body.status}
    if body.status == "completed":
        upd["paid_at"] = datetime.now(timezone.utc).isoformat()
        upd["paid_by"] = current_player_id
    else:
        upd["paid_at"] = None
        upd["paid_by"] = None
    await db.payments.update_one({"id": payment_id}, {"$set": upd})
    return {k: v for k, v in {**pay, **upd}.items() if k != "_id"}


@router.delete("/payments/{payment_id}")
async def delete_payment(payment_id: str, current_player_id: CurrentPlayer):
    pay = await db.payments.find_one({"id": payment_id})
    if not pay:
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden.")
    if not await _can_manage_cashbox(current_player_id, pay.get("cashbox_key")):
        raise HTTPException(status_code=403, detail="Nur Kassenwart oder Trainer dürfen Einträge löschen.")
    await db.payments.delete_one({"id": payment_id})
    return {"ok": True}


@router.get("/payments/my-open")
async def my_open_payments(current_player_id: CurrentPlayer):
    """Own still-open balance, grouped per cash box. Available to every player
    so the 'Kasse' dialog can pre-fill the amount they still owe."""
    docs = await db.payments.find(
        {"payer_id": current_player_id, "status": "open"}, {"_id": 0}
    ).to_list(2000)
    agg: dict = {}
    total = 0.0
    for d in docs:
        k = d.get("cashbox_key")
        a = agg.setdefault(k, {"cashbox_key": k, "total": 0.0, "count": 0})
        a["count"] += 1
        if d.get("amount"):
            a["total"] += float(d["amount"])
            total += float(d["amount"])
    return {"by_cashbox": list(agg.values()), "total": total}


@router.get("/payments")
async def list_payments(current_player_id: CurrentPlayer):
    if not await _can_view_payments(current_player_id):
        raise HTTPException(status_code=403, detail="Nur Trainer und Kassenwarte dürfen Zahlungen einsehen.")
    docs = await db.payments.find({}, {"_id": 0}).to_list(2000)
    boxes = {b["key"]: b for b in await db.cashboxes.find({}, {"_id": 0}).to_list(50)}
    for d in docs:
        d["cashbox_label"] = boxes.get(d.get("cashbox_key"), {}).get("label") or d.get("cashbox_key")
    docs.sort(key=lambda p: p.get("created_at", ""), reverse=True)
    sums: dict = {}
    for d in docs:
        k = d.get("cashbox_key")
        s = sums.setdefault(k, {"cashbox_key": k, "cashbox_label": boxes.get(k, {}).get("label") or k, "total": 0.0, "count": 0})
        s["count"] += 1
        if d.get("amount"):
            s["total"] += float(d["amount"])
    # Monthly summary of still-OPEN payments so the Bierwart sees, at a glance,
    # how much is outstanding per month. Aggregated across all cash boxes.
    monthly: dict = {}
    per_player: dict = {}
    for d in docs:
        if d.get("status") != "open":
            continue
        month = (d.get("created_at") or "")[:7]  # YYYY-MM
        if len(month) == 7:
            m = monthly.setdefault(month, {"month": month, "total": 0.0, "count": 0})
            m["count"] += 1
            if d.get("amount"):
                m["total"] += float(d["amount"])
        pid = d.get("payer_id")
        pp = per_player.setdefault(pid, {"payer_id": pid, "payer_name": d.get("payer_name") or pid, "total": 0.0, "count": 0})
        pp["count"] += 1
        if d.get("amount"):
            pp["total"] += float(d["amount"])
    monthly_open = sorted(monthly.values(), key=lambda x: x["month"], reverse=True)
    for m in monthly_open:
        year, mm = m["month"].split("-")
        m["month_label"] = f"{MONTHS_DE[int(mm) - 1]} {year}"
    per_player_open = sorted(per_player.values(), key=lambda x: (-x["total"], -x["count"]))
    # Which cash boxes may the current viewer manage (mark paid / add / delete)?
    if await _is_coach(current_player_id):
        manageable = list(boxes.keys())
    else:
        manageable = [k for k, b in boxes.items() if b.get("recipient_player_id") == current_player_id]
    return {
        "payments": docs,
        "sums": list(sums.values()),
        "monthly_open": monthly_open,
        "per_player_open": per_player_open,
        "manageable_cashboxes": manageable,
    }
