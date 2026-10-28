# @ada/shared

Constantes, enums, et validators Zod partagés entre frontend et backend.

## Usage

```js
// Import tout
import { AID_CATEGORIES, loginSchema } from '@ada/shared';

// Imports granulaires (tree-shakeable)
import { AID_CATEGORIES, AID_CATEGORY_LABELS } from '@ada/shared/constants';
import { loginSchema, searchSchema } from '@ada/shared/validators';
```

## Contenu

### Constants (`constants.js`)
- `AID_CATEGORIES` / `AID_CATEGORY_LABELS` — 12 catégories d'aides
- `AID_STATUSES` / `CONTENT_STATUSES` — Statuts de publication
- `CONTENT_TYPES` — AIDE, DEMARCHE, STRUCTURE, ACTUALITE
- `REPORT_REASONS` / `REPORT_STATUSES` — Signalements
- `APPOINTMENT_STATUSES` / `RDV_BOOKING_MODES` — Rendez-vous
- `INGEST_JOB_STATUSES` / `DATA_SOURCES` — Ingestion
- `TERRITORY_SCOPES` / `USER_ROLES`

### Validators (`validators.js`)
- `loginSchema` / `signupSchema` — Auth
- `searchSchema` — Recherche full-text
- `feedbackSchema` — Feedback utilisateur
- `contentReportSchema` — Signalements
- `chatInputSchema` — Assistant IA
- `diagnosticInputSchema` — OpenFisca
- `appointmentCreateSchema` — Rendez-vous
- Utilitaires : `emailSchema`, `slugSchema`, `paginationSchema`
