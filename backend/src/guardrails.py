"""
Guardrails and Policy Engine for RecoverAI.
Implements deterministic, explainable financial safety rules.

Design principles:
- Every blocked/escalated action has a traceable rule_id
- y (historical label) is NEVER used here — it is not a current payment status
- payment_status field indicates current payment resolution
- Idempotency: same (case_id, action) pair cannot execute twice in a session
- All failure class names match the actual dataset taxonomy
"""

from typing import Dict, Any, List, Optional, Set, Tuple
from pydantic import BaseModel

# ─────────────────────────────────────────────────────────────
# Failure class taxonomy (from Phase 0 audit — corrected)
# ─────────────────────────────────────────────────────────────
RETRYABLE_CLASSES = frozenset({
    'INSUFFICIENT_FUNDS', 'BANK_TECHNICAL', 'RATE_LIMIT'
})
MANDATE_ISSUE_CLASSES = frozenset({
    'MANDATE_CLOSED', 'MANDATE_PAUSED'
})
UNRETRYABLE_CLASSES = frozenset({
    'CARD_EXPIRED', 'CARD_LOST_STOLEN'
})
# Actions that involve contacting the customer
CONTACT_ACTIONS = frozenset({
    'SEND_REMINDER', 'SEND_PAYMENT_LINK'
})


class PolicyViolation(BaseModel):
    rule_id: str
    severity: str           # BLOCK, ESCALATE, WARN
    description: str


class GuardrailEvaluation(BaseModel):
    status: str             # APPROVED, BLOCKED, ESCALATED, HUMAN_REVIEW
    recommended_action: str
    original_action: str
    policy_violations: List[PolicyViolation]
    applied_rules: List[str]
    reason: str


# ─────────────────────────────────────────────────────────────
# Session-level idempotency store
# In-memory for MVP. Replace with Redis/DB for production.
# ─────────────────────────────────────────────────────────────
_EXECUTED_ACTIONS: Set[Tuple[str, str]] = set()


def record_execution(case_id: str, action: str) -> None:
    """Call this after a successful Razorpay execution to prevent duplicates."""
    _EXECUTED_ACTIONS.add((str(case_id), action))


def clear_execution_history() -> None:
    """For testing / session reset only."""
    _EXECUTED_ACTIONS.clear()


