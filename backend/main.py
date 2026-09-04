"""
RecoverAI FastAPI Application Server.
"""

import os
import sys
import uuid
import datetime
from typing import Dict, Any, List, Optional

import io
from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Response
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
from src.sms_service import send_recovery_sms, send_recovery_link_sms, format_phone_e164

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
model.load_model()
guardrails      = GuardrailEngine()
agent           = RecoveryAgent()
razorpay_client = RazorpayTestClient()

# In-memory audit trail (session-scoped; replace with DB for production)
AUDIT_LOGS: Dict[str, List[Dict[str, Any]]] = {}
LATEST_BATCH_RESULTS: Optional[BatchResults] = None
CASE_LEDGER: Dict[str, Dict[str, Any]] = {}


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


class CreateOrderRequest(BaseModel):
    amount_inr: float
    receipt: str = "receipt_default"
    currency: str = "INR"
    case_id: Optional[str] = None

    @field_validator('amount_inr')
    @classmethod
    def amount_min_one_rupee(cls, v):
        if v < 1.0:
            raise ValueError('amount_inr must be >= 1.00 (minimum 100 paise)')
        return v


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    case_id: Optional[str] = None

    @field_validator('razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature')
    @classmethod
    def must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError('field must not be empty')
        return v


class DiagnoseAndActRequest(BaseModel):
    """Payload sent by the frontend when a payment fails or is dismissed."""
    case_id: str
    amount_inr: float
    failure_reason: str            = "PAYMENT_FAILED"
    customer_id: Optional[str]     = None
    channel: str                   = "WHATSAPP"
    locale: str                    = "HI_EN"
    timestamp: Optional[str]       = None
    # Optional override fields (used when case is not in test_batch.csv)
    failure_class_at_decision: Optional[str] = None
    retries_used_before: Optional[int]       = None
    rail: Optional[str]                      = None
    bank_name: Optional[str]                 = None
    customer_phone: Optional[str]            = "+919234633668"

    @field_validator('amount_inr')
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError('amount_inr must be > 0')
        return v

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
            customer_phone  = req.customer_phone  or "9876543210",
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

        # Persist batch audit trail to central audit registry
        if results.case_details:
            for c in results.case_details:
                cid = str(c.get('transaction_id', ''))
                if cid:
                    log_audit_event(cid, "BATCH_EVALUATION_COMPLETED", {
                        "batch_id": results.batch_id,
                        "amount_inr": c.get('amount_inr'),
                        "p_recovery": c.get('p_recovery'),
                        "erv": c.get('erv'),
                        "risk_level": c.get('risk_level'),
                        "recommended_action": c.get('recommended_action'),
                        "guardrail_status": c.get('guardrail_status'),
                        "reasoning": c.get('agent_reasoning'),
                        "audit_steps": c.get('audit_steps'),
                    })
        if results.batch_audit_log:
            log_audit_event(results.batch_id, "BATCH_ORCHESTRATION_COMPLETED", {
                "batch_id": results.batch_id,
                "cases_evaluated": results.cases_evaluated,
                "revenue_at_risk_inr": results.revenue_at_risk_inr,
                "incremental_revenue_inr": results.incremental_revenue_inr,
                "recovery_uplift_pct": results.recovery_uplift_pct,
                "batch_log": results.batch_audit_log,
            })

        return results.model_dump()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/api/batch/upload")
