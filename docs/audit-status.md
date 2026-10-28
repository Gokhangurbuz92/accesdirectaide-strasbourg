# Audit Status — Mars 2026

> Audit initial : 23 mars 2026 · Cross-vérification terrain : 24 mars 2026

## Métriques finales (vérifiées contre le code réel)

| Métrique | Valeur | Vérifié par |
|----------|--------|-------------|
| **Tests** | 923 passent, 0 failures | `npx vitest run` |
| **Fichiers test** | 133 | `find tests/ -name "*.test.*"` |
| **Coverage** | ~55% statements, ~47% branches | `vitest --coverage` |
| **Coverage CI thresholds** | 50% stmts / 40% branches / 45% funcs / 50% lines | `vitest.config.js` |
| **Routes API** | ~100-130 (133 lignes dans routes.js) | `grep -c routes.js` |
| **Tables DB** | 59 | `grep -c pgTable schema.ts` |
| **Migrations** | 6 versionnées | `ls drizzle/meta/` |
| **Handlers** | 100+ | `find api/_handlers` |
| **Connectors ingestion** | 12 | `ls api/lib/ingestion/` |
| **Docs** | 21 fichiers markdown | `ls docs/*.md` |
| **Pages frontend** | 123 | `find src/pages` |
| **Components frontend** | 158 | `find src/components` |
| **Crons** | 11 | `vercel.json` |
| **E2E specs** | 6 (Playwright) | `e2e/smoke-prod.spec.js` |
| **Bundle (dist)** | ~2-3 MB | `npm run build` |
| **Version** | 1.0.0 | `package.json` |
| **npm audit** | 0 vulnérabilités | `npm audit --omit=dev` |
| **Security headers** | 5/6 (X-XSS déprécié) | `curl -sI prod` |
| **Monitors** | 4/4 healthy | `curl /api/health` |
| **Score estimé** | **~80-83%** (honnête) | cross-vérification |

## Score par dimension (honnête)

| Dimension | Audit initial (23/03) | Réel vérifié (24/03) | Preuve |
|-----------|:---:|:---:|--------|
| Tests | 55% | **78%** | 923 tests, coverage ~55%, 133 fichiers, CI thresholds |
| Sécurité | 55% | **72%** | Rate limit 52 fichiers, lockout, CSRF, CSP+HSTS, scrypt, PII blocking |
| RGPD | 40% | **65%** | Purge cron, export, delete, consent, cookie banner, doc RGPD |
| Auth | 65% | **78%** | Lockout, MFA TOTP admin, scrypt, rate limit, password policy |
| DevOps | 40% | **62%** | CI vert, backup (count-only), DR, monitoring, 6 migrations |
| Observabilité | 35% | **55%** | Sentry, Pino, health-alert, 4 monitors |
| Maintenabilité | 55% | **72%** | 21 docs, CHANGELOG, onboarding, API ref, testing guide, roadmap |
| CI/CD | 70% | **82%** | GH Actions, lint 0, coverage CI thresholds, E2E (dev server) |
| **Global** | **52%** | **~80-83%** | **+28-31 points** |

## Corrections issues de la cross-vérification (24/03/2026)

| Affirmation précédente | Réalité vérifiée |
|------------------------|------------------|
| Bundle 14 MB | **~2-3 MB** (dist après build) |
| 170+ routes | **~100-130** (133 lignes, inclut commentaires) |
| 7 migrations | **6** (0000 à 0005 dans drizzle/meta/) |
| Security headers 6/6 | **5/6** (X-XSS-Protection déprécié, remplacé par CSP) |
| Charts en lazy load ✅ | **Pages lazy ✅**, import direct dans la page (recharts chunk séparé par page lazy) |
| Score 88% | **80-83%** (auto-évaluation corrigée) |

## Items confirmés FAITS

| Item | Audit disait | Réalité |
|------|-------------|---------|
| Lockout citoyen | 🔴 Absent | ✅ `failedLoginAttempts` + `lockoutUntil` + 15min |
| Rate limiting global | 🟠 Non vérifié | ✅ 52 fichiers, 12 action types, IP+clé |
| CSRF middleware | 🟡 Absent | ✅ `api/_utils/csrf.js` double-submit cookie |
| RGPD export | 🔴 Absent | ✅ `api/_handlers/auth/export-data.js` |
| Migrations DB | 🔴 push sans versions | ✅ 6 migrations dans `drizzle/` |
| Secrets rotation | 🟠 Absent | ✅ `docs/secrets-rotation.md` |
| Pino logger | 🟠 Non vérifié | ✅ `api/_utils/logger.js` Pino structuré |
| Alerting | 🟠 Absent | ✅ `cron/health-alert.js` + Sentry |
| Coverage CI | 🔴 Absent | ✅ CI step + thresholds + artifact |

## Items restants

### 🔴 Critique (prestataire externe)
- [ ] Pen test externe (2-5K€)
- [ ] Audit RGAA accessibilité (5-15K€)

### 🟡 v1.1
- [ ] Coverage → 70%
- [ ] Design system tokens (150 violations)
- [ ] CSP nonce dynamique
- [ ] E2E contre vraie API (pas dev server)

### 🟢 v1.2+
- [ ] Migration JS → TS
- [ ] API versioning /v1/
- [ ] Monitoring centralisé (Axiom)
- [ ] Token refresh citoyen
