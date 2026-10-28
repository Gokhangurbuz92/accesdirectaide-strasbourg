# Déploiement

> Ce document décrit le chemin de mise en production, sur autorisation du propriétaire. Toute mise en service utilise des secrets
> **neufs**, jamais repris d'une installation antérieure.

## 1. La porte avant toute mise en production

```bash
node scripts/release-preflight.mjs
```

Lancée avec l'environnement de production, elle doit sortir **0**. Elle échoue (`FAIL`) quand un prérequis manque — base, secrets de session,
clé de données, clé du coffre MFA (`ADA_VAULT_KEY`), adresse publique https (`APP_BASE_URL`), e-mail délivrable, KV, stockage, TLS vérifié
vers la base, webhook d'alerte, Sentry en région UE — ou quand une variable interdite existe (`ADMIN_PASSWORD`, `ADMIN_TOKEN`, `BYPASS_SECRET`,
clés d'IA non approuvées, mode de contenu `lab`, lecture des anciens liens de partage, Session Replay, interrupteurs de développement).
Elle vérifie aussi que l'identité de l'éditeur est complète dans les pages légales (aucun « [À COMPLÉTER] »).

La liste des variables, avec les marqueurs `[REQUIRED-PROD]` / `[FORBIDDEN-PROD]`, est dans `.env.example` (noms seulement, jamais de valeur).
Un administrateur connecté voit la même liste de contrôles manquants dans `/api/health/deep` (`config.failing`, identifiants seulement).

## 2. Chaîne de déploiement (GitHub Actions)

1. **Pull request** → CI : lint, typecheck, tests, build ; gitleaks (archive vérifiée par SHA-256) ; Semgrep (image épinglée par digest) ;
   check-artifacts. Il n'y a plus de fusion automatique.
2. **Fusion sur `main`** → `deploy.yml` ne démarre que lorsque le CI de ce même commit a réussi. Il tourne dans l'environnement GitHub
   `production` (approbation requise) avec une version épinglée de Vercel CLI (`vars.VERCEL_CLI_VERSION`). Les tests de fumée sont bloquants.
3. **Migrations** → `db-migrate-deploy.yml` : `drizzle-kit migrate`, jamais `push`. `push` contournerait les déclencheurs des tables en ajout
   seul : registre des décisions, preuves de consentement, journaux. Staging d'abord, puis production après approbation.

## 3. Premier administrateur

La production n'a pas d'administrateur « par variable d'environnement ». Le premier compte nominatif est créé par le propriétaire, depuis son
poste, contre la base déployée :

```bash
DATABASE_URL='…' node scripts/admin-bootstrap.mjs --confirm-host <hôte de la base>
```

