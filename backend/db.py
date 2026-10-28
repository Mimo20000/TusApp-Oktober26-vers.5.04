import os

from motor.motor_asyncio import AsyncIOMotorClient

import config  # noqa: F401  ensures .env is loaded before reading env vars

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]
