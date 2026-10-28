# Architecture — Accès Direct Aide

> Documentation technique pour la maintenance, l'audit et le scaling.

## Vue d'ensemble

```
┌──────────────┐     HTTPS/REST      ┌──────────────────┐
│   Citoyen    │ ──────────────────── │   Vercel Edge    │
│   (Browser)  │                     │   + Functions    │
└──────────────┘                     └────────┬─────────┘
                                              │
                         ┌────────────────────┼────────────────────┐
                         │                    │                    │
                  ┌──────▼──────┐   ┌────────▼────────┐  ┌───────▼───────┐
                  │  Neon PG    │   │  Upstash Redis  │  │  Sources      │
                  │  + pgvector │   │  (KV + Rate)    │  │  officielles  │
                  └─────────────┘   └─────────────────┘  └───────────────┘
```

IA : aucune en production (sauf choix par le propriétaire d'un modèle hébergé dans l'UE) ; sur le LAB, modèle local Ollama (`qwen3:8b`). Le code Gemini restant est hérité et désactivé (`GEMINI_API_KEY` refusée par `scripts/release-preflight.mjs`). Sources officielles de la veille automatique : Service-Public (DILA), Annuaire de l'administration, SIRENE.

## Stack technique

| Couche | Technologie | Rôle |
|--------|-------------|------|
| Frontend | React 18 + Vite | SPA |
| Routing | React Router v7 | Lazy-loaded routes |
| State | TanStack Query | Cache + synchronisation |
| Animations | Framer Motion | Transitions de page |
| UI | Radix UI + Tailwind | Design system accessible |
| Backend | Vercel Functions (Node 20) | API serverless |
| Validation | Zod | Schémas de validation stricts |
| DB | Neon PostgreSQL + Drizzle ORM | SQL type-safe |
| Vector | pgvector | RAG / recherche sémantique |
| Cache | Upstash Redis | Rate limiting, KV |
| IA | Modèle local Ollama (qwen3:8b), LAB uniquement | Chat, FALC, rédaction des textes de la veille ; désactivée en production |
| Monitoring | Sentry | Errors + performance |
| CI/CD | GitHub Actions → Vercel | Preview + Production |

## Flux de requête

```
Request
  │
  ├─ 1. Vercel Edge (redirects, canonical domain, HSTS)
  │
  ├─ 2. api/index.js (Main Handler)
  │     ├─ CORS validation
  │     ├─ Security headers (CSP, X-Frame-Options, etc.)
  │     ├─ CSRF origin check + double-submit cookie
  │     ├─ Rate limiting (Upstash KV)
  │     ├─ Cache policy
  │     ├─ Route matching (170+ routes, lazy imports)
  │     └─ Zod input validation
  │
  ├─ 3. Handler execution
  │     ├─ Auth verification (JWT/cookie/cron secret)
  │     ├─ Business logic
  │     └─ Sentry scope (tags, context)
  │
  └─ 4. Response
        ├─ Cache-Control
        └─ x-request-id tracing
```

## Schema DB

Le schema Drizzle ORM est dans `src/db/schema.ts` (40+ tables) :

| Module | Tables principales |
|--------|-------------------|
| **Core** | Aide, Actualite, Demarche, Structure, Guide |
| **Auth** | AdminUser, CitizenUser, AuthToken, AuditLog |
| **Pro** | ProUser, ProProfile, ProAvailabilityRule, ProTimeOff |
| **RDV** | ProAppointment, ProRdvService, RdvConversation |
| **Messaging** | RdvConversation, ProNotification |
| **Taxonomy** | NeedCategory, AudienceCategory, ModalityType |
| **Ingestion** | IngestJob, SourceSnapshot, EntityVersion, RssSource |
| **IA** | AiMetric, ConversationLog, ReviewQueueItem |
| **RGPD** | ConsentLog, UserConsent |

## Pipeline d'ingestion

```
Vercel Crons (11 planifiés dans vercel.json, heures UTC)
  │
  ├─ ingest-aids        → Aides Territoires (quotidien 3h)
  ├─ ingest-structures  → Annuaire structures (hebdo dim 2h)
  ├─ ingest-demarches   → Service-public.fr (hebdo lun 4h)
  ├─ ingest-annuaire    → Annuaire complet (hebdo lun 1h)
  ├─ actualites         → Flux RSS (toutes les 6h)
  ├─ review-queue/scan  → Scan qualité (toutes les 6h, à la demi-heure)
  ├─ parcours-reminder  → Rappels d'échéances du parcours (quotidien 7h)
  ├─ referral-timeouts  → Orientations sans réponse (quotidien 7h30)
  ├─ rdv-reminder       → Rappels RDV (quotidien 8h)
  ├─ gdpr-purge         → Purge RGPD (hebdo dim 3h)
  └─ health-alert       → Monitoring (toutes les 5 min)
```

12 connecteurs d'ingestion :
AidesTerritoires, DREES, ServicePublic, FINESS, RNA, GrandEst, Agefiph, MesAidesReno, DémarchesSimplifiées + IngestionPipelineCore.

