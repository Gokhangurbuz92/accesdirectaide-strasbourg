// @ts-nocheck
/**
 * G14 (23/11/2026) — the citizen « estimation indicative » built from a qualified OpenFisca estimate (api/lib/openfiscaEstimate.js). PURE: no I/O.
 *
 * An estimated monthly amount is shown ONLY when all of this holds:
 *   1. the right's item is INDICATIVE_ESTIMATE (every input it needs was given; api/lib/openfiscaEstimate.js NEEDS) — otherwise the missing inputs are named;
 *   2. the engine that answered states the PINNED version (OPENFISCA_FRANCE_PIN, api/lib/openfiscaPins.js) — another engine's legislation is not known here;
 *   3. the code knows, for that pinned version, the official date from which the legislation the engine applies to this right is in force (LEGISLATION
 *      below, read from the openfisca-france 176.1.6 parameters on 23/11/2026: the start date of the latest value of the right's parameters), and the
 *      period computed lies between that date and the next official annual revaluation of the right — after it, the engine's values may be outdated.
 * Everything else: no amount, and the reason is given. Never an eligibility statement: « Seul l'organisme (CAF, CPAM, Département…) décide de vos droits. »
 *
 * D11 (owner decision 22/11/2026, « option A » for every question): uncertain conditions are never decided, and an OWNER_VALIDATED rule is never applied on
 * the server. The server passes only EXPERT_VALIDATED rules (none today) to qualifyEstimates, so every item is NOT_EXPERT_VALIDATED or NOT_IN_REGISTER and
 * carries verifyWithOrganism: true (« À vérifier auprès de l'organisme compétent »). Only an EXPERT_VALIDATED rule would drop that line — the amount stays an
 * estimate even then.
 */
import { OPENFISCA_FRANCE_PIN } from './openfiscaPins.js';
import { claimsEntitlement } from './entitlementWording.js';

export const CITIZEN_ESTIMATE_CONTRACT = 'ADA_CITIZEN_ESTIMATE_V1';
export const DECIDES_NOTICE = 'Seul l’organisme (CAF, CPAM, Département…) décide de vos droits.';
export const VERIFY_NOTICE = 'À vérifier auprès de l’organisme compétent.';
const SIMULATOR_CAF = 'https://www.caf.fr/allocataires/mes-services-en-ligne/estimer-vos-droits';
const SIMULATOR_STATE = 'https://www.mesdroitssociaux.gouv.fr/';

/**
 * Per engine right code (api/lib/openfiscaRightsCatalog.js): the legislation of the PINNED engine, the official page (the register's own source,
 * data/rules/rights-rules.v1.json) and the official simulator. Only the rights listed with `inForceFrom` can ever show an amount.
 * revaluation: the month and day of the official annual revaluation (RSA, prime d'activité: 1er avril; aides au logement: 1er octobre).
 */
