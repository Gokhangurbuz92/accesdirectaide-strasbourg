# RGPD — Conformité

> Dernière revue : 2026-09-02

## Données collectées

> R44 : « Purge auto ✅ » = une étape existe dans `cron/gdpr-purge` ; elle ne s'exécute pas tant que la politique de conservation
> versionnée (`api/_services/retention-policy.js`) est « PROPOSED — NOT APPROVED » : le job ne fait qu'un essai à blanc (aucune suppression).
> Toutes les durées sont des propositions du dossier R43 § 3.1, à valider par le responsable de traitement.

| Donnée | Base légale | Durée conservation | Purge auto |
|--------|-----------|-------------------|:---:|
| Email citoyen | Consentement | Jusqu'à suppression | ❌ |
| Conversations chat | Intérêt légitime | 90 jours | ✅ |
| Logs d'audit (AuditLog) | À décider (RT) — aucune obligation légale identifiée ; repère : recommandation CNIL 2021-122 (6 mois à 1 an) | 365 jours (proposition) | ✅ |
| Logs d'audit pro (ProAuditLog) | À décider (RT) — aucune obligation légale identifiée ; repère : recommandation CNIL 2021-122 | 365 jours (proposition) | ✅ |
| Mesure d'audience Vercel (Web Analytics, Speed Insights — aucun cookie selon l'éditeur, NON VÉRIFIÉ) | Intérêt légitime si l'exemption CNIL est vérifiée | Durée chez Vercel à confirmer | ❌ |
| Consent log | Preuve légale | 3 ans (1095 jours) | ✅ |
| User consents | Consentement | Jusqu'à expiration | ✅ |
| Tokens auth expirés | — | Après expiration | ✅ |
| Invitations expirées | — | 30 jours après expiration | ✅ |
| Tokens Outlook expirés | — | 30 jours après expiration | ✅ |
| Diagnostics partagés | Consentement | Expiration ou 90 jours | ✅ |
| Versions d'entités | Intérêt légitime | 90 jours | ✅ |
| Métriques IA | — | 90 jours | ✅ |
| Rendez-vous (ProAppointment) | Intérêt légitime | 2 ans puis anonymisation | ✅ |

## Prestataires techniques : rôles, transferts, contact Mailjet (notice v6, 17/11/2026, non approuvée)

> Sources : vérification des pages publiques des prestataires du 15/11/2026 (`CONTROL/v2/V4_SAGLAYICI_DOGRULAMA_2026-11-15.md`), relue le 17/11/2026
> pour la v6 (`CONTROL/v2/V6_METIN_FARKI_FR.md`) ; détail par prestataire dans `REGISTRE_RGPD.json` (`sous_traitants`, généré par `scripts/gdpr-suite.mjs`).
> Aucun accord n'est signé : ils sont intégrés aux conditions de service.

- **Rôles.** Pour les données des personnes, Vercel, Neon (Databricks), Upstash et Mailjet (Sinch) sont sous-traitants (art. 28). Certains sont **aussi
  responsables de traitement** pour des données techniques liées à leur service : Vercel (données d'usage, DPA § 4.b), Sinch (acheminement des messages,
  spam, fraude, sécurité du réseau, DPA § 3 a iv), Upstash (son DPA exclut sa propre sécurité et l'analyse de son service). La notice dit « notamment » :
  les conditions de Microsoft, Scaleway et Cloudflare n'ont pas été relues sur ce point.
- **Transferts.** Clauses contractuelles types (UE) 2021/914 pour les quatre ; Vercel Inc., Upstash, Inc. et Databricks, Inc. sont en outre sur la liste
  officielle du Data Privacy Framework (relue le 17/11/2026 ; à relire à chaque version de la notice). Pas Mailjet : la société inscrite est Mailgun Technologies, Inc.
- **Durées chez les prestataires.** Vercel : journaux d'exécution 1 jour sur l'offre Pro, 30 jours si l'option Observability Plus s'applique au projet
  (elle est activée par défaut pour les équipes passées en Pro depuis le 03/04/2026) — **non activée, vérifié en lecture seule par l'API Vercel le 17/11/2026** (équipe en Pro depuis le 21/01/2026) ; la notice garde le critère, l'option pouvant être activée à tout moment.
  Mailjet : statistiques 90 jours (offre gratuite) ou 13 mois (offre payante) — **offre du compte non vérifiée** ; aucune durée publiée pour le contenu des
  messages. Neon : historique de 6 heures sur l'offre gratuite (une offre payante l'allonge : la notice devrait alors changer).
