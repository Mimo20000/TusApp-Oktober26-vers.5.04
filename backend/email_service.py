import logging
import os

import resend

import config  # noqa: F401  ensures .env is loaded

logger = logging.getLogger(__name__)

resend.api_key = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")


def send_reset_code(email: str, code: str, name: str):
    """Sends the 6-digit password reset code. Runs as a background task."""
    first = (name or "").split()[0] if name else "Sportsfreund"
    html = f"""
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#DA291C">TuS Oberhausen II</h2>
      <p>Hallo {first},</p>
      <p>du hast angefordert, dein Passwort zurückzusetzen. Dein Code lautet:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#DA291C;
                background:#FEECEB;padding:16px 24px;border-radius:12px;text-align:center">
        {code}
      </p>
      <p>Gib diesen Code in der App ein, um ein neues Passwort zu vergeben.
         Der Code ist 15 Minuten gültig.</p>
      <p style="color:#8A8A8E;font-size:13px">
         Falls du das nicht warst, kannst du diese E-Mail ignorieren.</p>
    </div>
    """
    try:
        resend.Emails.send({
            "from": f"TuS Oberhausen II <{SENDER_EMAIL}>",
            "to": [email],
            "subject": "Passwort zurücksetzen – Dein Code",
            "html": html,
        })
        logger.info("Reset code email sent to %s", email)
    except Exception as e:
        logger.warning("Failed to send reset email to %s: %s", email, e)


def send_rsvp_reminder(email: str, name: str, event: dict, hours_left: int) -> None:
    """Reminder for a player who hasn't answered zusagen/absagen yet.

    Called synchronously from ``reminders.check_and_send_rsvp_reminders`` after
    the atomic upsert marker was inserted, so we're guaranteed to fire at most
    once per (event, player, 3h-slot).
    """
    first = (name or "").split()[0] if name else "Sportsfreund"
    kind = event.get("type") or "Termin"
    opponent = (event.get("opponent") or "").strip()
    title = f"Spiel vs. {opponent}" if kind == "Spiel" and opponent else kind
    date = event.get("date") or ""
    try:
        y, m, d = date.split("-")
        date_de = f"{d}.{m}.{y}"
    except ValueError:
        date_de = date
    time_s = event.get("time") or ""
    location = (event.get("location") or "").strip()
    when = f"{date_de} um {time_s} Uhr" if time_s else date_de
    where_line = f"<p><strong>Ort:</strong> {location}</p>" if location else ""

    if hours_left <= 6:
        urgency = "🚨 Nur noch wenige Stunden – bitte JETZT abstimmen"
    elif hours_left <= 24:
        urgency = f"⏰ In {hours_left} Stunden geht's los"
    else:
        urgency = f"📅 In {hours_left} Stunden ist der nächste Termin"

    html = f"""
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#DA291C;margin-bottom:4px">TuS Oberhausen II</h2>
      <p style="color:#8A8A8E;margin-top:0">{urgency}</p>
      <p>Hallo {first},</p>
      <p>du hast beim folgenden Termin noch <strong>nicht abgestimmt</strong>:</p>
      <div style="background:#FEECEB;border-left:4px solid #DA291C;padding:14px 18px;border-radius:8px;margin:14px 0">
        <p style="margin:0;font-size:16px;font-weight:bold;color:#1A1A1A">{title}</p>
        <p style="margin:6px 0 0 0;color:#4A4A4A"><strong>Wann:</strong> {when}</p>
        {where_line}
      </div>
      <p>Bitte öffne die App und tippe auf <strong>Zusagen</strong> oder <strong>Absagen</strong>,
         damit dein Team planen kann.</p>
      <p style="color:#8A8A8E;font-size:12px;margin-top:24px">
         Diese Erinnerung wird alle drei Stunden versendet, bis du abgestimmt hast oder der Termin beginnt.
         Sobald du geantwortet hast, hört sie automatisch auf.
      </p>
    </div>
    """
    try:
        resend.Emails.send({
            "from": f"TuS Oberhausen II <{SENDER_EMAIL}>",
            "to": [email],
            "subject": f"⏰ Bitte abstimmen: {title} – {when}",
            "html": html,
        })
        logger.info("RSVP reminder email sent to %s for event %s", email, event.get("id"))
    except Exception as e:
        logger.warning("Failed to send RSVP reminder email to %s: %s", email, e)
