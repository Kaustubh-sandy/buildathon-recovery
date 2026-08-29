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

## Frontend

```text
Next.js
React
TypeScript
Tailwind CSS
```

## Backend

```text
Node.js
TypeScript
REST APIs
```

## ML Service

```text
Python
pandas
scikit-learn
XGBoost
```

## Database

```text
PostgreSQL
```

## Queue / Async Jobs

```text
Redis
BullMQ
```

## AI

```text
LLM with structured outputs/tool calling
```

## Payment Integration

```text
Razorpay Test Mode APIs
```

---

# 21. Proposed Repository Structure

```text
recover-ai/
│
├── README.md
│
├── apps/
│   ├── web/
│   │   └── ...
│   │
│   └── api/
│       └── ...
│
├── ml/
│   ├── data/
│   │   ├── raw/
│   │   └── processed/
│   │
│   ├── notebooks/
│   │
│   ├── src/
│   │   ├── preprocessing.py
│   │   ├── train.py
│   │   ├── evaluate.py
│   │   └── predict.py
│   │
│   └── models/
│
├── agent/
│   ├── orchestrator/
│   ├── tools/
│   ├── prompts/
│   └── schemas/
│
├── policy/
│   ├── rules.ts
│   └── policy-engine.ts
│
├── services/
│   ├── payments/
│   ├── recovery/
│   ├── audit/
│   └── metrics/
│
├── database/
│   ├── schema/
│   └── migrations/
│
├── scripts/
│   ├── generate-data/
│   ├── run-batch/
│   └── evaluate/
│
└── docs/
    ├── architecture.md
    ├── evaluation.md
    └── demo.md
```

---

# 22. Development Plan

## Phase 1 — Dataset Audit

Before building anything:

- inspect every column,
- understand `y`,
- check missing values,
- check duplicates,
- check class balance,
- identify customer/case relationships,
- detect leakage,
- determine correct train/test splitting strategy.

### Deliverable

A validated dataset specification.

---

## Phase 2 — ML Baseline

Build:

```text
Logistic Regression
```

and:

```text
XGBoost
```

Compare them.

### Deliverable

Held-out metrics and feature importance.

---

## Phase 3 — Recovery Simulation / Evaluation

Build the controlled recovery environment.

### Deliverable

For every case:

```text
prediction
action
actual outcome
amount recovered
```

---

## Phase 4 — Policy Engine

Implement deterministic safety constraints.

### Deliverable

Actions can be:

```text
APPROVED
BLOCKED
ESCALATED
```

with a reason.

---

## Phase 5 — AI Agent

Add contextual reasoning and structured action selection.

### Deliverable

Agent can:

```text
inspect case
→ explain diagnosis
→ recommend action
→ request policy validation
→ execute only if approved
```

---

## Phase 6 — Razorpay Test Mode

Connect approved recovery actions to the available Test Mode APIs.

### Deliverable

At least one real end-to-end test-mode recovery workflow.

---

## Phase 7 — Batch Run

Run the complete pipeline on a large batch.

### Deliverable

Measured:

```text
revenue at risk
revenue recovered
recovery rate
baseline uplift
false interventions
blocked actions
escalations
```

---

## Phase 8 — Dashboard

Build the final demo UI.

---

# 23. Final Dashboard

The first screen should immediately communicate business value.

```text
┌──────────────────────────────────────────┐
│         AI REVENUE RECOVERY              │
├──────────────────────────────────────────┤
│                                          │
│ Revenue At Risk              ₹42.6L      │
│ Estimated Recoverable        ₹27.4L      │
│ Revenue Recovered            ₹15.8L      │
│ Recovery Rate                  57.7%      │
│                                          │
├──────────────────────────────────────────┤
│ Cases Analyzed                 50,000     │
│ Recovery Opportunities          5,217     │
│ Actions Executed                3,102     │
│ Successful Recoveries           1,740     │
│ Human Escalations                 187     │
│ Blocked Actions                   213     │
└──────────────────────────────────────────┘
```

Again, all final values must be generated from the actual experiment.

---

# 24. The Hero Demo

The final demonstration should follow one complete case.

