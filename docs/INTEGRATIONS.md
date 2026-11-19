# Intégrations externes

Chaque service a un adaptateur **sandbox** (par défaut, aucune clé) et un adaptateur **live**, choisis par variable d'environnement.

| Service | Variable de mode | Variables live | Mise en production |
|---|---|---|---|
| Stockage | `STORAGE_MODE` (`sandbox` = disque, `live` = S3/MinIO) | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` ; sandbox : `STORAGE_DIR` | Créer le bucket MinIO/S3 privé, jamais public |
| Push (Android + iOS) | `PUSH_MODE` | `FCM_SERVICE_ACCOUNT_JSON` (compte de service Firebase) | 1) Créer un projet Firebase. 2) Ajouter les apps Android et iOS avec l'identifiant définitif. 3) Mettre `google-services.json` / `GoogleService-Info.plist` dans `apps/mobile` (ignorés par git). 4) iOS : créer une clé APNs (.p8) dans Apple Developer et la téléverser dans Firebase > Cloud Messaging. 5) Activer la capacité Push Notifications dans Xcode. |
| SMS | `SMS_MODE` | `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` | Compte Twilio ou passerelle locale à brancher sur l'interface `SmsAdapter` |
| E-mail | `EMAIL_MODE` | `SMTP_URL` (ex. `smtps://user:pass@host`), `EMAIL_FROM` | Domaine d'envoi avec SPF/DKIM |
| Messagerie | — | `MESSAGE_KEY` (base64, 32 octets : `openssl rand -base64 32`) | Générer une clé par environnement, la stocker dans un gestionnaire de secrets, prévoir la rotation |
| Temps réel | — | `CORS_ORIGINS` (liste séparée par des virgules) | Origines web autorisées |

En mode sandbox, les push sont écrits dans la table `push_outbox` (consultable via `GET /push-outbox`), les SMS/e-mails sont conservés en mémoire : mêmes flux que le réel.

| IA prédictive | `AI_MODE` (`sandbox` = modèle JSON en processus, `live` = service FastAPI) | `AI_SERVICE_URL`, `AI_SERVICE_KEY` ; sandbox : `AI_MODEL_PATH` | Entraîner avec `python apps/ai/train.py` sur des données réelles anonymisées, relire `MODEL_CARD.md` et la mesure de biais avant d'activer ; xgboost/shap optionnels (`requirements.txt`) |

Les adaptateurs de paiement, GPS/cartes, IA générative et ministères seront documentés ici dans leurs phases.
