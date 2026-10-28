// @ts-nocheck
/**
 * OpenFisca Mapping — transforms wizard answers into OpenFisca test_case format.
 *
 * All variable names verified via GET https://api.fr.openfisca.org/latest/variable/{name}
 * on 2026-02-24.
 */

import { RIGHTS_CATALOG } from './openfiscaRightsCatalog.js';

// --- Enum mappings (wizard values → OpenFisca enum values) ---

/** Maps wizard statut → OpenFisca `activite` enum */
// R14 (D10, checked against the real engine OpenFisca-France 176.1.6 / Core 44.7.1): the diagnostic form sends « salarié », « sans_emploi », « indépendant »,
// « retraité », « étudiant » — only the wizard's former keys were mapped, so every person was computed as « inactif »
export const ACTIVITE_MAP = {
    emploi: 'actif',
    chomage: 'chomeur',
    etudiant: 'etudiant',
    retraite: 'retraite',
    hebergement: 'inactif',
    'salarié': 'actif',
    'indépendant': 'actif',
    sans_emploi: 'chomeur',
    'retraité': 'retraite',
    'étudiant': 'etudiant',
};

/** Maps wizard housing.status → OpenFisca `statut_occupation_logement` enum */
const LOGEMENT_MAP = {
    tenant: 'locataire_vide',
    tenant_hlm: 'locataire_hlm',
    tenant_furnished: 'locataire_meuble',
    owner: 'proprietaire',
    free: 'loge_gratuitement',
    homeless: 'non_renseigne',   // R14: « sans_domicile » is not a value of statut_occupation_logement (the engine refused the whole request)
};

/** R14: outputs the engine defines on the person, not the family (GET /variable/{name} → entity « individu »): requested and read on each adult */
export const INDIVIDUAL_OUTPUTS = new Set(['ass', 'aah']);

/**
 * Get current period in YYYY-MM format.
 * @returns {string}
 */
/** { 'YYYY-MM': value } for the month p and the n months before it @param {string} p @param {number} n @param {number} value */
export function monthsUpTo(p, n, value) {
    const [y, m] = p.split('-').map(Number); const out = {};
    for (let i = 0; i <= n; i += 1) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out[`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`] = value; }
    return out;
}

export function getCurrentPeriod() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

/**
 * Build OpenFisca test_case from wizard answers.
 *
 * V1: supports single adult household.
 * Future: couple + children via household.adults / household.children.
 *
 * @param {object} answers - Wizard answers
 * @param {string} [period] - YYYY-MM period (defaults to current month)
 * @returns {object} OpenFisca situation JSON
 */
