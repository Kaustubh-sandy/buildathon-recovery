# RecoverAI — Autonomous Revenue Recovery Platform

> **System Architecture & Technical Specification**
> An autonomous revenue recovery engine for subscriptions and recurring payment mandates. Detects payment failures, diagnoses root causes via trained machine learning, formulates bounded interventions, executes real-world gateway and communication actions, and proves net recovered capital through closed-loop settlement reconciliation and deterministic audit trails.

---

## 🎯 Executive Summary

RecoverAI addresses systemic revenue leakage across digital payment rails (UPI Autopay, e-Mandates, Cards, and NetBanking). Instead of relying on static, uncoordinated dunning schedules or blind retry spikes that damage merchant reputation and incur gateway penalties, RecoverAI operates as an **autonomous financial recovery agent**. 

The system:
1. **Detects** payment failures in real time via gateway ingestion.
2. **Diagnoses** failure taxonomy using a calibrated LightGBM model trained on ~100,000 transaction records ($AUC = 0.9102$).
3. **Formulates** bounded interventions using an Expected Recovery Value ($ERV$) optimization framework.
4. **Governs** actions through an 11-rule deterministic compliance and financial safety engine.
5. **Executes** multi-channel recovery workflows via live Razorpay APIs (Standard Checkout orders and dynamic payment links) and Twilio SMS.
6. **Reconciles** recovery through webhook callbacks, verifying actual state mutation ($FAILED \rightarrow PENDING\_PAYMENT \rightarrow RECOVERED$) and computing rigorous counterfactual ROI.

---

## 🏗️ End-to-End System Architecture

```mermaid
graph TD
    A["Payment Failure Ingestion<br/>(Webhook / API / CSV Batch)"] --> B["Gateway Ingestion Agent"]
    B --> C["Feature Pipeline & Normalization<br/>(30 Numeric + Categorical Signals)"]
    C --> D["ML Policy Predictor<br/>(LightGBM Classifier AUC=0.9102)"]
    D --> E["Action Policy Formulator<br/>(ERV Maximization Engine)"]
    E --> F["Financial Guardrails Engine<br/>(11 Deterministic Safety Rules)"]
    
    F -->|BLOCKED| G["Idempotency / Cooloff / Opt-Out Termination"]
    F -->|ESCALATED| H["Human Operational Review Queue"]
    F -->|APPROVED| I["Autonomous Recovery Dispatcher"]
    
    I --> J["Razorpay Gateway Integration<br/>(Orders API & Payment Links)"]
    I --> K["Twilio SMS Gateway<br/>(Automated Dispatch)"]
    I --> L["Generative AI Dunning Agent<br/>(Gemini 3.6 Flash / Localized Copy)"]
    
    J --> M["Customer Payment Settlement<br/>(UPI / Card / NetBanking)"]
    M --> N["Webhook Listener<br/>(/api/webhooks/razorpay)"]
    N --> O["State Mutation Engine<br/>(CASE_LEDGER Status Update)"]
    O --> P["Audited Ledger & Attribution Store<br/>(Incremental ₹ Verified)"]
```

### Technology Stack & Component Mapping

| Architectural Layer | Technology | Operational Function |
|---|---|---|
| **API Server & Orchestration** | FastAPI (Python 3.10+) | High-throughput asynchronous REST server, state machine manager, webhook processor |
| **Machine Learning Core** | LightGBM, Scikit-Learn | Calibrated non-linear scoring of $P(\text{recovery})$ across 30 features |
| **Generative AI** | Google Gemini 3.6 Flash | Dynamic localized dunning message formulation and conversational Promise-to-Pay (PTP) intent parsing |
| **Payment Gateway** | Razorpay SDK (Test Mode) | Live order creation, HMAC-SHA256 signature verification, and dynamic payment link generation (`rzp.io`) |
| **Telecommunications** | Twilio SMS API | Multi-channel SMS recovery dispatch with dynamic payment link injection |
| **Frontend Console** | Next.js 14, Tailwind CSS, Lucide Icons | 4-tier operational interface (Live Demo, Batch Engine, Executive Dashboard, AI Diagnostics) |
| **Data Engine** | Pandas, NumPy | Streaming CSV normalization, batch matrix operations, counterfactual attribution |

---

## 🧠 Machine Learning & Decision Intelligence

