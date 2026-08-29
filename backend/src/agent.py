"""
Agent Module for RecoverAI.
Implements:
  - Recovery state machine (explicit states, no hardcoded strings)
  - Case diagnostic engine (natural language reasoning)
  - LLM-powered (Gemini) dunning message generator with template fallback
  - LLM-powered PTP response parser with false-positive-safe regex fallback
"""

import os
import re
import json
import datetime
from enum import Enum
from typing import Dict, Any, Optional, List
from pydantic import BaseModel

# ─────────────────────────────────────────────────────────────
# Recovery State Machine
# ─────────────────────────────────────────────────────────────

class RecoveryState(str, Enum):
    # Lifecycle states
    DETECTED           = "DETECTED"
    DIAGNOSED          = "DIAGNOSED"
    ACTION_SELECTED    = "ACTION_SELECTED"
    POLICY_CHECK       = "POLICY_CHECK"
    BLOCKED            = "BLOCKED"
    ESCALATED          = "ESCALATED"
    ACTION_EXECUTED    = "ACTION_EXECUTED"
    AWAITING_OUTCOME   = "AWAITING_OUTCOME"
    RECOVERED          = "RECOVERED"
    FAILED             = "FAILED"

    # Customer communication branch
    CUSTOMER_RESPONSE  = "CUSTOMER_RESPONSE"
    PTP_RECEIVED       = "PTP_RECEIVED"
    SCHEDULED          = "SCHEDULED"
    VERIFY_PAYMENT     = "VERIFY_PAYMENT"
    FAILED_RAIL        = "FAILED_RAIL"
    NEW_LINK_SENT      = "NEW_LINK_SENT"

    # Terminal states
    OPT_OUT_CLOSED     = "OPT_OUT_CLOSED"
    HUMAN_HANDOFF      = "HUMAN_HANDOFF"
    CLOSED             = "CLOSED"


# ─────────────────────────────────────────────────────────────
# Pydantic output models
# ─────────────────────────────────────────────────────────────

class AgentDiagnosis(BaseModel):
    case_id: str
    risk_level: str                         # HIGH, MEDIUM, LOW
    recovery_probability: float
    recommended_action: str
    expected_recovery_inr: float
    reasoning: str
    state: RecoveryState


class PTPParseResult(BaseModel):
    raw_text: str
    intent: str                             # PROMISE_TO_PAY, PAY_NOW, FAILED_RAIL, REFUSAL_OPT_OUT, QUERY
    promised_date: Optional[str] = None    # YYYY-MM-DD if applicable
    sentiment: str                          # POSITIVE, NEUTRAL, NEGATIVE
    confidence: float
    recommended_next_state: RecoveryState
    parse_method: str = "fallback"         # "llm" or "fallback"


# ─────────────────────────────────────────────────────────────
# RecoveryAgent
# ─────────────────────────────────────────────────────────────

