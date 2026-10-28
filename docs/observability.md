# Observabilité — Accès Direct Aide

> Comment monitorer, collecter les logs et alerter sur la plateforme.

## Monitoring endpoints

| Endpoint | Description | Auth | Fréquence |
|----------|-------------|------|-----------|
| `GET /api/health` | Health check basique (uptime, version) | Public | À volonté |
| `GET /api/health/deep` | DB + KV + Storage + Crons | Admin/Cron | Cron 5min |
| `GET /api/monitor/core` | Statut DB + KV | Public | À volonté |
| `GET /api/monitor/cron/actualites` | Fraîcheur des crons | Public | À volonté |
| `GET /api/admin/ai-metrics` | Métriques IA (tokens, coûts, latence) | Admin | Dashboard |
| `GET /api/admin/dashboard` | Dashboard opérationnel | Admin | Dashboard |
| `GET /api/admin/logs` | Logs centralisés (KV) | Admin | Dashboard |

## Alerting

### Architecture actuelle

```
Cron health-alert (toutes les 5 min)
  │
  ├─ Check 1: DB (SELECT 1)
  ├─ Check 2: KV (set/get)
  └─ Check 3: Ingestion freshness (< 48h)
      │
      ├─ Sentry (captureMessage, level: fatal)
      ├─ Webhook (ALERT_WEBHOOK_URL → Slack/Discord)
      └─ KV alert log (alert:log, max 50 entries)
```

Anti-spam : même type d'alerte supprimé pendant 1 heure via KV.

### Configuration du webhook

Pour recevoir les alertes sur Slack :

1. Créer un [webhook Slack incoming](https://api.slack.com/messaging/webhooks)
2. Ajouter dans Vercel env : `ALERT_WEBHOOK_URL=https://hooks.slack.com/services/xxx`
3. Redéployer

Le payload envoyé :
```json
{
  "text": "🔴 *HEALTH ALERT* — db.down\nDatabase is unreachable",
  "name": "db.down",
  "severity": "critical",
  "timestamp": "2026-03-23T23:00:00.000Z"
}
```

## Logs

### Architecture

Deux loggers coexistent :

| Logger | Fichier | Usage |
|--------|---------|-------|
| Pino (structuré) | `api/_utils/logger.js` | Handlers principaux |
| Custom (console) | `api/lib/logger.js` | Modules legacy |

Les deux incluent :
- Masquage PII automatique (email, téléphone, mots de passe)
- Censor RGPD : `[MASQUÉ - RGPD]` / `[REDACTED]`
- Troncature à 8KB pour éviter les limites Vercel

### Collecte centralisée

En serverless Vercel, les logs `stdout`/`stderr` sont visibles dans :

1. **Vercel Dashboard** → Fonctions → Logs (temps réel)
2. **Vercel Log Drains** → Pour forward vers un service externe

#### Configurer un Log Drain (recommandé)

```bash
# Via Vercel CLI
vercel integrations add axiom     # Axiom (gratuit 500MB/mois)
# ou
vercel integrations add datadog   # Datadog
# ou
vercel integrations add logflare  # Logflare
```

Ou via l'API :
```bash
curl -X POST "https://api.vercel.com/v2/log-drains" \
  -H "Authorization: Bearer <your-vercel-token>" \
  -d '{
    "name": "axiom-drain",
    "type": "json",
    "url": "https://cloud.axiom.co/api/v1/datasets/vercel/ingest",
    "headers": { "Authorization": "Bearer <your-axiom-token>" }
  }'
```

### Niveaux de log

Configurable via `LOG_LEVEL` (variable d'env) :

| Niveau | Quand l'utiliser |
|--------|-----------------|
| `error` | Prod minimale (erreurs uniquement) |
| `warn` | CI, staging |
| `info` | Production (défaut) |
| `debug` | Développement local |

## Sentry

### Configuration

```env
SENTRY_DSN=https://<your-sentry-key>@o<org-id>.ingest.sentry.io/<project-id>
SENTRY_TRACES_SAMPLE_RATE=0.1
```

### Que capture Sentry automatiquement

- Toutes les exceptions non-catchées
- Les `health.deep.failed` (niveau warning)
- Les `HEALTH ALERT` (niveau fatal)
- Les erreurs du fournisseur d'IA (via circuit breaker ; aucune IA en production)
- Le scrubbing PII (NIR, IBAN) via `beforeSend`

## Métriques IA

Endpoint : `GET /api/admin/ai-metrics`

Pas d'IA en production (sauf choix par le propriétaire d'un modèle hébergé dans l'UE) ; sur le LAB, la section `local` décrit les exécutions réelles du modèle local (Ollama, qwen3:8b). Les compteurs Gemini restants sont hérités.

Données suivies :
- Tokens input/output par requête
- Latence du modèle (p50, p95)
- Coût estimé
- Taux d'erreur et fallback
- Circuit breaker state (open/closed/half-open)
