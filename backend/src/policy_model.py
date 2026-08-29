"""
Policy Model Module for RecoverAI.
Handles feature preprocessing, model training (LightGBM),
P(recovery) inference, and transparent rules-based action selection.

Schema locked from Phase 0 data audit (train.csv / test_batch.csv).
"""

import os
import pickle
import datetime
import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional, Tuple

try:
    import joblib
    HAS_JOBLIB = True
except ImportError:
    HAS_JOBLIB = False

try:
    import lightgbm as lgb
    HAS_LIGHTGBM = True
except ImportError:
    HAS_LIGHTGBM = False

try:
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import (
        roc_auc_score, precision_score, recall_score,
        f1_score, accuracy_score, brier_score_loss
    )
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

# ─────────────────────────────────────────────────────────────
# Locked feature schema — from Phase 0 data audit
# DO NOT modify without re-running the audit
# ─────────────────────────────────────────────────────────────

NUMERIC_FEATURES = [
    'amount_inr', 'customer_tenure_days', 'subscription_age_days',
    'prior_cycles_seen', 'prior_successes', 'prior_success_rate',
    'prior_failed_cases_before', 'prior_recovered_cases_before',
    'retries_used_before', 'contacts_sent_before', 'hours_since_open',
    'decision_seq', 'hour_of_day', 'day_of_month',
    'hours_to_next_cluster_slot', 'salary_day_proxy_dom',
    'day_of_week', 'amount_inr_log1p',
    # Bool columns cast to int
    'instrument_fixed_int', 'in_salary_cluster_int',
]

CATEGORICAL_FEATURES = [
    'rail', 'bank_name', 'segment', 'plan_tier', 'value_tier',
    'first_failure_class', 'failure_class_at_decision',
    'age_band', 'state', 'locale_pref',
]

TARGET = 'y'

# Historical action column — used for batch evaluation ONLY, never a model feature
HISTORICAL_ACTION_COL = 'action_type'

# Columns to exclude from model (post-decision / metadata)
EXCLUDE_COLS = ['logging_policy', 'channel', 'action_type',
                'subscription_id', 'case_id', 'customer_id',
                'instrument_fixed', 'in_salary_cluster']  # raw bools replaced by _int

# ─────────────────────────────────────────────────────────────
# Failure class taxonomy — corrected from audit
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

# Actions the system can take (excluding REQUEST_PM_UPDATE which maps to CHANGE_PAYMENT_METHOD)
ACTIONS = [
    'RETRY',
    'SEND_PAYMENT_LINK',
    'SEND_REMINDER',
    'CHANGE_PAYMENT_METHOD',
    'ESCALATE',
    'DO_NOTHING',
]

# Intervention costs (INR) — configurable
ACTION_COST_MAP: Dict[str, float] = {
    'RETRY': 2.00,
    'SEND_PAYMENT_LINK': 1.50,
    'SEND_REMINDER': 0.50,
    'CHANGE_PAYMENT_METHOD': 1.00,
    'ESCALATE': 5.00,
    'DO_NOTHING': 0.00,
}