export const LEGISLATION = Object.freeze({
  [OPENFISCA_FRANCE_PIN]: Object.freeze({
    rsa: Object.freeze({ inForceFrom: '2026-04-01', revaluation: '04-01', organisme: 'Caf (ou MSA)', fiche: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F19778', simulator: SIMULATOR_CAF,
      parameters: 'prestations_sociales.solidarite_insertion.minima_sociaux.rsa' }),
    prime_activite: Object.freeze({ inForceFrom: '2026-04-01', revaluation: '04-01', organisme: 'Caf (ou MSA)', fiche: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2882', simulator: SIMULATOR_CAF,
      parameters: 'prestations_sociales.solidarite_insertion.minima_sociaux.ppa' }),
    apl: Object.freeze({ inForceFrom: '2026-10-01', revaluation: '10-01', organisme: 'Caf (ou MSA)', fiche: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006', simulator: SIMULATOR_CAF,
      parameters: 'prestations_sociales.aides_logement.allocations_logement' }),
    aide_logement: Object.freeze({ inForceFrom: '2026-10-01', revaluation: '10-01', organisme: 'Caf (ou MSA)', fiche: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006', simulator: SIMULATOR_CAF,
      parameters: 'prestations_sociales.aides_logement.allocations_logement' }),
  }),
});
/** the deciding body and the official pages of the rights that never show an amount here (no legislation record) */
const OTHERS = Object.freeze({
  aspa: { organisme: 'Carsat (ou MSA)' }, ass: { organisme: 'France Travail' }, aah: { organisme: 'MDPH, puis Caf (ou MSA)', fiche: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12242' },
  af: { organisme: 'Caf (ou MSA)' }, cf: { organisme: 'Caf (ou MSA)' }, asf: { organisme: 'Caf (ou MSA)' }, bourse_college: { organisme: 'le collège (Éducation nationale)' },
  css: { organisme: 'CPAM (ou MSA)', fiche: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F10027' },
});

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « 1er avril 2026 » @param {string} iso YYYY-MM-DD */
export function frenchDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d === 1 ? '1er' : d} ${MONTHS_FR[m - 1]} ${y}`;
}

/**
 * Is the pinned legislation of this right in force for the period (YYYY-MM)? null when nothing is known.
 * @param {string} code @param {string} period YYYY-MM @param {string | null} engineVersion the version the engine stated
 * @returns {{ ok: boolean, reason: string | null, record: any }}
 */
export function legislationFor(code, period, engineVersion) {
  if (!engineVersion || engineVersion !== OPENFISCA_FRANCE_PIN) return { ok: false, reason: 'ENGINE_NOT_PINNED', record: null };
  const record = LEGISLATION[engineVersion]?.[code] || null;
  if (!record) return { ok: false, reason: 'NO_LEGISLATION_RECORD', record: null };
  if (!/^\d{4}-\d{2}$/.test(String(period))) return { ok: false, reason: 'LEGISLATION_UNKNOWN_FOR_PERIOD', record };
  const start = `${period}-01`;
  const next = `${Number(record.inForceFrom.slice(0, 4)) + 1}-${record.revaluation}`;
  const ok = start >= record.inForceFrom && start < next;
  return { ok, reason: ok ? null : 'LEGISLATION_UNKNOWN_FOR_PERIOD', record };
}

/**
 * @param {ReturnType<typeof import('./openfiscaEstimate.js').qualifyEstimates>} estimates
 * @param {{ period: string, engineVersion: string | null }} ctx engineVersion: the version the ENGINE stated (health probe), never the configured one
 */
export function citizenEstimate(estimates, ctx) {
  const items = (estimates?.items || []).map((i) => {
    const leg = legislationFor(i.code, ctx.period, ctx.engineVersion);
    const known = LEGISLATION[OPENFISCA_FRANCE_PIN][i.code] || OTHERS[i.code] || {};
    const amountOk = i.status === 'INDICATIVE_ESTIMATE' && leg.ok && Number.isInteger(i.monthlyOrderOfMagnitude) && i.monthlyOrderOfMagnitude > 0;
    const withheld = amountOk ? null : i.status === 'INSUFFICIENT_INFORMATION' ? 'MISSING_INPUTS' : i.status === 'NOT_INDICATED_UNDER_ASSUMPTIONS' ? 'NOT_INDICATED' : leg.reason;
    const links = [known.fiche && { kind: 'fiche', url: known.fiche }, { kind: 'simulator', url: known.simulator || SIMULATOR_STATE }].filter(Boolean);
    return {
      code: i.code, label: i.label, status: i.status,
      monthlyAmount: amountOk ? i.monthlyOrderOfMagnitude : null,
      amountWithheld: withheld,
      legislation: leg.ok ? { inForceFrom: leg.record.inForceFrom, label: `Législation en vigueur au ${frenchDate(leg.record.inForceFrom)}` } : null,
      organisme: known.organisme || null,
      officialLinks: links,
      ruleValidation: i.ruleValidation,
      verifyWithOrganism: i.ruleValidation !== 'EXPERT_VALIDATED',
      missing: (i.missing || []).map((m) => m.key),
    };
  });
  const out = {
    contract: CITIZEN_ESTIMATE_CONTRACT, kind: 'ESTIMATION_INDICATIVE', authoritative: false, period: ctx.period,
    engine: { name: 'openfisca-france', version: ctx.engineVersion || null },
    decidesNotice: DECIDES_NOTICE, verifyNotice: VERIFY_NOTICE,
    assumptions: estimates?.assumptions || [],
    items,
  };
  if (claimsEntitlement(out)) throw new Error('CITIZEN_ESTIMATE_ENTITLEMENT_WORDING');   // never « vous avez droit »
  return out;
}

/**
 * Can the indicative calculation be offered (configuration only — no network, nothing about a person)? null = yes; otherwise a closed-vocabulary reason.
 * The engine's own health (reachable, version) is checked by POST /api/diagnostic itself, which fails closed.
 * @param {Record<string, string | undefined>} env
 */
export function estimateConfigProblem(env) {
  const production = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
  const url = String(env.OPENFISCA_URL || env.OPENFISCA_API_URL || '').trim();
  if (!url) return 'OPENFISCA_NOT_CONFIGURED';
  if (/api\.fr\.openfisca\.org/i.test(url) && (production || env.ALLOW_OPENFISCA_PUBLIC_PROTOTYPE !== 'true')) return 'OPENFISCA_PUBLIC_PROTOTYPE';
  if (String(env.OPENFISCA_FRANCE_VERSION || '').trim() !== OPENFISCA_FRANCE_PIN) return 'OPENFISCA_VERSION_NOT_PINNED';
  if (production && !String(env.OPENFISCA_AUTH_TOKEN || '').trim()) return 'OPENFISCA_TOKEN_MISSING';
  return null;
}
