"""Reproducible training: python train.py [--seed 42]. Writes model/model.json, model/golden.json and model/MODEL_CARD.md.
Always trains the transparent logistic model (served natively by the API in sandbox mode).
If xgboost + shap are installed it also trains a gradient-boosted model whose SHAP values are served by app/main.py."""
import argparse
import json
import os
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split
from app.data import make_dataset
from app.features import FEATURES, THRESHOLDS
from app.model import bias_report, predict_logistic

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=os.path.join(HERE, "model"))
    a = ap.parse_args()
    X, y, group = make_dataset(seed=a.seed)
    Xtr, Xte, ytr, yte, _, gte = train_test_split(X, y, group, test_size=0.25, random_state=a.seed, stratify=y)
    means, stds = Xtr.mean(axis=0), Xtr.std(axis=0)
    clf = LogisticRegression(C=1.0, max_iter=1000).fit((Xtr - means) / stds, ytr)
    model = {"type": "logistic", "version": f"logit-seed{a.seed}", "features": FEATURES, "intercept": round(float(clf.intercept_[0]), 6),
             "coefs": [round(float(c), 6) for c in clf.coef_[0]], "means": [round(float(m), 6) for m in means], "stds": [round(float(s), 6) for s in stds],
             "thresholds": THRESHOLDS}
    probs = clf.predict_proba((Xte - means) / stds)[:, 1]
    auc, brier = float(roc_auc_score(yte, probs)), float(brier_score_loss(yte, probs))
    levels = ["high" if p >= THRESHOLDS["high"] else "medium" if p >= THRESHOLDS["medium"] else "low" for p in probs]
    bias = bias_report(levels, gte)
    model["card"] = {"auc": round(auc, 3), "brier": round(brier, 3), "n_train": int(len(ytr)), "n_test": int(len(yte)), "bias": bias,
                     "data": "synthetic demonstration dataset (seeded), no real student data", "intended_use": "decision support only, reviewed by a human",
                     "excluded": "payment data, gender and any personal attribute (gender is used only to audit bias)"}
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "model.json"), "w", encoding="utf-8") as fh:
        json.dump(model, fh, indent=2)
    golden = []
    rng = np.random.default_rng(7)
    for i in rng.choice(len(Xte), 12, replace=False):
        x = {f: round(float(Xte[i][k]), 3) for k, f in enumerate(FEATURES)}
        golden.append({"input": x, "output": predict_logistic(model, x)})
    with open(os.path.join(a.out, "golden.json"), "w", encoding="utf-8") as fh:
        json.dump(golden, fh, indent=2)
    with open(os.path.join(a.out, "MODEL_CARD.md"), "w", encoding="utf-8") as fh:
        fh.write(f"""# Fiche du modèle / Model card — {model['version']}

- **Usage / Intended use** : aide à la décision uniquement ; chaque alerte est examinée par un humain. / Decision support only; every alert is reviewed by a human.
- **Variables / Features** : {', '.join(FEATURES)}. Données de paiement, sexe et attributs personnels exclus. / Payment data and personal attributes excluded.
- **Données / Data** : jeu synthétique reproductible (graine {a.seed}), aucune donnée réelle. À réentraîner sur les données de l'établissement avant usage réel (réentraînement contrôlé).
- **Performance (jeu de test, n={len(yte)})** : AUC {auc:.3f} ; Brier {brier:.3f}.
- **Biais / Bias (règle des 4/5, taux de « risque élevé » par groupe)** : ratio {bias['disparateImpactRatio']} ; alerte : {bias['flagged']}.
- **Explicabilité / Explainability** : modèle linéaire, valeurs SHAP exactes = coef × (x − moyenne) / écart-type.
- **Limites / Limits** : un modèle entraîné sur des données synthétiques n'est pas validé pour un pays ou un établissement réel ; les corrélations ne sont pas des causes.
""")
    try:
        import shap  # noqa: F401
        import xgboost as xgb
        booster = xgb.XGBClassifier(n_estimators=120, max_depth=3, learning_rate=0.08, subsample=0.9, random_state=a.seed, eval_metric="logloss").fit(Xtr, ytr)
        booster.save_model(os.path.join(a.out, "model_xgb.json"))
        print("xgboost model saved, AUC", round(float(roc_auc_score(yte, booster.predict_proba(Xte)[:, 1])), 3))
    except ImportError:
        print("xgboost/shap not installed: logistic model only (install apps/ai/requirements.txt for the boosted model)")
    print(json.dumps(model["card"], indent=2))


if __name__ == "__main__":
    main()
