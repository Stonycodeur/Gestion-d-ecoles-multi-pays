# Géographie mondiale et activation des pays

## Données
`apps/api/geo-data/` contient les 7 continents, 250 pays, 5 348 provinces/régions et 172 237 villes (fichiers compressés par pays). Elles sont servies par l'API (`/geo/*`) : aucune règle nationale n'est dans le code.

- Source : [dr5hn/countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database), licence **ODbL 1.0** (attribution obligatoire : « Contains information from countries-states-cities-database, made available under the ODbL »). Une redistribution modifiée de la base doit rester sous ODbL.
- Reconstruction / mise à jour : `python3 apps/api/tools/build-geo.py <clone>/json`.
- Limites : les provinces et villes viennent d'un jeu communautaire ; une ville absente peut être saisie à la main. Les pays sans province (ex. Vatican) ont une entrée unique.

## Activer un pays
Un pays du monde n'a un référentiel (système éducatif, échelles de notation, calendrier) qu'une fois « activé » : `POST /geo/countries/{ISO2}/activate {model, locale}` (Super-Admin racine). Trois modèles : `numeric` (échelles du Gabon : /10 primaire, /20 ensuite, LMD), `letters` (A+ à E-), `percent` (/100). Les quatre cycles standard (primaire, collège, lycée, supérieur) sont créés ; **les examens nationaux et les intitulés de niveaux sont à adapter par pays** (données, pas du code). L'opération est idempotente.

## Console racine
- `/root` : chiffres clés, écoles (continent, pays, province, ville), création d'une école, journal d'audit.
- `/root/accounts` : création des comptes de n'importe quel rôle d'école (dont Super-Admin d'établissement), nouveau mot de passe, suspension.
- `/root/geography` : parcours continents → pays → provinces → villes, activation d'un pays.
- Sélecteur « École dans laquelle vous agissez » : le Super-Admin racine agit dans n'importe quelle école via l'en-tête `X-Tenant` (toute écriture est journalisée : `root.tenant_context`).
- `/account/password` : chacun change son mot de passe.

## Décisions
- Le Super-Admin racine reste **unique et immuable** (cahier des charges 11.2) : « créer d'autres Super-Admins » signifie créer des **Super-Admins d'établissement** (`tenant_super_admin`), pour n'importe quelle école, depuis la console.
- Les comptes sont créés par des fonctions SQL `SECURITY DEFINER` (`infra/sql/101_supabase_accounts.sql`, propre à Supabase) : l'API ne détient aucune clé « service role ». Avec Keycloak, les comptes se créent dans Keycloak (l'API répond 501 avec un message explicite).
