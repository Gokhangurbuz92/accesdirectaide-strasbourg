/**
 * G14 — the OpenFisca versions AccesDirectAide's request protocol was verified against (R14/R46). One source for JavaScript; the same values are written in
 * scripts/openfisca-local.sh (OPENFISCA_FRANCE_PIN / OPENFISCA_CORE_PIN), ops/openfisca/requirements.txt, ops/openfisca/Dockerfile,
 * infrastructure/openfisca/Dockerfile and tests/fixtures/openfisca-france-176-variables.json — tests/unit/g14-openfisca-selfhost.test.js keeps them equal.
 */
export const OPENFISCA_FRANCE_PIN = '176.1.6';
export const OPENFISCA_CORE_PIN = '44.7.1';
/** upstream source of the engine run unmodified (AGPL-3.0) */
export const OPENFISCA_FRANCE_SOURCE = 'https://github.com/openfisca/openfisca-france';
/** Scaleway memory tiers (MB) and the vCPU (mvCPU) that goes with each — the only shapes ops/openfisca/deploy_scaleway.mjs and the guard accept */
export const SCALEWAY_TIERS = Object.freeze({ 512: 280, 1024: 560, 2048: 1120 });
