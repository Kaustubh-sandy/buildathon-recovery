"""
RecoverAI FastAPI Application Server.
"""

import os
import sys
import uuid
import datetime
from typing import Dict, Any, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import pandas as pd
from dotenv import load_dotenv

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

from src.policy_model import RecoveryPolicyModel
from src.guardrails import GuardrailEngine, GuardrailEvaluation, record_execution
from src.agent import RecoveryAgent, AgentDiagnosis, PTPParseResult, RecoveryState
from src.razorpay_client import RazorpayTestClient
from src.batch_runner import BatchRunner, BatchResults

# ─────────────────────────────────────────────────────────────
# App setup
# ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="RecoverAI — AI Revenue Recovery Agent API",
    description=(
        "Bounded AI revenue recovery engine combining prediction, "
        "diagnosis, policy guardrails, and Razorpay Test Mode execution."
    ),
    version="2.0.0",
)

# CORS — read from environment, default to localhost for development
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────
# Component singletons
# ─────────────────────────────────────────────────────────────

model           = RecoveryPolicyModel()
guardrails      = GuardrailEngine()
agent           = RecoveryAgent()
razorpay_client = RazorpayTestClient()

# In-memory audit trail (session-scoped; replace with DB for production)
AUDIT_LOGS: Dict[str, List[Dict[str, Any]]] = {}
LATEST_BATCH_RESULTS: Optional[BatchResults] = None


# ─────────────────────────────────────────────────────────────
# Startup — load model only, never train on startup
# ─────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup_event():
    print("Starting RecoverAI Backend Service...")
    if model.load_model():
        print(f"[Startup] Policy model loaded — version {model.model_version}, "
              f"AUC={model.training_metrics.get('roc_auc', 'N/A')}")
    else:
        print(
            "[Startup] WARNING: policy_model.pkl not found. "
            "Predictions will fail until the model is trained.\n"
            "Train: python -c \"from src.policy_model import RecoveryPolicyModel; "
            "m = RecoveryPolicyModel(); m.train('data/train.csv')\""
        )


# ─────────────────────────────────────────────────────────────
# Request schemas with validation
# ─────────────────────────────────────────────────────────────

class CaseAnalysisRequest(BaseModel):
    case_id: str
    amount_inr: float
    customer_tenure_days: int                       = 180
    prior_success_rate: float                       = 0.60
    retries_used_before: int                        = 0
    contacts_sent_before: int                       = 0
    hours_since_open: float                         = 2.0
    failure_class_at_decision: str                  = "INSUFFICIENT_FUNDS"
    segment: str                                    = "OTT_STREAMING"
    plan_tier: str                                  = "BASIC"
    rail: str                                       = "UPI_AUTOPAY"
    bank_name: str                                  = "SBI"

    @field_validator('amount_inr')
    @classmethod
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError('amount_inr must be > 0')
        return v

    @field_validator('prior_success_rate')
    @classmethod
    def success_rate_in_range(cls, v):
        if not (0.0 <= v <= 1.0):
            raise ValueError('prior_success_rate must be between 0 and 1')
        return v

    @field_validator('retries_used_before', 'contacts_sent_before')
    @classmethod
    def non_negative_int(cls, v):
        if v < 0:
            raise ValueError('retry/contact counts must be >= 0')
        return v


class CaseExecutionRequest(BaseModel):
    case_id: str
    action: str
    amount_inr: float
    customer_name: Optional[str]  = None
    customer_email: Optional[str] = None
    customer_phone: Optional[str] = None

    @field_validator('amount_inr')
    @classmethod
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError('amount_inr must be > 0')
        return v

    @field_validator('action')
    @classmethod
    def valid_action(cls, v):
        valid = {'RETRY', 'SEND_PAYMENT_LINK', 'SEND_REMINDER',
                 'CHANGE_PAYMENT_METHOD', 'ESCALATE', 'DO_NOTHING'}
        if v.upper() not in valid:
            raise ValueError(f'action must be one of {valid}')
        return v.upper()


class DunningRequest(BaseModel):
    case_id: str
    amount_inr: float
    failure_class_at_decision: str = "INSUFFICIENT_FUNDS"
    channel: str                   = "WHATSAPP"
    locale: str                    = "HI_EN"

    @field_validator('amount_inr')
    @classmethod
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError('amount_inr must be > 0')
        return v


