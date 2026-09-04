"""
Twilio SMS Service for RecoverAI.
Dispatches real SMS containing Razorpay recovery links to customer phones.
"""

import os
from typing import Dict, Any, Optional

try:
    from twilio.rest import Client
    HAS_TWILIO = True
except ImportError:
    HAS_TWILIO = False


def format_phone_e164(phone: str) -> str:
    """Ensures phone number has international country code format (e.g. +91...)."""
    clean = str(phone).strip().replace(" ", "").replace("-", "")
    if clean.startswith("+"):
        return clean
    if len(clean) == 10:
        return f"+91{clean}"
    if clean.startswith("91") and len(clean) == 12:
        return f"+{clean}"
    return f"+{clean}"


def send_recovery_sms(
    to_phone: str,
    message_body: str,
) -> Dict[str, Any]:
    """
    Sends an SMS via Twilio API.
    Returns delivery receipt or simulated fallback if credentials not yet configured.
    """
    from dotenv import load_dotenv
    load_dotenv(override=True)
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    if os.path.exists(env_file):
        load_dotenv(env_file, override=True)

    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    auth_token  = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    from_number = os.getenv("TWILIO_FROM_NUMBER", "+17372212163").strip()
    target_phone = format_phone_e164(to_phone or os.getenv("DEFAULT_CUSTOMER_PHONE", "+919234633668"))

    if not HAS_TWILIO or not account_sid or not auth_token:
        print(f"[SMS Simulator] Would send to {target_phone}: {message_body}")
        return {
            "status":      "simulated",
            "message_sid": f"SM_mock_{abs(hash(message_body)) % 10000000:07d}",
            "to":          target_phone,
            "from":        from_number,
            "body":        message_body,
            "is_mock":     True,
            "note":        "Configure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in backend/.env for live dispatch.",
        }

    try:
        client = Client(account_sid, auth_token)
        try:
            msg = client.messages.create(
                to=target_phone,
                from_=from_number,
                body=message_body,
            )
        except Exception as initial_err:
            # Twilio trial accounts only permit predefined templates (e.g. sms_event_notifications)
            if "Trial accounts can only use predefined SMS templates" in str(initial_err):
                print("[Twilio SMS] Trial account detected — falling back to trial template 'sms_event_notifications'")
                msg = client.messages.create(
                    to=target_phone,
                    from_=from_number,
                    body="sms_event_notifications",
                )
            else:
                raise initial_err

        print(f"[Twilio SMS] Successfully dispatched SMS to {target_phone} (SID: {msg.sid})")
        return {
            "status":      "sent",
            "message_sid": msg.sid,
            "to":          target_phone,
            "from":        from_number,
            "body":        message_body,
            "is_mock":     False,
        }
    except Exception as e:
        print(f"[Twilio SMS Error] Failed to send SMS: {e}")
        return {
            "status":      "failed",
            "error":       str(e),
            "to":          target_phone,
            "from":        from_number,
            "is_mock":     False,
        }


def send_recovery_link_sms(
    to_phone: str,
    case_id: str,
    amount_inr: float,
    payment_url: str,
    custom_text: Optional[str] = None,
) -> Dict[str, Any]:
    """Generates standard recovery copy and dispatches SMS."""
    if custom_text and payment_url in custom_text:
        body = custom_text
    elif custom_text:
        body = f"{custom_text}\n\nRecovery Link: {payment_url}"
    else:
        body = (
            f"RecoverAI: Your payment of INR {amount_inr:.0f} (Case #{case_id}) was declined. "
            f"Tap to complete payment securely via Razorpay: {payment_url}"
        )
    return send_recovery_sms(to_phone=to_phone, message_body=body)
