from pymongo import MongoClient

MONGO_URI = "mongodb+srv://mimonicara_db_user:X8Bz7uIHvw7xrdR1@cluster0.x1jlmax.mongodb.net/tus-app?retryWrites=true&w=majority"
DB_NAME = "tus-app"

def link_player_avatars():
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    
    players_col = db["players"]
    uploads_col = db["uploads_aus_emergent"]
    
    players = list(players_col.find({}))
    uploads = list(uploads_col.find({}))
    
    # Erstelle ein Mapping von Dateinamen (ohne Endung) zu Datei-IDs
    upload_map = {}
    for up in uploads:
        filename = up.get("filename", "")
        # Dateinamen ohne Endung (z.B. "fabian-galau") als Key
        name_without_ext = filename.rsplit(".", 1)[0].lower()
        upload_map[name_without_ext] = str(up["_id"])

    linked_count = 0
    for player in players:
        player_id = player.get("id") # z.B. "fabian-galau"
        if player_id and player_id.lower() in upload_map:
            file_id = upload_map[player_id.lower()]
            players_col.update_one(
                {"_id": player["_id"]},
                {"$set": {"avatar_file_id": file_id}}
            )
            print(gr := f"🔗 Verknüpft: Spieler '{player_id}' mit Bild-ID {file_id}")
            linked_count += 1

    print(f"✅ Fertig! {linked_count} Spieler wurden erfolgreich mit ihren Avataren verknüpft.")

if __name__ == "__main__":
    link_player_avatars()
