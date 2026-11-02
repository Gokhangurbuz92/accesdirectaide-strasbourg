# AccesDirectAide (ADA) — Strasbourg

Project rules for Claude Code. Load the linked documents on demand; never guess. The owner is addressed in Turkish; this file, code, identifiers and commits are English; public user-facing text follows the six-language contract (§1).

## 1. Product contract
- Platform that reduces non-take-up of French social rights: official aides and démarches, verified places/services, orientation for citizens, professionals, structures and institutions. First launch: Strasbourg / Eurométropole (Bas-Rhin); national rights where they apply. Target is the FULL approved Strasbourg scope, not an MVP.
- **Inventory**: 188 original entries = **173 protected** + **15 explicitly deferred** (the owner-narrowed rows N04, C20, A11, X10, X11, N08, C26, N09, R02, D09, R22 are inside the 173, not extra; D07 is an unresolved technical classification discrepancy: the reconciliation CSV `narrowed` column flags it, the owner scope document does not; it is neither approved nor rejected as a scope narrowing until the owner decides explicitly, and it does not change the 173/15 denominator). Only the owner changes this denominator; never silently add back or drop a feature. Canonical deferred and narrowed lists: `OWNER_SCOPE_REVISION_STRASBOURG_2026-10-21.md` (§8).
- **Seven surfaces**: Public · Citizen / Mon Espace · ADA Pro · Structure · Territory / Institution · Administration · Platform Ops / Super Admin. A surface being coded is not it being open.
- **Six languages**: `fr` `en` `tr` `ar` `de` `uk` (`src/i18n`). French verified text is canonical; Arabic is RTL with LTR French fragments; FALC is French simplification, not translation. Never hardcode user-facing text in one language; withhold untranslated content rather than machine-invent it.
- AI may search, explain and draft. It never decides eligibility, computes entitlements or states French law without an official source. Unknown stays unknown. Organisation ≠ establishment ≠ service ≠ right ≠ referral route.

## 2. Stack and architecture (verify in the repo)
- React 18 + Vite (JSX) in `src/` → `src/api/*` clients → serverless-style handlers `api/_handlers`, `api/_services`, `api/lib` → PostgreSQL via Drizzle (`src/db`, numbered additive migrations in `drizzle/`). Node ≥ 22, Tailwind **3.x**, i18next, Vitest, Playwright. Hosting: Vercel + Neon + Upstash, free tiers.
- Reference data and rules: `data/reference/`, `data/rules/`. Importers and harnesses: `scripts/`, `scripts/acceptance/`.
- Commands come from `package.json` (e.g. `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run lint:design-system`, `npm run verify`), not from generic examples.
- **Blueprint Trust** is the design system: tokens in `src/design/tokens.json`, `src/styles/tokens.css`, `tailwind.config.js`, global styles `src/index.css`; `npm run lint:design-system` forbids raw hex/palette colours in components. Keep the existing professional blue/teal institutional identity and its accessibility rules; no decorative widgets.

## 3. Truth hierarchy
Newest explicit owner instruction > newer actual source/test evidence > current contracts (this file, `docs/`, the active directive) > latest accepted report/checkpoint > older handovers > your inference. Never overwrite newer material with older. Report figures only after reading the newest reconciliation CSV; this file holds no volatile metrics.

## 4. Official data and legal sources
- Fail-closed publication (D-5 v2, `docs/pkg1-d5-publication-policy-and-structure-model.md`; sole writer `api/_services/content-verification.js`): official URL, source date, verification date, territory; no source → not published; import time is never a verification date.
- Sources: **Service-Public / DILA** fiches (rights), **Légifrance** (law; DILA LEGI subset in `data/rules/legal-articles*.json`), **FINESS** (authorised activities — guarantees no place or admission), **data·inclusion** (listings, attribution), Région Grand Est / ARS / strasbourg.eu (reuse limited). Reuse the existing importers (`scripts/official-guides.mjs`, FINESS and data·inclusion scripts); never build a second publication path.
- Rights rules (D11): nothing is validated without a named qualified reviewer (`docs/rules/D11_PROCEDURE_VALIDATION_EXPERTE.md`, `scripts/d11-review.mjs`). Public text never claims a person HAS a right (`api/lib/entitlementWording.js`).
- For any legal wording, dates, Alsace-Moselle or CNIL/RGPD question use the `ada-french-social-law` Skill.

## 5. Acceptance
Implementation ≠ activation ≠ DB publication ≠ browser visibility ≠ legal acceptance ≠ delivered e-mail ≠ a cron that ran ≠ RGAA audit. Engineering status = the reconciliation CSV (categories A–D); formal operational acceptance is human/external and never invented. Documentation, mocks, simulations and percentages are not features.

