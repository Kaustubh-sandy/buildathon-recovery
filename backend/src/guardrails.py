"""
Guardrails and Policy Engine Module for RecoverAI.
Implements deterministic stopping rules, financial thresholds, throttles,
and duplicate prevention.
"""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel

class GuardrailRule(BaseModel):
    rule_id: str
    name: str
    description: str
    is_active: bool = True

class GuardrailEvaluation(BaseModel):
    status: str  # APPROVED, BLOCKED, ESCALATED, HUMAN_REVIEW
    recommended_action: str
    original_action: str
    policy_violations: List[str]
    applied_rules: List[str]
    reason: str

class GuardrailEngine:
    def __init__(
        self,
        max_retries: int = 2,
        max_contacts: int = 2,
        max_auto_amount: float = 25000.0,
        min_cooloff_hours: float = 4.0
    ):
        self.max_retries = max_retries
        self.max_contacts = max_contacts
        self.max_auto_amount = max_auto_amount
        self.min_cooloff_hours = min_cooloff_hours

    def evaluate(
        self,
        case: Dict[str, Any],
        proposed_action: str
    ) -> GuardrailEvaluation:
        """
        Evaluates a proposed action against deterministic governance rules.
        """
        violations: List[str] = []
        applied_rules: List[str] = []
        status = "APPROVED"
        final_action = proposed_action
        reasons: List[str] = []

        amount = float(case.get('amount_inr', 0.0))
        retries_used = int(case.get('retries_used_before', 0))
        contacts_sent = int(case.get('contacts_sent_before', 0))
        hours_open = float(case.get('hours_since_open', 0.0))
        failure_class = str(case.get('failure_class_at_decision', '')).upper()
        y_val = int(case.get('y', 0))
        is_disputed = bool(case.get('is_disputed', False))
        is_fraud = bool(case.get('is_fraud', False))
        opted_out = bool(case.get('opted_out', False))

        # Rule 1: Prevent duplicate action if case already recovered/successful
        if y_val == 1 or case.get('payment_status') == 'SUCCESS' or case.get('is_resolved') is True:
            violations.append("RULE_ALREADY_RECOVERED")
            applied_rules.append("STOP_ON_SUCCESS")
            status = "BLOCKED"
            final_action = "DO_NOTHING"
            reasons.append("Payment already recovered; duplicate intervention blocked.")

        # Rule 2: Dispute or Fraud hard stop
        elif is_disputed or is_fraud:
            violations.append("RULE_DISPUTE_OR_FRAUD_FLAG")
            applied_rules.append("STOP_ON_DISPUTE_FRAUD")
            status = "BLOCKED"
            final_action = "ESCALATE"
            reasons.append("Active dispute or fraud flag detected; automated action blocked.")

        # Rule 3: Customer opt-out
        elif opted_out and proposed_action in ['SEND_REMINDER', 'SEND_PAYMENT_LINK']:
            violations.append("RULE_CUSTOMER_OPT_OUT")
            applied_rules.append("STOP_ON_OPT_OUT")
            status = "BLOCKED"
            final_action = "DO_NOTHING"
            reasons.append("Customer opted out of notifications.")

        # Rule 4: High amount human review threshold
        elif amount > self.max_auto_amount and proposed_action in ['RETRY', 'SEND_PAYMENT_LINK']:
            violations.append("RULE_MAX_AMOUNT_EXCEEDED")
            applied_rules.append("REQUIRE_HUMAN_REVIEW")
            status = "HUMAN_REVIEW"
            final_action = "ESCALATE"
            reasons.append(f"Amount ₹{amount:,.2f} exceeds automatic limit ₹{self.max_auto_amount:,.2f}.")

        # Rule 5: Max retries limit throttle
        elif proposed_action == 'RETRY' and retries_used >= self.max_retries:
            violations.append("RULE_MAX_RETRIES_EXCEEDED")
            applied_rules.append("LIMIT_RETRIES")
            status = "ESCALATED"
            final_action = "SEND_PAYMENT_LINK" if contacts_sent < self.max_contacts else "ESCALATE"
            reasons.append(f"Retry limit ({self.max_retries}) reached ({retries_used} retries used).")

        # Rule 6: Max customer contacts throttle
        elif proposed_action in ['SEND_REMINDER', 'SEND_PAYMENT_LINK'] and contacts_sent >= self.max_contacts:
            violations.append("RULE_MAX_CONTACTS_EXCEEDED")
            applied_rules.append("LIMIT_DUNNING_CONTACTS")
            status = "ESCALATED"
            final_action = "ESCALATE"
            reasons.append(f"Max contact attempts ({self.max_contacts}) reached.")

        # Rule 7: Unretryable hard failure class
        elif proposed_action == 'RETRY' and failure_class in ['ACCOUNT_CLOSED', 'EXPIRED_CARD', 'INVALID_CARD']:
            violations.append("RULE_UNRETRYABLE_FAILURE")
            applied_rules.append("BLOCK_UNRETRYABLE_RAIL")
            status = "ESCALATED"
            final_action = "CHANGE_PAYMENT_METHOD"
            reasons.append(f"Failure class '{failure_class}' cannot be recovered via auto-retry.")

        # Rule 8: Cool-off period throttle
        elif proposed_action == 'RETRY' and retries_used > 0 and hours_open < self.min_cooloff_hours:
            violations.append("RULE_COOLOFF_PERIOD_ACTIVE")
            applied_rules.append("THROTTLE_RETRY_FREQUENCY")
            status = "BLOCKED"
            final_action = "DO_NOTHING"
            reasons.append(f"Retry cool-off active ({hours_open:.1f}h open < {self.min_cooloff_hours}h required).")

        if not reasons:
            reasons.append("All safety guardrails and policy checks passed.")

        return GuardrailEvaluation(
            status=status,
            recommended_action=final_action,
            original_action=proposed_action,
            policy_violations=violations,
            applied_rules=applied_rules,
            reason=" | ".join(reasons)
        )
