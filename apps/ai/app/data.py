"""Synthetic demonstration dataset (no real student data). Deterministic for a given seed."""
import numpy as np
from .features import FEATURES


def make_dataset(n=3000, seed=42):
    rng = np.random.default_rng(seed)
    avg = np.clip(rng.normal(60, 15, n), 0, 100)
    trend = rng.normal(0, 6, n)
    unj = rng.poisson(1.0, n).astype(float)
    late = rng.poisson(1.5, n).astype(float)
    oaa = np.clip(0.6 * avg + 0.4 * rng.normal(60, 10, n), 0, 100)
    xp = rng.exponential(60, n)
    quiz = np.clip(avg * 0.9 + 5 + rng.normal(0, 10, n), 0, 100)
    X = np.column_stack([avg, trend, unj, late, oaa, xp, quiz])
    z = (-0.08 * (avg - 60) - 0.12 * trend + 0.5 * unj + 0.2 * late - 0.03 * (oaa - 60) - 0.01 * (xp - 60) - 0.02 * (quiz - 60) - 0.6
         + rng.normal(0, 0.5, n))
    y = (rng.random(n) < 1 / (1 + np.exp(-z))).astype(int)
    # Group attribute used ONLY to audit bias; it is never given to the model and is independent of the features by construction.
    group = rng.choice(["F", "M"], n)
    assert X.shape[1] == len(FEATURES)
    return X, y, group
