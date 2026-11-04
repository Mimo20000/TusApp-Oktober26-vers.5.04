import os
from pathlib import Path
from pymongo import MongoClient
import bson

MONGO_URI = "mongodb+srv://mimonicara_db_user:X8Bz7uIHvw7xrdR1@cluster0.x1jlmax.mongodb.net/tus-app?retryWrites=true&w=majority"
DB_NAME = "tus-app"

def migrate_local_uploads():
    # Suchen Sie nach dem lokalen Uploads-Ordner im Backend
    backend_dir = Path(__file__).resolve().parent
    upload_dir = backend_dir / "uploads" # Falls Ihr Ordner anders heißt (z.B. "upload"), hier anpassen!
    
    if not upload_dir.exists():
        # Alternativ im Hauptverzeichnis suchen
        upload_dir = backend_dir.parent / "uploads"

    if not upload_dir.exists():
        print(f"❌ Fehler: Kein lokaler 'uploads'-Ordner gefunden unter {upload_dir}")
        print("Bitte passen Sie den Pfad im Skript an, falls Ihr Ordner anders heißt.")
        return

    print(f"📂 Durchsuche Ordner: {upload_dir}")
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    collection = db["uploads_aus_emergent"]

    count = 0
    for file_path in upload_dir.glob("*.*"):
        if file_path.is_file():
            filename = file_path.name
            # Datei als Binärdaten einlesen
            with open(file_path, "rb") as f:
                file_data = f.read()

            # In MongoDB speichern
            doc = {
                "filename": filename,
                "data": bson.Binary(file_data),
                "mime": "image/jpeg" if filename.lower().endswith(('.jpg', '.jpeg')) else "image/png"
            }
            
            # Mit Upsert einfügen, damit nichts doppelt reinkommt
            collection.update_one({"filename": filename}, {"$set": doc}, upsert=True)
            print(f"📤 Hochgeladen: {filename}")
            count += 1

    print(f"✅ Fertig! {count} Dateien wurden in MongoDB Atlas ('uploads_aus_emergent') übertragen.")

if __name__ == "__main__":
    migrate_local_uploads()