Routes existantes mais **non** planifiées dans vercel.json : `hive-scan`, `backup-db`, `link-check`, `pipeline` et `veille` (la chaîne de vérification automatique est exécutée chaque nuit par le serveur LAB).

### Veille automatique (vérification et publication)

Les informations publiques (aides, démarches, dispositifs, structures) sont vérifiées et publiées **automatiquement** par la « veille automatique » (décision du propriétaire D-5 v2, 2026-10-25) : `api/_services/verification/chain.js`, relecteur système `ada-veille-automatique` (rôle `system`). Chaque décision est confrontée aux sources officielles et consignée dans le registre `ContentVerification` ; elle n'est jamais présentée comme la relecture d'une personne. Sans preuve suffisante, rien n'est publié (fail-closed) ; une personne peut toujours vérifier ou suspendre un contenu manuellement.

## Architecture IA

```
User message
  │
  ├─ Prompt sanitizer (HTML, injection, length)
  ├─ Sensitive data check (NIR, IBAN, CB)
  │
  ├─ chatWithRulePack()
  │     ├─ Embedding (768d)
  │     ├─ Hybrid search (pgvector + lexical, RRF fusion)
  │     ├─ Modèle local Ollama qwen3:8b (RAG context) — LAB uniquement
  │     └─ Circuit breaker (opossum, 50% threshold, 30s timeout)
  │
  ├─ Output safety filter (source officielle check)
  └─ Response + metrics (local-ai-metrics.js)
```

En production, l'assistant IA est désactivé tant que le propriétaire n'a pas choisi un modèle hébergé dans l'UE. Les chemins Gemini restants (`gemini.js`, `GeminiProvider`) sont hérités et désactivés.

**Agents IA hérités** (derrière feature flag `ENABLE_AI_AGENT`, désactivés) :
- `/api/pro/agent-discovery` — Recherche nouvelles aides (Pro)
- `/api/pro/agent-scheduler` — Orchestration enrichissement (Pro)
- `/api/cron/hive-scan` — Scan toutes catégories (route existante, non planifiée)

## Sécurité

| Mesure | Implémentation |
|--------|---------------|
| CSP | Content-Security-Policy dans vercel.json |
| HSTS | `max-age=63072000; includeSubDomains; preload` |
| CSRF | Double-submit cookie + origin validation |
| Auth | JWT admin/pro, cookie citoyen ; administrateurs nominatifs avec MFA (`scripts/admin-bootstrap.mjs`), `ADMIN_TOKEN` / `ADMIN_PASSWORD` / `BYPASS_SECRET` refusés en production |
| Rate limiting | Upstash KV (`checkRateLimit`) |
| Input | Zod validation, prompt sanitizer |
| PII | Détection NIR/IBAN/CB, scrubbing Sentry |
| Chiffrement | AES-256-GCM (`api/lib/crypto.ts`) |
| Circuit breaker | opossum pour les appels au fournisseur d'IA |

## Monitoring

| Endpoint | Description |
|----------|-------------|
| `/api/health` | Health check (uptime, version, env) |
| `/api/health/deep` | Health profond DB+KV (auth requise) |
| `/api/monitor/core` | Statut DB + KV |
| `/api/monitor/cron/actualites` | Fraîcheur des crons |
| `/api/admin/ai-metrics` | Métriques IA (tokens, coûts, latence) |
| `/api/admin/dashboard` | Dashboard opérationnel |
| `/api/admin/logs` | Logs centralisés |

## Structure du projet

```
├── api/                     # Vercel serverless functions
│   ├── _handlers/           # Route handlers (lazy-loaded)
│   │   ├── assistant/       # Chat IA, recommandations, feedback
│   │   ├── auth/            # Auth citoyen (login, signup, MFA)
│   │   ├── pro/             # Espace pro (30+ handlers)
│   │   ├── admin/           # Admin (dashboard, sync, features)
│   │   └── cron/            # Cron jobs (11 crons)
│   ├── _utils/              # Auth, CSRF, rate limiting, logger
│   ├── _services/verification/ # Veille automatique (chain.js)
│   ├── lib/                 # IA locale (Gemini hérité, désactivé), circuit breaker, search
│   │   └── ingestion/       # 12 connecteurs de données
│   ├── index.js             # Main request pipeline
│   └── routes.js            # Route registry (170+ routes)
├── src/
│   ├── components/          # UI components (Radix + custom)
│   ├── pages/               # Route pages (81 pages, lazy-loaded)
│   │   ├── admin/           # Admin interface
│   │   └── pro/             # Pro interface
│   ├── lib/                 # Utilities, hooks
│   └── db/
│       └── schema.ts        # Drizzle schema (40+ tables)
├── tests/
│   ├── unit/                # 50 fichiers test
│   └── integration/         # 45 fichiers test
├── e2e/                     # 48 specs Playwright
├── docs/                    # Documentation
├── scripts/                 # Seed, backup, ingestion, build
└── .github/workflows/       # CI/CD GitHub Actions
```
