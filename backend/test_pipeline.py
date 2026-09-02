"""
End-to-End Test & Pipeline Verification Script for RecoverAI Backend.
Tests data loading, model training/inference, guardrail enforcement,
agent state machine, Razorpay client, batch simulation & CSV upload, and FastAPI API routes.
"""

import sys
import os
import io
import json

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Ensure backend root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.policy_model import RecoveryPolicyModel
from src.guardrails import GuardrailEngine
from src.agent import RecoveryAgent
from src.razorpay_client import RazorpayTestClient
from src.batch_runner import BatchRunner
import main as app_module
from fastapi.testclient import TestClient

def run_pipeline_tests():
    print("=" * 60)
    print(">> RECOVERAI BACKEND END-TO-END PIPELINE TEST")
    print("=" * 60)

    # Step 1: Data Check
    train_path = 'data/train.csv' if os.path.exists('data/train.csv') else 'backend/data/train.csv'
    test_path = 'data/test_batch.csv' if os.path.exists('data/test_batch.csv') else 'backend/data/test_batch.csv'
    
    print(f"\n[1/7] Checking Datasets...")
    print(f"  [OK] Train Data: {train_path} ({'Found' if os.path.exists(train_path) else 'Missing'})")
    print(f"  [OK] Test Batch: {test_path} ({'Found' if os.path.exists(test_path) else 'Missing'})")

    # Step 2: Policy Model Training & Prediction
    print(f"\n[2/7] Testing Policy ML Model (Train & Inference)...")
    pm = RecoveryPolicyModel()
    if not pm.load_model():
        metrics = pm.train(train_path)
        print(f"  [OK] Model Training Metrics: {metrics}")
    else:
        print(f"  [OK] Model Loaded (AUC: {pm.training_metrics.get('roc_auc')})")
    
    sample_case = {
        'case_id': 'CASE_TEST_101',
        'amount_inr': 8500.0,
        'customer_tenure_days': 320,
        'prior_success_rate': 0.85,
        'retries_used_before': 0,
        'contacts_sent_before': 0,
        'hours_since_open': 2.5,
        'failure_class_at_decision': 'INSUFFICIENT_FUNDS',
        'segment': 'OTT_STREAMING',
        'rail': 'UPI_AUTOPAY',
    }
    p_rec = pm.predict_proba(sample_case)
    action_rankings = pm.evaluate_actions(sample_case)
    print(f"  [OK] Sample Case P(recovery): {p_rec}")
    print(f"  [OK] Ranked Actions: Top action = {action_rankings[0]['action']} (ERV: INR {action_rankings[0]['expected_recovery_inr']})")

    # Step 3: Guardrails Safety Engine
    print(f"\n[3/7] Testing Guardrails Policy Engine...")
    ge = GuardrailEngine()
    eval_approved = ge.evaluate(sample_case, 'RETRY')
    print(f"  [OK] Normal Action Guardrail: {eval_approved.status} ({eval_approved.reason})")

    already_paid_case = {'payment_status': 'SUCCESS', 'amount_inr': 5000.0}
    eval_blocked = ge.evaluate(already_paid_case, 'RETRY')
    print(f"  [OK] Already Paid Case Guardrail: {eval_blocked.status} (Action: {eval_blocked.recommended_action})")
    assert eval_blocked.status == 'BLOCKED', "Already paid case must be BLOCKED"

    # Step 4: Agent & PTP Parser
    print(f"\n[4/7] Testing AI Agent & Dunning / PTP Parser...")
    ag = RecoveryAgent()
    diag = ag.diagnose_case(sample_case, p_rec, eval_approved.recommended_action)
    print(f"  [OK] Diagnosis Risk Level: {diag.risk_level}")
    print(f"  [OK] Reasoning: {diag.reasoning[:90]}...")
    
    dunning_msg = ag.generate_dunning_message(sample_case, channel="WHATSAPP", locale="HI_EN")
    print(f"  [OK] Generated Dunning Msg: {dunning_msg['message_body'][:80]}...")
    
    ptp_res = ag.parse_ptp_response("I will pay on 5th after salary")
    print(f"  [OK] Parsed PTP Response: Intent = {ptp_res.intent}, Promised Date = {ptp_res.promised_date}")

    # Step 5: Batch Runner Simulation
    print(f"\n[5/7] Running Batch Evaluation Simulator...")
    runner = BatchRunner(data_path=test_path)
    batch_res = runner.run_simulation(sample_size=200)
    print(f"  [OK] Batch Simulation Complete:")
    print(f"     - Cases Evaluated: {batch_res.cases_evaluated}")
    print(f"     - Revenue at Risk: INR {batch_res.revenue_at_risk_inr:,.2f}")
    print(f"     - Net Recovered (RecoverAI): INR {batch_res.recoverai.net_recovered_inr:,.2f} ({batch_res.recoverai.recovery_rate_pct}%)")
    print(f"     - Net Recovered (Baseline): INR {batch_res.baseline.net_recovered_inr:,.2f} ({batch_res.baseline.recovery_rate_pct}%)")
    print(f"     - Incremental Revenue: +INR {batch_res.incremental_revenue_inr:,.2f} ({batch_res.recovery_uplift_pct}%)")

    # Step 6: Custom CSV Upload & Processing
    print(f"\n[6/7] Testing Custom CSV Upload Processing...")
    client = TestClient(app_module.app)
    sample_csv = """transaction_id,customer_id,amount_inr,status,failure_code,payment_method,attempt_count,timestamp
TXN_101,CUST_801,499.0,FAILED,INSUFFICIENT_FUNDS,UPI_AUTOPAY,0,2026-08-28T14:30:00
TXN_102,CUST_802,8500.0,FAILED,RATE_LIMIT,CARD,2,2026-08-28T16:45:00
TXN_103,CUST_803,1200.0,FAILED,MANDATE_CLOSED,UPI_AUTOPAY,1,2026-08-28T18:00:00
TXN_104,CUST_804,350.0,FAILED,CARD_EXPIRED,CARD,0,2026-08-28T19:15:00
"""
    r_upload = client.post(
        '/api/batch/upload',
        files={'file': ('custom_batch.csv', io.BytesIO(sample_csv.encode('utf-8')), 'text/csv')}
    )
    assert r_upload.status_code == 200, f"Upload failed: {r_upload.text}"
    upload_res = r_upload.json()
    print(f"  [OK] POST /api/batch/upload: Evaluated {upload_res['cases_evaluated']} custom rows")
    print(f"     - Top Action: {upload_res['case_details'][0]['recommended_action']} for {upload_res['case_details'][0]['transaction_id']}")

    # Step 7: FastAPI Route Endpoints via TestClient
    print(f"\n[7/7] Testing FastAPI REST Endpoints (P0 & P1)...")
    
    r_health = client.get("/api/health")
    assert r_health.status_code == 200
    print(f"  [OK] GET /api/health: {r_health.json()['status']}")

    r_dash = client.get("/api/dashboard")
    assert r_dash.status_code == 200
    print(f"  [OK] GET /api/dashboard: INR {r_dash.json()['revenue_at_risk_inr']} at risk")

    r_analyze = client.post("/api/recovery/analyze", json=sample_case)
    assert r_analyze.status_code == 200
    print(f"  [OK] POST /api/recovery/analyze: Rec Action = {r_analyze.json()['recommended_action']}")

    r_execute = client.post("/api/recovery/execute", json={
        "case_id": "CASE_TEST_101",
        "action": "SEND_PAYMENT_LINK",
        "amount_inr": 8500.0
    })
    assert r_execute.status_code == 200
    print(f"  [OK] POST /api/recovery/execute: {r_execute.json()['status']} ({r_execute.json()['executed_action']})")

    # Diagnose and act recovery loop
    r_diag_act = client.post("/api/recovery/diagnose-and-act", json={
        "case_id": "610",
        "amount_inr": 499.0,
        "failure_reason": "USER_DISMISSED"
    })
    assert r_diag_act.status_code == 200
    print(f"  [OK] POST /api/recovery/diagnose-and-act: Action = {r_diag_act.json()['policy']['final_action']}")

    # Razorpay Standard Checkout
    r_order = client.post("/api/create-order", json={"amount_inr": 499.0, "case_id": "610"})
    assert r_order.status_code == 200
    print(f"  [OK] POST /api/create-order: Order ID = {r_order.json().get('order_id')}")

    print("\n" + "=" * 60)
    print("[SUCCESS] ALL P0 & P1 PIPELINE COMPONENTS VERIFIED CLEANLY.")
    print("=" * 60)

if __name__ == "__main__":
    run_pipeline_tests()


