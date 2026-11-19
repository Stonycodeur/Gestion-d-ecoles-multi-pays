# Fiche du modèle / Model card — logit-seed42

- **Usage / Intended use** : aide à la décision uniquement ; chaque alerte est examinée par un humain. / Decision support only; every alert is reviewed by a human.
- **Variables / Features** : avg100, trend, unjustified_rate, late_rate, oaa, xp_30d, quiz_avg. Données de paiement, sexe et attributs personnels exclus. / Payment data and personal attributes excluded.
- **Données / Data** : jeu synthétique reproductible (graine 42), aucune donnée réelle. À réentraîner sur les données de l'établissement avant usage réel (réentraînement contrôlé).
- **Performance (jeu de test, n=750)** : AUC 0.860 ; Brier 0.152.
- **Biais / Bias (règle des 4/5, taux de « risque élevé » par groupe)** : ratio 0.911 ; alerte : False.
- **Explicabilité / Explainability** : modèle linéaire, valeurs SHAP exactes = coef × (x − moyenne) / écart-type.
- **Limites / Limits** : un modèle entraîné sur des données synthétiques n'est pas validé pour un pays ou un établissement réel ; les corrélations ne sont pas des causes.