export function buildTestCase(answers, period) {
    const p = period || getCurrentPeriod();

    // --- Individual ---
    const individu = {};

    // Birth date (required)
    if (answers.birthDate) {
        individu.date_naissance = { ETERNITY: answers.birthDate };
    }

    // Activity status
    if (answers.statut) {
        individu.activite = { [p]: ACTIVITE_MAP[answers.statut] || 'inactif' };
    }

    // Income
    const income = answers.income || {};
    // R14 (D10, real engine): RSA / prime d'activité read the resources of the 3 PREVIOUS months and housing aid a longer window — given for the current month
    // only, the past months were 0 and a person earning 1 450 €/month got the full RSA. The person declares a monthly situation: it is assumed stable over the
    // 24 previous months (housing aid reads beyond 12) — stated in the result; the organism decides on its own records.
    individu.salaire_net = monthsUpTo(p, 24, Number(income.salary) || 0);
    individu.chomage_net = monthsUpTo(p, 24, Number(income.unemployment) || 0);
    // R14 (D10, real engine): housing aid's resource base reads TAXABLE income (salaire_imposable / chomage_imposable), not net: with net only it was 0 and the
    // aid was overstated (304 € for 1 450 €/month). Taxable ≈ net is a LOWER bound of the person's resources (to be refined with the rules expert, D11).
    individu.salaire_imposable = monthsUpTo(p, 24, Number(income.salary) || 0);
    individu.chomage_imposable = monthsUpTo(p, 24, Number(income.unemployment) || 0);

    // Phase 8: Variable-length household model. Cardinality from openfisca-france variable mappings.
    const individus = { ind_1: individu };
    const adults = ['ind_1'];
    const children = [];

    // Add conjoint if applicable
    if (answers.has_conjoint || answers.situation_familiale === 'couple') {
        adults.push('ind_2');
        individus.ind_2 = {
            // Default conjoint properties, could be populated from answers in the future
            date_naissance: { ETERNITY: '1990-01-01' },
            activite: { [p]: 'inactif' },
            salaire_net: { [p]: 0 },
            chomage_net: { [p]: 0 }
        };
    }

    // Add children dynamically
    const enfants = answers.enfants || [];
    const nombreEnfants = answers.nombre_enfants || enfants.length;
    for (let i = 0; i < nombreEnfants; i++) {
        const childId = `enfant_${i + 1}`;
        children.push(childId);
        
        let birthDate = '2015-01-01';
        if (enfants[i]?.date_naissance) {
            birthDate = enfants[i].date_naissance;
        } else if (enfants[i]?.age !== undefined) {
            const currentYear = parseInt(p.substring(0, 4), 10);
            birthDate = `${currentYear - enfants[i].age}-01-01`;
        }
        
        individus[childId] = {
            date_naissance: { ETERNITY: birthDate }
        };
    }

    // --- Housing / Ménage ---
    const housing = answers.housing || {};
    const menage = {
        personne_de_reference: [adults[0]],
        conjoint: adults.length > 1 ? [adults[1]] : [],
        enfants: children,
        loyer: { [p]: Number(housing.rent) || 0 },
        charges_locatives: { [p]: Number(housing.charges) || 0 },
        statut_occupation_logement: {
            [p]: LOGEMENT_MAP[housing.status] || 'non_renseigne',
        },
    };

    // depcom: code INSEE commune (prefer depcom, fallback to postalCode with warning)
    // R14: only an INSEE commune code is a depcom; the form's postal code (« 67000 ») was sent as one — a commune that does not exist. Without a commune code
    // the engine's defaults apply (the result is a non-authoritative orientation either way; postal → commune needs La Poste data, P07)
    if (answers.depcom && /^(?:\d{5}|2[AB]\d{3})$/i.test(String(answers.depcom))) {
        menage.depcom = { [p]: String(answers.depcom).toUpperCase() };
    }

    // --- Output variables (what we want OpenFisca to compute) ---
    const outputVariables = RIGHTS_CATALOG.map((r) => r.variable);

    // Build famille with output variable slots
    const famille = {
        parents: adults,
        enfants: children,
    };
    for (const v of outputVariables) {
        if (INDIVIDUAL_OUTPUTS.has(v)) for (const a of adults) individus[a][v] = { [p]: null };
        else famille[v] = { [p]: null }; // null = "please compute"
    }

    // --- Assemble situation ---
    return {
        individus: individus,
        familles: { fam_1: famille },
        menages: { men_1: menage },
        foyers_fiscaux: {
            foy_1: {
                declarants: adults,
                personnes_a_charge: children,
            },
        },
    };
}

/**
 * Parse OpenFisca calculation response into normalized rights array.
 *
 * @param {object} response - OpenFisca /calculate response
 * @param {string} period - YYYY-MM period
 * @returns {Array<object>} Normalized rights array
 */
export function parseResults(response, period) {
    const p = period || getCurrentPeriod();
    const famille = response?.familles?.fam_1 || {};

    return RIGHTS_CATALOG.map((right) => {
        // R14: a person-level output is the sum over the household's people (it used to be looked for on the family, where the engine never puts it)
        const amount = INDIVIDUAL_OUTPUTS.has(right.variable)
            ? Object.values(response?.individus || {}).reduce((s, ind) => s + (Number(ind?.[right.variable]?.[p]) || 0), 0)
            : (famille[right.variable]?.[p] ?? 0);
        const eligible = amount > 0;

        return {
            code: right.code,
            label: right.label,
            eligible,
            amount: Math.round(amount * 100) / 100,
            explain: eligible ? right.explainEligible : right.explainNotEligible,
            explain_falc: eligible
                ? right.explainFalcEligible
                : right.explainFalcNotEligible,
            next_steps: eligible ? right.nextSteps : [],
            category: right.category,
        };
    });
}

export default { buildTestCase, parseResults, getCurrentPeriod };
