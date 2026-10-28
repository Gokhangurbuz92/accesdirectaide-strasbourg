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

## 3. KV (Upstash) indisponible

En production, la connexion, l'inscription, les rendez-vous, le contact et l'administration **refusent** (fermeture sûre) sans KV : c'est voulu.
Vérifier la page d'état d'Upstash ; si la clé est en cause, la remplacer (Vercel → variables) et redéployer.

## 4. Sauvegarde et restauration (chiffrées)

- **Sauvegarder** : `BACKUP_ENCRYPTION_KEY=<64 hex> DATABASE_URL=… node scripts/db-backup.mjs --out <dossier> --label prod`
  → `ada_prod_<date>.dump.enc` (AES-256-GCM, 0600) et son `.sha256`. La clé de sauvegarde n'est jamais `ADA_ENCRYPTION_KEY` et se garde hors des
  sauvegardes.
- **Vérifier** : `node scripts/db-backup.mjs --verify <fichier>` (empreinte, étiquette GCM, archive lisible).
- **Restaurer** : `TARGET_DATABASE_URL=… node scripts/db-restore.mjs --file <fichier> --confirm-target <hôte>/<base>` — dans une base **vide**
  (sinon `--into-nonempty`, qui remplace les objets de la sauvegarde).
- **Rotation des fichiers** : `--list <dossier> --keep-days 35` liste ; rien n'est supprimé sans `--prune`.
- L'ancienne tâche `cron/backup-db` (copie JSON en clair) est retirée.
- Exercice de restauration : au moins une fois avant le lancement, puis après chaque changement de schéma important.

## 5. Rotation des clés de chiffrement

`ADA_ENCRYPTION_KEY` a fui dans l'historique Git : elle doit être remplacée **sans écraser l'ancienne** :

1. nouvelle clé en `ADA_ENCRYPTION_KEY`, l'ancienne en `ADA_ENCRYPTION_KEY_PREVIOUS` (déchiffrement seulement) ; déployer ;
2. `node --import tsx scripts/rc5-rewrap-keys.mjs --all` (essai), puis `--all --apply` ;
3. `rotationStatus.safeToRetireOldKeys: true` → retirer l'ancienne clé ; **garder une copie hors ligne** tant que des sauvegardes antérieures existent.

Depuis le 25/10/2026, la rotation couvre aussi les valeurs de l'ancien format v1 (messages de rendez-vous, coordonnées des rendez-vous, anciens
fichiers). Avant, elles devenaient illisibles dès la promotion d'une nouvelle clé. Une valeur qu'aucune clé n'ouvre est comptée à part
(`unreadableLegacy`) : elle était déjà illisible.

## 6. Alertes

- **Webhook** : `ALERT_WEBHOOK_URL` (obligatoire, porte de pré-lancement) reçoit les alertes de santé (toutes les 5 minutes) et les échecs des
  tâches d'import.
- **Erreurs** : Sentry, région UE, 10 % des traces de performance (`SENTRY_TRACES_SAMPLE_RATE`), Session Replay désactivé.
- **Externe** : `.github/workflows/healthcheck.yml`, toutes les 30 minutes ; un échec envoie un e-mail au propriétaire du dépôt.
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
