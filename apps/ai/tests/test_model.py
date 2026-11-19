import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from app.features import FEATURES, FORBIDDEN  # noqa: E402
from app.model import bias_report, load, predict_logistic  # noqa: E402


def train(out, seed=42):
    subprocess.run([sys.executable, os.path.join(ROOT, "train.py"), "--seed", str(seed), "--out", out], check=True, capture_output=True, cwd=ROOT)
    return load(os.path.join(out, "model.json"))


class ModelTests(unittest.TestCase):
    def test_training_is_reproducible(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            self.assertEqual(train(a)["coefs"], train(b)["coefs"])

    def test_quality_and_fairness_of_the_demo_model(self):
        with tempfile.TemporaryDirectory() as a:
            card = train(a)["card"]
        self.assertGreater(card["auc"], 0.75)
        self.assertFalse(card["bias"]["flagged"], card["bias"])

    def test_no_payment_feature(self):
        self.assertFalse([f for f in FEATURES if any(w in f for w in FORBIDDEN)])

    def test_directionality_and_shap_additivity(self):
        with tempfile.TemporaryDirectory() as a:
            m = train(a)
        weak = {"avg100": 30, "trend": -8, "unjustified_rate": 5, "late_rate": 4, "oaa": 35, "xp_30d": 0, "quiz_avg": 30}
        strong = {"avg100": 90, "trend": 4, "unjustified_rate": 0, "late_rate": 0, "oaa": 85, "xp_30d": 150, "quiz_avg": 90}
        self.assertEqual(predict_logistic(m, weak)["level"], "high")
        self.assertEqual(predict_logistic(m, strong)["level"], "low")
        # contributions + intercept reproduce the logit (SHAP local accuracy)
        import math
        r = predict_logistic(m, weak)
        z = m["intercept"] + sum(f["contribution"] for f in r["factors"])
        self.assertAlmostEqual(1 / (1 + math.exp(-z)), r["probability"], places=2)

    def test_bias_report(self):
        flagged = bias_report(["high"] * 5 + ["low"] * 5 + ["low"] * 9 + ["high"], ["A"] * 10 + ["B"] * 10)
        self.assertTrue(flagged["flagged"])
        self.assertIsNone(bias_report(["high"] * 10, ["A"] * 10)["disparateImpactRatio"])


if __name__ == "__main__":
    unittest.main()
