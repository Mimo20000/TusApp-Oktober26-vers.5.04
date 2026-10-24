"""Editable carpool (Fahrgemeinschaft) planning per event.

Anyone on the team may edit. We store the whole plan as one document:
- seats: {driver_id: seat_count}
- assignments: {passenger_id: driver_id}
"""
from typing import Dict

from fastapi import APIRouter
from pydantic import BaseModel

from auth import CurrentPlayer
from db import db

router = APIRouter(prefix="/carpool")


class CarpoolBody(BaseModel):
    seats: Dict[str, int] = {}
    assignments: Dict[str, str] = {}  # passenger_id -> driver_id


@router.get("/{event_id}")
async def get_carpool(event_id: str, current_player_id: CurrentPlayer):
    doc = await db.carpools.find_one({"event_id": event_id}, {"_id": 0})
    return {
        "event_id": event_id,
        "seats": (doc or {}).get("seats", {}),
        "assignments": (doc or {}).get("assignments", {}),
    }


@router.put("/{event_id}")
async def put_carpool(event_id: str, body: CarpoolBody, current_player_id: CurrentPlayer):
    await db.carpools.update_one(
        {"event_id": event_id},
        {"$set": {"seats": body.seats, "assignments": body.assignments}},
        upsert=True,
    )
    return {"event_id": event_id, "seats": body.seats, "assignments": body.assignments}
