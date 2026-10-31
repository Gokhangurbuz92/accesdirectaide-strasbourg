# Hébergement de production (bêta publique, relevé du 31/10/2026)

Relevé fait sur la configuration réelle (API Vercel, base Neon, tests anonymes de `https://www.accesdirectaide.fr/`), sans afficher de secret.
Il complète `deployment.md` (la porte de mise en production) et `disaster-recovery.md`.

## 1. Composants et lieux de traitement

| Composant | Prestataire, offre | Lieu | Ce qui y est |
|---|---|---|---|
| Site et fonctions serveur | Vercel Inc., Pro (projet `accesdirectaide-strasbourg`) | fonctions à Francfort (`fra1`) ; pages et fichiers publics distribués par le réseau mondial de Vercel | code, journaux techniques (adresse IP, 1 jour) |
| Base de données | Neon (via Vercel), offre Free | Francfort (`aws-eu-central-1`), PostgreSQL 18 | contenus publics vérifiés, journal de la veille |
| Limitation de débit | Upstash Redis (via Vercel), offre Free | Francfort (`fra1`) | compteurs par adresse IP, quelques minutes |
| Fichiers (Coffre) | aucun pendant la bêta | — | — |
| E-mail, SMS, Sentry, mesure d'audience, IA | non activés pendant la bêta | — | — |

Un accès depuis les États-Unis ne peut pas être exclu (sociétés américaines). Les accords de traitement (DPA) des trois prestataires restent
à archiver par l'éditeur.

## 2. Domaines

`www.accesdirectaide.fr` est l'adresse canonique. `accesdirectaide.fr`, `accesdirectaide.com`, `www.accesdirectaide.com`, `accesdirectaide.org`
et `www.accesdirectaide.org` redirigent en 308 vers elle (chemin conservé, certificats valides). Les adresses `*.vercel.app` des déploiements
demandent une connexion Vercel (protection standard). Les enregistrements MX, SPF, DKIM et DMARC (Outlook) ne sont pas gérés par Vercel.

## 3. Isolation Production / Preview

Les variables de la base et de Redis existent aussi pour Preview, mais :
- les déploiements Git sont désactivés (`git.deploymentEnabled: false`) : aucune preview n'est créée par un push ;
- Preview n'a ni `JWT_SECRET` ni `ADA_ENCRYPTION_KEY` : l'API d'une preview refuse de démarrer ;
- toute preview demande une connexion Vercel.

Isolation complète, sans coût : retirer l'environnement Preview des deux connexions de stockage (Vercel → Storage → chaque base → Projects).
Une branche Neon par preview est possible sur l'offre Free, mais n'est utile que le jour où des previews seront réellement utilisées.

## 4. Coûts mesurés (période du 21/10 au 21/11/2026, au 31/10)

Abonnement Pro 20 $ par mois, crédit d'usage inclus 20 $ : 0,27 $ utilisés (stockage des déploiements 0,10 $, CPU et mémoire des fonctions
0,15 $, invocations 0,02 $ ; minutes de build : 288, incluses). Neon et Upstash : offres gratuites. Les builds simultanés à la demande
(`elasticConcurrencyEnabled`) sont désactivés : un build en attend un autre au lieu d'être facturé.

## 5. Temps de réponse sur l'hébergement réel

Depuis Strasbourg, une requête à la fois (7 mesures par page, temps jusqu'au premier octet) :

| Page | médiane | max | budget p95 (`performance-budgets.md`) |
|---|---|---|---|
| accueil (CDN) | 100 ms | 183 ms | — |
| liste des aides (`/api/aides?q=logement`) | 123 ms | 199 ms | 600 ms |
| page d'une aide (`/aides/apl`, rendue par le serveur) | 125 ms | 204 ms | 400 ms |
| annuaire (`/api/structures?q=ehpad`) | 137 ms | 219 ms | 600 ms |

Un test de charge à plusieurs utilisateurs contre la production n'a pas été fait : la limite de 30 requêtes par minute et par adresse le
transformerait en test de la limite, et il consomme du crédit. Il demande l'accord de l'éditeur (adresse source autorisée, créneau).

## 6. Déployer et revenir en arrière

- Déploiement : `scripts/release-production.sh <sha>` depuis un clone propre de `main` lié au projet Vercel. Le script vérifie que le commit
  est la pointe poussée de `origin/main`, exige le succès de la CI GitHub quand le workflow existe (`ops/github-actions/ci.yml`, à installer
  avec un jeton GitHub ayant le droit « workflow »), lance la porte locale (installation propre, lint, typecheck, `scripts/unit-gate.mjs`,
  audit des dépendances de production), déploie (le build lance `scripts/release-preflight.mjs` et s'arrête sur un FAIL), puis essaie
  l'adresse publique (en-tête `x-release-sha`, disponibilité, une liste, l'accueil) et revient automatiquement au déploiement précédent si
  l'essai échoue. Voir aussi `operating-model-and-costs.md`.
- Retour arrière : Vercel → Deployments → déploiement précédent → *Instant Rollback* (ou `vercel rollback <url>`), sans rebuild. Les
  migrations sont additives : un retour du code ne demande pas de retour du schéma.
- Vérification après déploiement : en-tête `x-release-sha` de `/api/health`, `/api/health/ready`, une page d'aide, une recherche.

## 7. Veille D-5 v2

Elle tourne depuis le Mac du LAB (aucun port ouvert vers Internet), avec la connexion directe Neon gardée dans `~/.ada-lab/neon-prod.env`
(lisible par le seul compte), hors de la fenêtre 02:45–04:30 réservée aux traitements lourds du LAB. Chaque passage est borné
(`maxMinutes`), verrouillé (une seule veille à la fois, verrou repris après 20 minutes) et reprenable : les fiches les moins récemment
vérifiées passent en premier. Les crons Vercel existent dans la configuration mais sont refusés pendant la bêta.
