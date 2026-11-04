import json
import os
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv

# Lädt Umgebungsvariablen aus einer eventuellen .env Datei
load_dotenv()

# Holt die MongoDB-URI aus der Umgebung oder nutzt Standard-lokal/Atlas
MONGO_URI = os.getenv("MONGO_URI") or os.getenv("MONGO_URL") or "mongodb://localhost:27017"

def import_json_backup():
    # Sucht nach der tus_backup_allesdrin.json im backend-Ordner oder Hauptverzeichnis
    backup_path = Path(__file__).resolve().parent / "tus_backup_allesdrin.json"
    if not backup_path.exists():
        backup_path = Path(__file__).resolve().parent.parent / "tus_backup_allesdrin.json"
    
    if not backup_path.exists():
        print(f"❌ Fehler: 'tus_backup_allesdrin.json' wurde nicht gefunden!")
        return

    print(f"📂 Lese Backup von: {backup_path}")
    with open(backup_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print(f"🔌 Verbinde mit MongoDB...")
    client = MongoClient(MONGO_URI)
    db = client.get_default_database()

    # Alle Collections aus dem Backup importieren (players, events, messages, carpools, cashboxes etc.)
    for collection_name, docs in data.items():
        if isinstance(docs, list) and docs:
            collection = db[collection_name]
            print(f"📥 Importiere {len(docs)} Einträge in Collection '{collection_name}'...")
            for doc in docs:
                filter_query = {}
                if "_id" in doc and doc["_id"] is not None:
                    filter_query = {"_id": doc["_id"]}
                elif "id" in doc and doc["id"] is not None:
                    filter_query = {"id": doc["id"]}
                
                if filter_query:
                    collection.replace_one(filter_query, doc, upsert=True)
                else:
                    collection.insert_one(doc)

    print("✅ Backup 'tus_backup_allesdrin.json' erfolgreich in MongoDB importiert!")

if __name__ == "__main__":
    import_json_backup()
