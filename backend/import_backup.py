import json
from pathlib import Path
from db import client

def import_json_backup():
    # Sucht nach der backup-Datei im Hauptverzeichnis oder im backend-Ordner
    backup_path = Path(__file__).resolve().parent.parent / "tus_backup_allesdrin.json"
    if not backup_path.exists():
        backup_path = Path(__file__).resolve().parent / "tus_backup_allesdrin.json"
    
    if not backup_path.exists():
        print(f"Fehler: Die Datei '{backup_path.name}' wurde nicht gefunden!")
        return

    print(f"Lese Backup von: {backup_path}")
    with open(backup_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Holt die Standard-Datenbank aus der db.py
    db = client.get_default_database()

    # Alle Schlüssel (players, events, messages, cashboxes etc.) durchgehen und importieren
    for collection_name, docs in data.items():
        if isinstance(docs, list) and docs:
            collection = db[collection_name]
            print(f"Importiere {len(docs)} Einträge in Collection '{collection_name}'...")
            for doc in docs:
                # Versuche über 'id' oder '_id' eindeutig zuzuordnen
                query_key = "_id" if "_id" in doc else ("id" if "id" in doc else None)
                if query_key and doc[query_key] is not None:
                    collection.replace_one({query_key: doc[query_key]}, doc, upsert=True)
                else:
                    collection.insert_one(doc)

    print("✅ Backup 'tus_backup_allesdrin.json' erfolgreich in MongoDB importiert!")

if __name__ == "__main__":
    import_json_backup()
