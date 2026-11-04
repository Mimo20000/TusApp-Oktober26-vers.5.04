import os
from pathlib import Path
from pymongo import MongoClient
import bson

MONGO_URI = "mongodb+srv://mimonicara_db_user:X8Bz7uIHvw7xrdR1@cluster0.x1jlmax.mongodb.net/tus-app?retryWrites=true&w=majority"
DB_NAME = "tus-app"

def migrate_local_uploads():
    # Suchen nach dem lokalen 'upload'-Ordner direkt im Backend
    backend_dir = Path(__file__).resolve().parent
    upload_dir = backend_dir / "upload"
    
    if not upload_dir.exists():
        # Falls er stattdessen im Hauptverzeichnis liegt
        upload_dir = backend_dir.parent / "upload"

    if not upload_dir.exists():
        print(f"❌ Fehler: Kein lokaler 'upload'-Ordner gefunden unter {upload_dir}")
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

            # Passenden Mime-Type ermitteln
            mime_type = "image/jpeg"
            if filename.lower().endswith('.png'):
                mime_type = "image/png"
            elif filename.lower().endswith(('.jpg', '.jpeg')):
                mime_type = "image/jpeg"

            # In MongoDB speichern
            doc = {
                "filename": filename,
                "data": bson.Binary(file_data),
                "mime": mime_type
            }
            
            # Mit Upsert einfügen, damit nichts doppelt reinkommt
            collection.update_one({"filename": filename}, {"$set": doc}, upsert=True)
            print(f"📤 Hochgeladen: {filename}")
            count += 1

    print(f"✅ Fertig! {count} Dateien aus dem 'upload'-Ordner wurden erfolgreich in MongoDB Atlas übertragen.")

if __name__ == "__main__":
    migrate_local_uploads()
