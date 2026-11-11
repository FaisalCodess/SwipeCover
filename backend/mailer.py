"""Sends the game's emails (password resets) through any SMTP server, such as a Gmail account.

Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD (and optionally SMTP_PORT, SMTP_FROM) to turn it on.
Port 465 uses SSL; anything else uses STARTTLS. Without these the reset feature stays off.
"""
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

log = logging.getLogger("swipecover.mail")


def _setting(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def mail_enabled() -> bool:
    return bool(_setting("SMTP_HOST") and _setting("SMTP_USER") and _setting("SMTP_PASSWORD"))


def send_mail(to: str, subject: str, body: str) -> bool:
    """Returns whether it went out. Never raises, so a mail problem cannot break a request."""
    if not mail_enabled():
        return False
    host, user = _setting("SMTP_HOST"), _setting("SMTP_USER")
    port = int(_setting("SMTP_PORT", "587") or 587)
    message = EmailMessage()
    message["From"] = _setting("SMTP_FROM") or user
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    try:
        context = ssl.create_default_context()
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=context, timeout=15) as server:
                server.login(user, _setting("SMTP_PASSWORD"))
                server.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=15) as server:
                server.starttls(context=context)
                server.login(user, _setting("SMTP_PASSWORD"))
                server.send_message(message)
    except Exception:
        log.exception("Could not send an email")
        return False
    return True
