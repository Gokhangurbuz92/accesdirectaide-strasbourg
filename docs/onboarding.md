# Onboarding développeur

## Jour 1 — Setup et découverte

1. Lire [README.md](../README.md)
2. Setup local (voir [CONTRIBUTING.md](CONTRIBUTING.md))
3. `npm install && npm test` — tout doit passer (770+ tests)
4. `npm run dev` — naviguer le site en local
5. Lire [architecture.md](architecture.md)

## Jour 2 — API et sécurité

1. Lire [api-reference.md](api-reference.md) — 170+ routes
2. Lire [security.md](security.md) — auth, CSRF, rate limiting
3. Lire [rgpd.md](rgpd.md) — données, purge, export
4. Faire un petit fix (typo, doc, test)
5. Créer une PR

## Jour 3 — Base de données et tests

1. Lire [database.md](database.md) — schema, migrations
2. Explorer `src/db/schema.ts` (40+ tables)
3. Lire [testing.md](testing.md) — conventions
4. Écrire un test
5. Lire [deployment.md](deployment.md) — CI/CD, rollback

## Documentation complète

| Doc | Sujet |
|-----|-------|
| [README.md](../README.md) | Vue d'ensemble |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Guide contribution |
| [architecture.md](architecture.md) | Architecture technique |
| [api-reference.md](api-reference.md) | 170+ routes API |
| [database.md](database.md) | Schema et migrations |
| [testing.md](testing.md) | Guide des tests |
| [security.md](security.md) | Mesures de sécurité |
| [rgpd.md](rgpd.md) | Conformité RGPD |
| [deployment.md](deployment.md) | Déploiement Vercel |
| [monitoring.md](monitoring.md) | Endpoints, alertes, SEO |
| [disaster-recovery.md](disaster-recovery.md) | Backup et DR |
| [secrets-rotation.md](secrets-rotation.md) | Rotation des secrets |
| [known-issues.md](known-issues.md) | Issues connues |
| [audit-status.md](audit-status.md) | Score du projet |
