# RecoverAI — AI Revenue Recovery Agent

> **Hackathon Track 03: AI Revenue Recovery**
>
> **Find revenue that is slipping away and win it back.**

RecoverAI is an AI-assisted revenue recovery system for merchants. It identifies transactions and customer cases where revenue is at risk, estimates the probability of successful recovery, determines the most appropriate recovery intervention, applies deterministic safety policies, executes approved actions through Razorpay Test Mode, and measures the money actually recovered across a batch.

The project is designed around the Track 03 requirement:

> **Detect revenue at risk → determine the right intervention → execute a bounded recovery workflow → measure recovered money.**

---

## 1. Executive Summary

A failed payment is not necessarily lost revenue.

A merchant may have a customer who:
- has successfully paid many times before,
- experienced a temporary payment failure,
- abandoned checkout after showing strong purchase intent,
- has a subscription whose renewal failed,
- or has an overdue invoice with a high probability of eventual payment.

The difficult problem is deciding:

1. **Which revenue is genuinely recoverable?**
2. **Why is it at risk?**
3. **What intervention is most appropriate?**
4. **When should the intervention happen?**
5. **Should the system be allowed to execute it automatically?**
6. **When should it stop or escalate to a human?**
7. **How much money did the intervention actually recover?**

RecoverAI closes this loop.

It combines:
- a **recovery prediction model** for quantitative probability estimation,
- an **AI decision/diagnosis layer** for contextual reasoning,
- a **deterministic policy engine** for financial safety,
- Razorpay **Test Mode APIs** for bounded execution,
- and an **audit + evaluation layer** for explainability and measurable outcomes.

---

# 2. Problem Statement

## The problem

Merchants continuously lose potential revenue through events such as:

- payment failures,
- repeated payment failures,
- checkout abandonment,
- failed subscription renewals,
- overdue receivables,
- and other recoverable payment situations.

Existing systems can tell a merchant that a payment failed, but detection alone does not close the revenue loop.

A useful recovery system must answer:

> **"What should we do next, for this specific customer and this specific revenue opportunity?"**

A static rule such as:

```text
Payment failed → retry once
```

is insufficient.

Different situations require different interventions:

```text
Temporary failure
→ retry later

Strong customer intent
→ payment reminder/payment link

Repeated failure
→ change payment method or escalate

Disputed/fraud-flagged case
→ stop automated recovery

Already successful
→ do nothing / prevent duplicate action
```

The project therefore treats revenue recovery as a **decision + execution + measurement problem**, not simply a payment-status problem.

---

# 3. Why This Is an AI Problem

The system needs to combine multiple signals:

### Transaction context
- transaction amount
- payment status
- failure type
- payment method
- time of transaction

### Customer behavior
- previous successful payments
- previous failed payments
- historical success rate
- customer tenure
- customer value/tier
- lifetime payment behavior

### Recovery history
- previous retries
- previous recovery attempts
- previous contacts
- time since failure
- previous intervention outcomes

### Merchant/business context
- customer segment
- subscription status
- plan tier
- merchant-defined limits
- recovery policies

A machine-learning model can estimate:

```text
P(successful recovery | current context)
```

The AI decision layer can then use the available context to explain the situation and recommend an intervention.

However:

> **The AI must not have unrestricted authority over financial actions.**

Money-moving or customer-impacting actions must pass through deterministic policies.

---

# 4. Project Goal

## Primary goal

Build a working end-to-end system that can process a large batch of synthetic merchant recovery cases and demonstrate:

### Detection
Identify revenue at risk.

### Prediction
Estimate the probability that an intervention will recover the revenue.

### Diagnosis
Explain why the revenue is at risk.

### Decision
Select the appropriate recovery intervention.

### Governance
Check whether the action is permitted by predefined policies.

### Execution
Execute approved recovery actions using Razorpay Test Mode.

### Measurement
Calculate the actual money recovered.

### Auditability
Record what happened, why it happened, which policy allowed it, and what the outcome was.

---

# 5. What We Are NOT Building

RecoverAI is not:

- a generic chatbot,
- a generic payment dashboard,
- a simple payment retry script,
- an unrestricted autonomous payment agent,
- an LLM-only decision system,
- a fraud/offensive system,
- or a model trained to directly control payment APIs.

The project is specifically a:

