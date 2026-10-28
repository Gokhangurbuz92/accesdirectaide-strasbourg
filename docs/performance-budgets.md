# Budgets de performance (Q05)

Mesure : `node scripts/load-budget.mjs --base <adresse> --duration 60 --users <n> --think 2500`. Chaque utilisateur virtuel est une personne qui consulte
le site : sa propre adresse, une pause de 1,25 à 3,75 s entre deux pages, les pages d'une visite à tour de rôle (annuaire, une structure, aides, démarches,
« J'ai besoin d'aide pour… »). Un 429 (limite de débit) compte comme hors budget : à ce rythme une personne n'atteint jamais les limites par adresse.

| Page | Budget p95 |
|---|---|
| santé du service | 150 ms |
| annuaire des structures (20) | 600 ms |
| page d’une structure | 400 ms |
| liste des aides (20) | 600 ms |
| liste des démarches (20) | 600 ms |
| « J’ai besoin d’aide pour… » (logement) | 900 ms |

## Mesures du 25/10/2026 — données « production-like »

Serveur de QA local (même code que la production, une instance) sur la base de la répétition « équivalent staging » : contenu du LAB importé puis publié par
la veille de la base (614 structures publiques), un seul Mac mini (M-series, 16 Go). **Ce n'est pas une mesure de l'hébergement** : démarrages à froid, région
et latence de la base Neon restent à mesurer sur le staging (`docs/deployment.md` § 8, point 7).

### 150 utilisateurs pendant 60 s — 60.2 requêtes/s au total, tout dans le budget

| Page | Requêtes | p50 | p95 | p99 | Erreurs | 429 |
|---|---|---|---|---|---|---|
| santé du service | 604 | 2 ms | 4 ms | 5 ms | 0 | 0 |
| annuaire des structures (20) | 599 | 5 ms | 10 ms | 12 ms | 0 | 0 |
| page d’une structure | 596 | 4 ms | 8 ms | 9 ms | 0 | 0 |
| liste des aides (20) | 607 | 3 ms | 6 ms | 8 ms | 0 | 0 |
| liste des démarches (20) | 601 | 3 ms | 5 ms | 7 ms | 0 | 0 |
| « J’ai besoin d’aide pour… » (logement) | 603 | 26 ms | 36 ms | 39 ms | 0 | 0 |

### 600 utilisateurs pendant 60 s — 240.9 requêtes/s au total, tout dans le budget

| Page | Requêtes | p50 | p95 | p99 | Erreurs | 429 |
|---|---|---|---|---|---|---|
| santé du service | 2419 | 2 ms | 2 ms | 3 ms | 0 | 0 |
| annuaire des structures (20) | 2431 | 3 ms | 4 ms | 5 ms | 0 | 0 |
| page d’une structure | 2411 | 3 ms | 3 ms | 4 ms | 0 | 0 |
| liste des aides (20) | 2387 | 2 ms | 3 ms | 4 ms | 0 | 0 |
| liste des démarches (20) | 2404 | 2 ms | 3 ms | 3 ms | 0 | 0 |
| « J’ai besoin d’aide pour… » (logement) | 2400 | 18 ms | 21 ms | 24 ms | 0 | 0 |

Les réponses publiques passent par le cache de lecture (époque de contenu) : les chiffres mesurent surtout le chemin du code et la base locale.
Sur le LAB lui-même (127.0.0.1:3000), une mesure n'est pas possible : son serveur se comporte comme un mandataire de confiance et remplace `X-Forwarded-For`
par l'adresse du poste (`scripts/lab-server.mjs`) — tout le trafic d'un poste est un seul client, et les limites répondent 429, comme elles le doivent.
