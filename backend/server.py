import logging

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from db import client
from seed import seed_if_empty
from birthday import check_and_send_birthdays
from reminders import check_and_send_rsvp_reminders
from routers import attendance, chat, events, files, misc, players, stats

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

api_router = APIRouter(prefix="/api")
api_router.include_router(misc.router)
api_router.include_router(players.router)
api_router.include_router(events.router)
api_router.include_router(attendance.router)
api_router.include_router(stats.router)
api_router.include_router(chat.router)
api_router.include_router(files.router)

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
    await seed_if_empty()
    await check_and_send_birthdays()
    await check_and_send_rsvp_reminders()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
