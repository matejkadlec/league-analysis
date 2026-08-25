"""SMTP transport for the auth feature.

Owns the one question both mail flows ask -- is delivery configured? -- and
the one blocking send they must offload to a thread. The envelope sender is
transport configuration, so it is stamped here, not at each call site.
"""

import asyncio
import smtplib
from email.message import EmailMessage

from app.core.config import get_global_settings


def smtp_configured() -> bool:
    """Return True when SMTP delivery settings are configured."""
    settings = get_global_settings()
    return bool(settings.smtp_host and settings.smtp_from_email)


async def send_smtp_message(message: EmailMessage) -> None:
    """Stamp the configured sender on a message and send it, off the loop."""
    settings = get_global_settings()
    message["From"] = settings.smtp_from_email
    smtp_host = settings.smtp_host
    smtp_port = settings.smtp_port
    smtp_username = settings.smtp_username
    smtp_password = settings.smtp_password
    smtp_use_tls = settings.smtp_use_tls
    smtp_use_ssl = settings.smtp_use_ssl

    def send_blocking() -> None:
        if smtp_use_ssl:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10) as smtp:
                if smtp_username:
                    smtp.login(smtp_username, smtp_password)
                smtp.send_message(message)
            return

        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as smtp:
            if smtp_use_tls:
                smtp.ehlo()
                smtp.starttls()
                smtp.ehlo()
            if smtp_username:
                smtp.login(smtp_username, smtp_password)
            smtp.send_message(message)

    await asyncio.to_thread(send_blocking)
