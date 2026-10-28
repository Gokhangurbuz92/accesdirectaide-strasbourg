# Guide de contribution — Accès Direct Aide

## Setup local

1. Cloner le repo
2. Copier `.env.example` → `.env.local`
3. Remplir les variables (voir `.env.example` pour la documentation de chaque variable)
4. `npm install`
5. `npm run dev`

### Base de données locale (optionnel)

```bash
docker compose up -d          # PostgreSQL + pgvector
npm run db:migrate            # Appliquer les migrations Drizzle (drizzle/)
npm run db:seed               # Données de test (optionnel)
```

En production, la base est hébergée sur **Neon** (PostgreSQL managé). Dans tout environnement déployé, le schéma ne change que par `drizzle-kit migrate` avec les fichiers de `drizzle/` — jamais `drizzle-kit push` (réservé à une base locale jetable).

---

## Conventions

### Commits

Format **conventional commits** :

```
feat: ajouter la recherche hybride
fix: corriger le rate limiting admin
chore: mise à jour des dépendances
docs: documentation monitoring
test: tests intégration review-queue
```

### Branches

- `feature/xxx` — nouvelles fonctionnalités
- `fix/xxx` — corrections de bugs
- `chore/xxx` — maintenance, CI, deps

### Pull Requests

- PR obligatoire vers `main`
- CI doit être **vert** avant merge
- Description claire du changement
- Au moins 1 review si possible

---

## Tests

### Avant chaque commit

```bash
npm test                # Unit + integration (Vitest)
npm run build           # Vérifier le build
npm run lint            # 0 erreurs requises
```

### Commande de vérification complète

```bash
npm run preflight       # lint + typecheck + test + build
```

### Structure des tests

| Dossier | Type | Outil | Base de données |
|---------|------|-------|-----------------|
| `tests/unit/` | Unitaires | Vitest | Non |
| `tests/integration/` | Intégration | Vitest | Oui (test DB) |
| `e2e/` | E2E | Playwright | Oui (serveur requis) |
| `tests/load/` | Charge | k6 | Oui (serveur requis) |

### Écrire un test

- **Unit** : logique pure, pas de DB, mocks si nécessaire
- **Integration** : requêtes API avec DB de test, setup/teardown
- **E2E** : `npx playwright test` (nécessite le serveur local)

```bash
# Exemples
npm test                      # Tous les tests Vitest
npx vitest run tests/unit/    # Seulement les unit tests
npm run test:e2e              # E2E Playwright
npm run test:coverage         # Rapport de couverture
```

---

## Variables d'environnement

Voir `.env.example` pour la liste complète et commentée.

**Règles** :
- Ne JAMAIS commiter de secrets (`.env.local` est dans `.gitignore`)
- Les variables `VITE_*` sont exposées côté client
- Les autres sont server-only
- En production, les secrets sont dans Vercel Environment Variables

---

## RGPD

Le projet suit les principes RGPD :

- **Purge automatique** : données personnelles purgées via le cron `gdpr-purge`
- **Suppression de compte** : `DELETE /api/auth/delete-account`
- **Cookie banner** : consentement obligatoire avant tout tracking
- **Logs** : les données sensibles (NIR, IBAN) sont détectées et bloquées
- **Audit trail** : table `AuditLog` pour tracer les actions admin

---

## CI/CD

Le pipeline GitHub Actions exécute :

1. **Quality & Build** : `npm run lint` → `tsc --noEmit` → `npm test` → `npm run build`
2. **E2E** : Playwright shardé sur plusieurs runners
3. **Secrets scan** : détection de secrets dans le code

Le déploiement se fait automatiquement via **Vercel** à chaque push sur `main`.
