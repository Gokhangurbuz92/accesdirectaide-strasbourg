# ADR 022: Audience measurement — none by default

## Status
Accepted (R29, 31/10/2026) as the engineering default. Switching measurement on is a separate decision (owner + data-protection review) and needs a new ADR.

## Context
- The site serves people looking for social rights; the visit of such a page can itself be sensitive. The French regulator (CNIL) exempts audience
  measurement from consent only under strict conditions (strictly necessary purpose, aggregated anonymous statistics, no cross-site tracking, limited
  retention, information and objection). Whether a given provider meets them is a legal assessment, not an engineering one.
- The code already contained Vercel Web Analytics and Speed Insights (cookieless, publisher-only), a self-service objection kept on the device
  (`src/lib/audienceObjection.js`) and an address reducer that never sends query strings, fragments or identifiers (`measuredUrl`). The scripts were
  loaded by default outside the public beta, while the decision (ADR-022) was still open.
- Options considered: (a) no tracker that needs consent; (b) a consent banner « Accepter / Refuser / Personnaliser » with a proof record and a 6-month choice.

## Decision
1. **No audience measurement by default.** The measurement scripts load only when `VITE_AUDIENCE_MEASUREMENT=on` is set at build time, and never in
   the public beta (`VITE_PUBLIC_BETA=true`) or in mock/offline mode (`frontendEnv.flags.audienceMeasurement`, `src/App.jsx`).
2. **No tracker that needs consent, ever, without a new ADR.** So no consent banner is needed: the banner only informs about strictly necessary
   storage and links to the cookie page (option (a)).
3. **The public texts follow the flag**: the cookie banner, the cookie page and the privacy page say « nous ne mesurons pas l’audience » while the
   flag is off (three states: beta, off, on). The objection control stays available and is honoured if measurement is switched on later.
4. **If measurement is ever switched on**: the existing guarantees apply unchanged (cookieless provider, `measuredUrl`, `dropIfObjected`), the cookie
   page is completed (retention at the provider, transfer safeguards), and the data-protection review is recorded first.

## Consequences
- Usage figures (visits, people helped) are not available; the Impact page says so and shows only the published catalogue counts.
- `@vercel/analytics` and `@vercel/speed-insights` stay as dependencies but are not loaded (licence inventory: MPL-2.0, used unmodified).
- Tests: `tests/unit/r29-adr022-audience.test.jsx`.
