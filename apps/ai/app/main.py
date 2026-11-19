"""FastAPI prediction service (AI_MODE=live). POST /predict -> probability, level, SHAP factors. Never takes a decision."""
import os
from typing import Dict, List
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from .features import FEATURES
from .model import load, predict_logistic

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get("AI_MODEL_DIR", os.path.join(HERE, "..", "model"))
model = load(os.path.join(MODEL_DIR, "model.json"))
app = FastAPI(title="EcoleManager AI", version="1.0.0")

_xgb = None
try:  # boosted model + SHAP when available
    import numpy as np
    import shap
    import xgboost as xgb
    path = os.path.join(MODEL_DIR, "model_xgb.json")
    if os.path.exists(path):
        _clf = xgb.XGBClassifier()
        _clf.load_model(path)
        _xgb = (_clf, shap.TreeExplainer(_clf), np)
except ImportError:
    pass


class Item(BaseModel):
    id: str
    features: Dict[str, float]


class Batch(BaseModel):
    students: List[Item]


def _check_key(key):
    expected = os.environ.get("AI_SERVICE_KEY")
    if expected and key != expected:
        raise HTTPException(status_code=401, detail="invalid service key")


@app.get("/health")
def health():
    return {"status": "ok", "engine": "xgboost+shap" if _xgb else "logistic", "version": model["version"]}


@app.post("/predict")
def predict(batch: Batch, x_service_key: str = Header(default=None)):
    _check_key(x_service_key)
    out = []
    for it in batch.students:
        missing = [f for f in FEATURES if f not in it.features]
        if missing:
            raise HTTPException(status_code=422, detail=f"missing features: {missing}")
        if not _xgb:
            out.append({"id": it.id, **predict_logistic(model, it.features)})
            continue
        clf, expl, np = _xgb
        row = np.array([[it.features[f] for f in FEATURES]])
        p = round(float(clf.predict_proba(row)[0][1]), 3)
        sv = expl.shap_values(row)[0]
        t = model["thresholds"]
        factors = sorted(({"feature": f, "contribution": round(float(sv[i]), 3), "value": it.features[f]} for i, f in enumerate(FEATURES)), key=lambda a: -a["contribution"])
        out.append({"id": it.id, "probability": p, "level": "high" if p >= t["high"] else "medium" if p >= t["medium"] else "low",
                    "factors": factors, "modelVersion": "xgb-" + model["version"], "advisoryOnly": True})
    return {"predictions": out}
