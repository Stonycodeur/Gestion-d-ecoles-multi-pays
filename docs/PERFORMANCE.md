# Performance — ce qui est mesuré, et ce qui ne l'est pas

Cible du cahier (12.1) : API < 200 ms (p95). Deux scripts, exécutés par le job CI `web-e2e` sur l'établissement du seed Gabon, API en production (`node dist`) et PostgreSQL ordinaire :

| Script | Routes | Charge |
|---|---|---|
| `infra/loadtest/p95.mjs` | 6 routes de lecture | 10 clients, 20 s |
| `infra/loadtest/mixed.mjs` | PDF, écritures, assistant IA, calcul prédictif | 14 clients au total, 25 s |

## Résultats de référence (runner GitHub partagé, 2 vCPU)
| Scénario | Réussites | p50 | p95 | p99 | Budget CI |
|---|---|---|---|---|---|
| Lectures (6 routes) | toutes 2xx | 4 ms | 4–22 ms | — | 300 ms |
| Bulletin PDF | 1 350 | 71 ms | 101 ms | 129 ms | 1 500 ms |
| Emploi du temps PDF | 1 119 | 43 ms | 61 ms | 89 ms | 1 500 ms |
| Absence (écriture + notification + recalcul OAA) | 1 100 | 129 ms | 189 ms | 296 ms | 500 ms |
| Assistant IA (**modèle simulé**) | 240 | 59 ms | 154 ms | 363 ms | 1 000 ms |
| Calcul prédictif (toute l'école) | 12 | 614 ms | 910 ms | 910 ms | 4 000 ms |
| Génération d'un emploi du temps | 1 | 37 ms | — | — | — |

Chaque réponse est contrôlée (un PDF doit commencer par `%PDF`, une écriture doit renvoyer 2xx) : une erreur rapide fait échouer le test. Les budgets des PDF, de l'IA et du prédictif sont des budgets de CI choisis par nous, pas des exigences du cahier.

## Limites — à ne pas surinterpréter
- Ce n'est **pas** une preuve de tenue à 10 000 utilisateurs simultanés : 10 à 14 clients, un seul nœud, une base de quelques centaines de lignes.
- L'assistant IA est mesuré avec le **modèle simulé** : la latence réelle d'un fournisseur de modèle de langage (secondes) n'est pas couverte, ni celle du service FastAPI d'entraînement.
- Les écritures sont mesurées sur une seule route (absence). Pas de test de l'import massif, des paiements, du GPS en continu, de la messagerie temps réel (WebSocket).
- Base de données réduite : aucun test sur des millions de lignes (notes, positions GPS).
- Runner partagé : les chiffres varient d'une exécution à l'autre ; seuls les dépassements de budget font échouer la CI.

## Reproduire
```
API_BASE=http://localhost:3000 TENANT=ga_lycee node infra/loadtest/p95.mjs
API_BASE=http://localhost:3000 TENANT=ga_lycee node infra/loadtest/mixed.mjs
```
Prérequis : `AUTH_MODE=sandbox`, seed Gabon, limites de débit relevées (`RATE_LIMIT_PER_MIN`, `RATE_LIMIT_AUTH_PER_MIN`).