- l'hôte est saisi une seconde fois et doit correspondre à `DATABASE_URL` ;
- la connexion à une base distante exige un certificat TLS valide ;
- le script refuse s'il existe déjà un administrateur (`--additional` pour un compte nominatif supplémentaire, journalisé comme tel) ;
- une personne = un compte (attestation + refus d'un second compte au même nom) ;
- le mot de passe (12 caractères minimum) est saisi deux fois, jamais affiché ni écrit ;
- une seule transaction : le compte et la ligne de journal `ADMIN_ACCOUNT_BOOTSTRAP`. La MFA est configurée à la première connexion
  (le serveur doit avoir `ADA_VAULT_KEY`).

## 3 bis. Ordre de la première mise en service

Chaque étape attend la précédente ; aucune ne se lance d'ici sans l'autorisation du propriétaire.

1. **Propriétaire** : générer des secrets neufs pour chaque fournisseur (aucune valeur reprise d'une installation antérieure).
2. **Base** : une base Neon vide, région UE ; `db-migrate-deploy.yml` (staging, puis production) applique les migrations (`drizzle-kit migrate`).
   Puis le **référentiel territorial officiel** (INSEE COG 2026 + EPCI, livré dans `data/geography`) : `DATABASE_URL=… npx tsx scripts/geo-load.mjs`
   (sans réseau, idempotent, ne supprime rien ; sortie `GEO_LOAD_RESULT {"ok":true…}`). Sans lui aucune commune n'est reconnue (assistant, recherche par
   territoire) ; `/api/health/deep` signale alors `TERRITORY_REFERENCE_MISSING` à l'administrateur.
3. **Configuration** : les variables de `.env.example` ; `node scripts/release-preflight.mjs` sort 0.
4. **Preview** : les contrôles du § 4, tous au vert.
5. **Premier administrateur** (§ 3) ; MFA à la première connexion.
6. **Contenus** : `scripts/content-transfer.mjs` depuis le LAB, essai puis `--apply` (`docs/runbooks.md` § 7). Rien n'est encore public.
7. **Veille** planifiée (§ 4, point 12) ; les premières fiches deviennent publiques quand elle les a vérifiées (`/admin/veille`).
8. **Sauvegarde** chiffrée et exercice de restauration (`docs/runbooks.md` § 4) avant l'ouverture.
9. **Ouverture** : décision du propriétaire (GO LIVE) ; `MAINTENANCE_MODE` retiré.

## 4. À vérifier sur le premier déploiement preview

Ce sont des hypothèses **non vérifiables hors ligne** ; chacune est bloquante si elle échoue.

1. **Adresse du client** (limites de connexion, preuves de consentement). Envoyer une requête vers `/api/health` avec les en-têtes forgés
   `X-Forwarded-For: 203.0.113.77` et `X-Vercel-Forwarded-For: 203.0.113.77`. Dans les journaux Vercel, la ligne `Request received` doit
   montrer la vraie adresse, pas `203.0.113.77`. Sinon, arrêt : les limites pourraient être contournées (`api/_utils/client-ip.js`).
2. **Cartes de sources (source maps)** : `/assets/*.map` doit répondre 404.
3. **CSP** : parcourir les pages principales (carte comprise) ; aucun `csp.violation` ne doit apparaître dans les journaux pour un usage normal.
   Les rapports arrivent sur `/api/monitor/csp-report` : directive, origine bloquée et chemin seulement.
4. **Configuration** : `/api/health/deep` (administrateur) → `config.productionReady: true`.
5. **Fonctions** : la liste des fonctions du déploiement ne doit contenir ni test ni `api/server.js` (`.vercelignore`). Les modules de `api/lib/`
   restent des fonctions sans export par défaut : un appel direct répond une erreur, sans donnée.
6. **Fichiers lus à l'exécution** : la recherche (synonymes), `/api/docs/openapi.json` et `/api/status` répondent normalement (`includeFiles`).
7. **Région** : les fonctions s'exécutent à `fra1`.
8. **Planification** : la vérification d'état toutes les 5 minutes (`/api/cron/health-alert`) exige le forfait Vercel Pro ; sur le forfait gratuit, le
   déploiement refuse ce rythme. Choisir le forfait, ou espacer cette tâche.
9. **Plan du site** : `/sitemap.xml` est le plan dynamique (il n'y a plus de fichier statique qui le masquait).
10. **Maintenance** : `MAINTENANCE_MODE=1` sur la preview → chaque page répond 503 avec la page de maintenance ; l'API et `/api/health` répondent toujours.
11. **Surveillance externe** : le flux `healthcheck.yml` (toutes les 30 minutes) passe au vert sur la nouvelle version.
12. **Vérification automatique (veille) en production** : `/api/cron/veille` existe mais **n'est pas planifiée** dans `vercel.json`. Sans elle, aucune
    fiche (transférée du LAB ou importée) ne devient publique : la publication exige une vérification de cet environnement (D-5 v2). Sur la preview :
    l'appeler une fois avec `Authorization: Bearer <CRON_SECRET>`, vérifier son statut (`success` ou `partial`) et sa durée (4 minutes par passage,
    `ADA_VEILLE_MAX_MINUTES` ; `maxDuration` 300 s = forfait Pro), puis la planifier (proposition : `*/30 1-4 * * *`, huit passages par nuit). Les textes
    faciles à lire ne s'écrivent pas en production (aucun modèle) : ils viennent du LAB (`scripts/content-transfer.mjs`, `docs/runbooks.md` § 7).

## 5. Retour arrière

1. Vercel → Deployments → déploiement précédent → « Promote to Production » ; vérifier `/api/health`.
2. Base : les migrations sont compatibles avec la version précédente (ajouts seulement). Si une restauration est nécessaire, voir
   `docs/runbooks.md`.

## 6. Décisions du propriétaire encore ouvertes

- **HSTS `preload`** : l'en-tête contient `preload`. Inscrire le domaine sur hstspreload.org est quasi irréversible (plusieurs mois) et impose
  HTTPS à tous les sous-domaines. Garder ou retirer le jeton avant le lancement.
- **Modèle cookies (décision 21)** : le bandeau actuel est l'option A (information, mesure d'audience exemptée, opposition sur `/cookies`). Si un
  traceur soumis au consentement est retenu, le bandeau devient un vrai choix (option B, LEGAL_FR § 4.3).
