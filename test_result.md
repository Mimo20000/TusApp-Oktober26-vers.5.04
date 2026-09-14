#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: >
  TuS Oberhausen II Handball team app. Recent work: (1) Backend refactor of monolithic
  server.py into modules (config/db/models/seed/push/bw_holidays/birthday + routers/*),
  (2) frontend termine.tsx split into components (EventCard/HolidayInsert/EmptyState),
  (3) event edit + cancel by coach with cancelled badge, (4) ICS export marks cancelled
  events as CANCELLED, (5) self-editable Trikotnummer (jersey number) in Kader,
  (6) automatic team-chat birthday message when a player's birthdate matches today.

backend:
  - task: "Backend refactor into modules (routers/*, config, db, models, seed, push, birthday)"
    implemented: true
    working: true
    file: "backend/server.py, backend/routers/*.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "Split monolith. Verified all routes register and core GETs (players, events, stats, conversations) work via curl."
  - task: "Event edit (PATCH /events/{id}) and cancel (POST /events/{id}/cancel)"
    implemented: true
    working: true
    file: "backend/routers/events.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "curl verified PATCH updates time/location and cancel sets cancelled=true; both bump notify_at."
  - task: "Self-editable jersey number via PATCH /players/{id}/contact"
    implemented: true
    working: true
    file: "backend/routers/players.py, backend/models.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "curl: set jersey=7 persists; jersey_number=0 clears to null. Value>0 stored, else null."
  - task: "Automatic birthday team-chat message"
    implemented: true
    working: true
    file: "backend/birthday.py, backend/routers/chat.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "Triggered lazily from GET /unread + startup. Atomic upsert marker prevents duplicates. curl verified single message created for a player whose birthdate matches today; repeated polls do not duplicate."

frontend:
  - task: "Birthdate: allow dates older than 1970"
    implemented: true
    working: "NA"
    file: "frontend/src/PlayerEditSheet.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Native fix: added minimumDate=1940 to DateTimePicker. On WEB the birthdate is a free-text TextInput (JJJJ-MM-TT) with validation; entering a pre-1970 date (e.g. 1965-05-10) should save and display as 10.05.1965. Please verify on web."
  - task: "Chat input text visible / not hidden behind keyboard"
    implemented: true
    working: "NA"
    file: "frontend/app/chat/[id].tsx, frontend/app/_layout.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Switched to react-native-keyboard-controller KeyboardProvider + KeyboardAvoidingView behavior 'translate-with-padding'; added textAlignVertical center. On web verify typed text is visible in the input and message sends."

metadata:
  created_by: "main_agent"
  version: "1.2"
  test_sequence: 4
  run_ui: false

test_plan:
  current_focus:
    - "Stats: past-only calculation + scope toggle (all/season) + streak"
    - "Payments: monthly open-amount summary"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: >
      TWO BUG FIXES to verify (FRONTEND, on web). NOTE: ALL player accounts were reset to "Neu"
      (no password/email/contact, no attendance, no chats). To log in: on the login screen tap any
      player name -> it shows the new-account form -> enter a password (min 4 chars) + confirm +
      a valid email -> tap "Passwort festlegen & anmelden". Use player "Michael MOSER" (michael-moser)
      to get admin (Coach) rights.
      BUG 1 (birthdate pre-1970): Go to Kader tab -> tap your own player name to open the edit sheet ->
      in the "Geburtsdatum" field (free-text on web, format JJJJ-MM-TT) enter a date before 1970 e.g.
      "1965-05-10" -> Speichern. Reopen the sheet / check the Kader row: the birthdate must be saved
      and shown as 10.05.1965 (NOT rejected/blocked). Also try another pre-1970 date like 1968-12-01.
      BUG 2 (chat input visible): Go to Chat tab -> open the Team chat -> type a message in the input
      box at the bottom -> the typed text must be clearly VISIBLE in the input while typing (dark text
      on light field, not hidden/covered) -> tap send -> message appears in the list. Verify the input
      remains visible/usable. (Keyboard-overlap avoidance is a native behavior and can't be fully tested
      on web; just confirm text visibility + send works.)

    -agent: "main"
    -message: >
      NEW WORK to test (stats + Bierkasse management). Backend + frontend.
      Credentials: sascha-grins/test1234 (Bierwart = cashbox recipient, can manage bierwart box),
      josh-ankermann/pw12345 (normal player, NOT a recipient). Do NOT change michael-moser password.
      BACKEND: (1) GET /api/stats?scope=all and ?scope=season — every metric must count PAST events
      only (future events excluded); each player has a `streak` field; response has `scope`.
      (2) GET /api/payments (as sascha) returns per_player_open, monthly_open, manageable_cashboxes(['bierwart']).
      (3) POST /api/payments with payer_id — sascha may log on behalf for bierwart; josh gets 403 for others.
      (4) PATCH /api/payments/{id} {status} — sascha may toggle bierwart entries; josh 403.
      (5) DELETE /api/payments/{id} — sascha may delete bierwart entries; josh 403.
      (6) GET /api/payments/my-open (as josh) returns own open balance grouped by cashbox.
      FRONTEND: Statistik tab has "Alle Jahre/Dieses Jahr" scope chips + "Serie 🔥" mode; rates use past
      events only. Zahlungen tab (login sascha) shows "Eintrag hinzufügen" button+modal (pick player+amount+note),
      "Offen pro Spieler", and per-row "als bezahlt"/"offen" toggle + delete. Kasse button (login josh, tap
      "Kasse" on an event) pre-fills the amount with josh's open balance ("Dein offener Betrag: X €").