class PTPRequest(BaseModel):
    text: str

    @field_validator('text')
    @classmethod
    def text_not_empty(cls, v):
        if not v.strip():
            raise ValueError('text must not be empty')
        return v


class BatchRunRequest(BaseModel):
    sample_size: Optional[int] = Field(default=1000, ge=10, le=20000)


# ─────────────────────────────────────────────────────────────
# Audit helper
# ─────────────────────────────────────────────────────────────

def log_audit_event(case_id: str, event_type: str, details: Dict[str, Any]):
    key = str(case_id)
    if key not in AUDIT_LOGS:
        AUDIT_LOGS[key] = []
    AUDIT_LOGS[key].append({
        "event_id":   f"evt_{uuid.uuid4().hex[:8]}",
        "timestamp":  datetime.datetime.utcnow().isoformat(),
        "event_type": event_type,
        "details":    details,
    })


# ─────────────────────────────────────────────────────────────
# API Routes
# ─────────────────────────────────────────────────────────────

@app.get("/")
@app.get("/api/health")
def health():
    """Health check endpoint."""
    return {
        "status":         "healthy",
        "service":        "RecoverAI Revenue Recovery Backend",
        "version":        "2.0.0",
        "model_loaded":   model.is_trained,
        "model_version":  model.model_version or "not_loaded",
        "model_auc":      model.training_metrics.get('roc_auc') if model.is_trained else None,
        "razorpay_mock":  razorpay_client.is_mock,
        "llm_available":  agent._gemini_model is not None,
        "timestamp":      datetime.datetime.utcnow().isoformat(),
    }


@app.get("/api/dashboard")
def dashboard():
    """
    Returns aggregated dashboard metrics.
    Only returns real data after a batch has been run.
    Never returns fabricated numbers.
    """
    global LATEST_BATCH_RESULTS
    if LATEST_BATCH_RESULTS is None:
        return {
            "status": "no_batch_run",
            "message": "Run POST /api/batch/run first to generate dashboard metrics.",
        }

    r  = LATEST_BATCH_RESULTS
    ai = r.recoverai
    b  = r.baseline

    return {
        "status":                       "available",
        "batch_id":                     r.batch_id,
        "cases_evaluated":              r.cases_evaluated,
        "revenue_at_risk_inr":          r.revenue_at_risk_inr,
        "eligible_revenue_inr":         r.eligible_revenue_inr,

        # RecoverAI arm
        "recoverai_actions_attempted":  ai.actions_attempted,
        "recoverai_attributed_recoveries": ai.attributed_recoveries,
        "recoverai_gross_recovered_inr":ai.gross_recovered_inr,
        "recoverai_net_recovered_inr":  ai.net_recovered_inr,
        "recoverai_recovery_rate_pct":  ai.recovery_rate_pct,
        "recoverai_actions_breakdown":  ai.actions_breakdown,

        # Baseline arm
        "baseline_actions_attempted":   b.actions_attempted,
        "baseline_attributed_recoveries": b.attributed_recoveries,
        "baseline_net_recovered_inr":   b.net_recovered_inr,
        "baseline_recovery_rate_pct":   b.recovery_rate_pct,

        # Incremental
        "incremental_revenue_inr":      r.incremental_revenue_inr,
        "recovery_uplift_pct":          r.recovery_uplift_pct,
        "blocked_actions":              r.blocked_actions,
        "escalated_actions":            r.escalated_actions,
        "guardrail_stats":              r.guardrail_stats,

        # ML model metrics (separate from business metrics)
        "ml_metrics":                   r.ml_metrics,
    }


@app.post("/api/recovery/analyze")
def analyze_recovery_case(req: CaseAnalysisRequest):
    """ML prediction → agent diagnosis → guardrail evaluation. Returns full decision chain."""
    if not model.is_trained:
        raise HTTPException(
            status_code=503,
            detail="Policy model not loaded. Train the model first."
        )

    case_dict = req.model_dump()

    try:
        p_rec   = model.predict_proba(case_dict)
        actions = model.evaluate_actions(case_dict)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    proposed_act = actions[0]['action'] if actions else 'RETRY'
    g_eval       = guardrails.evaluate(case_dict, proposed_act)
    diagnosis    = agent.diagnose_case(case_dict, p_rec, g_eval.recommended_action)

    log_audit_event(req.case_id, "CASE_ANALYZED", {
        "recovery_probability":  p_rec,
        "recommended_action":    g_eval.recommended_action,
        "policy_status":         g_eval.status,
        "reason":                g_eval.reason,
        "expected_recovery_inr": diagnosis.expected_recovery_inr,
    })

    return {
        "case_id":              req.case_id,
        "recovery_probability": p_rec,
        "risk_level":           diagnosis.risk_level,
        "recommended_action":   g_eval.recommended_action,
        "expected_recovery_inr": diagnosis.expected_recovery_inr,
        "reason":               g_eval.reason,
        "policy_status":        g_eval.status,
        "policy_violations":    [v.model_dump() for v in g_eval.policy_violations],
        "all_action_scores":    actions,
        "diagnosis":            diagnosis.model_dump(),
        "state":                RecoveryState.ACTION_SELECTED,
    }