class RecoveryPolicyModel:
    """
    LightGBM-based recovery probability model with transparent
    rules-based action selection.
    """

    def __init__(self, model_dir: str = 'backend/models'):
        self.model_dir = model_dir
        self.model_path = os.path.join(model_dir, 'policy_model.pkl')
        self.model = None
        self.feature_names: List[str] = []
        self.categorical_feature_indices: List[int] = []
        self.cat_vocab: Dict[str, List[str]] = {}  # known values per categorical
        self.is_trained: bool = False
        self.training_metrics: Dict[str, float] = {}
        self.model_version: str = ''

    # ─────────────────────────────────────────────────────────
    # Preprocessing
    # ─────────────────────────────────────────────────────────

    def _preprocess(self, df: pd.DataFrame, is_training: bool = False) -> pd.DataFrame:
        """
        Prepares feature DataFrame for LightGBM.
        - Cast bool columns to int
        - Fill missing numerics with 0
        - Fill missing categoricals with 'UNKNOWN'
        - Record categorical vocabulary during training
        - Map unseen categoricals to 'UNKNOWN' during inference
        - Return only model features in correct order
        """
        out = df.copy()

        # Derive log-amount if missing
        if 'amount_inr_log1p' not in out.columns and 'amount_inr' in out.columns:
            out['amount_inr_log1p'] = np.log1p(out['amount_inr'].astype(float))

        # Bool → int
        for raw_col, int_col in [('instrument_fixed', 'instrument_fixed_int'),
                                   ('in_salary_cluster', 'in_salary_cluster_int')]:
            if raw_col in out.columns:
                out[int_col] = out[raw_col].astype(bool).astype(int)
            else:
                out[int_col] = 0

        # Numeric features
        for col in NUMERIC_FEATURES:
            if col not in out.columns:
                out[col] = 0.0
            else:
                out[col] = pd.to_numeric(out[col], errors='coerce').fillna(0.0)

        # Categorical features
        for col in CATEGORICAL_FEATURES:
            if col not in out.columns:
                out[col] = 'UNKNOWN'
            else:
                out[col] = out[col].astype(str).fillna('UNKNOWN')

            if is_training:
                # Record all known values including UNKNOWN sentinel
                vocab = sorted(out[col].unique().tolist())
                if 'UNKNOWN' not in vocab:
                    vocab.append('UNKNOWN')
                self.cat_vocab[col] = vocab
            else:
                # Map unseen values to UNKNOWN
                known = set(self.cat_vocab.get(col, []))
                if known:
                    out[col] = out[col].apply(lambda v: v if v in known else 'UNKNOWN')

            out[col] = out[col].astype('category')

        all_features = NUMERIC_FEATURES + CATEGORICAL_FEATURES
        self.feature_names = all_features

        # Categorical indices for LightGBM
        self.categorical_feature_indices = [
            all_features.index(c) for c in CATEGORICAL_FEATURES
        ]

        return out[all_features]

    # ─────────────────────────────────────────────────────────
    # Training
    # ─────────────────────────────────────────────────────────

    def train(self, data_path: str = 'backend/data/train.csv') -> Dict[str, float]:
        """
        Trains LightGBM on train.csv using customer-group based split.
        Raises RuntimeError if LightGBM or sklearn is unavailable.
        """
        if not HAS_LIGHTGBM:
            raise RuntimeError(
                "LightGBM is required. Install it: pip install lightgbm"
            )
        if not HAS_SKLEARN:
            raise RuntimeError(
                "scikit-learn is required for evaluation. Install it: pip install scikit-learn"
            )
        if not os.path.exists(data_path):
            raise FileNotFoundError(f"Training data not found at {data_path}")

        print(f"[PolicyModel] Loading training data from {data_path}...")
        df = pd.read_csv(data_path)
        print(f"[PolicyModel] Loaded {len(df):,} rows, {df['customer_id'].nunique():,} unique customers")

        # ── Customer-group based split ──────────────────────
        # Prevents same customer appearing in both train and validation.
        # 85% of customers → train, 15% → validation.
        all_customers = df['customer_id'].unique()
        np.random.seed(42)
        np.random.shuffle(all_customers)
        split_idx = int(len(all_customers) * 0.85)
        train_customers = set(all_customers[:split_idx])
        val_customers   = set(all_customers[split_idx:])

        train_df = df[df['customer_id'].isin(train_customers)].reset_index(drop=True)
        val_df   = df[df['customer_id'].isin(val_customers)].reset_index(drop=True)

        print(f"[PolicyModel] Customer-group split -> "
              f"Train: {len(train_df):,} rows ({len(train_customers):,} customers) | "
              f"Val: {len(val_df):,} rows ({len(val_customers):,} customers)")

        X_train = self._preprocess(train_df, is_training=True)
        y_train = train_df[TARGET].astype(int)

        X_val = self._preprocess(val_df, is_training=False)
        y_val = val_df[TARGET].astype(int)

        # ── LightGBM training ───────────────────────────────
        print("[PolicyModel] Training LightGBM classifier...")
        self.model = lgb.LGBMClassifier(
            n_estimators=300,
            learning_rate=0.05,
            max_depth=7,
            num_leaves=63,
            min_child_samples=30,
            feature_fraction=0.8,
            bagging_fraction=0.8,
            bagging_freq=5,
            class_weight='balanced',   # handles 77/23 imbalance
            random_state=42,
            verbose=-1,
        )
        self.model.fit(
            X_train, y_train,
            categorical_feature=self.categorical_feature_indices,
            eval_set=[(X_val, y_val)],
            callbacks=[
                lgb.early_stopping(stopping_rounds=20, verbose=False),
                lgb.log_evaluation(period=-1),
            ],
        )

        # ── Validation metrics ──────────────────────────────
        val_proba  = self.model.predict_proba(X_val)[:, 1]
        val_binary = (val_proba >= 0.5).astype(int)

        self.training_metrics = {
            'roc_auc':   round(float(roc_auc_score(y_val, val_proba)), 4),
            'precision': round(float(precision_score(y_val, val_binary, zero_division=0)), 4),
            'recall':    round(float(recall_score(y_val, val_binary, zero_division=0)), 4),
            'f1':        round(float(f1_score(y_val, val_binary, zero_division=0)), 4),
            'accuracy':  round(float(accuracy_score(y_val, val_binary)), 4),
            'brier':     round(float(brier_score_loss(y_val, val_proba)), 4),
            'val_rows':  int(len(y_val)),
            'val_customers': int(len(val_customers)),
        }

        self.model_version = datetime.datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        self.is_trained = True

        print(f"[PolicyModel] Training complete. Metrics: {self.training_metrics}")
        self.save_model()
        return self.training_metrics

    # ─────────────────────────────────────────────────────────
    # Persistence
    # ─────────────────────────────────────────────────────────

    def save_model(self):
        """Saves model + full metadata to policy_model.pkl."""
        os.makedirs(self.model_dir, exist_ok=True)
        artifact = {
            'model':                      self.model,
            'feature_names':              self.feature_names,
            'categorical_features':       CATEGORICAL_FEATURES,
            'categorical_feature_indices': self.categorical_feature_indices,
            'cat_vocab':                  self.cat_vocab,
            'is_trained':                 self.is_trained,
            'training_metrics':           self.training_metrics,
            'model_version':              self.model_version,
            'numeric_features':           NUMERIC_FEATURES,
            'target':                     TARGET,
        }
        if HAS_JOBLIB:
            joblib.dump(artifact, self.model_path)
        else:
            with open(self.model_path, 'wb') as f:
                pickle.dump(artifact, f)
        print(f"[PolicyModel] Saved to {self.model_path} (version {self.model_version})")

    def load_model(self) -> bool:
        """Loads model + metadata from policy_model.pkl. Returns True on success."""
        if not os.path.exists(self.model_path):
            return False
        try:
            if HAS_JOBLIB:
                artifact = joblib.load(self.model_path)
            else:
                with open(self.model_path, 'rb') as f:
                    artifact = pickle.load(f)

            self.model                       = artifact['model']
            self.feature_names               = artifact['feature_names']
            self.categorical_feature_indices = artifact.get('categorical_feature_indices', [])
            self.cat_vocab                   = artifact.get('cat_vocab', {})
            self.is_trained                  = artifact.get('is_trained', True)
            self.training_metrics            = artifact.get('training_metrics', {})
            self.model_version               = artifact.get('model_version', 'unknown')
            print(f"[PolicyModel] Loaded version {self.model_version}, "
                  f"AUC={self.training_metrics.get('roc_auc', 'N/A')}")
            return True
        except Exception as e:
            print(f"[PolicyModel] ERROR loading model: {e}")
            return False

    # ─────────────────────────────────────────────────────────
    # Inference
    # ─────────────────────────────────────────────────────────

    def predict_proba(self, case_dict: Dict[str, Any]) -> float:
        """
        Returns P(recovery) for a single case as a float in [0, 1].
        Raises RuntimeError if model is not loaded/trained.
        """
        if not self.is_trained and not self.load_model():
            raise RuntimeError(
                "Policy model is not trained. Run: python -c \"from src.policy_model import RecoveryPolicyModel; "
                "m = RecoveryPolicyModel(); m.train('data/train.csv')\""
            )
        df_single = pd.DataFrame([case_dict])
        X = self._preprocess(df_single, is_training=False)
        proba = float(self.model.predict_proba(X)[0, 1])
        return round(proba, 4)

    def predict_proba_batch(self, df: pd.DataFrame) -> np.ndarray:
        """
        Vectorised batch prediction. Returns np.ndarray of shape (n,).
        More efficient than calling predict_proba row-by-row.
        """
        if not self.is_trained and not self.load_model():
            raise RuntimeError("Policy model is not trained.")
        X = self._preprocess(df, is_training=False)
        return self.model.predict_proba(X)[:, 1]

    # ─────────────────────────────────────────────────────────
    # Transparent rules-based action selection
    # ─────────────────────────────────────────────────────────

    def evaluate_actions(self, case_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Ranks candidate actions using transparent, explainable rules.

        Design rationale:
        - The ML model predicts P(recovery | case features).
        - Action selection is a separate deterministic policy layer.
        - No invented multipliers. Every rule has a stated reason.
        - Expected recovery value = P(recovery) × amount_inr - action_cost
        """
        recovery_prob = self.predict_proba(case_dict)
        amount        = float(case_dict.get('amount_inr', 0.0))
        failure_class = str(case_dict.get('failure_class_at_decision', '')).upper()
        retries_used  = int(case_dict.get('retries_used_before', 0))
        contacts_sent = int(case_dict.get('contacts_sent_before', 0))

        # Build action candidacy with eligibility rules and reasons
        candidates = []

        # ── RETRY ──────────────────────────────────────────
        if failure_class in RETRYABLE_CLASSES and retries_used == 0:
            candidates.append({
                'action': 'RETRY',
                'eligible': True,
                'reason': f"Retryable failure ({failure_class}), first attempt — retry is highest-value action",
                'priority': 1,
            })
        elif failure_class in RETRYABLE_CLASSES and retries_used > 0:
            candidates.append({
                'action': 'RETRY',
                'eligible': True,
                'reason': f"Retryable failure ({failure_class}), {retries_used} prior retry(ies) — diminishing returns",
                'priority': 3,
            })
        else:
            candidates.append({
                'action': 'RETRY',
                'eligible': False,
                'reason': f"Failure class '{failure_class}' is not retryable via same rail",
                'priority': 6,
            })

        # ── CHANGE_PAYMENT_METHOD ───────────────────────────
        if failure_class in UNRETRYABLE_CLASSES or failure_class in MANDATE_ISSUE_CLASSES:
            candidates.append({
                'action': 'CHANGE_PAYMENT_METHOD',
                'eligible': True,
                'reason': f"'{failure_class}' requires a different payment instrument",
                'priority': 1,
            })
        elif failure_class in RETRYABLE_CLASSES and retries_used >= 2:
            candidates.append({
                'action': 'CHANGE_PAYMENT_METHOD',
                'eligible': True,
                'reason': f"Auto-retry exhausted ({retries_used} retries) — escalate to payment method change",
                'priority': 2,
            })
        else:
            candidates.append({
                'action': 'CHANGE_PAYMENT_METHOD',
                'eligible': True,
                'reason': "Alternative payment method available as fallback",
                'priority': 4,
            })

        # ── SEND_PAYMENT_LINK ────────────────────────────────
        if contacts_sent == 0:
            candidates.append({
                'action': 'SEND_PAYMENT_LINK',
                'eligible': True,
                'reason': "No prior contact — direct payment link maximises recovery speed",
                'priority': 2,
            })
        else:
            candidates.append({
                'action': 'SEND_PAYMENT_LINK',
                'eligible': True,
                'reason': f"{contacts_sent} prior contact(s) — payment link as follow-up",
                'priority': 4,
            })

        # ── SEND_REMINDER ───────────────────────────────────
        if failure_class in RETRYABLE_CLASSES and contacts_sent < 2:
            candidates.append({
                'action': 'SEND_REMINDER',
                'eligible': True,
                'reason': f"Retryable failure with {contacts_sent} contact(s) — reminder may prompt self-payment",
                'priority': 3,
            })
        else:
            candidates.append({
                'action': 'SEND_REMINDER',
                'eligible': True,
                'reason': "Reminder as low-cost engagement option",
                'priority': 5,
            })

        # ── ESCALATE ────────────────────────────────────────
        candidates.append({
            'action': 'ESCALATE',
            'eligible': True,
            'reason': "Human review for complex or high-risk cases",
            'priority': 5,
        })

        # ── DO_NOTHING ───────────────────────────────────────
        candidates.append({
            'action': 'DO_NOTHING',
            'eligible': False if recovery_prob > 0.30 else True,
            'reason': "No action — case probability below intervention threshold"
                      if recovery_prob <= 0.30 else "Recovery probability is sufficient to justify action",
            'priority': 7,
        })

        # Score: use priority (lower = better) then expected recovery value
        results = []
        for c in candidates:
            cost = ACTION_COST_MAP.get(c['action'], 0.0)
            # Only eligible actions get positive expected value
            if c['eligible']:
                erv = round(recovery_prob * amount - cost, 2)
            else:
                erv = round(-cost, 2)  # cost with no expected recovery

            results.append({
                'action':                   c['action'],
                'eligible':                 c['eligible'],
                'recovery_probability':     recovery_prob,
                'expected_recovery_inr':    erv,
                'action_cost_inr':          cost,
                'priority':                 c['priority'],
                'reason':                   c['reason'],
            })

        # Sort: eligible first, then by expected recovery value descending
        results.sort(key=lambda x: (-int(x['eligible']), -x['expected_recovery_inr']))
        return results


if __name__ == '__main__':
    import sys
    model = RecoveryPolicyModel()

    data_dir = 'data' if os.path.exists('data/train.csv') else 'backend/data'
    train_path = os.path.join(data_dir, 'train.csv')

    print(f"Training on {train_path} ...")
    metrics = model.train(train_path)
    print(f"\nFinal metrics: {metrics}")
