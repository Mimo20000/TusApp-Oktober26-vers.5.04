from typing import Optional

from pydantic import BaseModel


class Player(BaseModel):
    id: str
    name: str
    position: Optional[str] = None
    status: str = "Aktiv"
    jersey_number: Optional[int] = None
    email: Optional[str] = None
    birthdate: Optional[str] = None
    avatar_file_id: Optional[str] = None
    spieler_id: Optional[str] = None  # externe SL-SpielerID (Handball4All / SpielPlusR)
    has_password: bool = False


class Event(BaseModel):
    id: str
    type: str  # "Spiel" | "Training" | "Treffen"
    date: str  # ISO date YYYY-MM-DD
    time: str  # HH:MM
    home: Optional[str] = None
    away: Optional[str] = None
    opponent: Optional[str] = None
    location: Optional[str] = None
    title: str
    created_at: Optional[str] = None
    notify_at: Optional[str] = None
    cancelled: Optional[bool] = False


class RSVP(BaseModel):
    event_id: str
    player_id: str
    status: str  # "zugesagt" | "abgesagt"
    reason: Optional[str] = None  # required when status == "abgesagt"


class DrivingBody(BaseModel):
    event_id: str
    player_id: str
    driving: bool


class BeerBody(BaseModel):
    event_id: str
    player_id: str
    beer: bool


class StatusUpdate(BaseModel):
    status: str


class ContactUpdate(BaseModel):
    email: Optional[str] = None
    birthdate: Optional[str] = None
    jersey_number: Optional[int] = None
    avatar_file_id: Optional[str] = None
    spieler_id: Optional[str] = None


class PasswordBody(BaseModel):
    password: str


class ResetPasswordBody(BaseModel):
    code: str
    password: str


class PlayerCreate(BaseModel):
    name: str
    position: Optional[str] = None
    status: str = "Aktiv"


class PlayerUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[str] = None


class EventCreate(BaseModel):
    type: str
    date: str
    time: str
    opponent: Optional[str] = None
    location: Optional[str] = None
    home_game: bool = True


class EventPatch(BaseModel):
    type: Optional[str] = None  # allow coach to reclassify Spiel/Training/Treffen after the fact
    date: Optional[str] = None
    time: Optional[str] = None
    location: Optional[str] = None
    opponent: Optional[str] = None
    home_game: Optional[bool] = None


class MessageBody(BaseModel):
    conversation_id: str
    scope: str  # "team" | "direct"
    sender_id: str
    text: str = ""
    attachment: Optional[dict] = None


class FileInit(BaseModel):
    filename: str
    mime: str
    kind: str  # "image" | "file"


class FileChunk(BaseModel):
    upload_id: str
    index: int
    data: str  # base64 chunk


class FileFinalize(BaseModel):
    upload_id: str


class ReadBody(BaseModel):
    player_id: str
    conversation_id: str


class PushRegisterBody(BaseModel):
    player_id: str
    token: str


class EventsSeenBody(BaseModel):
    player_id: str
