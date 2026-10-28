"""Retention policy for team chat messages.

Team members explicitly requested that chats disappear after 14 days so
old banter, mid-season strategy, and stale attachments don't linger
forever. We implement it as a lazy cleanup: whenever `/api/messages`
is called we check if the last cleanup ran more than 6 hours ago and,
if so, delete every message whose `created_at` is older than the
retention window.

Deleting on GET keeps the app free of long-running schedulers and works
identically on the preview and production K8s pods.
"""

from datetime import datetime, timedelta, timezone
import logging

from db import db

CHAT_RETENTION_DAYS = 14
CLEANUP_INTERVAL_HOURS = 6
_KEY = "chat_retention_cleanup"

logger = logging.getLogger(__name__)


async def cleanup_old_chats_if_due() -> int:
    """Delete messages older than the retention window when the last run
    was more than `CLEANUP_INTERVAL_HOURS` ago.

    Returns the number of messages deleted (0 if the throttle skipped the
    run). Safe to call from any request path — throws no exceptions.
    """
    try:
        now = datetime.now(timezone.utc)
        last = await db.system_events.find_one({"key": _KEY})
        if last and last.get("at"):
            try:
                last_at = datetime.fromisoformat(last["at"])
                if last_at.tzinfo is None:
                    last_at = last_at.replace(tzinfo=timezone.utc)
                if now - last_at < timedelta(hours=CLEANUP_INTERVAL_HOURS):
                    return 0
            except ValueError:
                pass
        cutoff = (now - timedelta(days=CHAT_RETENTION_DAYS)).isoformat()
        res = await db.messages.delete_many({"created_at": {"$lt": cutoff}})
        await db.system_events.update_one(
            {"key": _KEY},
            {"$set": {"at": now.isoformat(), "deleted": res.deleted_count}},
            upsert=True,
        )
        if res.deleted_count:
            logger.info(
                "chat retention: deleted %d messages older than %s",
                res.deleted_count,
                cutoff,
            )
        return res.deleted_count
    except Exception:
        logger.exception("chat retention cleanup failed")
        return 0
