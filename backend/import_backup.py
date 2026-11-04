import json
import os
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI") or os.getenv("MONGO_URL") or "mongodb://localhost:27017"
DB_NAME = os.getenv("DB_NAME", "tus-app")

def import_json_backup():
    backup_path = Path(__file__).resolve().parent / "tus_backup_allesdrin.json"
    if not backup_path.exists():
        backup_path = Path(__file__).resolve().parent.parent / "tus_backup_allesdrin.json"
    
    if not backup_path.exists():
        print("❌ Fehler: 'tus_backup_allesdrin.json' wurde nicht gefunden!")
        return

    print(f"📂 Lese Backup von: {backup_path}")
    with open(backup_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print(f"🔌 Verbinde mit MongoDB (Datenbank: {DB_NAME})...")
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]

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
