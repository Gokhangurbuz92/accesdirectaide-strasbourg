# Guide des tests

## Structure

```
tests/
├── unit/           # Logique pure, pas de DB
├── integration/    # Avec DB de test
├── helpers/        # Utilitaires de test
e2e/                # Playwright (serveur requis)
tests/a11y/         # Accessibilité (Playwright)
tests/components/   # Composants React (@testing-library)
```

## Commandes

```bash
npm test                          # Tous les tests Vitest
npm run test:coverage             # Avec rapport coverage
npx vitest run tests/unit/        # Unit seulement
npx vitest run tests/integration/ # Integ seulement
npx vitest --watch                # Mode watch
npx playwright test               # E2E (48 fichiers)
npx playwright test tests/a11y    # Accessibilité
```

## Écrire un test

### Test unitaire

```javascript
import { describe, it, expect } from 'vitest';
import { maFonction } from '../../api/lib/mon-module.js';

describe('maFonction', () => {
  it('retourne le résultat attendu', () => {
    expect(maFonction('input')).toBe('output');
  });
});
```

### Test d'intégration (avec handler)

```javascript
import { describe, it, expect } from 'vitest';

describe('Mon endpoint', () => {
  it('retourne 200', async () => {
    const mod = await import('../../api/_handlers/mon-handler.js');
    const handler = mod.default;
    
    const req = { method: 'GET', headers: {} };
    let status = 200;
    let body = {};
    const res = {
      status(c) { status = c; return this; },
      json(d) { body = d; return this; },
      setHeader() { return this; },
    };
    
    await handler(req, res);
    expect(status).toBe(200);
  });
});
```

### Test de contrat (vérifier qu'un module existe)

```javascript
it('handler exists and exports default', async () => {
  const mod = await import('../../api/_handlers/mon-handler.js');
  expect(typeof mod.default).toBe('function');
});
```

## Coverage

- **Provider** : V8
- **Actuel** : Statements 58% · Branches 49% · Functions 57% · Lines 60%
- **Rapport** : `npm run test:coverage`
- **Sortie** : `coverage/` (HTML + JSON)

## Conventions

- Fichiers : `xxx.test.js` (unit) ou `xxx.test.js` (integration)
- 1 `describe` par module/endpoint
- Nettoyer les données de test (`afterEach`)
- Mocker les dépendances externes (`vi.mock()`)
- Ne pas tester les dépendances externes elles-mêmes

## E2E Tests (Playwright)

```bash
# Lancer le serveur
npm run dev

# Dans un autre terminal
npx playwright test                        # Tous les E2E
npx playwright test e2e/smoke-prod.spec.js # Smoke tests seulement
npx playwright test --ui                   # Mode interactif
```

Les E2E ne sont **pas** dans le CI Vitest (ils nécessitent un serveur). Un workflow GitHub Actions dédié (`a11y.yml`) les exécute.
