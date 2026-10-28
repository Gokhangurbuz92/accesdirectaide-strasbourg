# Changelog

## [Unreleased] — 2026-03-25

### Admin Panel Complete
- AdminAiMetrics page — Gemini token usage, costs, latency, per-agent breakdown
- AdminLogs page — system log viewer with level filtering
- Routes added for `/admin/ai-metrics` and `/admin/logs`
- Sidebar navigation updated with Métriques IA and Logs links
- Tests: admin-panel-complete (27 assertions), admin-api-complete (24 assertions)

### Recherche et Glossaire
- Glossaire (20 termes, `api/lib/glossaire.js` + `api/_handlers/glossaire.js`)
- Page Glossaire frontend (`/glossaire`) avec recherche et filtres catégorie
- Glossaire intégré dans la recherche universelle (5ème type de résultat)
- Filtre urgence corrigé : API-side au lieu de client-side
- Lien glossaire sous la barre de recherche des aides
- Tests: glossaire (6 assertions), search-filters (14 assertions)

## [Unreleased] — 2026-03-24

### Sprint final — Tests complets
- Tests pipeline orchestrateur (7 tests : ordering, timestamps, error resilience)
- Tests qualité prompts FALC/Classifier/Curator (15 tests)
- Tests validation seed resources (9 tests : domain whitelist, duplicates)
- Guide activation production (`docs/ai-agents.md`)

### Agents branchés sur Gemini réel
- Classifier, FALC Writer → `generateText()` avec `metricType` dédié
- Alerter → créé réelles `ProNotification` en DB
- Orchestrateur → importe dynamiquement Classifier, FalcWriter, Alerter
- Hive Repair → `metricType: 'hive-repair'` + `recordMetric` dédié
- Tests hive-repair handler (7) + alignment (+5)
- Guide d'activation production dans `docs/ai-agents.md`

### Agent 7 — Curateur de Ressources
- `api/lib/agents/resource-curator.js` — sources gouv.fr uniquement, 4 types de contenu
- `api/lib/seed-resources.js` — 12 ressources officielles pré-configurées
- Tests curator + seed (12 tests)
- Documentation mise à jour

### 6 Agents spécialisés
- Agent FALC Writer (`api/lib/agents/falc-writer.js`) — simplification FALC
- Agent Classifier (`api/lib/agents/classifier.js`) — 12 catégories + 8 audiences
- Agent Alerter (`api/lib/agents/alerter.js`) — notification pros
- Orchestrateur étendu à 6 étapes (Discovery→Enrichment→Validation→Classification→FALC→Alerting)
- Tests : falc-writer (4), classifier (5), alerter (4), orchestrator (+1)
- Documentation complète (`docs/ai-agents.md`)

### AI Agents Alignment
- Orchestrateur central (`api/lib/agent-orchestrator.js`) — pipeline Discovery→Enrichment→Validation
- Module partagé `ai-discovery-core.js` — Gemini logic DRY
- Endpoint admin POST `/api/admin/orchestrator` (+route)
- Feature flag `ENABLE_AI_AGENT` ajouté à `hive-repair.js`
- `hive-scan.js` étendu de 4 à 12 catégories
- `agent-scheduler.js` délègue à `ai-discovery-core` (supprimé 40 lignes dupliquées)
- Tests orchestrateur (6) + alignment (9)
- Documentation `docs/ai-agents.md`

### Added (Sprint 12)
- Tests redirects config (3), notification system (4), search/RAG (4)
- Tests RDV system (7), audit trail (6), crypto contracts (3)

### Added (Sprint 11)
- Tests handlers avec mocks : login (3), signup (3), dashboard (1), gdpr-purge (1), chat (1)
- Tests accessibilité contracts (5) : lang, viewport, charset, title, skip-to-content
- CSP nonce documenté pour v1.1

### Corrections (Cross-vérification 24/03/2026)
- Score ajusté : 88% → 80-83% (honnête, vérifié)
- Bundle : 14 MB → ~2-3 MB (taille dist réelle)
- Routes : 170+ → ~100-130 (comptage réel)
- Migrations : 7 → 6 (drizzle/meta/)
- Security headers : 6/6 → 5/6 (X-XSS déprécié)
- Charts : pages lazy via React.lazy(), import direct dans la page

### Added (Sprint 10)
- Tests ingestion connectors (6), AI contracts (7), frontend structure (7), RGPD compliance (7), build config (5)
- docs/audit-status.md — métriques finales

### Added (Sprint 9)
- Coverage CI thresholds (50/40/45/50) dans `vitest.config.js`
- Tests handler security : auth (6), admin (3), pro (2), cron (all), critical (13), public (14), openapi (2)
- docs/roadmap.md — v1.0, v1.1, v1.2, v2.0
- docs/security.md — section CSP nonce status
- docs/known-issues.md — table tests skipped, métriques mises à jour

### Added
- docs/monitoring.md — documentation monitoring
- docs/disaster-recovery.md — procédure DR
- docs/known-issues.md — issues connues
- docs/database.md — schema, migrations, procédures DB
- docs/CONTRIBUTING.md — guide contribution (session précédente)
- docs/architecture.md — architecture technique (session précédente)
- docs/api-reference.md — 170+ routes documentées
- docs/deployment.md — procédure déploiement, rollback, infra
- docs/security.md — auth, CSRF, rate limit, headers, token refresh
- docs/rgpd.md — données, purge, export, chiffrement
- docs/testing.md — guide tests, conventions, E2E
- docs/onboarding.md — plan onboarding 3 jours
- docs/troubleshooting.md — 8 scénarios de debug
- docs/glossary.md — 30 termes techniques
- LICENSE (MIT)
- E2E smoke tests Playwright (`e2e/smoke-prod.spec.js`)
- Contract tests : cron, routes, OpenAPI, security headers, schema, rate limit, logger, handler, middleware, env, vercel config, package config, docs completeness
- Account deletion connecté au handler API (`CompteParametres.jsx`)
- Feature flags documentés (`ENABLE_AI_AGENT`, `ENABLE_DS_INGESTION`)
- Token refresh décision documentée dans security.md
- Prompt sanitizer (api/lib/prompt-sanitizer.js)
- Log store centralisé (api/lib/log-store.js)
- Dashboard opérationnel (/api/admin/dashboard)
- Feature flag ENABLE_AI_AGENT dans les 3 agents
- recordMetric dans les 3 agents IA
- k6 load testing scripts
- Schema DB splitté en 8 modules
- 8 variables manquantes ajoutées à `.env.example`
- Rate limiting documenté (9 action types, 50+ fichiers protégés)
- `tests/unit/prompt-sanitizer.test.js` — 12 tests pour le sanitizer

### Fixed
- `scripts/backup-db.js` — réécrit en standalone `pg` (plus de bug import Drizzle)
- 32 tests réactivés (705 → 749) via correction d'imports et ajout de mocks
- 7 exclusions vitest supprimées → 0 exclusions unit
- `@vitejs/plugin-react` ajouté à `vitest.config.js` pour JSX automatic transform
- `tests/integration/p10-public-credibility.test.js` — ajout beforeEach/afterEach cleanup DB
- `tests/unit/errorboundary.test.js` doublon supprimé

### Security
- Security headers vérifiés en production (6/6 : HSTS, X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy, Permissions-Policy)
- Monitoring endpoints vérifiés (6/6 OK)
- Password policy citoyen (8+ chars, majuscule, minuscule, chiffre)
- Coverage code v8 configuré (58% statements, 60% lines)

### Changed
- `vitest.config.js` — nettoyage exclude list, ajout plugin React
- `.env.example` — 8 variables d'environnement manquantes documentées
