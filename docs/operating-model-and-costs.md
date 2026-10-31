# Modèle d'exploitation et coûts (Q13, relevé du 31/10/2026)

Ce document dit qui fait quoi pour faire tourner AccesDirectAide Strasbourg pendant la bêta publique, à quel rythme, avec quels outils, et ce que
cela coûte. Il est tiré de la configuration réelle (voir `production-hosting.md`) ; les montants sont mesurés, jamais estimés. Ce qui n'est pas
mesurable depuis le dépôt (abonnement du domaine, temps passé par des personnes) est dit comme tel.

## 1. Rôles

| Rôle | Tenu par | Responsabilités |
|---|---|---|
| Éditeur (responsable de la publication) | le porteur du projet | décisions juridiques et de publication, comptes des prestataires, accords et signatures, réponses aux personnes (`contact@`) |
| Opérateur technique | le LAB (Mac de l'éditeur, outillage du dépôt) | veille des sources, ingestion des actualités, mises en production, retours arrière, surveillance des coûts |
| Vérification automatique | le code (`api/_services/verification/*`, `api/_services/news-verification.js`) | ne publie que ce qui passe toutes les vérifications ; retire ce qui ne les passe plus ; écrit ses raisons sur chaque fiche |

Personne n'est présenté comme relecteur d'un contenu qu'il n'a pas relu : une publication automatique le dit (« Aucune relecture humaine »).

## 2. Tâches récurrentes

| Tâche | Rythme | Commande / outil | Durée mesurée | Coût |
|---|---|---|---|---|
| Veille D-5 v2 (aides, démarches, lieux, dispositifs) | quotidienne, hors 02:45–04:30 | `production-hosting.md` §7 | bornée par `maxMinutes` | Neon Free, réseau du LAB |
| Actualités : ingestion + vérification + publication | toutes les 6 heures si possible, au moins chaque jour | `node scripts/news-ingest.mjs` | moins d'une minute | aucun |
| Guides officiels (fiches Service-Public) | hebdomadaire, après l'archive DILA | `node scripts/official-guides.mjs <archive.zip> --apply` | moins d'une minute | aucun |
| Mise en production | par paquet de travail, pas à chaque changement | `scripts/release-production.sh <sha>` (porte, déploiement, essai, retour arrière automatique) | 5 à 8 minutes | minutes de build incluses |
| Retour arrière | sur incident | automatique dans le script ; sinon `vercel rollback <url>` | 6 secondes (mesuré le 31/10) | aucun |
| Audit des dépendances | à chaque mise en production | `npm audit --omit=dev --audit-level=high` (dans la porte) | quelques secondes | aucun |
| Relevé des coûts | mensuel | Vercel → Usage ; taille de la base (`pg_database_size`) | quelques minutes | aucun |

Pendant la bêta, tous les crons Vercel sont refusés par le serveur : les tâches ci-dessus sont lancées depuis le LAB. Les déploiements Git sont
désactivés : une mise en production est un acte volontaire.

## 3. Coûts mesurés

| Poste | Offre | Mesure au 31/10/2026 |
|---|---|---|
| Hébergement (Vercel) | Pro, 20 $ par mois, crédit d'usage inclus 20 $ | 0,27 $ d'usage sur la période du 21/10 au 21/11 (stockage des déploiements, CPU et mémoire des fonctions, invocations) ; builds inclus ; builds simultanés facturés désactivés |
| Base de données (Neon) | Free | base de 84 Mo (dont 53 Mo de référentiel territorial) |
| Limitation de débit (Upstash Redis) | Free | compteurs de quelques minutes par adresse IP |
| Code et intégration continue (GitHub) | dépôt public | gratuit ; les Actions sont gratuites pour un dépôt public |
| Domaines et messagerie | comptes de l'éditeur (GoDaddy, Microsoft Outlook) | hors du dépôt : montants sur les factures de l'éditeur |
| Veille et modèle local | Mac du LAB | matériel et électricité de l'éditeur ; aucun service d'IA payant |

Coût fixe connu : 20 $ par mois. Coût variable actuel : couvert par le crédit inclus.

## 4. Seuils de vigilance (et ce qui demande l'accord de l'éditeur)

- **Crédit Vercel** : au-delà de 15 $ d'usage dans le mois, chercher la cause (fonction qui boucle, trafic anormal) avant toute autre mise en
  production. Un dépassement du crédit est facturé : l'éditeur décide.
- **Base Neon** : surveiller la taille à chaque relevé mensuel ; changer d'offre est une dépense nouvelle, donc une décision de l'éditeur.
- **Nouveaux prestataires** (e-mail, SMS, Sentry, mesure d'audience, IA en ligne) : aucun n'est activé ; chacun demande l'accord de l'éditeur,
  une analyse de protection des données et la mise à jour des pages légales (voir ADR-022 pour la mesure d'audience).
- **Test de charge** contre la production : seulement avec l'accord de l'éditeur (il consomme du crédit et se heurte à la limite de 30
  requêtes par minute et par adresse).

## 5. Ce que ce modèle ne couvre pas encore

- Un canal d'alerte réel et des horaires de support (Q07) : à définir par l'éditeur.
- Une équipe éditoriale et des lecteurs pour les textes simplifiés (Q02) : à constituer.
- Les accords de traitement (DPA) des prestataires et l'analyse d'impact (Q03) : à signer et archiver par l'éditeur.
