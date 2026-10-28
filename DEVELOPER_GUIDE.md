# Accès Direct Aide — Guide Développeur

## 📋 Prérequis

- Node.js 20+
- PostgreSQL 15+ avec extension `pgvector`
- Redis (optionnel, fallback en mémoire)

## 🚀 Installation

```bash
npm install
cp .env.example .env.local  # Adapter les valeurs
```

## 🗄️ Base de données

### Setup initial (local)
```bash
# Créer la base et activer pgvector
createdb acces_direct_aide_dev
psql acces_direct_aide_dev -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Appliquer le schéma (migrations versionnées de drizzle/)
DATABASE_URL="postgresql://localhost/acces_direct_aide_dev" npm run db:migrate
```

> Dans tout environnement déployé, seul `drizzle-kit migrate` (`npm run db:migrate`) avec les fichiers de `drizzle/` est autorisé — jamais `drizzle-kit push`. `push` n'est toléré que sur une base locale jetable.

### Migrations versionnées
```bash
npx drizzle-kit generate   # Génère une migration SQL
npx drizzle-kit migrate    # Applique les migrations
```

Les migrations sont dans `/drizzle/` (5 fichiers SQL versionnés).

### Backup / Restore
```bash
pg_dump $DATABASE_URL > backups/backup_$(date +%Y%m%d).sql
psql <target_db> < backups/backup_YYYYMMDD.sql
```

## 🏗️ Architecture

```
├── api/                   # Backend serverless (Vercel Functions)
│   ├── index.js           # Entry point + routing
│   ├── routes.js          # Route definitions (130+ handlers)
│   ├── _handlers/         # Request handlers par domaine
│   │   ├── auth/          # Auth citoyen (signup, login, logout)
│   │   ├── pro/           # Espace professionnel (33 handlers)
│   │   ├── admin/         # Back-office admin (22 handlers)
│   │   ├── assistant/     # Chatbot IA (modèle local + RAG ; désactivé en production)
│   │   ├── cron/          # Jobs planifiés (ingestion, GDPR purge)
│   │   ├── booking/       # Réservation RDV
│   │   ├── public/        # API publique (messages, passeport)
│   │   └── monitor/       # Observabilité (health, freshness)
│   ├── _utils/            # Utilitaires (auth, rate limit, vault, env)
│   ├── _services/verification/ # Veille automatique (vérification et publication automatiques)
│   └── lib/               # Services (IA locale Ollama, openfisca, storage ; code Gemini hérité, désactivé)
├── src/                   # Frontend React + Vite
│   ├── pages/             # 80 pages (citoyen + pro + admin)
│   ├── components/        # Composants UI (shadcn/ui + Radix)
│   ├── db/                # Drizzle ORM schema (38 tables)
│   └── hooks/             # React hooks
├── drizzle/               # Migrations SQL versionnées
├── scripts/               # 24 scripts de maintenance
├── tests/                 # Tests (integration + unit)
└── e2e/                   # Tests Playwright (50+ specs)
```

## 🔑 Variables d'environnement requises

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret pour signer les JWT (≥32 chars) |
| `ADA_ENCRYPTION_KEY` | Clé de chiffrement des données sensibles |
| `OLLAMA_BASE_URL` | Optionnel, LAB uniquement : modèle local Ollama (`qwen3:8b`) pour l'assistant IA. Pas de `GEMINI_API_KEY` (refusée en production par `scripts/release-preflight.mjs`) |
| `KV_REST_API_URL` | URL Upstash Redis (rate limiting) |
| `KV_REST_API_TOKEN` | Token Upstash Redis |

Voir `.env.example` pour la liste complète.

## 🧪 Tests

```bash
# Tests d'intégration (nécessite PostgreSQL local)
DATABASE_URL="postgresql://localhost/acces_direct_aide_test" npx vitest run tests/integration

# Lint
npm run lint

# Build production
npx vite build

# E2E (nécessite preview URL ou dev-server complet)
USE_MOCKS=true npx playwright test
```

## 🔒 Sécurité

- **Auth** : JWT HS256 avec `jti` + révocation via DB (`AuthToken` table) ; administrateurs = comptes nominatifs avec MFA (`scripts/admin-bootstrap.mjs`), `ADMIN_TOKEN` / `ADMIN_PASSWORD` / `BYPASS_SECRET` refusés en production
- **Roles** : SUPERADMIN > STRUCTURE_ADMIN > PRO > USER
- **Rate limiting** : Upstash Redis (fallback mémoire), fail-closed en prod
- **Chiffrement** : AES-256-GCM (vault.ts) pour tokens Outlook
- **PII** : Sentry scrubbing, NIR/IBAN/CB blocking dans le chatbot

## 📦 Déploiement

Le projet se déploie sur **Vercel**, jamais automatiquement : après un merge dans `main`, le workflow `deploy.yml` ne démarre que si le CI a réussi sur ce commit, et attend l'approbation d'un relecteur nommé de l'environnement « production ». Les migrations passent par le workflow manuel `db-migrate-deploy`. Pendant REMOTE_FREEZE, rien n'est poussé ni déployé avant le GO LIVE du propriétaire ; `node scripts/release-preflight.mjs` vérifie la configuration avant tout déploiement.

```bash
# 1. Vérification locale complète
npm run lint && npx vite build && npm test

# 2. Push sur la branche
git push origin <branch>

# 3. Créer la PR, attendre le CI vert
# 4. Merger dans main → CI vert → approbation « production » → déploiement Vercel
```
