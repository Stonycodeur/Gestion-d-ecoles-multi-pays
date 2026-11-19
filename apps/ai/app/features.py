"""Feature contract shared with packages/shared/src/risk.ts. Payment data is deliberately NOT a feature (spec 7.7)."""
FEATURES = ["avg100", "trend", "unjustified_rate", "late_rate", "oaa", "xp_30d", "quiz_avg"]
FORBIDDEN = ("pay", "invoice", "fee", "billing")
THRESHOLDS = {"medium": 0.33, "high": 0.66}

assert not any(any(w in f for w in FORBIDDEN) for f in FEATURES), "payment data must never be a feature"
