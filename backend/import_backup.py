import json
from pathlib import Path
from db import client

def import_json_backup():
    # Sucht nach der backup.json im Projekt (entweder im Hauptverzeichnis oder backend)
    backup_path = Path(__file__).resolve().parent.parent / "backup.json"
    if not backup_path.exists():
        backup_path = Path(__file__).resolve().parent / "backup.json"
    
    if not backup_path.exists():
        print("Fehler: backup.json wurde nicht gefunden!")
        return

    print(f"Lese Backup von: {backup_path}")
    with open(backup_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Holt die Standard-Datenbank aus Ihrer db.py Konfiguration
    db = client.get_default_database()

    # Daten einlesen und in MongoDB schreiben
    for collection_name, docs in data.items():
        if isinstance(docs, list) and docs:
            collection = db[collection_name]
            print(f"Importiere {len(docs)} Einträge in Collection '{collection_name}'...")
            for doc in docs:
                if "_id" in doc:
                    collection.replace_one({"_id": doc["_id"]}, doc, upsert=True)
                else:
                    collection.insert_one(doc)
        elif isinstance(docs, dict):
            # Falls Collections als Dict gespeichert sind
            collection = db[collection_name]
            collection.replace_one({"_id": docs.get("_id", 1)}, docs, upsert=True)

    print("Backup erfolgreich in MongoDB importiert!")

if __name__ == "__main__":
    import_json_backup()
