from pathlib import Path
from pymongo import MongoClient

MONGO_URI = "mongodb+srv://mimonicara_db_user:X8Bz7uIHvw7xrdR1@cluster0.x1jlmax.mongodb.net/tus-app?retryWrites=true&w=majority"
DB_NAME = "tus-app"

def fix_player_avatars():
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    
    backend_dir = Path(__file__).resolve().parent
    upload_dir = backend_dir / "upload"
    
    if not upload_dir.exists():
        print("❌ 'upload'-Ordner nicht gefunden!")
        return

    # Alle vorhandenen Dateinamen im Ordner sammeln (z.B. "michael-moser.jpg")
    files = {f.name.lower(): f.name for f in upload_dir.glob("*.*") if f.is_file()}
    
    players = list(db["players"].find({}))
    updated = 0
    
    for player in players:
        pid = player.get("id", "").lower() # z.B. "michael-moser"
        
        # Suche nach passenden Dateien (mit .jpg, .png etc.)
        matched_filename = None
        for ext in [".jpg", ".jpeg", ".png"]:
            candidate = f"{pid}{ext}"
            if candidate in files:
                matched_filename = candidate
                break
        
        if matched_filename:
            # Wir speichern den Dateinamen direkt als avatar_file_id, 
            # damit die StaticFiles-Route /upload/{filename} greift!
            db["players"].update_one(
                {"_id": player["_id"]},
                {"$set": {"avatar_file_id": matched_filename}}
            )
            print(f"🔗 Avatar gesetzt für {player.get('name')}: {matched_filename}")
            updated += 1

    print(f"✅ Fertig! {updated} Spieler-Avatare wurden aktualisiert.")

if __name__ == "__main__":
    fix_player_avatars()