async def upload_batch_csv(file: UploadFile = File(...)):
    """
    Accepts a user-uploaded CSV file containing transactions with columns:
      - transaction_id
      - customer_id
      - amount_inr
      - status
      - failure_code
      - payment_method
      - attempt_count
      - timestamp
    Normalizes the data, runs the full RecoverAI vs Baseline evaluation,
    and returns BatchResults with per-transaction recovery recommendations.
    """
    global LATEST_BATCH_RESULTS
    try:
        contents = await file.read()
        df = pd.read_csv(io.BytesIO(contents))
        if df.empty:
            raise HTTPException(status_code=400, detail="Uploaded CSV file is empty.")

        runner = BatchRunner()
        results = runner.run_simulation(df=df)
        LATEST_BATCH_RESULTS = results

        # Persist custom batch audit trail to central audit registry
        if results.case_details:
            for c in results.case_details:
                cid = str(c.get('transaction_id', ''))
                if cid:
                    log_audit_event(cid, "BATCH_EVALUATION_COMPLETED", {
                        "batch_id": results.batch_id,
                        "amount_inr": c.get('amount_inr'),
                        "p_recovery": c.get('p_recovery'),
                        "erv": c.get('erv'),
                        "risk_level": c.get('risk_level'),
                        "recommended_action": c.get('recommended_action'),
                        "guardrail_status": c.get('guardrail_status'),
                        "reasoning": c.get('agent_reasoning'),
                        "audit_steps": c.get('audit_steps'),
                    })
        if results.batch_audit_log:
            log_audit_event(results.batch_id, "BATCH_ORCHESTRATION_COMPLETED", {
                "batch_id": results.batch_id,
                "cases_evaluated": results.cases_evaluated,
                "revenue_at_risk_inr": results.revenue_at_risk_inr,
                "incremental_revenue_inr": results.incremental_revenue_inr,
                "recovery_uplift_pct": results.recovery_uplift_pct,
                "batch_log": results.batch_audit_log,
            })

        return results.model_dump()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process CSV file: {str(e)}")



@app.get("/api/batch/sample-template")
def download_sample_template():
    """
    Returns a downloadable sample CSV with the required columns:
      transaction_id,customer_id,amount_inr,status,failure_code,payment_method,attempt_count,timestamp
    """
    csv_data = (
        "transaction_id,customer_id,amount_inr,status,failure_code,payment_method,attempt_count,timestamp\n"
        "TXN_901,CUST_4011,499.0,FAILED,INSUFFICIENT_FUNDS,UPI_AUTOPAY,0,2026-08-28T14:30:00\n"
        "TXN_902,CUST_4012,8500.0,FAILED,RATE_LIMIT,CARD,2,2026-08-28T16:45:00\n"
        "TXN_903,CUST_4013,1200.0,FAILED,MANDATE_CLOSED,UPI_AUTOPAY,1,2026-08-28T18:00:00\n"
        "TXN_904,CUST_4014,350.0,FAILED,CARD_EXPIRED,CARD,0,2026-08-28T19:15:00\n"
        "TXN_905,CUST_4015,15000.0,FAILED,BANK_TECHNICAL,NETBANKING,1,2026-08-28T21:00:00\n"
        "TXN_906,CUST_4016,299.0,RECOVERED,INSUFFICIENT_FUNDS,UPI_AUTOPAY,1,2026-08-29T10:00:00\n"
        "TXN_907,CUST_4017,2499.0,FAILED,INSUFFICIENT_FUNDS,UPI_AUTOPAY,0,2026-08-29T11:30:00\n"
        "TXN_908,CUST_4018,499.0,FAILED,GATEWAY_TIMEOUT,CARD,1,2026-08-29T15:00:00\n"
    )
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=recoverai_sample_batch.csv"},
    )


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


# ─────────────────────────────────────────────────────────────
# Razorpay Standard Checkout endpoints
# ─────────────────────────────────────────────────────────────

