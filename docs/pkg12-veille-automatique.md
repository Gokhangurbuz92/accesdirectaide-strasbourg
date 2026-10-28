# PKG-12 — Veille automatique (automatic verification chain)

Owner decision D-5 v2 (2026-10-25), confirmed by the owner's definitive directive the same day: public information (aides, démarches, dispositifs, structures, directory data) is found, checked against official sources, published, corrected and withdrawn **by the system**, with evidence; the owner supervises a dashboard (`/admin/veille`) and is never asked to validate a record. Decision record: `STRASBOURG_FULL_PRODUCT_PLAN/OWNER_DECISION_D5_V2_AUTOMATIC_VERIFICATION_2026-10-25.md`.

## Modules (`api/_services/verification/`)

| File | Role |
|---|---|
| `fetcher.js` | polite GET of official sources only: allow-list or registry-attested domains, every redirect re-checked, one request at a time per host (`ADA_VERIFICATION_MIN_GAP_MS`, default 1200), size and time limits, conditional requests (`headers`, 304), `ADA_VERIFICATION_NETWORK=off` |
| `dila.js` | Service-Public open-data archive (DILA, daily, Licence Ouverte): fiches and dossiers, redirections, date of last important change, coverage (territory), text, facts, online services, places to go, acronyms, legal references; on-disk cache asked again only if modified (`ADA_VEILLE_CACHE_DIR`) |
| `pages.js` | other official pages (CeA, Strasbourg, Région…): chapters, fingerprint, facts, « Vérifié le » |
| `registries.js` | SIRENE (recherche-entreprises.api.gouv.fr) and the Annuaire de l'administration |
| `structure-check.js` | identity / place / territory of an organization; `sameStreet` for identities (number and street words); corrections only when official sources agree |
| `contacts.js` | never a person's own e-mail address (prénom.nom@…) in a public listing |
| `offices.js` | Annuaire rows as directory records; plain and FALC texts per kind of office (general missions, « services vary from one place to another ») |
| `texts.js` | normal summary + FALC from the source (local model drafts) and the automatic checks (same checks at every attempt) |
| `sources.js` | registry of official sources: seed by level and authority (`capabilities`), weekly refresh from the Annuaire (attested sites) and from Service-Public (cited online services, démarches only, labelled for what they are: State `*.gouv.fr`, European institution, social security body or service OPERATOR), nightly health of the feeds, monthly visit of every site (moved elsewhere → paused, replaced → successor, unreachable ×3 → set aside), what was left out and why |
| `resources.js` | the machine: disk floor (`ADA_VEILLE_MIN_FREE_GB`, 10), no run during a native QA campaign, the model loaded only with room for it (`ADA_VEILLE_MIN_MEMORY_PCT`, 25 % available) and kept writing until macOS reports a critical memory pressure or swap exceeds `ADA_VEILLE_MAX_SWAP_GB` (12; macOS keeps swap allocated after a pressure passed, so the pressure level is the main signal and the disk floor watches the swap files) — once loaded, its own memory is not « available » any more —, model threads by time of day (`ADA_VEILLE_MODEL_THREADS`), model unloaded after the run; on with `ADA_VEILLE_RESOURCE_GUARD=on` (LAB) |
| `control.js` | one run at a time (advisory lock + heartbeat: a run silent for 20 min is dead, closed as `interrupted` and continued), the owner's pause (`veille-pause`), the emergency stop |
| `chain.js` | one run: sources → aides, démarches, dispositifs → structures (+ duplicates) → growth (new offices, new fiches) → monthly visits → self-check → journal |
| `audit.js` | the D-5 v2 contract on everything public (ledger decision, official evidence, no personal address, freshness, duplicates) |
| `digest.js` | the owner's dashboard and a record's history (events, ledger, source versions, content versions) |
| `schedule.js` | LAB schedule: a tick every 5 minutes runs the 03:17 run when it is due (after sleep, a stop, a QA campaign or the pause) |

Entry points: LAB server (`scripts/lab-server.mjs`, `ADA_VEILLE_RUNNER=inline`, guard on), `node --import tsx scripts/lab-local.mjs veille [status | pause | resume | audit]` (`--max-minutes`, `--force`), `GET /api/cron/veille` (CRON_SECRET; bounded by `ADA_VEILLE_MAX_MINUTES`, texts only with `ADA_VEILLE_TEXTS=on` and a local model), `GET|POST /api/admin/veille` (dashboard, `?history=kind:id`; actions `run` (LAB), `pause`, `resume`; MFA session for actions).

