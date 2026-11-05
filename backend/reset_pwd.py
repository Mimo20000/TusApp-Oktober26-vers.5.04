import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
import os
from dotenv import load_dotenv

load_dotenv()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

async def reset_password():
    # Holt die MongoDB URL aus den Umgebungsvariablen oder direkt einsetzen
    mongo_url = os.getenv("MONGO_URL", "HIER_FALLS_NÖTIG_DEINE_ATLAS_URL_EINTRAGEN")
    client = AsyncIOMotorClient(mongo_url)
    db = client["tus-app"]
    
    new_password_raw = "Rucksack"
    hashed_password = pwd_context.hash(new_password_raw)
    
    result = await db.players.update_one(
        {"username": "michael-moser"}, # oder {"id": "michael-moser"} je nach Feldname
        {"$set": {"password": hashed_password}}
    )
    
    if result.modified_count > 0:
        print("✅ Passwort für michael-moser erfolgreich aktualisiert!")
    else:
        # Falls der Username anders heißt, probieren wir das 'id'-Feld
        result2 = await db.players.update_one(
            {"id": "michael-moser"},
            {"$set": {"password": hashed_password}}
        )
        if result2.modified_count > 0:
            print("✅ Passwort über ID erfolgreich aktualisiert!")
        else:
            print("❌ Spieler michael-moser nicht gefunden. Prüfe das Feld in MongoDB.")

if __name__ == "__main__":
    asyncio.run(reset_password())