- **Visio** : aucun fournisseur choisi ; la visio reste désactivée (contrat, hébergement UE, AIPD, sécurité).
- **Forfait Vercel** : la veille de production (passages de 4 minutes, `maxDuration` 300 s) et le contrôle de santé toutes les 5 minutes supposent le forfait
  Pro ; sur le forfait gratuit, la veille ne passerait qu'une fois par jour au mieux (§ 4, points 8 et 12).
- **Preuve des mandats légaux** (tuteur, curateur, représentant) : la vérification n'est pas conçue ; ces délégations restent « preuve requise » et
  n'ouvrent rien.
- **Image Docker** : corrigée mais jamais construite ici (Docker absent du LAB) ; à construire et tester si l'auto-hébergement est retenu (Q12).
- **Pré-rendu des pages publiques** (`ENABLE_PRERENDER=1`) : sans lui, le HTML initial de toutes les pages porte le canonical `/` (remplacé dans le
  navigateur par celui de la page). À activer quand le catalogue vérifié est en place ; mesurer la durée de construction.
- **zod 4** : fait en R7 (zod 4.6.7, avis GHSA-mrhx-c7xc-m3w5 fermé ; `npm audit --omit=dev` : 0).

## 7. Infrastructure prévue

| Service | Fournisseur | Condition |
|---|---|---|
| Site + API | Vercel | région UE, contrat de traitement (DPA) |
| Base de données | Neon (PostgreSQL) | région UE, TLS vérifié, sauvegardes avec restauration testée |
| Limites de débit, sessions | Upstash KV | région UE |
| Stockage de fichiers | S3 compatible | région UE, DPA |
| Erreurs | Sentry | région UE (`*.ingest.de.sentry.io`), DPA, Session Replay désactivé |
| E-mail | Resend | DPA |
| IA | aucune en production | modèle local (Ollama) sur le LAB seulement |

## 8. Staging (pré-production) : configuration requise

Aucun staging n'existe encore ; rien ici ne s'y connecte. La répétition locale équivalente (`scripts/transfer-rehearsal.mjs`, base neuve et jetable sur un
PostgreSQL local, `docs/runbooks.md` § 7 bis) a réussi ses 10 étapes le 25/10/2026, avec et sans réseau. Pour un vrai staging, il faut :

1. **Base** : une base PostgreSQL séparée de la production (Neon, région UE, branche ou projet distinct), TLS vérifié, sauvegarde activée ; migrations
   par `db-migrate-deploy.yml` (environnement GitHub `staging`), jamais `push`. Les mêmes migrations que le LAB, sinon l'import refuse.
