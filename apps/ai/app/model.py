import json
import math
from .features import FEATURES, THRESHOLDS


def sigmoid(z):
    return 1.0 / (1.0 + math.exp(-z))


def predict_logistic(model, x):
    """Same maths as predictRisk() in TypeScript. For a linear model SHAP(feature) = coef * (x - mean) / std exactly."""
    z = model["intercept"]
    factors = []
    for i, f in enumerate(model["features"]):
        c = model["coefs"][i] * ((x[f] - model["means"][i]) / (model["stds"][i] or 1.0))
        z += c
        factors.append({"feature": f, "contribution": round(c, 3), "value": x[f]})
    p = round(sigmoid(z), 3)
    t = model["thresholds"]
    level = "high" if p >= t["high"] else "medium" if p >= t["medium"] else "low"
    factors.sort(key=lambda a: -a["contribution"])
    return {"probability": p, "level": level, "factors": factors, "modelVersion": model["version"], "advisoryOnly": True}


def bias_report(levels, groups, min_size=5):
    by = {}
    for lv, g in zip(levels, groups):
        n, hi = by.get(g, (0, 0))
        by[g] = (n + 1, hi + (1 if lv == "high" else 0))
    rows = [{"group": g, "n": n, "highRiskRate": round(hi / n, 3)} for g, (n, hi) in by.items() if n >= min_size]
    if len(rows) < 2:
        return {"rows": rows, "disparateImpactRatio": None, "flagged": False}
    rates = [r["highRiskRate"] for r in rows]
    ratio = 1.0 if max(rates) == 0 else round(min(rates) / max(rates), 3)
    return {"rows": rows, "disparateImpactRatio": ratio, "flagged": ratio < 0.8}


def load(path):
    with open(path, encoding="utf-8") as fh:
        m = json.load(fh)
    assert m["features"] == FEATURES, "model features differ from the feature contract"
    return m