class RecoveryAgent:

    def __init__(self):
        self.llm_api_key = os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY", "")
        self._gemini_model = None
        if self.llm_api_key:
            self._init_gemini()

    def _init_gemini(self):
        """Initialises the Gemini SDK client."""
        try:
            import google.generativeai as genai
            genai.configure(api_key=self.llm_api_key)
            self._gemini_model = genai.GenerativeModel("gemini-2.0-flash")
            print("[Agent] Gemini model initialised.")
        except Exception as e:
            print(f"[Agent] Gemini initialisation failed — using fallback parser: {e}")
            self._gemini_model = None

    # ─────────────────────────────────────────────────────────
    # Case Diagnosis
    # ─────────────────────────────────────────────────────────

    def diagnose_case(
        self,
        case: Dict[str, Any],
        recovery_prob: float,
        proposed_action: str,
    ) -> AgentDiagnosis:
        """
        Generates a diagnostic explanation and sets the correct recovery state.
        Does NOT bypass ML or guardrails — purely interpretive.
        """
        case_id       = str(case.get('case_id', 'UNKNOWN'))
        amount        = float(case.get('amount_inr', 0.0))
        tenure        = int(case.get('customer_tenure_days', 0))
        prior_sr      = float(case.get('prior_success_rate', 0.0))
        failure_class = str(case.get('failure_class_at_decision', 'UNKNOWN'))
        retries       = int(case.get('retries_used_before', 0))
        segment       = str(case.get('segment', 'GENERAL'))

        # Risk level from recovery probability
        if recovery_prob >= 0.65:
            risk_level = "LOW"
        elif recovery_prob >= 0.35:
            risk_level = "MEDIUM"
        else:
            risk_level = "HIGH"

        # Expected recovery value
        erv = round(recovery_prob * amount, 2)

        # Build reasoning
        parts = [
            f"Case #{case_id} ({segment}): ₹{amount:,.0f} at risk — failure: {failure_class}.",
        ]
        if prior_sr > 0.65:
            parts.append(
                f"Strong payment history ({prior_sr*100:.0f}% success rate, {tenure}d tenure)."
            )
        else:
            parts.append(
                f"Lower payment history ({prior_sr*100:.0f}% success rate)."
            )
        if retries == 0:
            parts.append("First failure — recovery probability is highest now.")
        elif retries >= 2:
            parts.append(f"{retries} prior retries used — conventional retry less effective.")

        parts.append(
            f"P(recovery) = {recovery_prob:.2f}. "
            f"Expected recovery value = ₹{erv:,.0f}. "
            f"Recommended: {proposed_action}."
        )

        return AgentDiagnosis(
            case_id=case_id,
            risk_level=risk_level,
            recovery_probability=recovery_prob,
            recommended_action=proposed_action,
            expected_recovery_inr=erv,
            reasoning=" ".join(parts),
            state=RecoveryState.ACTION_SELECTED,
        )

    # ─────────────────────────────────────────────────────────
    # Dunning Message Generation
    # ─────────────────────────────────────────────────────────

    def generate_dunning_message(
        self,
        case: Dict[str, Any],
        channel: str = "WHATSAPP",
        locale: str  = "HI_EN",
    ) -> Dict[str, str]:
        """
        Generates personalized dunning copy.
        Uses Gemini if available, otherwise deterministic template fallback.
        LLM is never allowed to invent amounts, URLs, or payment status.
        """
        amount        = float(case.get('amount_inr', 0.0))
        case_id       = str(case.get('case_id', ''))
        failure_class = str(case.get('failure_class_at_decision', 'payment issue'))
        payment_url   = f"https://rzp.io/i/rec_{case_id or 'pay'}"
        failure_reason = failure_class.replace('_', ' ').title()

        body = None
        method = "template"

        if self._gemini_model:
            try:
                body, method = self._llm_dunning(
                    amount, case_id, failure_reason, payment_url, channel, locale
                )
            except Exception as e:
                print(f"[Agent] LLM dunning failed — using template: {e}")

        if body is None:
            body = self._template_dunning(amount, case_id, failure_reason, payment_url, channel, locale)

        return {
            "channel":      channel,
            "locale":       locale,
            "message_body": body,
            "payment_link": payment_url,
            "method":       method,
        }

    def _llm_dunning(
        self,
        amount: float,
        case_id: str,
        failure_reason: str,
        payment_url: str,
        channel: str,
        locale: str,
    ) -> tuple:
        """Calls Gemini to generate dunning message. Returns (body, 'llm')."""
        lang_instruction = (
            "Write in Hinglish (Hindi + English mix)." if locale in ("HI_EN", "HI")
            else "Write in English."
        )
        channel_instruction = {
            "WHATSAPP": "Write a friendly WhatsApp message (max 300 chars). Use 1-2 emojis.",
            "SMS":      "Write a compact SMS (max 160 chars). No emojis.",
            "EMAIL":    "Write a professional email with Subject line then body.",
            "UPI_INTENT": "Write a short UPI payment notification (max 100 chars).",
        }.get(channel, "Write a short message.")

        prompt = f"""You are generating a payment recovery message for a subscription service.

STRICT RULES — never violate these:
- Do NOT invent or modify the amount, payment URL, or payment status
- Do NOT make promises on behalf of the business
- Do NOT add fees, threats, or penalties not mentioned

Context:
- Amount due: ₹{amount:,.2f}
- Subscription ID: #{case_id}
- Failure reason: {failure_reason}
- Payment link: {payment_url}

{lang_instruction}
{channel_instruction}

Output ONLY the message text. No preamble, no explanation."""

        response = self._gemini_model.generate_content(prompt)
        return response.text.strip(), "llm"

    def _template_dunning(
        self,
        amount: float,
        case_id: str,
        failure_reason: str,
        payment_url: str,
        channel: str,
        locale: str,
    ) -> str:
        """Deterministic template fallback."""
        if locale in ("HI_EN", "HI"):
            if channel == "WHATSAPP":
                return (
                    f"Hi! 👋 Aapka ₹{amount:,.0f} ka payment subscription #{case_id} ke liye "
                    f"process nahi ho paya ({failure_reason}). "
                    f"Abhi complete karein: {payment_url} — Service active rakhein."
                )
            elif channel == "SMS":
                return (
                    f"Payment Alert: ₹{amount:,.0f} for #{case_id} failed. "
                    f"Pay now: {payment_url}"
                )
            elif channel == "EMAIL":
                return (
                    f"Subject: Action Required — Subscription Payment of ₹{amount:,.0f} Failed\n\n"
                    f"Dear Customer,\n\n"
                    f"Your recent payment of ₹{amount:,.0f} for subscription #{case_id} "
                    f"could not be processed ({failure_reason}).\n\n"
                    f"Please complete your payment here: {payment_url}\n\n"
                    f"Thank you,\nRecoverAI Support"
                )
            else:
                return f"UPI collect request: ₹{amount:,.0f} — Approve in your UPI app."
        else:
            if channel == "WHATSAPP":
                return (
                    f"Hi 👋 Your payment of ₹{amount:,.0f} for subscription #{case_id} "
                    f"failed ({failure_reason}). Complete it here: {payment_url}"
                )
            elif channel == "SMS":
                return f"₹{amount:,.0f} payment failed for #{case_id}. Pay: {payment_url}"
            elif channel == "EMAIL":
                return (
                    f"Subject: Payment of ₹{amount:,.0f} Failed — Action Required\n\n"
                    f"Your payment of ₹{amount:,.0f} could not be processed ({failure_reason}).\n"
                    f"Pay here: {payment_url}"
                )
            else:
                return f"UPI collect: ₹{amount:,.0f} due. Approve in GPay/PhonePe."

    # ─────────────────────────────────────────────────────────
    # PTP Response Parsing
    # ─────────────────────────────────────────────────────────

    def parse_ptp_response(self, text: str) -> PTPParseResult:
        """
        Parses customer reply text.
        Uses Gemini if available, otherwise regex fallback.
        The regex fallback is false-positive safe:
          "I haven't paid" → QUERY  (not PAY_NOW)
        """
        if self._gemini_model:
            try:
                return self._llm_parse_ptp(text)
            except Exception as e:
                print(f"[Agent] LLM PTP parse failed — using regex fallback: {e}")
        return self._regex_parse_ptp(text)

    def _llm_parse_ptp(self, text: str) -> PTPParseResult:
        """Uses Gemini to extract intent, date, and sentiment from customer reply."""
        today = datetime.date.today()

        prompt = f"""You are parsing a customer's reply to a payment recovery message.

Today's date: {today.isoformat()}

Customer message: "{text}"

Return a JSON object with EXACTLY these fields:
{{
  "intent": one of ["PROMISE_TO_PAY", "PAY_NOW", "FAILED_RAIL", "REFUSAL_OPT_OUT", "QUERY"],
  "promised_date": "YYYY-MM-DD" or null,
  "sentiment": one of ["POSITIVE", "NEUTRAL", "NEGATIVE"],
  "confidence": float between 0.0 and 1.0,
  "reasoning": "brief explanation"
}}

Intent rules:
- PAY_NOW: customer confirms payment is ALREADY done ("I paid", "done", "already paid", "deducted")
- PROMISE_TO_PAY: customer commits to pay in the FUTURE ("will pay", "salary aayegi", "5 ko karunga", "tomorrow")
- FAILED_RAIL: customer reports a broken link or technical problem ("link not working", "error")
- REFUSAL_OPT_OUT: customer wants to stop receiving messages ("stop", "unsubscribe", "cancel", "don't message")
- QUERY: anything else, including complaints, questions, confusion

CRITICAL: "I haven't paid" = QUERY (not PAY_NOW). Only classify as PAY_NOW if payment is CONFIRMED as done.

For promised_date: normalize to YYYY-MM-DD. If "5th" mentioned, use {today.year}-{today.month:02d}-05 (next occurrence).
If "tomorrow", use {(today + datetime.timedelta(days=1)).isoformat()}.
If "next week", use {(today + datetime.timedelta(days=7)).isoformat()}.
If no date, return null.

Return ONLY the JSON. No markdown, no explanation."""

        response = self._gemini_model.generate_content(prompt)
        raw = response.text.strip()

        # Strip markdown code fences if present
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)

        parsed = json.loads(raw)

        intent = parsed.get('intent', 'QUERY')
        state_map = {
            'PAY_NOW':          RecoveryState.VERIFY_PAYMENT,
            'PROMISE_TO_PAY':   RecoveryState.SCHEDULED,
            'FAILED_RAIL':      RecoveryState.NEW_LINK_SENT,
            'REFUSAL_OPT_OUT':  RecoveryState.OPT_OUT_CLOSED,
            'QUERY':            RecoveryState.HUMAN_HANDOFF,
        }

        return PTPParseResult(
            raw_text=text,
            intent=intent,
            promised_date=parsed.get('promised_date'),
            sentiment=parsed.get('sentiment', 'NEUTRAL'),
            confidence=float(parsed.get('confidence', 0.75)),
            recommended_next_state=state_map.get(intent, RecoveryState.HUMAN_HANDOFF),
            parse_method="llm",
        )

    def _regex_parse_ptp(self, text: str) -> PTPParseResult:
        """
        Safe regex/keyword fallback PTP parser.

        False-positive protection:
        - Negation check: if "haven't", "not", "didn't", "never" precedes
          a positive keyword, do NOT classify as PAY_NOW.
        - All matches require the positive keyword WITHOUT a preceding negation
          within 5 words.
        """
        clean = text.strip().lower()
        today = datetime.date.today()

        def has_negation_before(keyword: str, window: int = 5) -> bool:
            """Returns True if a negation word appears within `window` words before `keyword`."""
            negations = {"not", "haven't", "havent", "didn't", "didnt",
                         "never", "no", "nahi", "nhi", "abhi", "nai"}
            idx = clean.find(keyword)
            if idx == -1:
                return False
            preceding = clean[:idx].split()[-window:]
            return bool(negations & set(preceding))

        # ── PAY_NOW ──────────────────────────────────────────
        pay_now_keywords = ['already paid', 'already done', 'payment done',
                            'payment complete', 'paid already', 'amount deducted',
                            'kiya hai', 'kar diya', 'ho gaya', 'complete kar diya']
        simple_pay_keywords = ['paid', 'done', 'deducted', 'complete']

        for kw in pay_now_keywords:
            if kw in clean:
                return PTPParseResult(
                    raw_text=text, intent="PAY_NOW",
                    sentiment="POSITIVE", confidence=0.90,
                    recommended_next_state=RecoveryState.VERIFY_PAYMENT,
                    parse_method="fallback",
                )
        for kw in simple_pay_keywords:
            if kw in clean and not has_negation_before(kw):
                return PTPParseResult(
                    raw_text=text, intent="PAY_NOW",
                    sentiment="POSITIVE", confidence=0.82,
                    recommended_next_state=RecoveryState.VERIFY_PAYMENT,
                    parse_method="fallback",
                )

        # ── REFUSAL_OPT_OUT ───────────────────────────────────
        opt_out_keywords = ['stop', 'unsubscribe', 'opt out', "don't message",
                            'dont message', 'spam', 'band karo', 'mat bhejo',
                            'cancel', 'remove me']
        for kw in opt_out_keywords:
            if kw in clean:
                return PTPParseResult(
                    raw_text=text, intent="REFUSAL_OPT_OUT",
                    sentiment="NEGATIVE", confidence=0.90,
                    recommended_next_state=RecoveryState.OPT_OUT_CLOSED,
                    parse_method="fallback",
                )

        # ── FAILED_RAIL ───────────────────────────────────────
        failed_keywords = ['link not working', 'link broken', 'error', 'failed to open',
                           'kaam nahi kar', 'link kaam', 'page not loading',
                           'payment failed again', 'declined again']
        for kw in failed_keywords:
            if kw in clean:
                return PTPParseResult(
                    raw_text=text, intent="FAILED_RAIL",
                    sentiment="NEGATIVE", confidence=0.85,
                    recommended_next_state=RecoveryState.NEW_LINK_SENT,
                    parse_method="fallback",
                )

        # ── PROMISE_TO_PAY ────────────────────────────────────
        ptp_keywords = ['will pay', 'pay later', 'karunga', 'kar dunga', 'de dunga',
                        'salary', 'payday', 'tomorrow', 'kal', 'next week',
                        'this week', 'promised', 'aayegi', 'aate hi']
        date_keywords = ['5th', '10th', '1st', '15th', '20th', '25th', '30th']

        is_ptp = any(kw in clean for kw in ptp_keywords + date_keywords)
        if is_ptp:
            # Date extraction — look for ordinal numbers (1st, 5th, 15th etc.)
            promised_str = None
            match = re.search(r'\b(\d{1,2})(st|nd|rd|th)?\b', clean)
            if match:
                day_num = int(match.group(1))
                if 1 <= day_num <= 31:
                    # If the day has already passed this month, use next month
                    try:
                        candidate = datetime.date(today.year, today.month, day_num)
                        if candidate <= today:
                            # Move to next month
                            if today.month == 12:
                                candidate = datetime.date(today.year + 1, 1, day_num)
                            else:
                                candidate = datetime.date(today.year, today.month + 1, day_num)
                        promised_str = candidate.isoformat()
                    except ValueError:
                        pass  # invalid day for this month

            if 'tomorrow' in clean or 'kal' in clean:
                promised_str = (today + datetime.timedelta(days=1)).isoformat()
            elif 'next week' in clean:
                promised_str = (today + datetime.timedelta(days=7)).isoformat()

            if not promised_str:
                promised_str = (today + datetime.timedelta(days=3)).isoformat()

            return PTPParseResult(
                raw_text=text, intent="PROMISE_TO_PAY",
                promised_date=promised_str,
                sentiment="POSITIVE", confidence=0.82,
                recommended_next_state=RecoveryState.SCHEDULED,
                parse_method="fallback",
            )

        # ── QUERY (default) ───────────────────────────────────
        return PTPParseResult(
            raw_text=text, intent="QUERY",
            sentiment="NEUTRAL", confidence=0.60,
            recommended_next_state=RecoveryState.HUMAN_HANDOFF,
            parse_method="fallback",
        )