## 6. Environments and security
- **Production**: restricted public beta. No deploy, Production DB write, migration, cron run, secret rotation, DNS/provider change, surface opening or paid service without explicit owner action in the current task. A new env flag is not legal compliance; `MAILER_PROVIDER=noop` is not delivery; `gdpr-purge` stays off without an approved retention policy. Executed migrations are never reapplied.
- **LAB** (disposable DB, synthetic accounts) is where journeys and destructive tests run. Preview shares the Production DB (owner-deferred isolation): no Preview writes, migrations, seeds or crons.
- **The GitHub repository is PUBLIC by explicit owner decision (2 November 2026), superseding the earlier private requirement. Public visibility is not an open-source licence: treat it as a public GitHub repository, not an open-source project, unless a licensing decision is documented.** Never recommend or attempt to change its visibility or GitHub settings unless the owner explicitly changes this decision. Because it is public: never commit or expose API keys, tokens, credentials, `.env` values, `~/.ada-lab/` contents, personal data, sensitive documents or private infrastructure configuration; run the secret scan (`npm run security:secrets`, `npm run secrets:bundle` on the build) and check for data exposure before any push or release. Public source never grants public access to databases, admin interfaces, Production secrets or restricted environments; all Production restrictions and owner-approval requirements above still apply.
- Keep auth, CSRF, rate limits, audit, isolation, publish/hold rules; no personal data in tests or reports.

## 7. Working discipline
- Continuity: read the newest checkpoint and report first; do not redo verified work; implement only what remains; update the existing register/inventory; report a delta.
- Completion needs fresh evidence (command output, test, browser run). Never skip or weaken a failing test.
- Selective tests while developing; one integrated, SHA-pinned gate at milestones. Prefer large coherent packages; do not stop for routine permission inside delegated reversible scope; batch real owner decisions into one final package.
- Accessibility is a requirement: keyboard, screen reader, RTL, 200 % zoom, FALC.
- Do not commit, push or open PRs unless asked.

## 8. What to load
Control documents are in `../../STRASBOURG_FULL_PRODUCT_PLAN/` relative to the repo (outside git; confirm the path first).

| Task | Load |
|---|---|
| Any campaign | newest `CONTROL/R*_HANDOVER_CHECKPOINT.md`, newest `CONTROL/directives/R*_DIRECTIVE.md`, newest `STRASBOURG_173_RECONCILIATION_*.csv`, `CONTROL/R35_OWNER_REQUEST_REGISTER.md` |
| Scope / deferred | `OWNER_SCOPE_REVISION_STRASBOURG_2026-10-21.md`, `FULL_PRODUCT_ATOMIC_INVENTORY.csv` |
| Owner decisions | `CONTROL/directives/R35_OWNER_DECISION_UPDATE.md` and newer directives |
| Publication, rules | D-5 policy, `sources/README.md`, `docs/rules/*`, `data/rules/*` |
| Coverage, orientation | `data/reference/social-*.json`, `api/lib/multi-need.js`, newest report |
| Legal / privacy | `LEGAL_FR/00_INDEX.md`, `LEGAL_FR/SOURCES_OFFICIELLES.md`, `docs/rgpd.md`, `REGISTRE_RGPD.json` |
| Security, deploy, DB | `docs/security.md`, `docs/deployment.md`, `docs/database.md`, `docs/runbooks.md` |
| Accessibility, languages | `docs/accessibility-checklist.md`, `src/i18n`, newest `R*_MULTILINGUAL_ACCESSIBILITY_REPORT_EN.md` |
| Providers, activation | newest `R*_FEATURE_ACTIVATION_MATRIX.csv`, `scripts/feature-readiness.mjs` |

## 9. External Skills: ADA precedence
Generic Skills yield to this file:
- `frontend-design`: Blueprint Trust and the existing brand outrank "distinctive / risk-taking" advice; use it for craft and critique only.
- `systematic-debugging`: after 3 failed fixes, record the architectural finding and continue independent work; ask the owner only for a real external decision. `superpowers:*` references are not installed.
- `verification-before-completion`: evidence before every claim, but selective tests while developing and the full gate at milestones (§7).
- `context-engineering`: Prisma / Tailwind 4 / default-export examples are illustrations; the stack is §2. No database MCP; no Production connection for agents.
- `postgres`: read-only exploration and migration guidance for Drizzle/Neon. TimescaleDB, pgvector, PostGIS only if an extension is verified available and approved. Destructive DDL needs owner action (§6).

## 10. Checkpoint pointer
Current state lives only in the newest `CONTROL/R*_HANDOVER_CHECKPOINT.md` and its report; read it, do not copy it here. Anything that checkpoint marks as owner action or pending (migrations not applied, surfaces closed, providers unconfigured) is not done.
