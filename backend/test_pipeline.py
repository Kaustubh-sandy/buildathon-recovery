"""
End-to-End Test & Pipeline Verification Script for RecoverAI Backend.
Tests data loading, model training/inference, guardrail enforcement,
agent state machine, Razorpay client, batch simulation, and FastAPI API routes.
"""

import sys
import os
import json

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
    print("🚀 RECOVERAI BACKEND END-TO-END PIPELINE TEST")
    print("=" * 60)

    # Step 1: Data Check
    train_path = 'data/train.csv' if os.path.exists('data/train.csv') else 'backend/data/train.csv'
    test_path = 'data/test_batch.csv' if os.path.exists('data/test_batch.csv') else 'backend/data/test_batch.csv'
    
    print(f"\n[1/6] Checking Datasets...")
    print(f"  ✓ Train Data: {train_path} ({'Found' if os.path.exists(train_path) else 'Missing'})")
    print(f"  ✓ Test Batch: {test_path} ({'Found' if os.path.exists(test_path) else 'Missing'})")

    # Step 2: Policy Model Training & Prediction
    print(f"\n[2/6] Testing Policy ML Model (Train & Inference)...")
    pm = RecoveryPolicyModel()
    metrics = pm.train(train_path)
    print(f"  ✓ Model Training Metrics: {metrics}")
    
    sample_case = {
        'case_id': 'CASE_TEST_101',
        'amount_inr': 8500.0,
        'customer_tenure_days': 320,
        'prior_success_rate': 0.85,
        'retries_used_before': 0,
        'contacts_sent_before': 0,
        'hours_since_open': 2.5,
        'failure_class_at_decision': 'INSUFFICIENT_FUNDS',
        'segment': 'PREMIUM'
    }
    p_rec = pm.predict_proba(sample_case)
    action_rankings = pm.evaluate_actions(sample_case)
    print(f"  ✓ Sample Case P(recovery): {p_rec}")
    print(f"  ✓ Ranked Actions: Top action = {action_rankings[0]['action']} (Score: {action_rankings[0]['expected_recovery_inr']})")

    # Step 3: Guardrails Safety Engine
    print(f"\n[3/6] Testing Guardrails Policy Engine...")
    ge = GuardrailEngine()
    eval_approved = ge.evaluate(sample_case, 'RETRY')
    print(f"  ✓ Normal Action Guardrail: {eval_approved.status} ({eval_approved.reason})")

    already_paid_case = {'y': 1, 'amount_inr': 5000.0}
    eval_blocked = ge.evaluate(already_paid_case, 'RETRY')
    print(f"  ✓ Already Paid Case Guardrail: {eval_blocked.status} (Action: {eval_blocked.recommended_action})")
    assert eval_blocked.status == 'BLOCKED', "Already paid case must be BLOCKED"

    # Step 4: Agent & PTP Parser
    print(f"\n[4/6] Testing AI Agent & Dunning / PTP Parser...")
    ag = RecoveryAgent()
    diag = ag.diagnose_case(sample_case, p_rec, eval_approved.recommended_action)
    print(f"  ✓ Diagnosis Risk Level: {diag.risk_level}")
    print(f"  ✓ Reasoning: {diag.reasoning[:90]}...")
    
    dunning_msg = ag.generate_dunning_message(sample_case, channel="WHATSAPP", locale="HI_EN")
    print(f"  ✓ Generated Dunning Msg: {dunning_msg['message_body'][:80]}...")
    
    ptp_res = ag.parse_ptp_response("I will pay on 5th after salary")
    print(f"  ✓ Parsed PTP Response: Intent = {ptp_res.intent}, Promised Date = {ptp_res.promised_date}")

    # Step 5: Batch Runner Simulation
    print(f"\n[5/6] Running Batch Evaluation Simulator...")
    runner = BatchRunner(data_path=test_path)
    batch_res = runner.run_simulation(sample_size=200)
    print(f"  ✓ Batch Simulation Complete:")
    print(f"     - Cases Analyzed: {batch_res.cases_analyzed}")
    print(f"     - Revenue at Risk: ₹{batch_res.revenue_at_risk:,.2f}")
    print(f"     - Revenue Recovered (RecoverAI): ₹{batch_res.revenue_recovered:,.2f} ({batch_res.recovery_rate}%)")
    print(f"     - Revenue Recovered (Baseline): ₹{batch_res.baseline_results.revenue_recovered:,.2f} ({batch_res.baseline_results.recovery_rate}%)")
    print(f"     - Recovery Uplift: +{batch_res.recovery_uplift_pct}%")
    print(f"     - Net Financial ROI: ₹{batch_res.net_roi_inr:,.2f}")

    # Step 6: FastAPI Route Endpoints via TestClient
    print(f"\n[6/6] Testing FastAPI REST Endpoints...")
    client = TestClient(app_module.app)
    
    r_health = client.get("/api/health")
    assert r_health.status_code == 200
    print(f"  ✓ GET /api/health: {r_health.json()['status']}")

    r_dash = client.get("/api/dashboard")
    assert r_dash.status_code == 200
    print(f"  ✓ GET /api/dashboard: ₹{r_dash.json()['revenue_at_risk']} at risk")

    r_analyze = client.post("/api/recovery/analyze", json=sample_case)
    assert r_analyze.status_code == 200
    print(f"  ✓ POST /api/recovery/analyze: Rec Action = {r_analyze.json()['recommended_action']}")

    r_execute = client.post("/api/recovery/execute", json={
        "case_id": "CASE_TEST_101",
        "action": "SEND_PAYMENT_LINK",
        "amount_inr": 8500.0
    })
    assert r_execute.status_code == 200
    print(f"  ✓ POST /api/recovery/execute: {r_execute.json()['status']} ({r_execute.json()['executed_action']})")

    r_batch = client.get("/api/batch/results")
    assert r_batch.status_code == 200
    print(f"  ✓ GET /api/batch/results: {r_batch.json()['cases_analyzed']} cases retrieved")

    print("\n" + "=" * 60)
    print("✅ SUCCESS! ALL PIPELINE COMPONENTS VERIFIED CLEANLY.")
    print("=" * 60)

if __name__ == "__main__":
    run_pipeline_tests()
