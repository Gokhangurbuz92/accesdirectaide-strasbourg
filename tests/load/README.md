# Tests de charge (k6)

## Prérequis

```bash
brew install k6
```

## Smoke test (1 user, 10s)

```bash
npm run test:load:smoke
```

Vérifie que les endpoints critiques répondent correctement avec 1 utilisateur.

## Test complet (50 users, 4 min)

```bash
npm run test:load
```

Ramp-up progressif :
- 0→10 VUs en 30s
- 10→50 VUs en 1 min
- Maintien 50 VUs pendant 2 min
- Redescente en 30s

## Test local

```bash
npm run test:load:local
```

## Seuils (thresholds)

| Métrique | Seuil |
|----------|-------|
| Latence P95 | < 3 secondes |
| Taux d'erreur HTTP | < 5% |
| Erreurs custom | < 10% |

## Endpoints testés

| # | Endpoint | Vérifications |
|---|----------|---------------|
| 1 | `/api/health` | Status 200, `ok: true` |
| 2 | `/api/aides?limit=10` | Status 200, données présentes, latence < 2s |
| 3 | `/api/aides?q=logement&limit=5` | Status 200, latence < 3s |
| 4 | `/api/structures?limit=10` | Status 200 |
| 5 | `/api/demarches?limit=10` | Status 200 |
| 6 | `/api/monitor/core` | Status 200 |

## Résultats

Les résultats sont sauvés dans `tests/load/results.json` (gitignored).