> **Bounded AI revenue-recovery decision and execution system.**

---

# 6. Core Architecture

```text
                         MERCHANT DATA
                              |
             +----------------+----------------+
             |                |                |
             v                v                v
         Payments         Customers       Subscriptions
             |                |                |
             +----------------+----------------+
                              |
                              v
                   +-----------------------+
                   | Revenue Risk Detector |
                   +-----------+-----------+
                               |
                               v
                      Revenue At Risk
                               |
                               v
                  +------------------------+
                  | Recovery ML Model      |
                  |                        |
                  | P(recovery)            |
                  +-----------+------------+
                              |
                              v
                  +------------------------+
                  | AI Diagnosis / Agent   |
                  |                        |
                  | Why?                   |
                  | What action?           |
                  +-----------+------------+
                              |
                              v
                  +------------------------+
                  | Deterministic Policy   |
                  | Engine                  |
                  |                        |
                  | Limits                 |
                  | Retry rules            |
                  | Consent                |
                  | Duplicate protection   |
                  | Escalation             |
                  +-----------+------------+
                              |
                    +---------+---------+
                    |                   |
                 APPROVE              BLOCK
                    |                   |
                    v                   v
             Razorpay Test         Human Review /
                Mode API             No Action
                    |
                    v
                 Outcome
                    |
                    v
              +-------------+
              | Audit Log   |
              +------+------+
                     |
                     v
            Business Metrics
                     |
                     v
             ₹ REVENUE RECOVERED
```

---

# 7. AI / ML Strategy

## Important principle

We do **not** need to train an LLM.

The ML problem is primarily a **tabular prediction problem**.

Recommended initial model:

- XGBoost

Strong baseline:

- Logistic Regression

The model predicts:

```text
recovery_probability
```

Example:

```text
Transaction:
₹8,500

Recovery probability:
0.82
```

This prediction becomes an input to the decision engine.

---

# 8. Dataset

The project currently has a candidate dataset:

```text
train.csv
```

It contains approximately:

- **110K rows**
- **37 columns**

Relevant fields include examples such as:

```text
amount_inr
customer_tenure_days
subscription_age_days
prior_cycles_seen
prior_successes
prior_success_rate
prior_failed_cases_before
prior_recovered_cases_before
retries_used_before
contacts_sent_before
hours_since_open
hour_of_day
salary_day_proxy_dom
segment
plan_tier
value_tier
failure_class_at_decision
instrument_fixed
in_salary_cluster
action_type
channel
y
```

## Dataset validation requirement

Before final modeling, we must verify:

1. What `y` represents.
2. Whether `y=1` means successful recovery.
3. Whether `action_type` is available before the outcome.
4. Whether any columns leak future information.
5. Whether multiple rows belong to the same customer/case.
6. Whether train/test splitting must be grouped by customer/case/subscription.
7. Whether the dataset represents actual recovery outcomes or requires a synthetic outcome simulator.
8. Whether the dataset supports both recovery prediction and action evaluation.

**No model result should be presented until leakage and target semantics are verified.**

---

# 9. Why Synthetic Data May Be Necessary

A public dataset rarely contains the complete chain:

```text
failed revenue
→ intervention
→ recovery attempt
→ actual recovered amount
```

Therefore, if the existing dataset does not provide valid recovery ground truth, we will create a realistic synthetic recovery environment.

The synthetic dataset should NOT simply use random values.

It should model realistic relationships between:

- customer history,
- failure type,
- transaction value,
- retry count,
- previous recovery behavior,
- time since failure,
- intervention type,
- and recovery outcome.

Example:

```text
High prior success rate
+ first temporary failure
+ low retry count
→ high recovery probability
```

while:

```text
Repeated hard failures
+ multiple previous retries
+ low customer engagement
→ low recovery probability
```

This creates a controlled environment where the true outcome is known and the model can be evaluated honestly.

---

# 10. Feature Groups

## Transaction Features

Examples:

```text
amount_inr
payment_method
failure_class_at_decision
hour_of_day
day/time features
```

## Customer Features

```text
customer_tenure_days
prior_successes
prior_failed_cases_before
prior_success_rate
customer value tier
segment
```

## Recovery History

```text
prior_recovered_cases_before
retries_used_before
contacts_sent_before
hours_since_open
previous intervention outcomes
```

## Subscription / Business Context