@app.post("/api/recovery/execute")
def execute_recovery(req: CaseExecutionRequest):
    """Re-evaluates guardrails and executes approved recovery action via Razorpay client."""
    case_dict = req.model_dump()
    g_eval    = guardrails.evaluate(case_dict, req.action)

    if g_eval.status == "BLOCKED":
        log_audit_event(req.case_id, "ACTION_BLOCKED", {
            "action":   req.action,
            "reason":   g_eval.reason,
            "violations": [v.model_dump() for v in g_eval.policy_violations],
        })
        return {
            "status":           "BLOCKED",
            "case_id":          req.case_id,
            "action":           req.action,
            "policy_status":    "BLOCKED",
            "reason":           g_eval.reason,
            "policy_violations": [v.model_dump() for v in g_eval.policy_violations],
            "execution_details": None,
            "state":            RecoveryState.BLOCKED,
        }

    exec_action      = g_eval.recommended_action
    execution_result = {}

    if exec_action == "SEND_PAYMENT_LINK":
        execution_result = razorpay_client.create_payment_link(
            amount_inr      = req.amount_inr,
            customer_name   = req.customer_name   or "Customer",
            customer_email  = req.customer_email  or "customer@example.com",
            customer_phone  = req.customer_phone  or "9999999999",
            description     = f"RecoverAI Recovery — Case #{req.case_id}",
        )
    elif exec_action == "RETRY":
        execution_result = razorpay_client.retry_subscription_charge(
            f"sub_{req.case_id}"
        )
    else:
        execution_result = {
            "status":  "initiated",
            "action":  exec_action,
            "message": f"Action '{exec_action}' dispatched.",
            "is_mock": True,
        }

    # Record execution for idempotency
    record_execution(req.case_id, exec_action)

    log_audit_event(req.case_id, "ACTION_EXECUTED", {
        "action":           exec_action,
        "policy_status":    g_eval.status,
        "execution_result": execution_result,
    })

    return {
        "status":           "SUCCESS",
        "case_id":          req.case_id,
        "executed_action":  exec_action,
        "policy_status":    g_eval.status,
        "reason":           g_eval.reason,
        "execution_details": execution_result,
        "state":            RecoveryState.ACTION_EXECUTED,
    }


@app.post("/api/batch/run")
def run_batch(req: BatchRunRequest):
    """Runs batch recovery evaluation across test dataset. Returns honest comparison table."""
    global LATEST_BATCH_RESULTS
    data_file = 'data/test_batch.csv' if os.path.exists('data/test_batch.csv') else 'backend/data/test_batch.csv'

    if not os.path.exists(data_file):
        raise HTTPException(status_code=404, detail="test_batch.csv not found")

    try:
        runner = BatchRunner(data_path=data_file)
        results = runner.run_simulation(sample_size=req.sample_size)
        LATEST_BATCH_RESULTS = results
        return results.model_dump()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/batch/results")
@app.get("/api/batch/{batch_id}/results")
def get_batch_results(batch_id: Optional[str] = None):
    """Retrieves latest batch simulation results."""
    global LATEST_BATCH_RESULTS
    if LATEST_BATCH_RESULTS:
        return LATEST_BATCH_RESULTS.model_dump()
    raise HTTPException(
        status_code=404,
        detail="No batch results available. Run POST /api/batch/run first."
    )


@app.get("/api/audit/{case_id}")
def get_audit(case_id: str):
    """Returns chronological audit trail for a case."""
    logs = AUDIT_LOGS.get(str(case_id), [])
    return {"case_id": case_id, "event_count": len(logs), "logs": logs}