- **Contact Mailjet (décision C6 du 17/11/2026 : l'adresse n'est copiée nulle part).** L'API d'envoi enregistre l'adresse de chaque destinataire comme
  « contact » pour la durée du compte Mailjet. `api/_services/mail-contact-erasure.js` (API « GDPR Delete contacts ») le supprime ; une réponse autre que
  200 est un échec (`failed`), jamais une suppression.
  - **Effacement d'un compte** (`privacy.js` `executeApprovedDeletion`) : la suppression chez Mailjet est demandée **avant** l'effacement en base, tant
    que l'adresse est encore dans la ligne du compte. En cas d'échec, rien n'est effacé : la demande passe en `BLOCKED` / `MAIL_CONTACT_RETRY`
    (écran admin « Vie privée », bouton « Relancer » ; relance quotidienne par la purge quand elle tourne en exécution). Fenêtre bornée : 3 jours après
    le premier échec, et jamais au-delà de 3 jours avant l'échéance d'un mois (art. 12, 3). Ensuite le compte est effacé quand même et l'échec est
    enregistré sans adresse (`AuditLog` `MAIL_CONTACT_ERASURE_FAILED`, « intervention humaine requise »).
  - **Compte jamais confirmé (étape 6c)** : une tentative avant la transaction ; les comptes sont supprimés quoi qu'il arrive (promesse des 8 jours) ;
    un échec est enregistré et nomme l'étape `mailContactErasure`. **Ancienne adresse après un changement** : une tentative après la réponse ; un échec
    est enregistré.
  - **Intervention humaine** : la liste « Suppressions chez Mailjet à vérifier » (écran « Vie privée ») et le compteur « À traiter » montrent chaque
    signalement (motif, étape, statut HTTP, nombre ; ni adresse, ni identifiant de contact, ni identifiant de compte). Dans Mailjet → Contacts, supprimer
    les contacts dont l'adresse n'est plus celle d'un compte (ou le demander au support de Mailjet), puis noter ce qui a été fait (note sans adresse).
  - **Effet sur le délai d'effacement** : au plus 3 jours de report, uniquement pour une demande approuvée, et jamais au-delà de 3 jours avant l'échéance
    d'un mois ; une approbation tardive n'attend pas. Le délai d'un mois de l'art. 12, 3 est donc tenu.
  - **Rien dans Upstash.** L'état des nouveaux essais vit dans Postgres, dans la demande elle-même (`DSRRequest.reviewOutcome.mailContactRetry` : dates et
    nombre d'essais, sans adresse) ; l'adresse reste dans la ligne du compte jusqu'à l'effacement. Aucune migration. L'ancienne liste d'identifiants de la
    v5 dans Upstash n'est plus jamais écrite : la purge essaie chaque identifiant une fois, supprime la liste, et signale sans adresse ceux que Mailjet
    n'a pas confirmés. Sans effet quand `MAILER_PROVIDER` n'est pas `mailjet`.

## Droits des utilisateurs

| Droit | Endpoint | Implémenté |
|-------|---------|:---:|
| **Accès** | `GET /api/auth/export-data` | ✅ |
| **Suppression** | `DELETE /api/auth/delete-account` | ✅ |
| **Portabilité** | `GET /api/auth/export-data` (JSON) | ✅ |
| **Rectification** | Via profil utilisateur | ✅ |
| **Opposition** | Via suppression de compte | ✅ |

## Purge automatique (GDPR Purge Cron)

Le cron `gdpr-purge` s'exécute hebdomadairement et supprime :

| Table | Condition | Délai |
|-------|-----------|-------|
| `ConversationLog` | `createdAt < 90j` | 90 jours |
| `AuditLog` | `timestamp < 365j` | 1 an |
| `ProAuditLog` | `createdAt < 365j` | 1 an |
| `ConsentLog` | `created_at < 3 ans` | 3 ans (1095 jours) |
| `UserConsent` | `expiresAt < NOW()` | Après expiration |
| `SharedDiagnostic` | Expirés OU `createdAt < 90j` | 90 jours |
| `AuthToken` | `expiresAt < NOW()` | Après expiration |
| `Invitation` | `expires_at < NOW() - 30j` | 30 jours après expiration |
| `ProOutlookToken` | `expiresAt < NOW() - 30j` | 30 jours après expiration |
| `EntityVersion` | `createdAt < 90j` | 90 jours |
| `AiMetric` | `createdAt < 90j` | 90 jours |
| `ProAppointment` | `createdAt < 730j` | 2 ans → anonymisation |

### Anonymisation ProAppointment

Les rendez-vous de plus de 2 ans sont anonymisés (pas supprimés) :
- `beneficiaryName` → `[anonymisé]`
- `beneficiaryPhone` → `NULL`
- `citizenEmailSnapshot` → `NULL`
- `notes` → `NULL`

## Chiffrement des données sensibles

| Donnée | Méthode |
|--------|---------|
| Mots de passe | scrypt (salt + 64 bytes) |
| NIR/IBAN/CB dans prompts | Bloqués par sanitizer |
| Tokens OAuth | AES-256-GCM (`api/_utils/outlook-token-crypto.js` pour Outlook, `api/_utils/vault.ts` pour les autres secrets) |
| Tokens MFA | AES-256-GCM |

## Cookie banner

Implémenté dans `src/components/CookieBanner.jsx` (bandeau d'information, option A de `LEGAL_FR/03_COOKIES_TRACEURS.md`).
- Un seul bouton « Accepter » : il mémorise seulement que l'information a été vue (`ada_cookie_consent` en localStorage, sans expiration aujourd'hui).
- Le choix **ne commande aucun chargement** : Vercel Analytics et Speed Insights se chargent dans tous les cas ; Sentry (erreurs) aussi si un DSN est configuré.
- Sentry Session Replay est **désactivé par défaut** (`VITE_SENTRY_REPLAY` ≠ `true`) ; l'activer exige un vrai recueil de consentement.
- Le bandeau **n'écrit pas** dans `ConsentLog`.

## PII Detection

Le `api/lib/prompt-sanitizer.js` détecte et bloque :
- Numéros de sécurité sociale (NIR)
- IBAN
- Numéros de carte bancaire

## Contact protection des données
Contact protection des données : [À COMPLÉTER : adresse de contact protection des données]. Aucun DPO désigné (décision ouverte).