```text
subscription_age_days
prior_cycles_seen
plan_tier
value_tier
```

---

# 11. Target Variable

The primary prediction target should be:

```text
recovered = 1
not_recovered = 0
```

or the equivalent representation contained in the validated dataset.

The model learns:

```text
Features
    ↓
Recovery probability
```

For example:

```text
Case A → 0.87
Case B → 0.24
Case C → 0.71
```

---

# 12. Action Space

The recovery agent should have a small, explicit action space.

Example:

```text
RETRY
SEND_PAYMENT_LINK
SEND_REMINDER
CHANGE_PAYMENT_METHOD
ESCALATE
DO_NOTHING
```

The final action set must be aligned with the Razorpay Test Mode capabilities actually available to the project.

We should not create fake production capabilities merely for the demo.

---

# 13. Decision Logic

The system should combine model output, context, AI reasoning, and hard policies.

Example:

```text
Recovery probability = 0.84
Failure = retryable
Retry count = 0
Amount = ₹8,500
Customer = historically successful

→ Recommend RETRY
```

Another:

```text
Recovery probability = 0.79
Retry count = 2
Customer has already received multiple contacts

→ DO NOT RETRY
→ ESCALATE
```

Another:

```text
Payment already successful

→ BLOCK
→ Prevent duplicate action
```

---

# 14. Policy / Guardrail Engine

The policy engine is deterministic.

Example policies:

```text
MAX_RETRIES = 2

MAX_AUTO_RECOVERY_AMOUNT = ₹25,000

MAX_CUSTOMER_CONTACTS = 2

IF payment_success = true
    → STOP

IF dispute = true
    → STOP

IF fraud_flag = true
    → STOP

IF customer_opted_out = true
    → STOP

IF retry_limit_reached
    → ESCALATE

IF amount > auto_limit
    → HUMAN_REVIEW
```

These limits should be configurable.

The AI can recommend an action, but it cannot bypass these policies.

---

# 15. Agent Responsibilities

The agent should be responsible for contextual reasoning, not unrestricted financial authority.

### Agent tools

Conceptually:

```text
get_payment()
get_customer()
get_recovery_history()
predict_recovery()
check_policy()
execute_recovery_action()
escalate_case()
record_audit()
```

Example reasoning:

```text
Payment failed due to a likely temporary issue.
Customer has 12 successful historical payments.
No previous retry has been attempted.
Recovery probability is 0.82.

Recommended action:
Retry after 6 hours.

Policy check:
Passed.

Execution:
Approved.
```

---

# 16. Audit Trail

Every financial or customer-impacting action must be explainable.

Example:

```text
11:42:03
Payment failed
₹8,500

11:42:04
Revenue risk detected

11:42:04
Recovery probability = 0.82

11:42:05
Agent recommendation = RETRY

Reason:
Temporary failure + strong customer history

11:42:05
Policy checks passed

11:42:06
Recovery action executed

11:42:09
Payment recovered

11:42:09
₹8,500 recovered
```

The dashboard should allow the judge to inspect this history.

---

# 17. Batch Evaluation

This is one of the most important parts of the project.

We should evaluate on at least:

```text
10,000+ cases
```

and ideally:

```text
50,000+ cases
```

The exact size depends on available compute and demo requirements.

The system should process the batch end-to-end.

Example final output:

```text
Cases analyzed:              50,000

Revenue at risk:             ₹42.6L

Estimated recoverable:       ₹27.4L

Recovery opportunities:       5,217

Actions approved:             3,102

Successful recoveries:        1,740

Revenue recovered:           ₹15.8L

Recovery rate:                 57.7%

Human escalations:               187

Policy-blocked actions:          213
```

These are example values only. **The final demo must display actual measured results from our experiment.**

---

# 18. Baseline Comparison

We must prove that AI provides value.

At minimum, compare RecoverAI against a simple baseline.

### Baseline

Example:

```text
Every eligible failed payment
→ retry once
```

### RecoverAI

```text
Detect
→ predict
→ diagnose
→ choose intervention
→ policy gate
→ execute
→ measure
```

Compare:

```text
                         Baseline      RecoverAI

Recovery rate               X%            Y%

Revenue recovered          ₹X             ₹Y

Actions attempted          X              Y

False interventions        X              Y

Blocked unsafe actions     X              Y
```

