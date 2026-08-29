"""
Batch Simulator for RecoverAI.
Runs an honest, scientifically valid experiment comparing:
  Naive Baseline vs RecoverAI Policy Engine

The three-phase pipeline is strictly enforced:

  1. PREDICTION  — ML model outputs P(recovery | case features)
  2. DECISION    — Action policy selects best action
  3. OUTCOME     — Determined from real historical y label, independently

Prediction ≠ Decision ≠ Outcome.

Outcome attribution rule:
  - BLOCKED by guardrails           → recovered = ₹0, cost = ₹0
  - APPROVED + action matches historical action_type + y=1
                                    → recovered = amount (full, honest)
  - APPROVED + action matches historical action_type + y=0
                                    → recovered = ₹0
  - APPROVED + action differs from historical action_type
                                    → counterfactual, recovered = ₹0 (unattributed)

This is conservative: we do not claim credit for actions we cannot verify.

Baseline:
  Naive retry: if retries_used_before == 0, RETRY. Otherwise DO_NOTHING.
  Same attribution rule applied.
"""

import os
import uuid
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

from .policy_model import (
    RecoveryPolicyModel, ACTION_COST_MAP,
    RETRYABLE_CLASSES, UNRETRYABLE_CLASSES, MANDATE_ISSUE_CLASSES
)
from .guardrails import GuardrailEngine


# ─────────────────────────────────────────────────────────────
# Result models
# ─────────────────────────────────────────────────────────────

class ArmResult(BaseModel):
    """Results for one arm of the experiment (Baseline or RecoverAI)."""
    label: str
    cases_evaluated: int
    actions_attempted: int
    actions_breakdown: Dict[str, int]
    attributed_recoveries: int          # cases where we can claim credit
    counterfactual_cases: int           # different action — unattributed
    blocked_cases: int
    gross_recovered_inr: float          # sum of recovered amounts
    total_intervention_cost_inr: float
    net_recovered_inr: float            # gross - cost
    recovery_rate_pct: float            # attributed recoveries / cases_evaluated


class BatchResults(BaseModel):
    batch_id: str
    cases_evaluated: int
    revenue_at_risk_inr: float          # total amount across all cases
    eligible_revenue_inr: float         # amount in APPROVED cases only

    baseline: ArmResult
    recoverai: ArmResult

    incremental_recoveries: int         # recoverai.attributed - baseline.attributed
    incremental_revenue_inr: float      # recoverai.net - baseline.net
    recovery_uplift_pct: float          # uplift vs baseline net

    blocked_actions: int
    escalated_actions: int
    guardrail_stats: Dict[str, int]

    # ML model evaluation (separate from business metrics)
    ml_metrics: Optional[Dict[str, float]] = None


# ─────────────────────────────────────────────────────────────
# Batch Runner
# ─────────────────────────────────────────────────────────────

def _fast_action_policy(case_dict: dict, p_rec: float) -> str:
    """
    Lightweight action selector for batch evaluation.
    Uses pre-computed p_rec to avoid calling predict_proba again.
    Implements the same rules as RecoveryPolicyModel.evaluate_actions().
    """
    failure_class = str(case_dict.get('failure_class_at_decision', '')).upper()
    retries_used  = int(case_dict.get('retries_used_before', 0))
    contacts_sent = int(case_dict.get('contacts_sent_before', 0))

    if failure_class in UNRETRYABLE_CLASSES or failure_class in MANDATE_ISSUE_CLASSES:
        return 'CHANGE_PAYMENT_METHOD'
    if failure_class in RETRYABLE_CLASSES and retries_used == 0:
        return 'RETRY'
    if failure_class in RETRYABLE_CLASSES and retries_used < 2:
        return 'RETRY'
    if contacts_sent < 2:
        return 'SEND_PAYMENT_LINK'
    if p_rec < 0.25:
        return 'DO_NOTHING'
    return 'ESCALATE'


