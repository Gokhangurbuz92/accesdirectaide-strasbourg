# Procédures d'exploitation — AccesDirectAide

> Mis à jour le 25/10/2026 (campagne de remédiation 35–71). Les commandes s'exécutent depuis la racine du dépôt. Aucune ne s'exécute toute seule
> contre la production : la personne qui intervient fournit l'environnement.

## 1. Mettre le site en maintenance

- **Activer** : Vercel → Settings → Environment Variables → `MAINTENANCE_MODE=1`, puis redéployer la même version (le middleware lit la variable).
- **Effet** : chaque page répond 503 avec une page simple (numéros d'urgence compris), `Retry-After: 3600`, jamais mise en cache. L'API, les contrôles
  de santé et les fichiers statiques continuent de répondre.
- **Désactiver** : retirer la variable (ou `0`) et redéployer. La porte `release-preflight` signale `ops.maintenance_off` tant qu'elle est active.

## 2. Base de données indisponible ou corrompue (Neon)

1. `/api/health` répond mais `/api/health/deep` est en 503 : vérifier la page d'état du fournisseur.
2. Mettre le site en maintenance (§ 1) si l'indisponibilité dure.
3. Données corrompues : restauration à un instant donné (PITR) dans la console du fournisseur, vers une **nouvelle** branche ; vérifier ; basculer
   `DATABASE_URL`.
4. Copie indépendante : restaurer la dernière sauvegarde chiffrée (§ 4) dans une base vide, vérifier, puis basculer.
5. R44 / E15 — **après toute restauration (PITR ou copie)**, avant la bascule : rejouer les effacements terminés depuis l'instant restauré (§ 4,
   « Rejeu des effacements »), puis relancer la purge de conservation (ses étapes sont idempotentes ; elle reste un essai à blanc tant que la politique
   n'est pas approuvée).

## 3. KV (Upstash) indisponible

En production, la connexion, l'inscription, les rendez-vous, le contact et l'administration **refusent** (fermeture sûre) sans KV : c'est voulu.
Vérifier la page d'état d'Upstash ; si la clé est en cause, la remplacer (Vercel → variables) et redéployer.

## 4. Sauvegarde et restauration (chiffrées)

- **Sauvegarder** : `BACKUP_ENCRYPTION_KEY=<64 hex> DATABASE_URL=… node scripts/db-backup.mjs --out <dossier> --label prod`
  → `ada_prod_<date>.dump.enc` (AES-256-GCM, 0600) et son `.sha256`. La clé de sauvegarde n'est jamais `ADA_ENCRYPTION_KEY` et se garde hors des
  sauvegardes.
- **Vérifier** : `node scripts/db-backup.mjs --verify <fichier> [--work-dir <dossier privé>]` (empreinte, étiquette GCM, archive lisible).
- **Restaurer** : `TARGET_DATABASE_URL=… node scripts/db-restore.mjs --file <fichier> --confirm-target <hôte>/<base> --work-dir <dossier privé>` — dans
  une base **vide** (sinon `--into-nonempty`, qui remplace les objets de la sauvegarde : jamais en Production). R45 : l'archive déchiffrée est écrite
  dans `--work-dir` (dossier 0700, de préférence sur un volume chiffré ; refusé s'il est modifiable par d'autres) et **supprimée même en cas d'échec** ;
  elle est relue par `pg_restore --list` **avant** de toucher la cible ; le résultat donne le nombre de tables, de lignes d'historique des migrations et
  la date de la sauvegarde (lue dans son nom).
- **Vérifier le schéma restauré** (R45) : `DATABASE_URL_UNPOOLED=<base restaurée> node scripts/db-deploy-migrate.mjs --check` (lecture seule ;
  `--lab-rehearsal` en plus pour une base locale `…_test`) : une ligne par migration appliquée (43 à 0042, 44 après 0045), empreintes, aucune dérive,
  0043/0044 jamais appliquées.
- **Rotation des fichiers** (R44 / E15) : `--list <dossier>` liste et calcule le plan de rotation : toutes les sauvegardes des 30 derniers jours, plus la
  plus récente de chacune des 4 semaines précédentes, et toujours la plus récente. Ces valeurs viennent de la politique de conservation versionnée
  (`api/_services/retention-policy.js`), aujourd'hui **PROPOSED — NOT APPROVED** : tant qu'elle n'est pas approuvée, `--prune` exige un `--keep-days`
  explicite (choix de l'opérateur) ; rien n'est supprimé sans `--prune`. Options : `--keep-days N`, `--keep-weekly W`.
- **Registre des effacements** (R44 / E15) : à chaque sauvegarde, exporter aussi
  `BACKUP_ENCRYPTION_KEY=… DATABASE_URL=… node scripts/db-erasure-replay.mjs --export --out <dossier>` → `ada_erasures_<date>.json.enc` (chiffré, 0600 :
  identifiant de la demande, identifiant de la personne, date, domaines — ni nom, ni e-mail, ni contenu). Il se garde et tourne avec les sauvegardes.
- **Rejeu des effacements après une restauration** (R44 / E15) : avec le registre le plus récent (exporté de la base vivante si elle est lisible,
  sinon le dernier fichier) et la date de la sauvegarde restaurée :
  `BACKUP_ENCRYPTION_KEY=… TARGET_DATABASE_URL=… node scripts/db-erasure-replay.mjs --ledger <fichier> --since-backup <fichier .dump.enc restauré> --confirm-target <hôte>/<base>`
  (ou `--since <date ISO>`). R45 — registre version 2 : en plus des effacements, il contient les **retraits de message** de rendez-vous et les
  **protections** en vigueur (gels légaux actifs, limitations art. 18 actives, demandes d'accès ouvertes). Le rejeu rétablit d'abord les protections,
  puis rejoue les effacements, puis efface de nouveau les messages retirés ; un registre exporté **avant** la sauvegarde restaurée est refusé. Un gel
  présent mais levé dans la copie restaurée est compté pour décision humaine, jamais réactivé seul.
  → essai à blanc : combien de personnes effacées sont revenues ; puis la même commande avec `npx tsx` et `--execute` : effacement par le moteur DSR
  de l'application (mêmes domaines, refus en cas de gel légal, journal `DSR_DELETE_COMPLETED`) et la demande d'effacement réinscrite (`REPLAYED_AFTER_RESTORE`).
  Une personne sous gel légal dans la copie restaurée est comptée, pas effacée : décision humaine.
- L'ancienne tâche `cron/backup-db` (copie JSON en clair) est retirée.
- Exercice de restauration : au moins une fois avant le lancement, puis après chaque changement de schéma important.
  Répétition LAB (R45, données **synthétiques**, ce n'est pas une restauration de Production) :
  `node --import tsx scripts/lab/r45-restore-rehearsal.mjs --out <dossier de preuves> --work <dossier privé>` (cluster local 127.0.0.1:55434, bases
  `ada_r45_ops_*_test`, clé jetable détruite à la fin). Plan Production : `STRASBOURG_FULL_PRODUCT_PLAN/CONTROL/r45/R45_PRODUCTION_RESTORE_PLAN_FR.md`.

## 5. Rotation des clés de chiffrement

`ADA_ENCRYPTION_KEY` a fui dans l'historique Git : elle doit être remplacée **sans écraser l'ancienne** :

1. nouvelle clé en `ADA_ENCRYPTION_KEY`, l'ancienne en `ADA_ENCRYPTION_KEY_PREVIOUS` (déchiffrement seulement) ; déployer ;
2. `node --import tsx scripts/rc5-rewrap-keys.mjs --all` (essai), puis `--all --apply` ;
3. `rotationStatus.safeToRetireOldKeys: true` → retirer l'ancienne clé ; **garder une copie hors ligne** tant que des sauvegardes antérieures existent.

Depuis le 25/10/2026, la rotation couvre aussi les valeurs de l'ancien format v1 (messages de rendez-vous, coordonnées des rendez-vous, anciens
fichiers). Avant, elles devenaient illisibles dès la promotion d'une nouvelle clé. Une valeur qu'aucune clé n'ouvre est comptée à part
(`unreadableLegacy`) : elle était déjà illisible.

## 6. Alertes

- **Canal d'alerte** : `ALERT_WEBHOOK_URL` (https) **ou** `ALERT_EMAIL` avec un vrai fournisseur d'e-mail (`MAILER_PROVIDER` = `resend`, `mailjet` ou
  `msgraph` ; `noop` ne délivre rien). La porte de pré-lancement (`scripts/release-preflight.mjs`, contrôle `alerts.webhook`) exige l'un des deux dès
  qu'une tâche planifiée est ouverte. Le contrôle de santé (`/api/cron/health-alert`) tourne **toutes les heures, minute 7** : sur Neon Free, un contrôle
  toutes les 5 minutes empêcherait la base de se mettre en veille et épuiserait le quota mensuel de calcul. Une même alerte n'est envoyée qu'une fois par heure.
- **Tâches planifiées** (RA-03) : chaque tâche écrit une ligne `CronRun` (historique : `/admin/sync`). Le contrôle de santé juge chaque tâche ouverte
  séparément : `job.failed.<tâche>` (la dernière exécution a échoué) et `job.stale.<tâche>` (aucune exécution réussie depuis plus de deux intervalles
  + 1 h : actualites 13 h, tâches quotidiennes 49 h, ingest-structures 337 h ; ou tâche ouverte qui n'a jamais tourné après ce délai). Voir § 13.
- **Signaux de sécurité** (RA-01) : connexions refusées, codes MFA refusés, exports — fenêtre de 70 minutes (intervalle du contrôle + 10 minutes de
  recouvrement, `ALERT_SECURITY_WINDOW_MINUTES`), prolongée jusqu'au contrôle précédent si une exécution a été retardée ; un même épisode n'est pas alerté deux fois.
- **Erreurs** : Sentry, région UE (`o<id>.ingest.de.sentry.io`), erreurs seulement (R5-S1) : aucune trace de performance par défaut (côté serveur seulement si `SENTRY_SERVER_TRACING=on` **et** `SENTRY_TRACES_SAMPLE_RATE` > 0 ; jamais côté navigateur), Session Replay désactivé, envoi seulement depuis un déploiement Vercel Production.
- **Externe** (C1) : `.github/workflows/healthcheck.yml`, au plus une fois par heure depuis GitHub (GitHub peut retarder ou abandonner une exécution
  planifiée : une seule exécution sur 11 heures observée le 17/11/2026), lectures publiques seulement ; échec de la 2e exécution consécutive = e-mail
  GitHub au propriétaire (puis toutes les 6), ou dès la 1re quand l'exécution précédente date de plus de 2 heures. Il signale l'absence du contrôle interne quand la fonction, le planificateur ou le
  déploiement est arrêté. Il ne tourne qu'une fois poussé sur GitHub (`docs/ops/EXTERNAL_WATCHDOG.md`).
- **CSP** : les violations apparaissent dans les journaux (`csp.violation` : directive, origine bloquée, chemin). Un pic après un déploiement indique
  une ressource bloquée.
- **Veille automatique** (R8) : le contrôle de santé alerte (« veille.stale ») quand aucune veille ne s'est terminée depuis 48 h
  (`ALERT_VEILLE_STALE_HOURS`) : les fiches publiques ne sont alors plus revérifiées. Les anciens imports ne comptent plus comme une panne. Une alerte est
  envoyée même quand KV est injoignable (sans période de silence cette fois). **Exercice** : `ALERT_VEILLE_STALE_HOURS=0` le temps d'une exécution de
  `/api/cron/health-alert` → une alerte en français arrive, une seule pendant une heure.

## 7. Transférer les contenus du LAB vers une autre base (répétition, staging, puis production)

Les fiches préparées dans le LAB (sources officielles, textes faciles à lire écrits par le modèle local, registre des sources) passent dans une autre base
sans jamais y arriver « vérifiées ». Chaque import réel (staging, production) est une décision du propriétaire.

1. **Exporter** (une transaction en lecture seule) : `DATABASE_URL=<base du LAB> node scripts/content-transfer.mjs export --out <nouveau dossier>`.
   Seules les tables d'information publique partent (aides, démarches, structures, dispositifs, registre des sources). Ne partent jamais : l'état de
   vérification, les identités du personnel et les notes internes, les réglages professionnels d'une structure, les identifiants des connecteurs
   (`auth_config`), une adresse e-mail nominative (retenue et comptée), et aucune table de comptes, rendez-vous, dossiers, documents, journaux ou décisions.
2. **Aperçu** : `TARGET_DATABASE_URL=… node scripts/content-transfer.mjs import --from <dossier> --confirm-target <hôte>/<base> --target-env rehearsal|staging|production`.
   Rien n'est écrit ; l'aperçu compte les fiches à créer, celles déjà présentes (identiques, plus récentes dans la cible, plus récentes dans le LAB), les
   conflits, les liens introuvables, et relit chaque fiche. Un reçu (identifiants et empreintes seulement) est écrit dans le dossier.
3. **Importer** : la même commande avec `--apply` (une transaction ; une ligne `CONTENT_TRANSFER_IMPORT` au journal ; reçu `receipt-import-….json`).
4. **Retour arrière** : `node scripts/content-transfer.mjs rollback --receipt <reçu de l'import> --confirm-target <hôte>/<base> [--apply]` retire exactement
   les fiches de cet import encore inchangées et jamais vérifiées dans la cible ; il garde (et compte) les autres. Une fiche mise à jour par
   `--update-existing` se restaure depuis son historique (EntityVersion).

Refusé : la base source elle-même, d'autres migrations (même nombre mais pas les mêmes compris), un fichier ou une ligne modifiés après l'export, un champ
de type secret, une fiche en conflit avec une autre fiche de la cible (même slug, SIRET, FINESS, RNA ou source), un dispositif lié à une fiche introuvable.
Après l'import, rien n'est public : la veille automatique de la cible vérifie chaque fiche sur sa source officielle avant de la publier (décision D-5 v2,
décision enregistrée au nom du système, jamais d'une personne).

**Plus tard (textes réécrits dans le LAB)** : `node --import tsx scripts/content-transfer.mjs import … --apply --update-existing` met à jour les fiches « plus
récentes dans le LAB » par le chemin d'import versionné (ancienne version gardée, statut et vérification jamais écrits, fiche vérifiée retenue jusqu'à la
nouvelle vérification). Une fiche modifiée dans la cible depuis n'est jamais écrasée. Le registre des sources de la cible n'est jamais remplacé.

**Répétition du 25/10/2026** (base jetable, contenu réel du LAB lu sans écriture) : 15 aides, 10 démarches, 474 structures, 966 sources ; 1 465 fiches relues
identiques, 0 publiée, 0 identifiant de connecteur, 0 identité du personnel ; second import : tout gardé ; retour arrière : les 1 465 retirées.

**Prérequis en production** : la veille de la cible doit tourner (`/api/cron/veille`, voir `docs/deployment.md` § 4) — sinon aucune fiche transférée ne
devient publique.

## 7 bis. Répétition « équivalent staging » (locale, base jetable)

Avant un vrai staging, et après chaque changement du transfert ou de la veille :

```bash
SOURCE_DATABASE_URL='<base LAB>' REHEARSAL_ADMIN_URL='postgresql://<utilisateur>@127.0.0.1:<port>/postgres' ADA_VEILLE_CACHE_DIR=~/.ada-lab/veille-cache \
  node --import tsx scripts/transfer-rehearsal.mjs --out <répertoire neuf> [--network] [--keep]
```

Elle refuse tout PostgreSQL qui n'est pas local, crée une base neuve, la migre, puis : export (lecture seule), aperçu, échec au milieu d'un import (rien
d'écrit), conflit (refus), import (relu identique, rien de vérifié ni de public), réimport (rien d'inséré, une fiche modifiée dans la cible gardée), veille
de la cible (publication automatique sur preuve ; `--network` lit les sources officielles comme un staging), retrait par reçu, source inchangée. Le rapport
(`rehearsal-report.md` / `.json`) ne contient ni adresse, ni secret, ni contenu ; la base est supprimée à la fin (sauf `--keep`).

Résultat du 25/10/2026 (LAB : 15 aides, 10 démarches, 624 structures, 966 sources) : 10 étapes réussies hors ligne (150 fiches FINESS publiées par la veille de la
cible, les autres non publiées faute de source lisible) et avec réseau (621 structures publiées par la veille de la cible, 7 doublons écartés ; aides et
démarches non publiées tant que leurs textes ne sont pas réécrits par le modèle local).

## 7 ter. FINESS+ (établissements sanitaires, sociaux et médico-sociaux)

La veille lit chaque nuit les deux fichiers quotidiens de l'Agence du numérique en santé sur data.gouv.fr (« FINESS - Structures », « FINESS - Activités »,
Licence Ouverte 2.0) : téléchargés en flux, empreinte SHA-1 comparée à celle publiée, lus en flux (`api/_services/verification/finess.js`). Seuls les
établissements **ouverts** du Bas-Rhin, d'une catégorie d'accueil retenue (`finess-scope.js` : santé, santé mentale, addictions, hébergement et logement,
personnes âgées, handicap, famille, demandeurs d'asile), deviennent des fiches ; jamais les pharmacies, laboratoires, écoles, ni les services qui n'accueillent
que sur décision d'un juge ou de l'aide sociale à l'enfance. 150 nouvelles fiches au plus par nuit. Une fiche FINESS est retirée quand le répertoire la ferme
ou ne la liste plus ; si le fichier du jour est illisible, plus ancien que le précédent ou nettement plus court, rien ne change (nouvel essai la nuit suivante).

- **Libellés officiels** : `api/_services/verification/finess-terms.js`, généré par `node scripts/finess-terms.mjs` depuis le guide des terminologies de l'ANS.
  À relancer quand une nomenclature change (la version est dans le fichier).
- **Lancer seulement FINESS sur le LAB** : `node --import tsx scripts/lab-local.mjs veille --only finess,structure`.
- **RNA** : le Répertoire national des associations **exclut le Bas-Rhin**, le Haut-Rhin et la Moselle (droit local, registres des tribunaux) ; l'identité
  d'une association de Strasbourg vient de SIRENE.

## 7 quater. data·inclusion (offre d'insertion : structures et services)

- Source : export ouvert hebdomadaire sur data.gouv.fr (« Référentiel de l'offre d'insertion sociale et professionnelle — data·inclusion », Plateforme de
  l'inclusion, Licence Ouverte 2.0 : réutilisation libre avec mention de la source et de la date de mise à jour — mentionnées sous chaque service). Aucun compte.
- La veille (`--only datainclusion,structure`) télécharge les deux fichiers JSON avec contrôle SHA-1, les lit en flux, garde les lieux du département et
  n'en retient que l'identité et le lieu (ni description, ni téléphone, ni courriel, ni nom de personne). L'identité d'une fiche vient toujours d'un registre
  (SIRENE, Annuaire, FINESS). Chaque service affiché dit qui le dit : « selon France Travail » (opérateur public) ou « déclaré par la structure sur DORA ».
- Export écarté (plus ancien, beaucoup plus petit, illisible) : les services déjà affichés restent ; nouvel essai la nuit suivante.
- Retraits : un service absent de l'export disparaît de la fiche ; une fiche créée à partir de data·inclusion est retirée après deux exports sans elle.
- API restreinte (contacts, dédoublonnage, score de qualité) : jeton à demander à l'équipe data·inclusion (formulaire indiqué dans
  https://api.data.inclusion.gouv.fr/api/docs), à placer dans `DATA_INCLUSION_API_TOKEN` (secret). L'adaptateur (`apiStructures`, `apiServices`) ne garde
  jamais les contacts ; il n'est pas branché sur la veille tant que les conditions d'utilisation de l'API n'ont pas été acceptées par le propriétaire.
- Libellés : `node scripts/datainclusion-terms.mjs` (version du schéma épinglée ; à relancer volontairement si le schéma change).
- Import ponctuel pour l'Eurométropole (R6, commande du propriétaire) : `node --import tsx scripts/datainclusion-import.mjs` — **dry-run par défaut**
  (`--out plan.json --report rapport.md`, `--check-sirene` facultatif) ; `--apply --plan --confirm <12 car. de l'empreinte> --backup <dump.enc>` n'écrit que
  le plan relu. Il n'écrit jamais une fiche publique (la veille s'en charge par la voie de publication), crée les nouveaux lieux en **brouillon non vérifié**
  (`import_batch` = `datainclusion-import:<date d'export>`, publiés ou non par la veille comme toute fiche), met les rapprochements incertains dans la file
  de revue (`ReviewQueueItem`, raison `DATA_INCLUSION_DOUBLON_POSSIBLE`) et s'arrête si la licence du jeu de données n'est plus `lov2`.

## 7 quinquies. Notifications sur appareil (Web Push)

- Aucun fournisseur : le message est chiffré pour le navigateur (RFC 8291) et signé (VAPID, RFC 8292), puis remis au service de notification choisi par le
  navigateur. Indisponible tant que les trois secrets ne sont pas posés : `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`.
- Générer une paire : `node scripts/web-push-keys.mjs` (affichée une fois, à copier dans les secrets du déploiement ; ne jamais la committer). Changer de
  paire met fin à tous les abonnements existants.
- Ce que le site sait : « accepté par le service de notification », jamais « lu ». 404/410 du service : l'abonnement est supprimé ; trois échecs : FAILING.
- Données : l'adresse d'abonnement est scellée (`push-subscription`), supprimée avec le compte ; le message ne contient rien de personnel.

## 8. Fournisseur externe en panne (sources officielles, e-mail)

- Sources officielles : la veille automatique enregistre l'incident et réessaie la nuit suivante ; une fiche n'est jamais publiée sur une source
  injoignable.
- E-mail : un envoi non accepté par le fournisseur est enregistré comme non délivré (`NOT_SENT` / `NOT_DELIVERED`), jamais comme « envoyé » ; les
  écrans qui attendent un e-mail (par exemple le changement d'adresse) le disent à la personne.

## 9. Restaurer depuis les sauvegardes cloud (copie indépendante, V2 C7)

Les sauvegardes quotidiennes chiffrées et signées de la base de Production sont dans un compartiment R2 (tâche Scaleway `producer`,
`scripts/cloud-backup.mjs`) ; une tâche `verifier` séparée (`scripts/cloud-restore-verify.mjs`) restaure la plus récente dans une base jetable chaque
mois et dépose une preuve. Architecture, variables (noms) et coûts : `ops/cloud-backup/README.md`. C'est la voie à utiliser quand le fournisseur de la
base est lui-même en cause ; pour une erreur récente sur une base saine, la restauration à un instant donné de Neon (`docs/disaster-recovery.md`) est plus rapide.

1. **Geler les écritures** : fermer les surfaces citoyennes (variable Vercel) ou `MAINTENANCE_MODE=1` (§ 1), redéployer.
2. **Base cible vide** (nouvelle base Neon). Ne jamais restaurer dans la base de Production en place.
3. **Restaurer avec vérification des signatures** : `node scripts/cloud-restore-verify.mjs --confirm-target <hôte>/<base> --keep-restored`
   (variables du vérificateur : jeton R2 en lecture seule, clé privée de sauvegarde, clé publique de signature, `TARGET_DATABASE_URL`). Le script refuse de
   tourner si `DATABASE_URL` est présent. Il vérifie l'empreinte, la signature, les tables principales, l'historique des migrations (déduit du journal,
   `checks.migrationsDerived`) et le registre des effacements.
4. **Schéma** : `DATABASE_URL_UNPOOLED=<base restaurée> node scripts/db-deploy-migrate.mjs --check` (lecture seule).
5. **Rejouer les effacements** : `node scripts/db-erasure-replay.mjs --ledger <registre> --since-backup <sauvegarde> --confirm-target <hôte>/<base> --kv`
   à blanc, puis avec `--execute`. `--kv` est indispensable : les effacements postérieurs à la sauvegarde ne sont connus que par les marqueurs KV (40 jours).
6. **Avant de rouvrir** : relancer la purge de conservation sur la base restaurée (§ 11), puis pointer Vercel sur la base restaurée, redéployer, vérifier
   `/api/health` et `/api/health/ready`.
7. **Consigner l'incident** dans le registre des violations (§ 12) : une perte ou une indisponibilité de données personnelles ouvre le délai de 72 h.

## 10. Retour arrière d'une version (`scripts/release-production.sh`)

Une mise en production se fait uniquement par `QA_SUMMARY=<SUMMARY.json du QA natif de ce SHA> scripts/release-production.sh <sha>`, depuis un clone propre lié
au projet Vercel (les déploiements par git sont désactivés). Le script note le déploiement de production précédent **avant** de déployer.

- **Automatique** : si le test de fumée échoue (en-tête `x-release-sha`, `/api/health/ready`, une liste publique, page d'accueil), le script exécute
  `vercel rollback <déploiement précédent> --yes` (sans reconstruction) et sort avec le code **4**.
- **Déploiement non vérifié** (code **5**) : le script n'a pas pu établir que la production sert le nouveau SHA ; il affiche la commande
  `vercel rollback "<déploiement précédent>" --yes` à lancer par le propriétaire.
- **Après coup** (régression découverte plus tard) : Vercel → Deployments → déploiement précédent → « Promote to Production », ou
  `vercel rollback <url du déploiement> --yes` ; puis vérifier que `/api/health` renvoie le `x-release-sha` attendu.
- **Autres codes** : 2 = précondition (clone, SHA, preuve QA, analyse des secrets, cible de retour introuvable), 3 = CI GitHub absent ou en échec. Rien n'a été déployé.
- **Base de données** : un retour arrière du code ne défait aucune migration. Les migrations sont additives et compatibles avec la version précédente ;
  si un schéma doit être défait : `drizzle/rollback/NNNN_down.sql` selon `docs/database.md` (« Retour arrière »), après une sauvegarde chiffrée.
- **Variables d'environnement** : un retour arrière Vercel reprend le build précédent **avec ses variables d'alors** ; une variable changée depuis ne
  s'applique qu'au prochain déploiement.

## 11. Purge RGPD (`/api/cron/gdpr-purge`) : exploitation

La tâche est planifiée chaque jour à 03:00 UTC. Elle **ne supprime rien** tant que toutes les conditions ne sont pas réunies
(`api/_services/retention-policy.js`, `executionGate`) : `GDPR_PURGE_ENABLED=true`, politique de conservation approuvée pour sa version exacte,
`GDPR_PURGE_POLICY_VERSION` égal à cette version, étape listée dans `GDPR_PURGE_APPROVED_STEPS` **et** approuvée dans la politique. En bêta restreinte, la
tâche doit aussi être ouverte (`ADA_BETA_OPEN_JOBS`) et approuvée (`ADA_JOBS_APPROVED`).

- **Essai à blanc** (état par défaut, ou `?dryRun=1`) : réponse `skipped: true` avec la raison ; les **nombres par étape** sont écrits dans les journaux
  (« [gdpr-purge] dry run — counts only ») et, depuis RA-03, dans la ligne `CronRun` de la tâche (`metrics.mode = dry-run`, `metrics.counts`).
- **Exécution** : chaque étape dans sa propre transaction ; preuve dans le journal d'audit (`GDPR_PURGE_RUN` : version, étapes, nombres — jamais une
  valeur ni un identifiant de personne) ; ligne `CronRun` `success`, ou `partial` avec `failedSteps`.
- **Une étape a échoué** : lire `failedSteps` (`/admin/sync` ou journaux, message « retention step failed » avec l'étape). Les autres étapes ont été
  validées ; l'étape en échec n'a rien supprimé (transaction annulée). Corriger, puis attendre l'exécution suivante ou relancer la tâche.
- **Deux exécutions en même temps** : la seconde répond 409 `ALREADY_RUNNING` (ligne `CronRun` `skipped`) ; rien à faire.
- **Arrêt d'urgence** : retirer `gdpr-purge` de `ADA_BETA_OPEN_JOBS` ou mettre `GDPR_PURGE_ENABLED` à une autre valeur que `true`, puis redéployer.
- **Gels légaux et limitations** (art. 18) : les personnes concernées sont exclues par les étapes elles-mêmes ; rien à faire à la main.
- Une suppression est irréversible : avant d'approuver une nouvelle étape, lire les nombres de l'essai à blanc et vérifier qu'une sauvegarde récente existe (§ 9).

## 12. Registre des violations de données (RGPD art. 33)

Le registre réel est tenu **hors de ce dépôt public**. Son format est `docs/security/incident-register.schema.json`.

1. À la découverte d'un incident touchant des données personnelles (confidentialité, intégrité **ou** disponibilité) : créer une entrée — dates de
   détection et de prise de connaissance avec fuseau, canal, nature, cause, catégories de données, mesures. Le délai de notification à la CNIL est de
   **72 h** à partir de la prise de connaissance.
2. Valider : `node scripts/incident-register-validate.mjs <registre.json>` (codes et chemins JSON seulement, jamais le texte d'un champ). Sortie 0 = valide,
   1 = erreurs (délai dépassé encore « pending », décision CNIL ou information des personnes non justifiée, adresse ou téléphone dans un texte…), 2 = fichier illisible.
3. Décision de notifier ou non, information des personnes en cas de risque élevé, clôture : chaque décision est écrite avec sa raison dans l'entrée.
4. Ne jamais copier dans le registre une adresse, un numéro ou un contenu de dossier ; ne jamais déposer le registre dans le dépôt.

## 13. Une tâche planifiée échoue ou ne tourne plus

Alerte `job.failed.<tâche>` ou `job.stale.<tâche>` (§ 6), ou ligne en échec dans `/admin/sync`.

1. **Lire l'historique** : `/admin/sync` → statut (`failed`, `partial`, `skipped` avec sa raison), durée, `errorSample` (nom de l'erreur ou raison typée), `metrics`
   (nombres seulement).
2. **Lire les journaux** de la fonction à l'heure de l'exécution (Vercel → Logs, filtre sur le chemin `/api/cron/<tâche>`). Depuis RA-02, l'erreur
   complète (nom, message masqué, pile) accompagne le message.
3. **La tâche est-elle ouverte ?** En bêta restreinte, une tâche absente de `ADA_BETA_OPEN_JOBS` (et, pour les rappels, les délais d'orientation et la
   purge, de `ADA_JOBS_APPROVED`) est refusée avant d'atteindre son code : aucune ligne, aucune alerte — c'est l'état voulu.
4. **Causes fréquentes** : `CRON_SECRET` absent ou changé sans redéploiement (401 / 500) ; base injoignable (alerte `db.down` en même temps) ; fournisseur
   d'e-mail refusé (rappels en `partial`) ; source officielle en panne (§ 8) ; verrou d'une exécution précédente encore tenu (`skipped`, se libère seul).
5. **Relancer** (décision du propriétaire en Production) : `curl -H "Authorization: Bearer <CRON_SECRET>" https://<site>/api/cron/<tâche>`. Les tâches
   sont idempotentes (verrou ou revendication ligne par ligne) : une relance ne double ni un rappel ni une suppression.
6. **L'alerte s'arrête** à la première exécution réussie suivante. `health-alert` ne se surveille pas lui-même : son absence n'est visible que par la
   surveillance externe (§ 6) ou par sa ligne `CronRun` (une seule ligne `success`, la plus récente ; les lignes `partial` sont conservées).
