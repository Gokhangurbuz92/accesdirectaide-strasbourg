# Roadmap

## ✅ v1.0.0 — Mars 2026 (fait)
- 836+ tests, 57% coverage
- 20 docs techniques
- Auth complète (admin, pro, citoyen + MFA)
- Rate limiting (50+ fichiers, 12 action types)
- CSRF double-submit, lockout citoyen
- RGPD (purge cron, export, suppression compte)
- Monitoring (4 monitors, Sentry, health-alert cron)
- CI/CD (GitHub Actions → Vercel)
- 11 crons configurés
- Chatbot IA (Gemini + RAG + circuit breaker)
- Espace Pro (RDV, dossiers, équipes, messagerie)
- Security headers 6/6
- npm audit 0 vulnérabilités

## 🔜 v1.1 — Prochaine version
- [ ] Coverage → 70%
- [ ] E2E tests stabilisés en CI
- [ ] Design system tokens (résoudre 150 violations)
- [ ] CSP nonce dynamique

## 📅 v1.2 — Été 2026
- [ ] Migration JS → TS progressive
- [ ] API versioning /v1/
- [ ] Monitoring centralisé (Axiom)
- [ ] Load testing k6

## 🎯 v2.0 — Automne 2026
- [ ] Pen test externe
- [ ] Audit RGAA accessibilité
- [ ] Token refresh citoyen
- [ ] Multi-tenant