The goal is to demonstrate **incremental recovery with fewer unnecessary interventions**, not merely better model accuracy.

---

# 19. Metrics

## ML Metrics

Report:

- Precision
- Recall
- F1
- ROC-AUC
- Calibration / probability reliability

Use a **held-out test set**.

---

## Business Metrics

These matter most:

### Revenue at Risk

Total value identified as potentially recoverable.

### Estimated Recoverable Revenue

Value predicted to have a viable recovery path.

### Revenue Actually Recovered

Actual successful recovery value.

### Recovery Rate

```text
Recovered Revenue
----------------- × 100
Eligible Revenue
```

### Recovery Uplift

Compare against the baseline.

---

## Safety Metrics

Report:

- false interventions,
- unnecessary retries,
- duplicate actions prevented,
- blocked actions,
- escalations,
- policy violations.

Target:

```text
Policy violations = 0
```

---

# 20. Recommended Technology Stack

## Frontend — React + Vercel

The frontend is a completely independent React application.

```text
React
TypeScript
Vite
Tailwind CSS
Recharts
```

Responsibilities:

- Merchant dashboard
- Revenue-at-risk visualization
- Recovery case inspection
- Agent decision display
- Policy/guardrail results
- Audit trail
- Batch evaluation results
- Triggering demo workflows

The frontend contains **no secret credentials** and never directly executes payment operations.

---

## Backend — Hugging Face Spaces

The backend is intentionally kept as a **single, simple FastAPI service**.

All backend logic lives inside one `backend/` directory. We do not split the backend into many nested application/service/database modules because this is a hackathon project and the deployment target is a single Hugging Face Space.

### Simplified backend structure

```text
backend/                              # Deploy directly to Hugging Face Spaces
│
├── data/
│   ├── train.csv                    # Training / development data
│   └── test_batch.csv               # Held-out evaluation batch
│
├── models/
│   └── policy_model.pkl             # Saved trained model / decision artifact
│
├── src/
│   ├── agent.py                     # Agent state machine + LLM reasoning
│   ├── guardrails.py                # Hard stopping rules, limits & throttles
│   ├── policy_model.py              # Model training + inference
│   ├── razorpay_client.py           # Razorpay Test Mode API client/tools
│   └── batch_runner.py              # Batch simulation + recovery metrics
│
├── main.py                          # FastAPI server + API endpoints
│
├── requirements.txt
└── Dockerfile
```

### Backend responsibilities

| File | Responsibility |
|---|---|
| `main.py` | FastAPI application and all API endpoints |
| `agent.py` | Recovery-agent state machine, contextual reasoning and structured decisions |
| `guardrails.py` | Deterministic financial safety rules, limits, throttles and stopping conditions |
| `policy_model.py` | ML preprocessing, training, model loading and inference |
| `razorpay_client.py` | Razorpay Test Mode integration and payment/recovery tools |
| `batch_runner.py` | Large-batch execution, simulation and unit-economics/recovery calculations |
| `train.csv` | Training/development dataset |
| `test_batch.csv` | Held-out batch used for final evaluation |
| `policy_model.pkl` | Saved model artifact loaded by the backend |

### Backend request flow

```text
FastAPI
   ↓
agent.py
   ↓
policy_model.py
   ↓
guardrails.py
   ↓
razorpay_client.py
   ↓
batch_runner.py
   ↓
Audit / metrics response
```

The exact internal order can vary by endpoint, but **every financial action must pass through `guardrails.py` before execution**.

---

# 22. Complete Repository Structure

The final repository intentionally remains small.

```text
recover-ai/
│
├── README.md
├── .gitignore
├── .env.example
│
├── frontend/                         # → VERCEL
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   │   ├── dashboard/
│   │   │   ├── recovery/
│   │   │   ├── audit/
│   │   │   └── common/
│   │   ├── pages/
│   │   ├── services/
│   │   │   └── api.ts
│   │   ├── hooks/
│   │   ├── types/
│   │   └── utils/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
└── backend/                          # → HUGGING FACE SPACES
    ├── data/
    │   ├── train.csv
    │   └── test_batch.csv
    │
    ├── models/
    │   └── policy_model.pkl
    │
    ├── src/
    │   ├── agent.py
    │   ├── guardrails.py
    │   ├── policy_model.py
    │   ├── razorpay_client.py
    │   └── batch_runner.py
    │
    ├── main.py
    ├── requirements.txt
    └── Dockerfile
```