@app.get("/api/cases")
def list_cases(
    limit: int                   = Query(20, ge=1, le=100),
    offset: int                  = Query(0, ge=0),
    failure_class: Optional[str] = None,
):
    """Lists cases with ML predictions, guardrail status, and priority score."""
    if not model.is_trained:
        raise HTTPException(status_code=503, detail="Policy model not loaded.")

    data_file = 'data/test_batch.csv' if os.path.exists('data/test_batch.csv') else 'backend/data/test_batch.csv'
    if not os.path.exists(data_file):
        raise HTTPException(status_code=404, detail="Dataset not found")

    df = pd.read_csv(data_file)
    if failure_class:
        df = df[df['failure_class_at_decision'] == failure_class]

    total_count = len(df)
    sliced      = df.iloc[offset: offset + limit]

    results = []
    for _, row in sliced.iterrows():
        c_dict  = row.to_dict()
        try:
            p_rec   = model.predict_proba(c_dict)
            actions = model.evaluate_actions(c_dict)
        except Exception:
            p_rec   = 0.0
            actions = []

        best_act = actions[0]['action'] if actions else 'RETRY'
        g_eval   = guardrails.evaluate(c_dict, best_act)
        amount   = float(c_dict.get('amount_inr', 0))

        results.append({
            "case_id":              str(c_dict.get('case_id')),
            "customer_id":          str(c_dict.get('customer_id')),
            "subscription_id":      str(c_dict.get('subscription_id')),
            "amount_inr":           amount,
            "failure_class":        str(c_dict.get('failure_class_at_decision')),
            "prior_success_rate":   float(c_dict.get('prior_success_rate', 0)),
            "recovery_probability": p_rec,
            "expected_recovery_inr": round(p_rec * amount, 2),
            "priority_score":       round(p_rec * amount, 2),   # higher = recover first
            "recommended_action":   g_eval.recommended_action,
            "policy_status":        g_eval.status,
            "reason":               g_eval.reason,
        })

    return {"total": total_count, "offset": offset, "limit": limit, "cases": results}


@app.get("/api/cases/{case_id}")
def get_case_detail(case_id: str):
    """Returns single case details, prediction, guardrail status, and audit log."""
    if not model.is_trained:
        raise HTTPException(status_code=503, detail="Policy model not loaded.")

    data_file = 'data/test_batch.csv' if os.path.exists('data/test_batch.csv') else 'backend/data/test_batch.csv'
    if not os.path.exists(data_file):
        raise HTTPException(status_code=404, detail="Dataset not found")

    df      = pd.read_csv(data_file)
    matches = df[df['case_id'].astype(str) == str(case_id)]
    if matches.empty:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")

    case_dict    = matches.iloc[0].to_dict()
    p_rec        = model.predict_proba(case_dict)
    actions      = model.evaluate_actions(case_dict)
    proposed_act = actions[0]['action'] if actions else 'RETRY'
    g_eval       = guardrails.evaluate(case_dict, proposed_act)
    diagnosis    = agent.diagnose_case(case_dict, p_rec, g_eval.recommended_action)

    return {
        "case_info":           {k: v for k, v in case_dict.items()
                                if k not in ('logging_policy',)},
        "prediction": {
            "recovery_probability":  p_rec,
            "expected_recovery_inr": diagnosis.expected_recovery_inr,
            "action_rankings":       actions,
        },
        "guardrail_evaluation": g_eval.model_dump(),
        "diagnosis":            diagnosis.model_dump(),
        "audit_trail":          AUDIT_LOGS.get(str(case_id), []),
    }


@app.post("/api/dunning/generate")
def generate_dunning(req: DunningRequest):
    """Generates personalized multi-channel dunning copy."""
    return agent.generate_dunning_message(
        case    = req.model_dump(),
        channel = req.channel,
        locale  = req.locale,
    )


@app.post("/api/dunning/parse-ptp")
def parse_ptp(req: PTPRequest):
    """Parses customer Promise-To-Pay text response."""
    return agent.parse_ptp_response(req.text).model_dump()


@app.get("/api/model/info")
def model_info():
    """Returns training metadata for the loaded policy model."""
    if not model.is_trained:
        raise HTTPException(status_code=503, detail="Policy model not loaded.")
    return {
        "model_version":     model.model_version,
        "training_metrics":  model.training_metrics,
        "feature_count":     len(model.feature_names),
        "features":          model.feature_names,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