class BatchRunner:
    """
    Runs batch evaluation on test_batch.csv.
    Both arms see the same cases; outcome is determined from historical y.
    """

    def __init__(self, data_path: str = 'backend/data/test_batch.csv'):
        self.data_path   = data_path
        self.policy_model = RecoveryPolicyModel()
        self.guardrails  = GuardrailEngine()

    def _resolve_data_path(self) -> str:
        """Returns the first existing data path."""
        candidates = [
            self.data_path,
            'data/test_batch.csv',
            'backend/data/test_batch.csv',
        ]
        for p in candidates:
            if os.path.exists(p):
                return p
        raise FileNotFoundError(
            f"test_batch.csv not found. Tried: {candidates}"
        )

    def _ensure_model(self) -> None:
        if not self.policy_model.is_trained:
            if not self.policy_model.load_model():
                raise RuntimeError(
                    "Policy model is not trained. "
                    "Train first: python -c \"from src.policy_model import "
                    "RecoveryPolicyModel; m = RecoveryPolicyModel(); "
                    "m.train('data/train.csv')\""
                )

    def run_simulation(self, sample_size: Optional[int] = None) -> BatchResults:
        """
        Runs the full batch experiment.
        Returns BatchResults with honest Baseline vs RecoverAI comparison.
        """
        data_path = self._resolve_data_path()
        self._ensure_model()

        df = pd.read_csv(data_path)
        if sample_size and sample_size < len(df):
            df = df.sample(n=sample_size, random_state=42).reset_index(drop=True)

        n_cases = len(df)
        revenue_at_risk = float(df['amount_inr'].sum())

        # ── Vectorised ML prediction (efficient batch inference) ──
        print(f"[BatchRunner] Predicting P(recovery) for {n_cases:,} cases...")
        p_rec_array = self.policy_model.predict_proba_batch(df)

        # ── Counters ──────────────────────────────────────────
        # Baseline arm
        b_actions_attempted  = 0
        b_attributed         = 0
        b_counterfactual     = 0
        b_blocked            = 0
        b_gross_recovered    = 0.0
        b_cost               = 0.0
        b_breakdown          = {a: 0 for a in ['RETRY', 'DO_NOTHING']}

        # RecoverAI arm
        r_actions_attempted  = 0
        r_attributed         = 0
        r_counterfactual     = 0
        r_blocked            = 0
        r_gross_recovered    = 0.0
        r_cost               = 0.0
        r_eligible_revenue   = 0.0
        r_breakdown          = {a: 0 for a in
                                 ['RETRY', 'SEND_PAYMENT_LINK', 'SEND_REMINDER',
                                  'CHANGE_PAYMENT_METHOD', 'ESCALATE', 'DO_NOTHING']}

        guardrail_stats = {'APPROVED': 0, 'BLOCKED': 0, 'ESCALATED': 0, 'HUMAN_REVIEW': 0}

        print(f"[BatchRunner] Running simulation...")

        for idx in range(n_cases):
            row          = df.iloc[idx]
            case_dict    = row.to_dict()
            amount       = float(case_dict.get('amount_inr', 0.0))
            y_actual     = int(case_dict.get('y', 0))
            retries_used = int(case_dict.get('retries_used_before', 0))
            hist_action  = str(case_dict.get('action_type', '')).upper()
            p_rec        = float(p_rec_array[idx])

            # ──────────────────────────────────────────────────
            # BASELINE ARM: Naive retry policy
            # Rule: retry if no prior retry, else do nothing
            # ──────────────────────────────────────────────────
            if retries_used == 0:
                b_action = 'RETRY'
                b_actions_attempted += 1
                b_cost += ACTION_COST_MAP['RETRY']

                if hist_action == 'RETRY':
                    # Attribution: we know what happened with RETRY
                    if y_actual == 1:
                        b_attributed += 1
                        b_gross_recovered += amount
                    # y_actual == 0 → no recovery
                else:
                    # Counterfactual: historical data used a different action
                    b_counterfactual += 1
                    # Conservative: don't claim credit
            else:
                b_action = 'DO_NOTHING'
                # No cost, no recovery

            b_breakdown[b_action] = b_breakdown.get(b_action, 0) + 1

            # ──────────────────────────────────────────────────
            # RECOVERAI ARM: ML + rules-based action policy + guardrails
            # ──────────────────────────────────────────────────

            # Phase 1 — Action policy: use already-computed p_rec (no extra model call)
            # Inline rules mirror evaluate_actions() but skip the predict_proba call
            proposed_action = _fast_action_policy(case_dict, p_rec)

            # Phase 2 — Guardrails evaluate the proposed action
            g_eval      = self.guardrails.evaluate(case_dict, proposed_action)
            final_action = g_eval.recommended_action
            status       = g_eval.status

            guardrail_stats[status] = guardrail_stats.get(status, 0) + 1
            r_breakdown[final_action] = r_breakdown.get(final_action, 0) + 1

            # Phase 3 — Outcome (independent of model prediction)
            if status == 'BLOCKED':
                r_blocked += 1
                # No action, no cost
            else:
                r_eligible_revenue += amount

                if final_action != 'DO_NOTHING':
                    r_actions_attempted += 1
                    r_cost += ACTION_COST_MAP.get(final_action, 0.0)

                # Outcome attribution
                if hist_action == final_action:
                    # We know the historical outcome for this exact action
                    if y_actual == 1:
                        r_attributed += 1
                        r_gross_recovered += amount
                    # y_actual == 0 → action was tried and failed historically
                else:
                    # Counterfactual: RecoverAI chose differently from historical system
                    # We cannot claim credit (conservative)
                    r_counterfactual += 1

        # ── Compute final metrics ─────────────────────────────
        b_net = round(b_gross_recovered - b_cost, 2)
        r_net = round(r_gross_recovered - r_cost, 2)

        b_rate = round(b_attributed / n_cases * 100, 2) if n_cases > 0 else 0.0
        r_rate = round(r_attributed / n_cases * 100, 2) if n_cases > 0 else 0.0

        incremental_rev = round(r_net - b_net, 2)
        if b_net > 0:
            uplift_pct = round((r_net - b_net) / b_net * 100, 1)
        else:
            uplift_pct = 0.0

        escalated = guardrail_stats.get('ESCALATED', 0) + guardrail_stats.get('HUMAN_REVIEW', 0)

        # ML metrics from loaded model
        ml_metrics = self.policy_model.training_metrics if self.policy_model.training_metrics else None

        results = BatchResults(
            batch_id              = f"batch_{uuid.uuid4().hex[:8]}",
            cases_evaluated       = n_cases,
            revenue_at_risk_inr   = round(revenue_at_risk, 2),
            eligible_revenue_inr  = round(r_eligible_revenue, 2),

            baseline = ArmResult(
                label                       = "Naive Retry Baseline",
                cases_evaluated             = n_cases,
                actions_attempted           = b_actions_attempted,
                actions_breakdown           = b_breakdown,
                attributed_recoveries       = b_attributed,
                counterfactual_cases        = b_counterfactual,
                blocked_cases               = b_blocked,
                gross_recovered_inr         = round(b_gross_recovered, 2),
                total_intervention_cost_inr = round(b_cost, 2),
                net_recovered_inr           = b_net,
                recovery_rate_pct           = b_rate,
            ),
            recoverai = ArmResult(
                label                       = "RecoverAI Policy Engine",
                cases_evaluated             = n_cases,
                actions_attempted           = r_actions_attempted,
                actions_breakdown           = r_breakdown,
                attributed_recoveries       = r_attributed,
                counterfactual_cases        = r_counterfactual,
                blocked_cases               = r_blocked,
                gross_recovered_inr         = round(r_gross_recovered, 2),
                total_intervention_cost_inr = round(r_cost, 2),
                net_recovered_inr           = r_net,
                recovery_rate_pct           = r_rate,
            ),

            incremental_recoveries  = r_attributed - b_attributed,
            incremental_revenue_inr = incremental_rev,
            recovery_uplift_pct     = uplift_pct,
            blocked_actions         = guardrail_stats.get('BLOCKED', 0),
            escalated_actions       = escalated,
            guardrail_stats         = guardrail_stats,
            ml_metrics              = ml_metrics,
        )

        self._print_summary(results)
        return results

    def _print_summary(self, r: BatchResults) -> None:
        b = r.baseline
        ai = r.recoverai
        print(f"""
[BatchRunner] ── RECOVERY EXPERIMENT RESULTS ──────────────────────

  Cases evaluated         {r.cases_evaluated:>10,}
  Revenue at risk         {r.revenue_at_risk_inr:>10,.2f} INR
  Eligible revenue        {r.eligible_revenue_inr:>10,.2f} INR

                                Baseline     RecoverAI
  ─────────────────────────────────────────────────────
  Actions attempted       {b.actions_attempted:>10,}  {ai.actions_attempted:>10,}
  Attributed recoveries   {b.attributed_recoveries:>10,}  {ai.attributed_recoveries:>10,}
  Counterfactual cases    {b.counterfactual_cases:>10,}  {ai.counterfactual_cases:>10,}
  Gross recovered (INR)   {b.gross_recovered_inr:>10,.2f}  {ai.gross_recovered_inr:>10,.2f}
  Intervention cost (INR) {b.total_intervention_cost_inr:>10,.2f}  {ai.total_intervention_cost_inr:>10,.2f}
  Net recovered (INR)     {b.net_recovered_inr:>10,.2f}  {ai.net_recovered_inr:>10,.2f}
  Recovery rate           {b.recovery_rate_pct:>9.2f}%  {ai.recovery_rate_pct:>9.2f}%

  Incremental revenue (RecoverAI vs Baseline): {r.incremental_revenue_inr:+,.2f} INR
  Uplift: {r.recovery_uplift_pct:+.1f}%

  Guardrail stats: {r.guardrail_stats}
  ML model metrics: {r.ml_metrics}
──────────────────────────────────────────────────────────────────""")


if __name__ == '__main__':
    runner = BatchRunner()
    res = runner.run_simulation(sample_size=1000)
