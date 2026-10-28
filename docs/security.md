# Sécurité

> Dernière revue : 2026-03-24

## Authentification

| Type | Méthode | Durée session | MFA |
|------|---------|:---:|:---:|
| Admin | Compte nominatif (`scripts/admin-bootstrap.mjs`) → JWT (Bearer) ; `ADMIN_TOKEN` / `ADMIN_PASSWORD` / `BYPASS_SECRET` refusés en production | 24h | ✅ TOTP |
| Pro | JWT (Bearer) | 24h | ✅ TOTP |
| Citoyen | JWT (HttpOnly cookie) | 7j | ❌ |
| Crons | `CRON_SECRET` header | N/A | N/A |

## Protections actives

| Mesure | Implémentation | Fichier |
|--------|---------------|---------|
| **CSRF** | Double-submit cookie | `api/_utils/csrf.js` |
| **Rate limiting** | Upstash KV, 12 action types | `api/_utils/rateLimit.js` |
| **Lockout citoyen** | 5 tentatives → 15min lock | `api/_handlers/auth/login.js` |
| **Password policy** | 8+ chars, A-Z, a-z, 0-9 | `api/_handlers/auth/signup.js` |
| **PII blocking** | NIR/IBAN/CB détectés et bloqués | `api/lib/prompt-sanitizer.js` |
| **Chiffrement PII** | AES-256-GCM | `api/_utils/vault-crypto.js` |
| **Circuit breaker** | Opossum (appels au fournisseur d'IA ; aucune IA en production) | `api/_utils/circuit.js` |
| **Pas de clé IA non approuvée** | `GEMINI_API_KEY` / `GOOGLE_API_KEY` refusées en production | `scripts/release-preflight.mjs` |
| **Secrets scan** | Gitleaks CI + GitGuardian | `.github/workflows/secrets-scan.yml` |
| **SAST** | Semgrep CI | `.github/workflows/semgrep.yml` |

## Security Headers (production)

| Header | Valeur |
|--------|--------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' sha256-...` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

## Hashing

| Usage | Algorithme |
|-------|-----------|
| Mots de passe | scrypt (salt + 64 bytes) |
| Tokens auth | SHA-256 |
| Chiffrement vault | AES-256-GCM |

## Token Refresh — Décision

**Status** : Non implémenté (décision consciente)

**Pourquoi c'est acceptable** :
- JWT citoyen expire après 7 jours
- Lockout après 5 tentatives (15 min)
- Rate limiting sur login (IP + email)
- Cookie HttpOnly + Secure + SameSite=Strict
- Pas de données financières exposées

**Quand l'implémenter** :
- Si le site gère des données très sensibles
- Si on dépasse 10 000 utilisateurs actifs
- Si un audit de sécurité externe le recommande

## CSP Nonce — Status

**Actuel** : SHA-256 hashes statiques dans `vercel.json`
**Idéal** : Nonce dynamique par requête (middleware edge Vercel)
**Risque actuel** : Faible — les scripts sont tous connus et hashés
**Quand** : Si audit sécurité le recommande ou ajout de scripts inline dynamiques

## Signalement vulnérabilité

Si vous trouvez une vulnérabilité de sécurité :
- **Email** : <adresse sécurité de l’association, à définir>
- **Ne créez PAS** d'issue publique sur GitHub
- Nous répondrons dans les 48h