This structure keeps the deployment model clear:

```text
frontend/
    ↓
Vercel

backend/
    ↓
Hugging Face Spaces
```

There is no separate `api/`, `services/`, `database/`, `agent/`, or nested backend application tree unless the implementation later becomes large enough to justify it.

---

# 23. API Contract

The FastAPI backend exposes a small REST API for the React frontend.

## Health

```http
GET /api/health
```

## Dashboard

```http
GET /api/dashboard
```

Returns:

```text
revenue at risk
estimated recoverable revenue
revenue recovered
recovery rate
cases analyzed
actions executed
blocked actions
escalations
```

## Analyze Recovery Case

```http
POST /api/recovery/analyze
```

Example response:

```json
{
  "case_id": "CASE_1024",
  "recovery_probability": 0.82,
  "risk_level": "HIGH",
  "recommended_action": "RETRY",
  "reason": "Strong customer history and temporary failure",
  "policy_status": "APPROVED"
}
```

## Execute Recovery

```http
POST /api/recovery/execute
```

The backend must re-check guardrails before execution.

## Run Batch

```http
POST /api/batch/run
```

## Batch Results

```http
GET /api/batch/{batch_id}/results
```

Returns:

```text
cases analyzed
revenue at risk
eligible revenue
actions attempted
successful recoveries
revenue recovered
recovery rate
baseline results
blocked actions
escalations
```

## Audit

```http
GET /api/audit/{case_id}
```

Returns the chronological decision/action history.

---

# 24. Environment Variables

## Frontend

```text
VITE_API_BASE_URL
```

No Razorpay secret credentials belong in the frontend.

## Backend

```text
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET

LLM_API_KEY

DATABASE_URL

ALLOWED_ORIGINS
```

Example `.env.example`:

```text
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
LLM_API_KEY=
DATABASE_URL=
ALLOWED_ORIGINS=
```

Actual credentials must never be committed to Git.

---

# 25. Local Development

Run the frontend and backend independently.

### Backend

```bash
cd backend

pip install -r requirements.txt

uvicorn main:app --reload --port 8000
```

Backend:

```text
http://localhost:8000
```

FastAPI documentation:

```text
http://localhost:8000/docs
```

### Frontend

```bash
cd frontend

npm install
npm run dev
```

Frontend:

```text
http://localhost:5173
```

Configure:

```text
VITE_API_BASE_URL=http://localhost:8000
```

---

# 26. Production Deployment

## Frontend → Vercel

Build:

```bash
npm run build
```

Set:

```text
VITE_API_BASE_URL=<HUGGING_FACE_BACKEND_URL>
```

The React frontend communicates with the Hugging Face backend over HTTPS.

---

## Backend → Hugging Face Spaces

The Hugging Face Space runs the `backend/` directory directly.

Example command:

```bash
uvicorn main:app --host 0.0.0.0 --port 7860
```

The Dockerfile should expose port `7860`.

Backend secrets are configured through Hugging Face's environment/secrets configuration.

---

# 27. End-to-End Runtime Flow

```text
Merchant opens dashboard
          ↓
React Frontend on Vercel
          ↓ HTTPS
FastAPI Backend on Hugging Face
          ↓
       agent.py
          ↓
    policy_model.py
          ↓
     guardrails.py
          ↓
   +------+------+
   |             |
APPROVED       BLOCKED
   |             |
   ↓             ↓
razorpay_      Escalate
client.py
   |
   ↓
Outcome
   |
   ↓
batch_runner.py / metrics
   |
   ↓
React Dashboard
```

---

# 28. Security and Deployment Rules

Mandatory:

- [ ] Razorpay secret keys only on backend
- [ ] LLM API keys only on backend
- [ ] Frontend cannot directly execute financial actions
- [ ] Every execution re-checks `guardrails.py`
- [ ] Production CORS restricted to the Vercel frontend
- [ ] No secrets committed to Git
- [ ] Test Mode only for hackathon execution
- [ ] Every action creates an audit event
- [ ] Duplicate-action protection
- [ ] Retry limits
- [ ] Amount limits
- [ ] Explicit escalation path
- [ ] Held-out `test_batch.csv` is not used for model training

---

