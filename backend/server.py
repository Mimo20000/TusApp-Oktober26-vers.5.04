import logging
from pathlib import Path

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from db import client
from seed import seed_if_empty
from birthday import check_and_send_birthdays
from reminders import check_and_send_rsvp_reminders
from routers import attendance, chat, events, files, misc, players, stats, cashboxes, bwhv, carpool
from routers.cashboxes import seed_cashboxes_if_empty

# 1. Erst die FastAPI-Instanz erstellen
app = FastAPI()

# 2. Automatischen und sicheren Pfad zum upload-Ordner ermitteln
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "upload"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 3. Sicher mounten
app.mount("/upload", StaticFiles(directory=str(UPLOAD_DIR)), name="upload")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.get("/")
async def root():
    return {"message": "TuS App Backend läuft!", "status": "online"}

api_router = APIRouter(prefix="/api")
api_router.include_router(misc.router)
api_router.include_router(players.router)
api_router.include_router(events.router)
api_router.include_router(attendance.router)
api_router.include_router(stats.router)
api_router.include_router(chat.router)
api_router.include_router(files.router)
api_router.include_router(cashboxes.router)
api_router.include_router(bwhv.router)
api_router.include_router(carpool.router)

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        await seed_if_empty()
    except Exception as e:
        logger.error(f"Fehler bei seed_if_empty: {e}")

    try:
        await seed_cashboxes_if_empty()
    except Exception as e:
        logger.error(f"Fehler bei seed_cashboxes_if_empty: {e}")

    try:
        await check_and_send_birthdays()
    except Exception as e:
        logger.error(f"Fehler bei check_and_send_birthdays: {e}")

    try:
        await check_and_send_rsvp_reminders()
    except Exception as e:
        logger.error(f"Fehler bei check_and_send_rsvp_reminders: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