## What decides publication (fail-closed, bounded, reversible)

- **Authority**: a page is a source only if its site is an authority for that kind of information (registry `capabilities`: `aides`, `demarches`, `structures`…); a fiche applies only if its coverage includes the Bas-Rhin; an unknown or look-alike site never.
- **Identity**: an organization is matched to an Annuaire office or a SIRENE establishment by id, SIRET, or name **and** the same street; duplicates are merged only on the same SIRET or Annuaire entry, through the duplicate register (non-destructive).
- **Change**: a record is checked when due (every night for records read from a feed, every other day for a site's page, every week for a SIRENE identity, sooner when a date is near) and at once when its fiche changed or disappeared in the day's archive. Texts carry the version of the source they were written from: an important change not yet rewritten is never forgotten.
- **Texts**: no number absent from the source, FALC rules, faithfulness reading, no condition the source removes for everybody (an exception — « aux mineurs », « si vous… » — does not remove it).
- **Outages are not closures**: an archive much smaller or older than the last one, an Annuaire or SIRENE outage, a page missing once: nothing is withdrawn; a page is withdrawn only when still missing the next day; at most 20 % of a kind (≥ 5) are withdrawn in one night.
- **Transactions**: content, bookkeeping and the verification commit together or not at all; every content change keeps the previous version (`EntityVersion`), restorable from `/admin/versions?type=&id=` (a restored record is held, then checked again by the system).
- **Supervision**: a person's refusal or hold recorded after the veille's first automatic decision stays as it is (the veille neither lifts it nor publishes over it,
  and says why on the dashboard); the decisions of the earlier per-record queue (before that first decision — the 73 AI-assisted decisions of 2026-10-24) are superseded
  by the evidence and stay in the history; an edit or rollback hold is checked again by the system.
- **Readable addresses**: SIRENE and some Annuaire rows write addresses in capitals without accents; the record keeps its own wording of the same street and number
  (or the latest earlier version's), otherwise the official text is written in readable case (easy-to-read texts never write whole words in capitals).
- **Self-check** at the end of every run: a public record without a ledger decision, with evidence outside the official sources, or showing a personal address is withdrawn at once.

## Contract families (D-5 v2)

1. **Legacy human verification of files** (WS2): `tests/unit/ws8-frozen-launch-data.test.js`, a frozen WS8 test kept unchanged as historical evidence; it fails while the static seed files are not flagged by a person — expected under D-5 v2.
2. **Current automatic source verification**: `tests/unit/d5v2-publication-contract.test.js`, `tests/unit/veille-*.test.js`, `tests/integration/veille-*-db.test.js`; attribution « ada-veille-automatique » (role system), never presented as a person's review.
3. **Human approvals that stay human** (personal data, DSR / erasure, legal holds, organization closure, privileged accounts): the chain imports none of their services; their routes require a named administrator with MFA.

## Data

- `VeilleEvent` (0035): what happened to which record and why (changes, failures, new records; details: source change, changed fields, version for rollback, legal and territorial changes).
- `Aide|Demarche|Dispositif|Structure.auto_check` (0035, Dispositif 0037): last automatic check (source, authority, tier, next check, texts and their source version); the public part is `verification_auto` (`publicVisibility.publicAutoCheck`).
- `Aide.etapes_falc`, `Demarche.etapes_falc`, `Demarche.conditions_falc` (0035, 0036); `Dispositif.falc_origin` (0037).
- `SourceRegistryEntry.level / attestation / attestation_url` (0035), `health / content_version / last_change_at / redirects / successor_source_id` (0037).
- `SourceSnapshot`: one row per source reading that changed (fingerprint, facts, chapter hashes, DILA date, coverage, references).
- `CronRun`: `veille` (status `success | partial | stopped | error | interrupted | skipped`, metrics: counts, progress, archive, machine, model, caps, alerts, audit, registry), `veille-registre`, `veille-pause`.
- Decisions: `ContentVerification` (reviewer `ada-veille-automatique`, role `system`), `StructureDuplicateDecision` for merges.

## Tests

`tests/unit/veille-automatique.test.js`, `tests/unit/veille-hardening.test.js` (contacts, machine, schedule, identity, authority, conditions and exceptions, matching, no weakening on retry, registry, offices), `tests/unit/d5v2-publication-contract.test.js`; `tests/integration/veille-chain-db.test.js` (runs on real PostgreSQL with doubles of the sources and the model), `tests/integration/veille-hardening-db.test.js` (lock, dead run, pause, stop, machine guard, caps, broken / older archive, refused verification rolled back, rollback and re-verification, authority, look-alike, territory, page missing once, personal address, Annuaire outage, dispositifs, registry growth and visits, self-check, dashboard and history).

## Automatic startup of the LAB server (owner decision 2026-10-25)

`lab-local autostart enable` installs a user LaunchAgent (`~/Library/LaunchAgents/fr.accesdirectaide.lab.plist`: `RunAtLoad`, `KeepAlive.SuccessfulExit=false`,
`ThrottleInterval` 60 s, `TZ=Europe/Paris`, no secret in it) that runs `lab-local supervise` in the owner's session. The supervisor (`scripts/lab-supervisor.mjs`):

- starts `scripts/lab-server.mjs` (127.0.0.1 only) at login and keeps **one** of them: a LAB server already serving the port (started by hand) is left alone,
  anything else on the port is never touched, a second supervisor exits at once (lock `~/.ada-lab/run/supervisor.pid`), `lab-local start` refuses to start a
  second server;
- gives port 3000 to a **native QA campaign** (detected like the veille does, `QA_PROCESS`): the server is stopped and the local model unloaded, a hand-over is
  recorded and the server comes back five minutes after the last QA process. A launcher checks its ports within a second of its start, sooner than any watch:
  `RC5_AUTHZ_QA/run_native_qa.sh ./ADA_…_QA_vN.command` (or `lab-local server qa-handover` first) gives it the port for sure; without it the first attempt may
  stop at its preflight (`port busy 3000`) and the next one gets the port;
- restarts a crashed server after 10 s, 30 s, 2 min, 5 min, then 15 min; six crashes in an hour hold it for an hour; the database or the build not ready is
  waited for (not a crash);
- the owner's temporary stop (`server stop`) holds until `server start` or the next restart of the Mac; `server restart` after a `build`;
- writes bounded, redacted logs (`~/.ada-lab/logs/supervisor.log` 1 MB, `server.log` 2 MB, three files each; `launchd.log` truncated past 1 MB).

The server's shutdown resets its open connections before closing the listener (no TIME_WAIT on the port: the QA launchers bind it without `SO_REUSEADDR`), and
idle keep-alive connections are left to the client to close; it asks the veille in progress to stop at its next record with `SERVER_STOP`, which, like a stop
for the machine (`NATIVE_QA_RUNNING`, `DISK_LOW`), is **continued** at the next start — only the owner's pause or stop (`OWNER_STOPS`) ends a night's run.
`/__lab/health` (127.0.0.1) tells the supervisor and `server status` which process serves the LAB. A user LaunchAgent runs nothing while the Mac is off or no
session is open; no power, sleep or startup setting of the Mac is changed (the veille catches a missed night up a few minutes after the next start).
Tests: `tests/unit/lab-supervisor.test.js`, `tests/unit/veille-hardening.test.js` (stop codes, 03:17 across both daylight-saving changes).

## Owner LAB activation (2026-10-25)

Verified backup first (`~/.ada-lab/backups/`, restore checked table by table, identity fingerprints of the administrator account, the audit journal and the earlier
decisions), then migrations 0035–0037, build, and the first runs from the command line. Two refinements came from that live run (after the RC29 R3 native campaign;
to be part of the next one): the memory rule above (the first run deferred every text after the first because the loaded model itself lowered the « available »
figure below 25 %) and the truthful labels of the cited online services; `veille --max-minutes N` is a run with an option (it was read as a sub-command).
The registry's refresh was then run once more so that the Annuaire-attested sites carry the refined levels (associations, chambers and other service operators are
`OPERATEUR`, no longer `NATIONAL`); a site retired for its successor stays retired after a refresh. The public structure page shows the département from the record or
else its postal code (never « Département : » followed by nothing) and the provenance note is spelt correctly (`tests/unit/structure-display-labels.test.jsx`).
