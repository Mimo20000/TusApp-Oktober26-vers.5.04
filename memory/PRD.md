# PRD — TuS Oberhausen II Handball Team App

## Original Problem Statement
German handball team app: player roster, trainings & match dates with confirm/decline, participation statistics, TuS Oberhausen club logo, and a sheet table. Extended by user with: password login, calendar to add events, Treffen type, "Ich fahre"/"Bringe Bier" buttons, chat + notifications, live league table, holidays.

## Architecture
- Backend: FastAPI + MongoDB (motor). Auto-seed. JWT (pyjwt) + bcrypt (passlib). httpx for handball.net + Expo push. Routes under /api.
- Frontend: Expo Router (SDK 54). Plus Jakarta Sans, Ionicons, expo-image, expo-linear-gradient, expo-sharing/file-system, @react-native-community/datetimepicker, expo-notifications/expo-device.
- Session: player + JWT (secure storage) via `@/src/utils/storage`.
- Tabs (6): Termine, Chat, Kader, Statistik, Anwesenheit (sheet), Tabelle (league).

## Data
- 18 players (name, position, status, email, birthdate, password_hash, push_token).
- 12 games (Spiel) Oct 2026–Apr 2027 + weekly Thursday 19:00 trainings from today through 2031 + coach-added Treffen.

## Fixed (2026-08, v3.0.1)
- [x] **Trikotnummer-Sperre gegen Doppelvergabe**: `PATCH /players/{id}/contact` prüft jetzt Uniqueness und lehnt mit HTTP 409 ab, wenn eine Nummer schon vergeben ist ("Trikotnummer 7 ist bereits an X vergeben."). Frontend liest die Detail-Message aus (`api.ts`) und zeigt sie im Edit-Sheet. Zusätzliche UX: unter dem Trikotnummer-Feld sieht der User eine sortierte Liste "Bereits vergeben: 4, 7, 10 …" sowie eine sofort erscheinende Live-Warnung "⚠️ Nr. 7 gehört Peter HAHNER. Bitte andere wählen.", sobald eine kollidierende Nummer getippt wird.
- [x] **Trikotnummer-Avatar-Fallback**: Wenn ein Spieler kein Profilfoto hat, aber eine Trikotnummer, zeigt der Avatar-Kreis groß die Nummer (statt Positions-Kürzel oder Personen-Icon). Sowohl in der Kader-Liste als auch im Edit-Sheet. Fallback-Kette: Foto → Trikotnummer → Positions-Kürzel → "?".
- [x] **Kader "Speichern" macht die Änderungen wieder sichtbar**: `GET /api/players` lieferte PII (E-Mail, Geburtsdatum, Trikotnummer, SpielerID, Foto) nur an anonyme Login-Screen-Aufrufer und blendete sie für die Kader-Liste eingeloggter User aus. Neu: Auth-Header wird an `/players` mitgeschickt (`api.ts` PUBLIC_PATHS aktualisiert), Backend nutzt `OptionalPlayer`-Dependency und liefert die vollen Felder, wenn ein gültiger JWT vorliegt (`routers/players.py`, `auth.py`). Ergebnis: gespeicherte Trikotnummer/Geburtsdatum/SpielerID erscheinen sofort in der Karte und im Edit-Sheet.

## Implemented (2026-08, v3.0.1)
- [x] **Version-Bump auf 3.0.1** in `app.json` und `public/sw.js` (`SW_VERSION`), damit PWA-Nutzer beim nächsten Besuch automatisch die neueste Version ziehen und ein neuer Android-Build (APK 3.0.1) erzeugt werden kann.
- [x] Sitzungs-Handling: Bei 401-Antworten werden Token + Player-Cache automatisch verworfen und die App zeigt "Sitzung abgelaufen. Bitte erneut anmelden." (fix für "Spielerdaten nicht speicherbar" nach JWT-Rollout).
- [x] SpielerID (Handball360 SL-ID) Profilfeld editierbar via `PATCH /api/players/{id}/contact`.
- [x] JWT-Sicherheits-Hardening: alle sensiblen Endpunkte via `Depends(get_current_player)`; keine Body-Spoofing-Identitäten mehr.
- [x] Mandatory decline-reason + Auto-DM an Coach bei Absage.
- [x] "Bringe Bier"-Button (Trainings) / "Ich fahre" nur bei Auswärtsspielen.
- [x] Coach: Event-Typ nachträglich änderbar.
- [x] RSVP-E-Mail-Reminder via `/unread`.
- [x] Player-Fotos + Pillow-Thumbnails im Kader.
- [x] Google-Maps-Route-Button bei Auswärtsspielen; Chat-Input über Soft-Keyboard (visualViewport-Hook).
- [x] PayPal-Bierkasse via `paypal.me` deep-link (voll-integrierter Webhook-Capture pending → benötigt PayPal-Sandbox-Keys).

