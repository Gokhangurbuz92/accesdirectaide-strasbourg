# Vérification automatique en production (D-5 v2) — architecture

Statut : conception vérifiée localement (LAB, bases jetables, simulation multi-instance Q11). **Rien n'est activé, acheté ni déployé.**
Les chiffres viennent des exécutions mesurées dans le LAB du 25 et du 26/10/2026 (`CronRun` `veille`) et de la répétition D05 sur une copie jetable du LAB.

## 1. Principe : la cible vérifie elle-même

- Une fiche importée (transfert LAB → cible, `scripts/content-transfer.mjs`) arrive **non publiée et non vérifiée**. Elle n'est publiée que par la veille
  **de la cible**, avec sa propre décision dans le registre `ContentVerification` (relecteur `ada-veille-automatique`, rôle `system`) et sa preuve officielle.
  Répétition : `scripts/transfer-rehearsal.mjs` (étapes 6 à 9).
- Le contrat de publication est versionné : `api/_services/verification/audit.js` `CONTRACT` (D-5 v2, **version 2** : LEDGER, EVIDENCE, PRIVACY, FRESHNESS,
  DUPLICATE, TEXTS). Il est contrôlé à la fin de chaque veille sur la base elle-même ; LEDGER, EVIDENCE, PRIVACY et TEXTS retirent la fiche immédiatement.
- L'ancien contrôle WS2 (`tests/unit/ws8-frozen-launch-data.test.js`, fichiers de départ marqués par une personne) reste exécuté tel quel, comme preuve
  historique : ses 2 échecs restent des **KNOWN_FAIL** signalés comme tels, jamais comme réussite. Il n'est pas le contrat de mise en production : celui-ci
  est le contrat D-5 v2 sur les fiches vivantes (`tests/unit/d5v2-publication-contract.test.js`).

## 2. Les textes suivent la version exacte de la source

- Chaque texte écrit par la chaîne (résumé, FALC) garde la **marque de la source** dont il vient (`auto_check.texts.sourceMark`, `sourceFingerprint`).
  Si la source a changé de façon importante depuis, la fiche est **retirée** tant que ses textes ne sont pas réécrits (jamais un ancien texte présenté
  comme actuel) ; la clause TEXTS du contrat v2 le vérifie aussi a posteriori (textes antérieurs à la dernière modification importante → retrait).
- Les textes des fiches d'identité (SIRENE, Annuaire, FINESS, data·inclusion) sont **déterministes** (aucun modèle) et réécrits dans la même modification
  que les faits dont ils parlent.

## 3. Mises à jour structurelles et contenu qui demande un modèle

| Travail | Besoin | Mesure LAB | En production |
|---|---|---|---|
| Identité d'une structure (SIRENE) | réseau, ~0,6 s / fiche | 489 contrôles + 100 créations en 305 s (répétition D05) | lots bornés, sans modèle |
| Annuaire, FINESS (fichier du jour) | réseau, flux | FINESS : 2 fichiers ≈ 100 Mo compressés, lecture en flux ; 150 créations en 43 s | 1 lot / jour |
| data·inclusion (export hebdomadaire) | réseau, 294 Mo, lecture en flux | lecture 1,5 s, 160 Mo de mémoire ; 100 créations vérifiées par nuit au plus | 1 lot / semaine |
| Textes des aides / démarches (modèle) | modèle local | ≈ 110 s / fiche (qwen3:8b sur le Mac du LAB : 13 fiches en 1 491 s) | **pas de modèle** par défaut |

- **Sans modèle** (R12), une fiche déjà publique dont la source a changé **reste en ligne** avec un **extrait mot pour mot de la nouvelle version de la source**
  (attribué, daté ; Licence Ouverte 2.0) à la place de son résumé ; les textes écrits à partir de l'ancienne version (résumé, FALC, étapes, montants) sont retirés.
  Une première publication attend toujours ses textes. `ADA_VEILLE_TEXT_FALLBACK=withdraw` rétablit le retrait. La veille le dit : alerte `TEXTS_WAITING_MODEL`
  (nombre de fiches, raison) et, sur la fiche, la note « le résumé est pour l'instant un extrait mot pour mot de la fiche officielle ». C'est **récupérable** : (a) la veille du LAB écrit les textes, le transfert les apporte avec leur marque
  de source, la veille de la cible les publie seulement si la source est encore la même ; ou (b) un modèle hébergé — décision et coût du propriétaire, non activé.
- La production ne dépend pas d'un Mac interactif : la veille est une fonction planifiée (`/api/cron/veille`, `ADA_VEILLE_MAX_MINUTES`, reprise par les fiches
  vérifiées depuis le plus longtemps). Le Mac du LAB n'apporte que l'option (a).

## 4. Fraîcheur et expiration

- Intervalles : fichier lu chaque nuit 20 h ; page d'un site 44 h ; identité SIRENE 164 h ; date proche dans la source 20 h (`tierOf`). Une fiche non revérifiée
  dans son intervalle + 2 jours déclenche FRESHNESS (alerte, pas un retrait : elle était juste au dernier contrôle).
- Expiration publique : `visibleWhere` exige une vérification de moins de `maxAgeDays` ; au-delà la fiche disparaît (404/410 : P22) — jamais en silence :
  l'alerte FRESHNESS et `veille.stale` (contrôle de santé toutes les 5 min, seuil 48 h) préviennent avant.
- Services data·inclusion : non affichés si leur producteur ne les a pas mis à jour depuis 730 jours (comptés, réaffichés à la mise à jour).

## 5. Plans d'hébergement (Vercel) — à vérifier à l'activation

- **Hobby** : une tâche planifiée au plus **une fois par jour** (heure approximative). Le `vercel.json` actuel planifie `health-alert` toutes les 5 minutes et
  d'autres tâches toutes les 6 heures : **incompatible avec Hobby** en l'état. Sur Hobby il faudrait une veille quotidienne unique (lots par flux en tournant
  sur les jours) et un contrôle de santé externe — non conçu ici.
- **Pro** : planification à la minute ; veille toutes les heures en lots de 4 min (`ADA_VEILLE_MAX_MINUTES=4`) : ~300 contrôles SIRENE par lot couvrent la
  charge quotidienne mesurée (≈ 70 identités SIRENE / jour avec l'intervalle hebdomadaire, plus les flux du jour) avec marge.
- Durée maximale d'une fonction et taille de `/tmp` : à confirmer sur la documentation du plan choisi au moment de l'activation. Contraintes mesurées : un
  lot ne doit pas lire FINESS (≈ 100 Mo) et data·inclusion (294 Mo) dans la même exécution ; lancer `only=['finess']` et `only=['datainclusion']` séparément.
- Concurrence : une seule veille à la fois (verrou de base, simulé à deux processus : Q11 S6b) ; une alerte de santé n'est envoyée qu'une fois pour plusieurs
  instances (cooldown atomique, Q11 S6a) ; les tentatives réseau sont bornées (KV 3 s, sources 30 s à 15 min selon le fichier).

## 6. Ce qui reste au propriétaire

Choix du plan d'hébergement ; clés et secrets de production ; activation de la planification ; décision sur un modèle hébergé (option b) ou sur le
transfert depuis le LAB (option a) ; canal d'alerte réel (`ALERT_WEBHOOK_URL`).