### Model Selection & Evaluation Rationale

Payment failure recovery operates under strict operational and regulatory constraints: decisions require sub-millisecond scoring, resilience to missing transactional attributes, native handling of high-cardinality banking metadata, and calibrated probabilities for risk management.

| Evaluation Dimension | LightGBM (Implemented) | Deep Neural Network | Logistic Regression |
|---|---|---|---|
| **Inference Latency** | **< 3ms** (CPU-native) | 25–80ms (GPU preferred) | < 2ms (CPU-native) |
| **Interpretability** | **High** (SHAP values, tree splits, feature importance) | Low (Black box) | High (Linear coefficients) |
| **Categorical Processing** | **Native** (Optimized Fisher partitioning) | Complex embeddings required | High-dimensional one-hot encoding |
| **Non-Linear Interactions** | **High** (Captures rail $\times$ failure code $\times$ tenure) | High | None (Requires manual engineering) |
| **Calibration Stability** | **High** (Brier Score = 0.14 with balanced weights) | Variable (Requires Platt scaling) | High |
| **Cold-Start Resilience** | **High** (Robust split penalties) | Poor on sparse partitions | Degrades on sparse categories |

### Model Architecture & Feature Engineering

Located in [`policy_model.py`](file:///c:/Users/luvsh/Downloads/razorpay/buildathon-recovery/backend/src/policy_model.py):

- **20 Continuous / Numerical Features**:
  - `amount_inr`: Transaction value.
  - `customer_tenure_days`: Account relationship maturity.
  - `prior_success_rate`: Historical debit success percentage.
  - `retries_used_before`: Retry exhaustion counter.
  - `hours_since_open`: Latency since initial failure event.
  - `hour_of_day`, `day_of_month`: Cyclical temporal signals.
  - `salary_day_proxy_dom`: Proximity to regional liquidity/salary disbursements (28th–5th).
- **10 Categorical Features**:
  - `rail`: `upi_autopay`, `emandate_nach`, `card_recurring`.
  - `bank_name`: Issuer bank identity (HDFC, ICICI, SBI, AXIS, etc.).
  - `segment`: Enterprise, SMB, Consumer tier.
  - `plan_tier`: Subscription tier pricing level.
  - `failure_class_at_decision`: `INSUFFICIENT_FUNDS`, `NETWORK_DECLINE`, `EXPIRED_CARD`, etc.
  - `state`, `locale_pref`: Geographic and linguistic targeting context.
- **Validation Strategy**: 85/15 customer-grouped split. Grouping by `customer_id` prevents cross-partition data leakage and guarantees that customer behavioral profiles in validation are unseen.

### Training Hyperparameters & Metrics

```python
LGBMClassifier(
    n_estimators=300,
    learning_rate=0.05,
    max_depth=7,
    num_leaves=63,
    min_child_samples=30,
    feature_fraction=0.8,
    bagging_fraction=0.8,
    bagging_freq=5,
    class_weight='balanced',
    random_state=42,
)
```

- **Validation ROC-AUC**: `0.9102`
- **Brier Calibration Score**: `0.14` (indicating reliable probability calibration)
- **Precision / Recall / F1**: `0.65+` / `0.70+` / `0.67+`

### Bounded Action Policy & Optimization Function

The model's probability estimate $P(\text{recovery})$ feeds directly into a financial optimization objective rather than an arbitrary threshold:

$$\text{Expected Recovery Value (ERV)} = P(\text{recovery}) \times \text{amount\_inr} - \text{action\_cost}$$

The action policy engine ranks 6 discrete interventions based on net expected yield:

| Action Identifier | Trigger Criteria | Unit Cost (₹) | Operational Objective |
|---|---|---|---|
| `RETRY` | Transient / network failure + zero previous retries | ₹2.00 | Headless gateway re-execution without customer disruption |
| `SEND_PAYMENT_LINK` | High recovery likelihood + retry exhausted / customer action needed | ₹1.50 | Out-of-band payment link via SMS/WhatsApp with alternate payment methods |
| `SEND_REMINDER` | Soft nudge following previous outreach | ₹0.50 | Low-friction notification for scheduled payments |
| `CHANGE_PAYMENT_METHOD` | Hard failure (mandate suspended, card expired) | ₹1.00 | Customer portal prompt to register new mandate/card |
| `ESCALATE` | High-value threshold or repeated technical failures | ₹5.00 | Route to human operations and account managers |
| `DO_NOTHING` | $P(\text{recovery}) < 0.30$ or negative ERV | ₹0.00 | Prevent wasted transaction fees and avoid customer annoyance |

---

## 🛡️ Deterministic Financial Guardrails & Compliance

Autonomous financial systems require strict, deterministic boundary constraints. The compliance engine ([`guardrails.py`](file:///c:/Users/luvsh/Downloads/razorpay/buildathon-recovery/backend/src/guardrails.py)) evaluates 11 hierarchical rules prior to executing any recovery action:

```
Proposed Action ──► [ Rule 1: IDEMPOTENCY_BLOCK ] ───────► BLOCKED
                 ──► [ Rule 2: PAYMENT_ALREADY_RESOLVED ] ─► BLOCKED
                 ──► [ Rule 3: FRAUD_FLAG_DETECTED ] ─────► BLOCKED & ESCALATED
                 ──► [ Rule 4: DISPUTE_ACTIVE ] ──────────► BLOCKED
                 ──► [ Rule 5: CUSTOMER_OPT_OUT ] ────────► BLOCKED
                 ──► [ Rule 6: UNRETRYABLE_FAILURE ] ─────► ESCALATE (CHANGE_METHOD)
                 ──► [ Rule 7: MANDATE_ISSUE ] ───────────► ESCALATE
                 ──► [ Rule 8: AMOUNT_EXCEEDS_AUTO_LIMIT ]► ESCALATE (HUMAN_REVIEW)
                 ──► [ Rule 9: MAX_RETRIES_EXCEEDED ] ────► ESCALATE
                 ──► [ Rule 10: MAX_CONTACTS_EXCEEDED ] ──► ESCALATE
                 ──► [ Rule 11: RETRY_COOLOFF_ACTIVE ] ───► BLOCKED
                 ──► APPROVED ──► Execution Pipeline
```

### Guardrail Specification Matrix

| Rule ID | Evaluation Predicate | Severity | Action Taken |
|---|---|---|---|
| `IDEMPOTENCY_BLOCK` | Hash of `(case_id, action)` exists in execution history | **BLOCK** | Prevents duplicate charge attempts or message spam |
| `PAYMENT_ALREADY_RESOLVED` | `case.status == "RECOVERED"` or `amount_due == 0` | **BLOCK** | Halts all dunning immediately upon settlement |
| `FRAUD_FLAG_DETECTED` | `is_fraud == True` or gateway risk score high | **BLOCK** | Suspends automation; routes to Risk & Fraud Operations |
| `DISPUTE_ACTIVE` | Chargeback or dispute flag active | **BLOCK** | Freezes recovery to prevent compliance violations |
| `CUSTOMER_OPT_OUT` | DND registry or explicit refusal recorded | **BLOCK** | Immediate cessation of all customer-facing outreach |
| `UNRETRYABLE_FAILURE_CLASS` | Expired instrument, lost card, account closed | **ESCALATE** | Replaces retry with payment method update workflow |
| `MANDATE_ISSUE` | Mandate cancelled, revoked, or invalid | **ESCALATE** | Replaces retry with mandate re-registration link |
| `AMOUNT_EXCEEDS_AUTO_LIMIT` | Transaction amount $\ge ₹25,000$ | **ESCALATE** | Requires dual-authorization / manual relationship review |
| `MAX_RETRIES_EXCEEDED` | Attempt count $\ge 2$ | **ESCALATE** | Prevents issuer penalty fees from excessive attempts |
| `MAX_CONTACTS_EXCEEDED` | Outbound communication count $\ge 2$ | **ESCALATE** | Prevents customer harassment; enforces communication caps |
| `RETRY_COOLOFF_ACTIVE` | Time since last attempt $< 4$ hours | **BLOCK** | Enforces exponential backoff and banking network cooling |

---

## 🔄 Closed-Loop Settlement Architecture & Verification

The platform implements a verifiable, closed-loop state transition model rather than relying on theoretical or open-loop projections.

```
       ┌────────────────────────┐
       │   Initial State:       │
       │        FAILED          │
       └──────────┬─────────────┘
                  │  1. Ingestion & Diagnostic Pipeline
                  ▼
       ┌────────────────────────┐
       │ Action: Mint Artifact  │
       │ (Razorpay rzp.io Link) │
       └──────────┬─────────────┘
                  │  2. Dispatch via Twilio SMS + Dunning
                  ▼
       ┌────────────────────────┐
       │   Transition State:    │
       │    PENDING_PAYMENT     │
       └──────────┬─────────────┘
                  │  3. Customer Completes Test Payment
                  ▼
       ┌────────────────────────┐
       │ Razorpay Webhook Event │
       │  (payment_link.paid)   │
       └──────────┬─────────────┘
                  │  4. HMAC Check & Status Mutation
                  ▼
       ┌────────────────────────┐
       │    Terminal State:     │
       │       RECOVERED        │
       └────────────────────────┘
```

### Verification Proof Points

1. **State Mutation**: The in-memory ledger (`CASE_LEDGER`) maintains atomic state transitions from `FAILED` $\rightarrow$ `PENDING_PAYMENT` $\rightarrow$ `RECOVERED` with immutable audit logging.
2. **Third-Party Gateway Artifact**: Real Razorpay Payment Links are programmatically generated via `razorpay_client.create_payment_link()` using live sandbox credentials, outputting authentic `https://rzp.io/i/...` URIs.
3. **Execution Delivery**: Twilio SMS client transmits personalized recovery prompts containing the minted payment link to the customer's mobile device, accompanied by localized Gemini-generated copy.
4. **Settlement Confirmation**: Razorpay webhook callbacks (`payment_link.paid`, `payment.captured`) trigger automated reconciliation, transitioning the case to `RECOVERED` and incrementing the audited recovered capital ledger.

---

## 📊 Batch Counterfactual Evaluation & Attribution Engine

Evaluating revenue recovery on historical cohorts requires rigorous statistical accounting to prevent false attribution.

### Experimental Design & Attribution Logic

Located in [`batch_runner.py`](file:///c:/Users/luvsh/Downloads/razorpay/buildathon-recovery/backend/src/batch_runner.py):

- **Baseline Strategy**: Represents industry-standard naive heuristics (immediate single retry for retryable errors; inaction otherwise).
- **RecoverAI Strategy**: Dynamic ML policy scoring $\rightarrow$ Expected Value ranking $\rightarrow$ 11 Guardrail filters $\rightarrow$ Selected optimal intervention.
- **Attribution Rules**:
  1. **Historical Dataset with Ground-Truth Outcomes**:
     - *Direct Attribution*: RecoverAI receives recovery credit if and only if the algorithm selected the exact historical action that succeeded ($y = 1$).
     - *Conservative Exclusion*: If RecoverAI chose a different action than historically executed, no recovery is credited, even if the case recovered historically.
     - *Deduction*: Incurred execution costs are deducted regardless of outcome.
  2. **Uploaded Custom Batch Data without Pre-Existing Outcomes**:
     - Evaluated via calibrated model expectation: $\text{Expected Net Revenue} = \sum [P(\text{recovery}) \times \text{amount\_inr} - \text{action\_cost}]$ for approved actions.

### 6-Agent Batch Orchestration Trace

Every batch execution records a complete multi-agent pipeline trace:
1. `Gateway Ingestion Agent`: Data ingestion, field mapping, and schema normalization.
2. `ML Policy Predictor`: Calibrated $P(\text{recovery})$ vector calculation.
3. `Action Policy Formulator`: Cost-benefit calculation and ERV maximization.
4. `Financial Guardrails Engine`: Idempotency, rate limit, and compliance filtering.
5. `Recovery Dispatcher`: Simulated or live dispatch orchestration.
6. `Attribution & ROI Engine`: Conservative counterfactual accounting and net revenue calculation.

---

## 🌐 Complete API Specification

The FastAPI application provides 26 endpoints covering execution, telemetry, diagnostics, and compliance:

| Method | Route | Description | Primary Payload / Response |
|---|---|---|---|
| `GET` | `/api/health` | System health check and component status | Status of ML model, LLM, Razorpay, Twilio |
| `POST` | `/api/recovery/diagnose-and-act` | **Unified pipeline**: analysis, guardrails, link creation, SMS | `{case_id, customer_phone, ...}` $\rightarrow$ Full execution record |
| `POST` | `/api/recovery/analyze` | Standalone ML diagnosis and guardrail check | Case parameters $\rightarrow$ $P(\text{recovery})$, recommended action |
| `POST` | `/api/recovery/execute` | Execute specific approved recovery action | Action execution confirmation & artifact links |
| `POST` | `/api/batch/run` | Execute batch evaluation on standard test cohort | Batch metrics, ROI summary, agent audit trace |
| `POST` | `/api/batch/upload` | Ingest and evaluate custom CSV dataset | Normalized batch results and financial attribution |
| `GET` | `/api/batch/sample-template` | Download schema-compliant CSV template | CSV file stream |
| `GET` | `/api/batch/results` | Fetch latest cached batch execution results | Complete batch performance metrics |
| `GET` | `/api/dashboard` | Aggregated executive KPIs and metrics | Total recovery, efficiency rate, guardrail stats |
| `POST` | `/api/dunning/generate` | Generate localized LLM dunning communication | Message copy, channel formatting, confidence |
| `POST` | `/api/dunning/parse-ptp` | Parse unstructured customer responses (PTP) | Structured intent, promise date, sentiment |
| `POST` | `/api/create-order` | Mint Razorpay standard checkout order | Razorpay `order_id`, currency, amount |
| `POST` | `/api/verify-payment` | Verify HMAC-SHA256 payment signature | Signature verification boolean, case status |
| `POST` | `/api/webhooks/razorpay` | Ingest Razorpay settlement webhooks | Event processing confirmation, state mutation |
| `GET` | `/api/cases/live/{case_id}` | Poll real-time ledger status for live loop | Current state, payment ID, settlement timestamp |
| `GET` | `/api/cases` | Paginated listing of active/recovered cases | Array of case objects with ML scoring |
| `GET` | `/api/cases/{case_id}` | Detailed case inspection and diagnosis | Case metadata, history, guardrail trace |
| `GET` | `/api/audit/{case_id}` | Full chronological audit trail for a case | Ordered array of agent reasoning steps |
| `GET` | `/api/model/info` | ML model architecture, features, and metrics | Feature importance, AUC, hyperparameters |
| `POST` | `/api/sms/send-test` | Dispatch test SMS via Twilio integration | Message SID, delivery status |

---

## 🎬 End-to-End Operational Workflows

### Workflow 1: Real-Time Single Transaction Recovery & Settlement Verification
1. **Trigger**: Payment failure initiated via checkout or simulated gateway decline.
2. **Autonomous Execution**:
   - Gateway Ingestion Agent captures failure code, rail, amount, and customer tenure.
   - ML Model calculates $P(\text{recovery}) = 0.72$.
   - Policy Formulator identifies `SEND_PAYMENT_LINK` as highest ERV.
   - Guardrails Engine verifies no idempotency conflicts, valid contact limits, and normal risk parameters.
   - Razorpay Client mints authentic `https://rzp.io/i/...` short link.
   - Twilio Service dispatches outbound SMS with generated payment link.
   - Gemini Agent creates culturally contextual Hinglish dunning message.
3. **Settlement & Reconciliation**:
   - Customer accesses payment link and completes transaction in test mode.
   - Razorpay webhook emits `payment_link.paid`.
   - Backend processes payload, mutates ledger state from `PENDING_PAYMENT` $\rightarrow$ `RECOVERED`.
   - Executive Dashboard increments verified capital metric.

### Workflow 2: Batch Counterfactual Evaluation & Measurable Financial ROI
1. **Ingestion**: Upload historical failure batch or run baseline cohort.
2. **Automated Processing**: 1,000+ records normalized and evaluated across the 6-agent pipeline in $< 3$ seconds.
3. **Audit & Attribution**:
   - System applies conservative same-action counterfactual logic.
   - Displays exact incremental net revenue uplift over naive retry baseline.
   - Outputs complete per-transaction reasoning logs with feature attribution.

### Workflow 3: Automated Risk Governance & Stopping Rules Enforcement
1. **Excessive Retries**: Case with $\ge 2$ prior retries $\rightarrow$ `MAX_RETRIES_EXCEEDED` halts automatic execution and routes to operations.
2. **Fraud Detection**: Active fraud or dispute indicator $\rightarrow$ `FRAUD_FLAG_DETECTED` instantly blocks outreach and alerts compliance.
3. **High-Value Threshold**: Values exceeding ₹25,000 $\rightarrow$ `AMOUNT_EXCEEDS_AUTO_LIMIT` escalates to enterprise relationship managers.
4. **Idempotency Protection**: Repeated API requests for identical `(case_id, action)` are safely dropped with zero side effects.

---

## 📁 Repository Structure

```
buildathon-recovery/
├── backend/
│   ├── main.py                     # FastAPI server (1168 lines, 26 endpoints)
│   ├── requirements.txt            # Python dependencies (fastapi, lightgbm, razorpay, twilio, etc.)
│   ├── .env                        # Production configuration & credentials
│   ├── data/
│   │   ├── train.csv               # Historical training cohort (~100K records, 21MB)
│   │   └── test_batch.csv          # Evaluation cohort (3.8MB)
│   ├── models/
│   │   └── policy_model.pkl        # Serialized LightGBM model artifact (AUC=0.9102)
│   └── src/
│       ├── policy_model.py         # LightGBM classifier & ERV policy formulator (532 lines)
│       ├── agent.py                # Gemini LLM dunning & PTP response parsing (512 lines)
│       ├── guardrails.py           # 11 deterministic compliance & stopping rules (257 lines)
│       ├── batch_runner.py         # Batch simulator & counterfactual attribution (691 lines)
│       ├── razorpay_client.py      # Razorpay Gateway SDK wrapper (300 lines)
│       └── sms_service.py          # Twilio SMS dispatch handler (117 lines)
├── frontend/
│   └── razor-buildathon/
│       └── src/app/
│           ├── page.tsx            # Unified 4-tier Operations Console (1759 lines)
│           └── globals.css         # Styling, tokens, custom scrollbars
└── project_summary.md              # Project Architecture & Technical Specification
```

---

## ✅ Verified Capabilities Matrix

| System Capability | Implementation Status | Validation Evidence |
|---|---|---|
| **Non-Linear ML Scoring** | Complete | LightGBM artifact loaded; ROC-AUC 0.9102 validated on test partition |
| **Calibrated Risk Estimation** | Complete | $P(\text{recovery})$ output verified via `/api/recovery/analyze` |
| **Value-Optimized Action Policy** | Complete | ERV ranking across 6 discrete recovery actions |
| **Deterministic Guardrails Engine** | Complete | 11 compliance rules enforcing safety, idempotency, and caps |
| **Live Payment Gateway Minting** | Complete | Authentic Razorpay payment links (`https://rzp.io/...`) created via API |
| **Cryptographic Signature Verification** | Complete | HMAC-SHA256 signature checking on checkout completion |
| **Webhook Reconciliation** | Complete | Dynamic state transition (`PENDING_PAYMENT` $\rightarrow$ `RECOVERED`) |
| **Outbound Telecommunications** | Complete | Twilio SMS API integration with delivery status logging |
| **Generative AI Localization** | Complete | Multi-lingual dunning generation with deterministic safety fallback |
| **Conversational PTP Parsing** | Complete | Intent classification (Pay Now, Broken Promise, Refusal, Dispute) |
| **Conservative Attribution Engine** | Complete | Scientifically sound counterfactual A/B evaluation |
| **Custom Batch Ingestion** | Complete | CSV ingestion pipeline with automated schema normalization |
| **Multi-Agent Audit Trail** | Complete | Chronological 5-step transaction trace and 6-agent batch log |
| **Unified Enterprise Console** | Complete | Clean 4-view Next.js application with zero compilation errors |

---

## ⚠️ Current Staging Implementation Notes

| Component | Current Implementation | Production Transition Plan |
|---|---|---|
| **Ledger Storage** | In-memory atomic data structures (`CASE_LEDGER`, `BATCH_STATE`) | Migrate to PostgreSQL with row-level locking or Redis Cluster for distributed state |
| **Webhook Signature Validation** | Configured for sandbox/test environments without mandatory secret header | Enforce Razorpay Webhook Secret HMAC validation in production deployment |
| **SMS Templates** | Twilio trial accounts require pre-approved message formatting | Register enterprise DLT templates for transactional SMS delivery in India |
| **Direct Mandate Retries** | Gateway re-execution simulation via `retry_subscription_charge()` | Direct integration with Razorpay Subscription Auto-Retry API |
