# PKG-3 — Video appointments: activation checklist (production stays OFF until every line is approved)

Owner decision 2026-10-19: video appointments are part of the Strasbourg Full Product and are implemented. Production activation is OFF.

## What is implemented (code, tested in the LAB)
* Two modalities per appointment: `IN_PERSON` / `VIDEO` (`ProAppointment.mode`, CHECK). Structures choose `bookingMode` (IN_PERSON / VIDEO / BOTH), services choose `modes`, opening periods choose `modes`; a citizen only sees what is bookable **now** (structure x service x video activation).
* A VIDEO booking requires the person's explicit agreement (`visioCitizenConsentAt`); the structure validates video (`visioApprovedAt`, a fresh room nonce per approval).
* Join (`POST /api/rdv/appointments/:id/visio`, `POST /api/pro/appointments/visio`): only the person of the appointment or a member of its structure; active appointment, approved, consented, from 15 min before start to 15 min after end; provider activated. The response is a no-store JSON body: `{ domain, roomName, jwt }`. No link by e-mail, in the calendar file, in a URL or in a log.
* Token: HS256 JWT for a JWT-protected Jitsi (self-hosted with token auth, or 8x8 JaaS): `aud=jitsi`, `iss=<app id>`, `sub=<domain>`, `room=<HMAC room name>`, `nbf/exp` = join window, `context.features` recording / live streaming / transcription / outbound calls **false**. Display names are generic ("Conseiller·e" / "Personne accompagnée").
* `api/lib/video-provider.js` refuses video unless `VIDEO_PROVIDER=jitsi-jwt` + domain + app id + 32+ char secret, and in production also `VIDEO_PRODUCTION_APPROVED=true`; a sandbox configuration can never run in production.

## What is NOT verified (external dependency)
* No real video provider was contacted. The LAB uses a non-routable sandbox domain; the browser test proves that the page asks the server, receives a token in memory only, and that the shipped Content-Security-Policy blocks the provider script — the screen then says plainly that video could not be loaded. A real meeting needs the items below.

## Activation (all required, in this order)
1. Provider and hosting decision (self-hosted Jitsi with JWT auth in the EU, or JaaS with an EU region) and a signed DPA; DPO/GDPR record (purpose, retention: none for media, no recording), privacy notice text.
2. Security review: token secret stored as a secret, rotation procedure; provider configured to REQUIRE tokens (anonymous rooms disabled), lobby on, recording disabled server-side.
3. Environment: `VIDEO_PROVIDER=jitsi-jwt`, `VIDEO_JITSI_DOMAIN`, `VIDEO_JITSI_APP_ID`, `VIDEO_JITSI_SECRET`, then `VIDEO_PRODUCTION_APPROVED=true` (never `VIDEO_SANDBOX` in production).
4. Headers (vercel.json, reviewed change): add `https://<domain>` to `script-src` and `frame-src`, `https://<domain> wss://<domain>` to `connect-src`, and `Permissions-Policy: camera=(self "https://<domain>"), microphone=(self "https://<domain>")` — see `activationHeaderSources()`; until then the shipped headers block the provider (asserted by `tests/unit/pkg3-video-headers.test.js`).
5. A provider-level test in a staging environment with two real browsers (person + professional), then human acceptance.

## Outlook calendar (B10) — same rule
OFF by default (`OUTLOOK_ENABLED`), production also needs `CALENDAR_PRODUCTION_APPROVED=true`, and `scripts/release-preflight.mjs` still fails a release with `OUTLOOK_ENABLED=true` until the owner lifts it. Needs a Microsoft app registration (external) for a real sign-in; the LAB test runs the whole flow against an in-process fake authority.