@app.post("/api/create-order")
def create_razorpay_order(req: CreateOrderRequest):
    """
    Creates a Razorpay Order for Standard Checkout.
    Returns order_id + amount (paise) + currency to the frontend.
    KEY_SECRET never leaves this backend.
    """
    try:
        result = razorpay_client.create_order(
            amount_inr = req.amount_inr,
            receipt    = req.receipt,
            currency   = req.currency,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Razorpay order creation failed: {e}")

    # Attach the public KEY_ID so frontend can open the modal without needing it in .env
    result["key_id"] = razorpay_client.key_id

    if req.case_id:
        log_audit_event(req.case_id, "RAZORPAY_ORDER_CREATED", {
            "order_id":   result.get("order_id"),
            "amount_inr": req.amount_inr,
            "is_mock":    result.get("is_mock"),
        })

    return result


@app.post("/api/verify-payment")
def verify_razorpay_payment(req: VerifyPaymentRequest):
    """
    Verifies Razorpay payment signature.
    Algorithm: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
    Returns HTTP 200 + verified=true ONLY when signatures match.
    Returns HTTP 400 on mismatch — do NOT mark payment as captured on any other response.
    """
    result = razorpay_client.verify_payment_signature(
        razorpay_order_id   = req.razorpay_order_id,
        razorpay_payment_id = req.razorpay_payment_id,
        razorpay_signature  = req.razorpay_signature,
    )

    if not result.get("verified"):
        # Signature mismatch — never mark as paid
        log_audit_event(req.case_id or "unknown", "PAYMENT_SIGNATURE_FAILED", result)
        raise HTTPException(
            status_code=400,
            detail=result.get("error", "Signature verification failed"),
        )

    log_audit_event(req.case_id or req.razorpay_order_id, "PAYMENT_VERIFIED", {
        "razorpay_order_id":   req.razorpay_order_id,
        "razorpay_payment_id": req.razorpay_payment_id,
        "is_mock":             result.get("is_mock"),
    })

    return {
        "status":              "PAYMENT_VERIFIED",
        "verified":            True,
        "razorpay_order_id":   req.razorpay_order_id,
        "razorpay_payment_id": req.razorpay_payment_id,
        "message":             result.get("message", "Payment verified"),
        "mode":                result.get("mode"),
    }



# ─────────────────────────────────────────────────────────────
# AI Recovery Loop — diagnose-and-act (triggered on payment failure)
# ─────────────────────────────────────────────────────────────

@app.post("/api/recovery/diagnose-and-act")
def diagnose_and_act(req: DiagnoseAndActRequest):
    """
    The central AI Recovery Loop endpoint.
    Called immediately when a payment fails or is dismissed.

    Pipeline (in order):
      1. Case lookup   — find context from test_batch.csv by case_id
      2. ML prediction — P(recovery | case features)
      3. Guardrails    — check limits, fraud, opt-out, cooldown
      4. Payment link  — create Razorpay payment link for recovery
      5. LLM copy      — generate localized dunning message (Gemini / template)
      6. Audit log     — write timeline event
      7. Return        — full recovery plan for UI rendering
    """
    import datetime as _dt
    import os as _os

    audit_steps: List[Dict[str, Any]] = []
    t0 = _dt.datetime.utcnow()

    def step(name: str, detail: Dict[str, Any]):
        audit_steps.append({
            "step":      name,
            "timestamp": _dt.datetime.utcnow().isoformat(),
            "detail":    detail,
        })

    # ── 1. Case Lookup ───────────────────────────────────────────────
    case_dict: Dict[str, Any] = {
        "case_id":                  req.case_id,
        "amount_inr":               req.amount_inr,
        "failure_class_at_decision": req.failure_class_at_decision or "BANK_TECHNICAL",
        "retries_used_before":      req.retries_used_before if req.retries_used_before is not None else 0,
        "rail":                     req.rail or "UPI_AUTOPAY",
        "bank_name":                req.bank_name or "UNKNOWN",
        "contacts_sent_before":     0,
        "prior_success_rate":       0.60,
        "customer_tenure_days":     365,
        "hours_since_open":         0,
    }

    # Try to find richer context from test_batch.csv
    data_file = "data/test_batch.csv" if _os.path.exists("data/test_batch.csv") else "backend/data/test_batch.csv"
    case_source = "request_payload"
    if _os.path.exists(data_file):
        try:
            df_lookup = pd.read_csv(data_file)
            matches   = df_lookup[df_lookup["case_id"].astype(str) == str(req.case_id)]
            if not matches.empty:
                case_dict   = matches.iloc[0].to_dict()
                # Override amount and failure reason from live request
                case_dict["amount_inr"] = req.amount_inr
                case_source = "test_batch_csv"
        except Exception:
            pass

    step("CASE_LOOKUP", {
        "case_id":   req.case_id,
        "source":    case_source,
        "amount_inr": req.amount_inr,
        "failure_reason": req.failure_reason,
        "failure_class":  case_dict.get("failure_class_at_decision"),
        "bank_name":      case_dict.get("bank_name"),
        "retries_used":   case_dict.get("retries_used_before"),
    })

    # ── 2. ML Prediction ───────────────────────────────────────────
    p_rec = 0.50  # fallback
    if model.is_trained:
        try:
            p_rec = model.predict_proba(case_dict)
        except Exception as e:
            step("ML_PREDICTION_ERROR", {"error": str(e)})

    risk_level = "LOW" if p_rec >= 0.65 else "MEDIUM" if p_rec >= 0.35 else "HIGH"
    erv        = round(p_rec * req.amount_inr, 2)

    step("ML_PREDICTION", {
        "recovery_probability": p_rec,
        "risk_level":           risk_level,
        "expected_recovery_inr": erv,
    })

    # ── 3. Action Policy ───────────────────────────────────────────
    try:
        action_rankings = model.evaluate_actions(case_dict)
        proposed_action = action_rankings[0]["action"] if action_rankings else "SEND_PAYMENT_LINK"
    except Exception:
        action_rankings = []
        proposed_action = "SEND_PAYMENT_LINK"

    step("ACTION_POLICY", {"proposed_action": proposed_action, "rankings": action_rankings[:3]})

    # ── 4. Guardrails ──────────────────────────────────────────────
    g_eval       = guardrails.evaluate(case_dict, proposed_action)
    final_action = g_eval.recommended_action

    step("GUARDRAILS", {
        "status":          g_eval.status,
        "proposed_action": proposed_action,
        "final_action":    final_action,
        "violations": [v.model_dump() for v in g_eval.policy_violations],
        "checks_passed": len(g_eval.policy_violations) == 0,
    })

    # ── 5. Razorpay Payment Link ──────────────────────────────────
    payment_link_result = {}
    payment_url         = ""
    link_cost_inr       = 0.0

    if g_eval.status != "BLOCKED":
        try:
            payment_link_result = razorpay_client.create_payment_link(
                amount_inr      = req.amount_inr,
                customer_name   = req.customer_id or "Valued Customer",
                description     = f"RecoverAI Recovery — Case #{req.case_id}",
                case_id         = str(req.case_id),
            )
            payment_url   = payment_link_result.get("short_url", "")
            link_cost_inr = 0.50 if not payment_link_result.get("is_mock") else 0.0
        except Exception as e:
            step("PAYMENT_LINK_ERROR", {"error": str(e)})

    # Live State Ledger registration
    cid = str(req.case_id)
    initial_status = "PENDING_PAYMENT" if payment_url else ("BLOCKED" if g_eval.status == "BLOCKED" else "IN_RECOVERY")
    CASE_LEDGER[cid] = {
        "case_id":         cid,
        "status":          initial_status,
        "amount_inr":      req.amount_inr,
        "payment_link_id": payment_link_result.get("payment_link_id"),
        "short_url":       payment_url,
        "failure_reason":  req.failure_reason,
        "customer_id":     req.customer_id or "Valued Customer",
        "created_at":      _dt.datetime.utcnow().isoformat(),
        "updated_at":      _dt.datetime.utcnow().isoformat(),
        "payment_id":      None,
        "settled_at":      None,
    }
    log_audit_event(cid, "RECOVERY_STATE_INITIALIZED", {
        "status":      initial_status,
        "short_url":   payment_url,
        "payment_link_id": payment_link_result.get("payment_link_id"),
    })

    step("PAYMENT_LINK", {
        "payment_url": payment_url,
        "is_mock":     payment_link_result.get("is_mock", True),
        "cost_inr":    link_cost_inr,
    })

    # ── 6. LLM Dunning Message ──────────────────────────────────
    dunning_case = dict(case_dict)
    dunning_case["amount_inr"] = req.amount_inr

    dunning_result = agent.generate_dunning_message(
        case    = dunning_case,
        channel = req.channel,
        locale  = req.locale,
    )
    # Inject the real payment link into the message if we got one
    if payment_url and payment_url not in dunning_result.get("message_body", ""):
        dunning_result["message_body"] = (
            dunning_result.get("message_body", "") + f"\n\nLink: {payment_url}"
        )
    dunning_result["payment_link"] = payment_url

    step("DUNNING_GENERATED", {
        "channel":      req.channel,
        "locale":       req.locale,
        "method":       dunning_result.get("method"),
        "message_preview": dunning_result.get("message_body", "")[:80] + "...",
    })

    # ── 6b. Twilio SMS Dispatch ─────────────────────────────────
    sms_result: Dict[str, Any] = {}
    target_phone = req.customer_phone or _os.getenv("DEFAULT_CUSTOMER_PHONE", "+919234633668")
    if payment_url and g_eval.status != "BLOCKED":
        try:
            sms_result = send_recovery_link_sms(
                to_phone    = target_phone,
                case_id     = req.case_id,
                amount_inr  = req.amount_inr,
                payment_url = payment_url,
                custom_text = dunning_result.get("message_body"),
            )
            step("SMS_DISPATCHED", sms_result)
            log_audit_event(req.case_id, "SMS_RECOVERY_DISPATCHED", sms_result)
        except Exception as _sms_e:
            step("SMS_DISPATCH_ERROR", {"error": str(_sms_e)})

    # ── 7. Audit + Cost Accounting ──────────────────────────────
    elapsed_ms = int((_dt.datetime.utcnow() - t0).total_seconds() * 1000)

    log_audit_event(req.case_id, "RECOVERY_TRIGGERED", {
        "failure_reason":        req.failure_reason,
        "recovery_probability":  p_rec,
        "risk_level":            risk_level,
        "final_action":          final_action,
        "guardrail_status":      g_eval.status,
        "payment_url":           payment_url,
        "expected_recovery_inr": erv,
        "cost_inr":              link_cost_inr,
        "elapsed_ms":            elapsed_ms,
    })

    # ── 8. Return full recovery plan ────────────────────────────
    return {
        # Trigger context
        "case_id":         req.case_id,
        "amount_inr":      req.amount_inr,
        "failure_reason":  req.failure_reason,
        "case_source":     case_source,

        # Diagnosis
        "diagnosis": {
            "failure_class":         case_dict.get("failure_class_at_decision"),
            "bank_name":             case_dict.get("bank_name"),
            "rail":                  case_dict.get("rail"),
            "risk_level":            risk_level,
            "recovery_probability":  p_rec,
            "expected_recovery_inr": erv,
            "retries_used":          case_dict.get("retries_used_before", 0),
            "customer_tenure_days":  case_dict.get("customer_tenure_days"),
            "prior_success_rate":    case_dict.get("prior_success_rate"),
        },

        # Policy decision
        "policy": {
            "proposed_action":  proposed_action,
            "final_action":     final_action,
            "guardrail_status": g_eval.status,
            "guardrail_reason": g_eval.reason,
            "violations":       [v.model_dump() for v in g_eval.policy_violations],
        },

        # Recovery action
        "recovery_action": {
            "action":       final_action,
            "payment_url":  payment_url,
            "payment_link": payment_link_result,
            "cost_inr":     link_cost_inr,
        },

        # Outreach
        "outreach": {
            **dunning_result,
            "sms_dispatch":   sms_result,
            "customer_phone": target_phone,
        },

        # Audit trail
        "audit_steps":  audit_steps,
        "elapsed_ms":   elapsed_ms,

        # Live proof loop ledger
        "ledger_status":   initial_status,
        "payment_link_id": payment_link_result.get("payment_link_id"),
    }


# ─────────────────────────────────────────────────────────────
# Live Recovery Proof Loop & Razorpay Webhooks
# ─────────────────────────────────────────────────────────────

class TestSMSRequest(BaseModel):
    phone: str = "+919234633668"
    message: Optional[str] = None


@app.post("/api/sms/send-test")
def test_send_sms(req: TestSMSRequest):
    """Dispatches a test SMS via Twilio to verify credentials and connectivity."""
    body = req.message or f"RecoverAI Test: Twilio SMS service is operational for {req.phone}!"
    result = send_recovery_sms(to_phone=req.phone, message_body=body)
    return result


@app.get("/api/cases/live/{case_id}")
def get_live_case_status(case_id: str):
    """
    Returns the real-time mutation state of a recovery case from the ledger.
    Used by the frontend to poll and detect when settlement occurs.
    """
    cid = str(case_id)
    if cid in CASE_LEDGER:
        return CASE_LEDGER[cid]
    return {
        "case_id":         cid,
        "status":          "UNKNOWN",
        "amount_inr":      0.0,
        "payment_link_id": None,
        "short_url":       None,
        "updated_at":      datetime.datetime.utcnow().isoformat(),
    }


@app.post("/api/webhooks/razorpay")
async def razorpay_webhook(payload: Dict[str, Any]):
    """
    Processes Razorpay payment link settlement webhooks (payment_link.paid / payment.captured)
    or simulated webhook events from the demo console.
    Mutates CASE_LEDGER status from PENDING_PAYMENT -> RECOVERED and logs the audit event.
    """
    event = payload.get("event", "payment_link.paid")
    case_id = payload.get("case_id")
    payment_id = payload.get("payment_id") or f"pay_settled_{uuid.uuid4().hex[:8]}"

    # 1. Parse standard Razorpay webhook structure if present
    entity = {}
    if "payload" in payload and isinstance(payload["payload"], dict):
        pl_entity = payload["payload"].get("payment_link", {}).get("entity", {})
        pay_entity = payload["payload"].get("payment", {}).get("entity", {})
        entity = pl_entity or pay_entity
        notes = entity.get("notes", {})
        if not case_id and notes:
            case_id = notes.get("case_id")
        if not payment_id and pay_entity.get("id"):
            payment_id = pay_entity.get("id")

    # 2. If case_id not directly extracted, match against payment_link_id
    pl_id = entity.get("id") or payload.get("payment_link_id")
    if not case_id and pl_id:
        for cid, record in CASE_LEDGER.items():
            if record.get("payment_link_id") == pl_id:
                case_id = cid
                break

    # 3. Fallback: If only 1 pending case is in the ledger, map to it
    if not case_id:
        pending = [cid for cid, r in CASE_LEDGER.items() if r.get("status") == "PENDING_PAYMENT"]
        if len(pending) == 1:
            case_id = pending[0]

    if not case_id:
        return {
            "status": "ignored",
            "reason": "No matching active case_id found in ledger",
            "event": event,
        }

    cid = str(case_id)
    now_iso = datetime.datetime.utcnow().isoformat()
    amount_recovered = 0.0

    if cid in CASE_LEDGER:
        amount_recovered = float(CASE_LEDGER[cid].get("amount_inr", 0.0))
        CASE_LEDGER[cid]["status"] = "RECOVERED"
        CASE_LEDGER[cid]["payment_id"] = payment_id
        CASE_LEDGER[cid]["settled_at"] = now_iso
        CASE_LEDGER[cid]["updated_at"] = now_iso
    else:
        amount_recovered = float(payload.get("amount_inr", 0.0))
        CASE_LEDGER[cid] = {
            "case_id":         cid,
            "status":          "RECOVERED",
            "amount_inr":      amount_recovered,
            "payment_link_id": pl_id,
            "short_url":       payload.get("short_url"),
            "payment_id":      payment_id,
            "settled_at":      now_iso,
            "updated_at":      now_iso,
        }

    # Log settlement to central immutable audit trail
    log_audit_event(cid, "PAYMENT_SETTLED_VIA_WEBHOOK", {
        "event":            event,
        "payment_id":       payment_id,
        "amount_recovered": amount_recovered,
        "settled_at":       now_iso,
        "ledger_status":    "RECOVERED",
    })

    return {
        "status":           "success",
        "event":            event,
        "case_id":          cid,
        "state":            "RECOVERED",
        "payment_id":       payment_id,
        "amount_recovered": amount_recovered,
        "settled_at":       now_iso,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