class GuardrailEngine:
    """
    Evaluates a proposed recovery action against deterministic
    financial governance rules. Returns a structured evaluation
    with rule_id codes so every decision is traceable.
    """

    def __init__(
        self,
        max_retries: int          = 2,
        max_contacts: int         = 2,
        max_auto_amount_inr: float = 25_000.0,
        min_cooloff_hours: float  = 4.0,
    ):
        self.max_retries           = max_retries
        self.max_contacts          = max_contacts
        self.max_auto_amount_inr   = max_auto_amount_inr
        self.min_cooloff_hours     = min_cooloff_hours

    def evaluate(
        self,
        case: Dict[str, Any],
        proposed_action: str,
    ) -> GuardrailEvaluation:
        """
        Evaluates proposed_action for case.
        Rules are evaluated in priority order; first matching hard-stop wins.
        """
        violations: List[PolicyViolation] = []
        applied_rules: List[str]          = []
        status          = "APPROVED"
        final_action    = proposed_action

        # ── Extract fields ────────────────────────────────────
        amount         = float(case.get('amount_inr', 0.0))
        retries_used   = int(case.get('retries_used_before', 0))
        contacts_sent  = int(case.get('contacts_sent_before', 0))
        hours_open     = float(case.get('hours_since_open', 0.0))
        failure_class  = str(case.get('failure_class_at_decision', '')).upper()
        case_id        = str(case.get('case_id', ''))

        # Current payment state — NOT the historical ML target y
        payment_status = str(case.get('payment_status', '')).upper()
        is_resolved    = bool(case.get('is_resolved', False))
        is_disputed    = bool(case.get('is_disputed', False))
        is_fraud       = bool(case.get('is_fraud', False))
        opted_out      = bool(case.get('opted_out', False))

        # ── Rule evaluation (ordered, first hard-stop wins) ───

        # RULE 1: Idempotency — don't execute same action twice on same case
        if (case_id, proposed_action) in _EXECUTED_ACTIONS:
            violations.append(PolicyViolation(
                rule_id='IDEMPOTENCY_BLOCK',
                severity='BLOCK',
                description=f"Action '{proposed_action}' already executed for case {case_id} in this session.",
            ))
            applied_rules.append('IDEMPOTENCY')
            status       = "BLOCKED"
            final_action = "DO_NOTHING"

        # RULE 2: Payment already resolved (current status, NOT y)
        elif payment_status == 'SUCCESS' or is_resolved:
            violations.append(PolicyViolation(
                rule_id='PAYMENT_ALREADY_RESOLVED',
                severity='BLOCK',
                description="Payment is already resolved; further intervention would be duplicate.",
            ))
            applied_rules.append('STOP_ON_SUCCESS')
            status       = "BLOCKED"
            final_action = "DO_NOTHING"

        # RULE 3: Active fraud flag — hard stop, escalate to human
        elif is_fraud:
            violations.append(PolicyViolation(
                rule_id='FRAUD_FLAG_DETECTED',
                severity='BLOCK',
                description="Fraud flag is active. Automated recovery is prohibited.",
            ))
            applied_rules.append('STOP_ON_FRAUD')
            status       = "BLOCKED"
            final_action = "ESCALATE"

        # RULE 4: Active dispute — hard stop, escalate to human
        elif is_disputed:
            violations.append(PolicyViolation(
                rule_id='DISPUTE_ACTIVE',
                severity='BLOCK',
                description="Payment is under active dispute. Automated action prohibited.",
            ))
            applied_rules.append('STOP_ON_DISPUTE')
            status       = "BLOCKED"
            final_action = "ESCALATE"

        # RULE 5: Customer opted out of communications
        elif opted_out and proposed_action in CONTACT_ACTIONS:
            violations.append(PolicyViolation(
                rule_id='CUSTOMER_OPT_OUT',
                severity='BLOCK',
                description=f"Customer has opted out of communications. Cannot send {proposed_action}.",
            ))
            applied_rules.append('STOP_ON_OPT_OUT')
            status       = "BLOCKED"
            final_action = "DO_NOTHING"

        # RULE 6: Unretryable failure class — cannot RETRY
        elif proposed_action == 'RETRY' and failure_class in UNRETRYABLE_CLASSES:
            violations.append(PolicyViolation(
                rule_id='UNRETRYABLE_FAILURE_CLASS',
                severity='ESCALATE',
                description=f"Failure class '{failure_class}' cannot be recovered via retry. "
                            f"Payment instrument must be changed.",
            ))
            applied_rules.append('BLOCK_UNRETRYABLE_RETRY')
            status       = "ESCALATED"
            final_action = "CHANGE_PAYMENT_METHOD"

        # RULE 7: Mandate issue — retry ineffective, need re-mandate
        elif proposed_action == 'RETRY' and failure_class in MANDATE_ISSUE_CLASSES:
            violations.append(PolicyViolation(
                rule_id='MANDATE_ISSUE',
                severity='ESCALATE',
                description=f"Failure class '{failure_class}' requires mandate re-establishment, not retry.",
            ))
            applied_rules.append('BLOCK_MANDATE_RETRY')
            status       = "ESCALATED"
            final_action = "CHANGE_PAYMENT_METHOD"

        # RULE 8: High amount — require human review for auto-actions
        elif amount > self.max_auto_amount_inr and proposed_action in {'RETRY', 'SEND_PAYMENT_LINK'}:
            violations.append(PolicyViolation(
                rule_id='AMOUNT_EXCEEDS_AUTO_LIMIT',
                severity='ESCALATE',
                description=f"Amount ₹{amount:,.2f} exceeds automatic action limit "
                            f"₹{self.max_auto_amount_inr:,.2f}. Human review required.",
            ))
            applied_rules.append('REQUIRE_HUMAN_REVIEW')
            status       = "HUMAN_REVIEW"
            final_action = "ESCALATE"

        # RULE 9: Max retries throttle
        elif proposed_action == 'RETRY' and retries_used >= self.max_retries:
            violations.append(PolicyViolation(
                rule_id='MAX_RETRIES_EXCEEDED',
                severity='ESCALATE',
                description=f"Maximum auto-retry limit ({self.max_retries}) reached "
                            f"({retries_used} retries used). Escalating to payment link.",
            ))
            applied_rules.append('LIMIT_RETRIES')
            status       = "ESCALATED"
            final_action = "SEND_PAYMENT_LINK" if contacts_sent < self.max_contacts else "ESCALATE"

        # RULE 10: Max contact throttle
        elif proposed_action in CONTACT_ACTIONS and contacts_sent >= self.max_contacts:
            violations.append(PolicyViolation(
                rule_id='MAX_CONTACTS_EXCEEDED',
                severity='ESCALATE',
                description=f"Maximum customer contact limit ({self.max_contacts}) reached "
                            f"({contacts_sent} contacts sent). Further dunning blocked.",
            ))
            applied_rules.append('LIMIT_DUNNING_CONTACTS')
            status       = "ESCALATED"
            final_action = "ESCALATE"

        # RULE 11: Retry cool-off period
        elif proposed_action == 'RETRY' and retries_used > 0 and hours_open < self.min_cooloff_hours:
            violations.append(PolicyViolation(
                rule_id='RETRY_COOLOFF_ACTIVE',
                severity='BLOCK',
                description=f"Retry cool-off active: case open for {hours_open:.1f}h, "
                            f"minimum {self.min_cooloff_hours}h required between retries.",
            ))
            applied_rules.append('THROTTLE_RETRY_FREQUENCY')
            status       = "BLOCKED"
            final_action = "DO_NOTHING"

        # ── Build reason string ───────────────────────────────
        if violations:
            reason = " | ".join(v.description for v in violations)
        else:
            applied_rules.append('ALL_RULES_PASSED')
            reason = "All safety guardrails and policy checks passed."

        return GuardrailEvaluation(
            status=status,
            recommended_action=final_action,
            original_action=proposed_action,
            policy_violations=violations,
            applied_rules=applied_rules,
            reason=reason,
        )