### Step 1 — Detect

```text
₹8,500 payment failed
Revenue risk: HIGH
```

### Step 2 — Diagnose

```text
Temporary failure
Strong customer history
No previous retry
```

### Step 3 — Predict

```text
Recovery probability: 82%
```

### Step 4 — Decide

```text
Recommended:
Retry after 6 hours
```

### Step 5 — Gate

```text
Retry limit: PASS
Amount limit: PASS
Duplicate protection: PASS
Customer eligibility: PASS
```

### Step 6 — Execute

```text
Razorpay Test Mode
→ recovery action
```

### Step 7 — Outcome

```text
Payment successful

₹8,500 recovered
```

### Step 8 — Audit

Show the entire decision trail.

---

# 25. Failure Handling

The Track explicitly asks for graceful failure handling.

We must demonstrate at least one.

Example:

```text
Agent recommends RETRY

Policy Engine:
BLOCKED

Reason:
Maximum retry count already reached.

System:
→ Does not execute payment
→ Creates escalation
→ Records audit event
```

The UI should clearly say:

```text
ACTION BLOCKED SAFELY
```

This proves the system does not blindly follow the AI.

---

# 26. Final Hackathon Acceptance Criteria

The project is considered complete only when all of the following work:

### Data

- [ ] Large batch of realistic recovery cases
- [ ] Validated target
- [ ] No known data leakage
- [ ] Reproducible evaluation

### AI / ML

- [ ] Recovery probability model
- [ ] Held-out evaluation
- [ ] Precision/recall/F1/AUC
- [ ] Calibration or probability analysis

### Agent

- [ ] Diagnoses the case
- [ ] Recommends an action
- [ ] Produces structured output
- [ ] Uses available context

### Safety

- [ ] Deterministic policy engine
- [ ] Amount limits
- [ ] Retry limits
- [ ] Duplicate protection
- [ ] Stop conditions
- [ ] Escalation path

### Execution

- [ ] Razorpay Test Mode integration
- [ ] At least one genuine end-to-end recovery workflow
- [ ] Graceful failure handling

### Evaluation

- [ ] Batch-level evaluation
- [ ] Actual recovered money
- [ ] Baseline comparison
- [ ] False intervention measurement
- [ ] Audit trail

### Demo

- [ ] Revenue-at-risk dashboard
- [ ] Individual case walkthrough
- [ ] Agent reasoning
- [ ] Policy decision
- [ ] Test-mode execution
- [ ] Final batch results

---

# 27. The Single Most Important Outcome

Do not make the final presentation about:

> "Our model has 94% accuracy."

Do not make it about:

> "We built an AI agent."

Make it about:

# **"We recovered ₹X from Y revenue-at-risk cases."**

Then prove how:

```text
Detect
   ↓
Predict
   ↓
Diagnose
   ↓
Intervene
   ↓
Gate
   ↓
Execute
   ↓
Recover
   ↓
Measure
```

The ML metrics establish technical credibility.

The audit trail establishes safety.

The batch evaluation establishes that the system actually works.

But:

> **Recovered revenue is the hero metric.**

---

# 28. Final Product Definition

## RecoverAI

**An autonomous, bounded revenue-recovery agent for merchants.**

### Input

Merchant payment/customer/recovery data.

### Intelligence

Identify revenue at risk and estimate recoverability.

### Reasoning

Understand the cause and select an appropriate intervention.

### Safety

Apply deterministic merchant policies before every action.

### Execution

Execute approved actions through Razorpay Test Mode.

### Measurement

Track successful recoveries and compare against a baseline.

### Accountability

Maintain a complete audit trail and explicit exception list.

### Final proof

```text
Large batch
      ↓
Revenue at risk
      ↓
Recovery opportunities
      ↓
Approved interventions
      ↓
Successful recoveries
      ↓
₹ ACTUAL REVENUE RECOVERED
```

---

# 29. North Star Metric

## **Incremental Revenue Recovered**

The ultimate question is:

> **How much additional revenue did RecoverAI recover compared with the baseline strategy, while respecting all safety constraints?**

Everything else in the project should support answering that question.
