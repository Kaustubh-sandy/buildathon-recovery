"""
Agent Module for RecoverAI.
Implements the recovery state machine, case diagnostic engine,
LLM multi-channel dunning copy generator, and Promise-To-Pay (PTP) response parser.
"""

import os
import re
import datetime
from typing import Dict, Any, Optional, List
from pydantic import BaseModel

class AgentDiagnosis(BaseModel):
    case_id: str
    risk_level: str  # HIGH, MEDIUM, LOW
    recovery_probability: float
    recommended_action: str
    reasoning: str
    state: str

class PTPParseResult(BaseModel):
    raw_text: str
    intent: str  # PROMISE_TO_PAY, PAY_NOW, FAILED_RAIL, REFUSAL_OPT_OUT, QUERY
    promised_date: Optional[str] = None
    sentiment: str  # POSITIVE, NEUTRAL, NEGATIVE
    confidence: float
    recommended_next_state: str

class RecoveryAgent:
    def __init__(self):
        self.llm_api_key = os.getenv("LLM_API_KEY", "")

    def diagnose_case(
        self,
        case: Dict[str, Any],
        recovery_prob: float,
        proposed_action: str
    ) -> AgentDiagnosis:
        """
        Generates diagnostic explanation for why revenue is at risk
        and provides contextual reasoning.
        """
        case_id = str(case.get('case_id', 'UNKNOWN'))
        amount = float(case.get('amount_inr', 0.0))
        tenure = int(case.get('customer_tenure_days', 0))
        prior_sr = float(case.get('prior_success_rate', 0.0))
        failure_class = str(case.get('failure_class_at_decision', 'UNKNOWN'))
        retries = int(case.get('retries_used_before', 0))
        segment = str(case.get('segment', 'GENERAL'))

        # Risk level determination
        if recovery_prob >= 0.70:
            risk_level = "LOW"
        elif recovery_prob >= 0.40:
            risk_level = "MEDIUM"
        else:
            risk_level = "HIGH"

        reasoning_parts = []
        reasoning_parts.append(
            f"Case #{case_id} ({segment} tier): ₹{amount:,.2f} at risk due to failure '{failure_class}'."
        )
        
        if prior_sr > 0.6:
            reasoning_parts.append(f"Customer has strong payment history ({prior_sr*100:.0f}% success rate across {tenure} days tenure).")
        else:
            reasoning_parts.append(f"Customer has lower historical success rate ({prior_sr*100:.0f}%).")

        if retries == 0:
            reasoning_parts.append("First payment attempt failure. High probability of recovery.")
        else:
            reasoning_parts.append(f"Previous retries attempted: {retries}.")

        reasoning_parts.append(f"P(recovery) evaluated at {recovery_prob:.2f}. Recommended intervention: {proposed_action}.")

        return AgentDiagnosis(
            case_id=case_id,
            risk_level=risk_level,
            recovery_probability=recovery_prob,
            recommended_action=proposed_action,
            reasoning=" ".join(reasoning_parts),
            state="ACTION_SELECTED"
        )

    def generate_dunning_message(
        self,
        case: Dict[str, Any],
        channel: str = "WHATSAPP",
        locale: str = "HI_EN"
    ) -> Dict[str, str]:
        """
        Generates personalized multi-channel dunning copy.
        """
        amount = float(case.get('amount_inr', 0.0))
        case_id = str(case.get('case_id', ''))
        customer_id = str(case.get('customer_id', ''))
        failure_class = str(case.get('failure_class_at_decision', 'INSUFFICIENT_FUNDS'))
        payment_url = f"https://rzp.io/i/rec_{case_id or '101'}"

        if locale == "HI_EN":
            if channel == "WHATSAPP":
                body = (
                    f"Hi! 👋 Your payment of ₹{amount:,.2f} for subscription #{case_id} didn't go through "
                    f"due to a temporary {failure_class.replace('_', ' ').title()} issue. "
                    f"Quickly complete your payment here to keep services active: {payment_url}\n"
                    f"Reply 'PAY' to retry immediately or 'LATER' to set a reminder."
                )
            elif channel == "SMS":
                body = f"Payment Alert: ₹{amount:,.2f} for sub #{case_id} failed. Tap to pay now: {payment_url} - RecoverAI"
            elif channel == "UPI_INTENT":
                body = f"UPI Collect request sent for ₹{amount:,.2f}. Approve payment in GPay/PhonePe."
            else:  # EMAIL
                body = (
                    f"Subject: Action Required: Subscription Payment of ₹{amount:,.2f} Failed\n\n"
                    f"Dear Customer,\n\n"
                    f"We noticed that your recent payment of ₹{amount:,.2f} could not be processed. "
                    f"Reason: {failure_class}.\n\n"
                    f"Please update your payment method or complete the transaction using this secure link: {payment_url}\n\n"
                    f"Thank you,\nRecoverAI Support"
                )
        else:
            if channel == "WHATSAPP":
                body = (
                    f"Namaste! 🙏 Aapka ₹{amount:,.2f} ka payment complete nahi ho paya. "
                    f"Aap abhi is link se payment finish kar sakte hain: {payment_url}\n"
                    f"Service uninterrupted rakhne ke liye kripya abhi pay karein."
                )
            else:
                body = f"Payment update: ₹{amount:,.2f} failed. Pay here: {payment_url}"

        return {
            "channel": channel,
            "locale": locale,
            "message_body": body,
            "payment_link": payment_url
        }

    def parse_ptp_response(self, text: str) -> PTPParseResult:
        """
        Parses customer reply text to extract Promise-To-Pay intent,
        promised dates, and recommended state transition.
        """
        clean_text = text.strip().lower()
        today = datetime.date.today()

        # Intent detection heuristics
        if any(w in clean_text for w in ['paid', 'done', 'already paid', 'complete', 'deducted']):
            return PTPParseResult(
                raw_text=text,
                intent="PAY_NOW",
                sentiment="POSITIVE",
                confidence=0.95,
                recommended_next_state="VERIFY_PAYMENT"
            )
        elif any(w in clean_text for w in ['stop', 'cancel', 'opt out', 'dont message', 'don\'t message', 'spam']):
            return PTPParseResult(
                raw_text=text,
                intent="REFUSAL_OPT_OUT",
                sentiment="NEGATIVE",
                confidence=0.90,
                recommended_next_state="OPT_OUT_CLOSE"
            )
        elif any(w in clean_text for w in ['broken', 'link not working', 'failed', 'declined', 'error']):
            return PTPParseResult(
                raw_text=text,
                intent="FAILED_RAIL",
                sentiment="NEGATIVE",
                confidence=0.85,
                recommended_next_state="SEND_NEW_LINK"
            )
        elif any(w in clean_text for w in ['pay later', 'tomorrow', 'next week', 'salary', 'promised', '5th', '10th', '1st']):
            # Extract date if mentioned
            match = re.search(r'\b(\d{1,2})(st|nd|rd|th)?\b', clean_text)
            promised_str = None
            if match:
                day_num = int(match.group(1))
                if 1 <= day_num <= 31:
                    promised_str = f"{today.year}-{today.month:02d}-{day_num:02d}"
            if not promised_str:
                promised_str = (today + datetime.timedelta(days=3)).strftime("%Y-%m-%d")

            return PTPParseResult(
                raw_text=text,
                intent="PROMISE_TO_PAY",
                promised_date=promised_str,
                sentiment="POSITIVE",
                confidence=0.88,
                recommended_next_state="SCHEDULED_PTP_REMINDER"
            )
        else:
            return PTPParseResult(
                raw_text=text,
                intent="QUERY",
                sentiment="NEUTRAL",
                confidence=0.60,
                recommended_next_state="AGENT_HUMAN_HANDOFF"
            )
