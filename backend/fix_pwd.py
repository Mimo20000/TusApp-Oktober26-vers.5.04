import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
import bcrypt
from dotenv import load_dotenv

load_dotenv()

async def update_pwd():
    mongo_url = os.getenv("MONGO_URL")
    client = AsyncIOMotorClient(mongo_url)
    db = client["tus-app"]
    
    # Passwort 'Rucksack' mit bcrypt hashen
    hashed = bcrypt.hashpw("Rucksack".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    
    result = await db.players.update_one(
        {"id": "michael-moser"},
        {"$set": {"password": hashed}}
    )
    print(f"✅ Aktualisiert: {result.modified_count} Dokument(e)")

if __name__ == "__main__":
    asyncio.run(update_pwd())