2. **Variables** : celles de `.env.example` marquées `[REQUIRED-PROD]`, avec des valeurs **propres au staging** (aucun secret partagé avec la production
   ni repris de l'ancienne version) : `DATABASE_URL`, `JWT_SECRET`, `ADA_ENCRYPTION_KEY`, `ADA_VAULT_KEY`, `CRON_SECRET`, `APP_BASE_URL` (https),
   KV (`KV_REST_API_URL`/`KV_REST_API_TOKEN`), stockage S3, `ALERT_WEBHOOK_URL` (un canal de staging), Sentry UE. `ADA_PUBLIC_CONTENT_MODE` n'est
   pas `lab`. `node scripts/release-preflight.mjs` sort 0.
   Référentiel territorial : `npx tsx scripts/geo-load.mjs` sur la base de staging (même commande qu'en production, § 3 bis point 2).
3. **KV obligatoire dès deux instances** : sans KV, les limites de débit sont comptées dans la mémoire de chaque instance (`api/_utils/rateLimit.js`) ;
   avec plusieurs instances une adresse dispose de plusieurs quotas (connexion, MFA, formulaires). Le staging doit utiliser KV pour que la mesure soit juste.
4. **Veille** : `/api/cron/veille` planifiée (§ 4, point 12) ; `ADA_VEILLE_CACHE_DIR=/tmp/veille-cache` (le répertoire temporaire de la fonction :
   les fichiers FINESS+, environ 110 Mo compressés par jour, y sont téléchargés en flux et vérifiés par SHA-1 ; lecture en flux, environ 10 s et 200 Mo
   de mémoire mesurés sur le LAB). Sans cache persistant, le fichier du jour est retéléchargé à chaque passage : prévoir le forfait qui le permet.
5. **Contenus** : `scripts/content-transfer.mjs export` depuis le LAB, puis `import --target-env staging --confirm-target <hôte/base>` en aperçu, puis
   `--apply` ; garder le reçu. Rien n'est public tant que la veille du staging n'a pas vérifié chaque fiche (D-5 v2, aucune approbation par fiche).
   Les textes faciles à lire viennent du LAB (pas de modèle en staging) : une fiche dont les textes doivent être réécrits reste non publiée.
6. **Alerte** : un exercice une fois configuré — `ALERT_VEILLE_STALE_HOURS=0` sur une exécution de `/api/cron/health-alert` → une alerte « veille »
   en français arrive sur le canal de staging, une seule pendant la période de silence (`tests/integration/alert-drill-db.test.js` fait le même
   exercice localement). Remettre la variable à vide ensuite.
7. **Mesures** : `node scripts/load-budget.mjs --base https://<staging>` depuis plusieurs postes (sur Vercel l'adresse du client vient de la plateforme :
   un seul poste = un seul client, les limites répondent 429). Budgets et méthode : `docs/performance-budgets.md`.
8. **Retour arrière** : `scripts/content-transfer.mjs rollback --receipt <reçu>` (retire ce que l'import a inséré et que le staging n'a pas vérifié),
   déploiement précédent (§ 5), restauration de la sauvegarde (`docs/runbooks.md` § 4).


## 9. Pages publiques et plusieurs instances (R11)

- **P22 — HTML initial des fiches** : `/aides|demarches|dispositifs|structures/<slug>` sont réécrites vers `/api/public/page` (`vercel.json`) ; la réponse
  contient déjà l'adresse canonique, le titre, la description et un résumé lisible, calculés **à la requête** depuis la base avec la règle de visibilité de
  l'API : 200 (indexable) pour une fiche publique, **410** (noindex, rien de la fiche) pour une fiche retirée ou expirée, 404 pour une fiche jamais publiée ou
  inconnue, 301 de `/annuaire/<slug>` vers `/structures/<slug>`. Cache partagé 300 s au plus (ETag de l'état de la fiche) : une correction ou un retrait de la
  veille arrive dans le HTML en quelques minutes. Rien n'est construit d'avance (`scripts/prerender.mjs` ne rend plus de fiche ; `scripts/generate-sitemap.mjs`
  n'écrit plus de copie statique) : temps et taille de construction inchangés. Le plan du site (`/sitemap.xml`) liste les adresses canoniques publiques seulement.
  À vérifier au premier déploiement : que `dist/index.html` est bien inclus dans la fonction (`includeFiles`) — sinon la fonction lit la copie statique du site.
- **Q11 — plusieurs instances** : verrous en base (veille), compteurs partagés en KV (limites de débit, MFA), session révoquée en base, cooldown d'alerte atomique
  (`SET NX`). Vérifié en **simulation locale** seulement (`scripts/q11-multi-instance.mjs` : deux instances, une base jetable, un magasin compatible Upstash local),
  pas sur Vercel ni Upstash réels. KV indisponible : en production l'authentification échoue fermée (503) et la recherche publique reste ouverte ; le contrôle
  de santé signale la panne et délivre son alerte sans KV. Interrupteurs d'arrêt : cache par instance de 15 s au plus.
