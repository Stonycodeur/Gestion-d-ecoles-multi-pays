# Publication sur Google Play et l'App Store

L'application Flutter (`apps/mobile`) est livrée sans dossiers `android/` et `ios/` : ils sont générés par `flutter create`, puis configurés par `tool/configure_native.py` (permissions, localisation en arrière-plan, signature, entitlements, identifiant, nom). Les workflows `release-android.yml` et `release-ios.yml` font tout cela automatiquement.

## Ce que je fais moi-même (action de votre part)
1. Ouvrir le compte **Google Play Console** (frais uniques) et le compte **Apple Developer Program** (abonnement annuel).
2. Choisir et me communiquer l'**identifiant d'application** (applicationId Android = bundle identifier iOS) et le nom commercial. En attendant : `com.ecolemanager.pro.work`.
3. **Générer le keystore Android** (jamais commité) et fournir les certificats/profils iOS.
4. Créer le projet **Firebase** et fournir `google-services.json` / `GoogleService-Info.plist` (voir `docs/INTEGRATIONS.md`).
5. Ajouter les **captures d'écran finales** (liste dans `store/*/listing.md`) et compléter les [crochets] des pages légales.
6. **Soumettre** les builds à la revue.

## Secrets GitHub (Settings > Secrets and variables > Actions)
| Secret | Contenu |
|---|---|
| `APP_ID`, `APP_NAME` | identifiant et nom (facultatifs, valeurs de travail par défaut) |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 upload-keystore.jks` |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | infos du keystore |
| `GOOGLE_SERVICES_JSON_BASE64` | `google-services.json` en base64 (push) |
| `PLAY_JSON_KEY` | JSON du compte de service Play (envoi vers la piste interne) |
| `IOS_CERT_P12_BASE64`, `IOS_CERT_PASSWORD` | certificat de distribution .p12 |
| `IOS_PROVISIONING_PROFILE_BASE64` | profil App Store (.mobileprovision) |
| `IOS_TEAM_ID` | identifiant d'équipe Apple |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64` | `GoogleService-Info.plist` en base64 |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_BASE64` | clé API App Store Connect (TestFlight) |

## Android
1. Générer le keystore : `keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload` (le conserver hors du dépôt, avec sauvegarde).
2. Créer l'application dans la Play Console (identifiant identique à `APP_ID`), activer **Play App Signing**.
3. Renseigner les secrets ci-dessus, puis lancer le workflow **release-android** (ou pousser un tag `mobile-vX.Y.Z`). Artefacts : `app-release.aab` (à déposer) et `app-release.apk` (test).
4. Local : `cd apps/mobile && flutter create --platforms=android,ios --org com.ecolemanager --project-name ecolemanager_mobile . && (cd tool && python3 configure_native.py ..) && cp /chemin/key.properties android/ && flutter build appbundle --release`.
5. Piste interne : créer le compte de service (Play Console > Accès à l'API), le déclarer en `PLAY_JSON_KEY`, lancer le workflow avec `upload_internal` (Fastlane `android internal`, envoi en brouillon).
6. Remplir : fiche (`store/*/listing.md`), **Sécurité des données** (`store/DATA_SAFETY.md`), politique de confidentialité (`/legal/privacy`), **déclaration de localisation en arrière-plan** avec vidéo, public cible, classification, compte de test pour les réviseurs.

## iOS (nécessite un Mac ou le runner macOS GitHub)
1. Dans le compte Apple Developer : créer l'App ID (identifiant = `APP_ID`) avec les capacités **Push Notifications** et **Background Modes (Location updates, Remote notifications)**.
2. Créer un certificat « Apple Distribution » (exporter en .p12) et un profil « App Store » lié à l'App ID.
3. Créer la clé APNs (.p8) et la téléverser dans Firebase (Paramètres du projet > Cloud Messaging).
4. Créer l'app dans App Store Connect ; créer une clé API App Store Connect pour TestFlight.
5. Renseigner les secrets, lancer **release-ios** (s'exécute seulement si les secrets de signature existent). Artefact : `.ipa`. Avec `upload_testflight`, Fastlane `ios beta` l'envoie à TestFlight.
6. Local sur Mac : mêmes commandes `flutter create` + `configure_native.py`, ouvrir `ios/Runner.xcworkspace`, choisir l'équipe, `flutter build ipa --release`.
7. App Store Connect : fiche, **App Privacy** (`store/DATA_SAFETY.md`), notes de revue (compte de démonstration + justification de la localisation en arrière-plan), âge/catégorie Éducation.

## Icône et écran de lancement
Sources dans `apps/mobile/assets/icon/` (icône provisoire générée : remplacez `icon.png` 1024×1024, `icon_foreground.png` et `splash.png` par votre identité visuelle). Générés par `dart run flutter_launcher_icons` et `dart run flutter_native_splash:create` (déjà inclus dans les workflows et la CI).

## Conformité
Voir `store/COMPLIANCE.md` (mineurs, suppression de compte dans l'app, paiements hors achat intégré, permissions).

## Limites connues
- Le certificate pinning et la base locale chiffrée sont suivis dans `docs/PROGRESS.md`.
- Les builds signés ne peuvent pas être exécutés sans vos secrets : seuls les builds debug sont vérifiés en CI.