## Implemented (2026-07-27, v2.0)
- [x] **PWA-fähig**: `/public/manifest.json` (id="Mimos App", name="Tus2 by Mimo 2.0"), Service Worker (`sw.js`) mit versionierten Caches (`tus2-mimo-2.0.0`), skipWaiting + clients.claim, controllerchange-Reload. Bestehende Installationen bekommen Updates automatisch, ohne Neu-Installation. Login-Screen zeigt "Version 2.0" Badge. Server-Daten (MongoDB) und Client-Session bleiben beim Update erhalten.
- [x] **Google-Maps-Route-Button** neben Hallenname bei Auswärtsspielen (nicht bei Heimspielen, Training, Treffen, abgesagten Terminen). Testkennung `maps-<event_id>` in EventCard und `maps-detail-<event_id>` in Event-Detail. Öffnet Apple Maps auf iOS, Google Maps sonst.
- [x] **Chat-Input bleibt über der Bildschirmtastatur sichtbar**: Web-PWA nutzt `window.visualViewport`-Hook `useWebKeyboardInset`, der die Input-Leiste exakt um die Höhe des Soft-Keyboards anhebt. Native (iOS/Android) verwendet KeyboardAvoidingView aus `react-native-keyboard-controller` mit `padding`/`translate-with-padding`.

## Implemented (2026-07-12)
- [x] Password login (self-chosen), name selection + JWT; "Neu"/lock badges.
- [x] Termine: filter chips (Alle/Spiele/Trainings/Treffen), Zusagen/Absagen; "Ich fahre" (Spiele), "Bringe Bier" (Trainings); Ferien/Feiertage BW inserts; ICS calendar export/share.
- [x] Kader: email (mailto button) + birthdate editable by self; coach edits status/any; PlayerEditSheet.
- [x] Statistik: attendance % per player, rankings, mode chips (Gesamt/Spiele/Trainings/Gefahren/Bier gebracht).
- [x] Kader: selbst editierbare Trikotnummer (1–99), Anzeige als Badge am Avatar + in Zeile.
- [x] Auto-Geburtstagsnachricht im Team-Chat (bei ausgefülltem Geburtsdatum, 1×/Jahr, mit Push).
- [x] Auto-Team-Chat-Nachricht mit Name beim Aktivieren/Deaktivieren von "Ich fahre" (🚗/🚗❌) bzw. "Bringe Bier" (🍺/🍺❌); nur bei Zustandswechsel, kein Spam.
- [x] Termin-Detailansicht (alle Spieler): Zusagen/Absagen/Offen + Fahrer/Bier mit Name, Trikotnummer & E-Mail; Personen-Icon auf Terminkarte.
- [x] Dauerhaft angemeldet bleiben bis manueller Logout (robuste Session-Wiederherstellung, auch offline).
- [x] Passwort vergessen: 6-stelliger Code per E-Mail (Resend) an hinterlegte Adresse, Code + neues Passwort → Auto-Login.
- [x] Anwesenheit: players×events sheet, sticky column, CSV export.
- [x] Tabelle: live league standings from handball.net (empty-state pre-season).
- [x] Chat: team chat + 1:1 direct, unread badges (tab + rows), polling; push scaffold (Expo token register + backend send).
- [x] Coach (Michael MOSER) admin: add events via calendar FAB.
- [x] Coach: Termine **bearbeiten** (Datum/Uhrzeit/Ort/Gegner) & **absagen** via Bearbeiten-Icon; abgesagte Termine mit "Abgesagt"-Badge + durchgestrichen; Push "Termin geändert"/"Termin abgesagt".

## Backlog / Next
- P1: Real push delivery needs publish + native build + google-services.json (Firebase). EMERGENT_PUSH_KEY auto-set at deploy.
- P1: Chat group channels; message delete/edit; typing indicator.
- P2: Migrate FastAPI on_event to lifespan; paginate chat/messages.
- P2: League table auto-refresh caching.

## Next Tasks
1. After user publishes + builds: verify push notifications with google-services.json.
2. Event detail with per-player RSVP/driving/beer overview.
