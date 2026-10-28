// @ts-nocheck
/**
 * WS3 LocalRulesEngine
 *
 * Deterministic, local-only pre-orientation simulation.
 * This engine is deliberately NON-AUTHORITATIVE and must never replace
 * the authoritative OpenFisca path unless SIMULATION_MODE is explicitly requested.
 */

import { TERRITORY_SCOPES, territoryStatus } from './territoryScopes.js';
import { ageFromBand } from './ageBands.js';

export const LOCAL_SIMULATION_MODE = 'SIMULATION_NON_AUTHORITATIVE';
export const LOCAL_SIMULATION_FIXTURE = 'WS3_LOCAL_RULES_V1_2026_09';
export const LOCAL_REFERENCE_DATE = '2026-09-01';
export const LOCAL_SIMULATION_DISCLAIMER = "Cette simulation est indicative et non-opposable. Seule une instruction officielle par l'organisme compétent (CAF, CPAM, Département) a valeur légale.";

/**
 * @param {string | undefined} message
 */
function invalidInput(message) {
    const err = new Error(message);
    err.code = 'LOCAL_SIMULATION_INVALID_INPUT';
    err.status = 400;
    return err;
}

/**
 * @param {string | null} value
 * @param {string} field
 */
function nonNegativeNumber(value, field) {
    if (value == null || value === '') return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw invalidInput(`${field} must be a non-negative number`);
    return n;
}

function integerInRange(/** @type {string | number | boolean | null | undefined} */ value, /** @type {number} */ fallback, /** @type {number} */ min, /** @type {number} */ max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * @param {string} birthDate
 */
function calculateAge(birthDate) {
    if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        throw invalidInput('birthDate is required (YYYY-MM-DD format)');
    }
    const [year, month, day] = birthDate.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) throw invalidInput('birthDate is invalid');
    const [refYear, refMonth, refDay] = LOCAL_REFERENCE_DATE.split('-').map(Number);
    let age = refYear - year;
    if (month > refMonth || (month === refMonth && day > refDay)) age -= 1;
    if (age < 0 || age > 120) throw invalidInput('birthDate is outside supported simulation range');
    return age;
}

/**
 * @param {number} value
 */
function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

// @ts-ignore
function right({ code, label, eligible, amount, explain, explainFalc, nextSteps, category, amountType = 'estimated_local' }) {
    return {
        code,
        label,
        eligible: Boolean(eligible),
        amount: eligible ? round2(amount || 0) : 0,
        amount_type: amountType,
        explain,
        explain_falc: explainFalc,
        next_steps: eligible ? nextSteps : [],
        category,
        authoritative: false,
        calculation_basis: 'HEURISTIC_LOCAL_V1',
    };
}

export function runLocalSimulation(answers = {}) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        throw invalidInput('answers is required and must be an object');
    }

    // DTA S2B (D3d): an exact birth date, OR a declared age band (closed vocabulary; its lower bound feeds only this non-authoritative heuristic)
    const bandAge = answers.birthDate ? null : ageFromBand(answers.ageBand);
    const age = bandAge !== null ? bandAge : calculateAge(answers.birthDate);
    const salary = nonNegativeNumber(answers.income?.salary, 'income.salary');
    const unemployment = nonNegativeNumber(answers.income?.unemployment, 'income.unemployment');
    const rent = nonNegativeNumber(answers.housing?.rent, 'housing.rent');
    nonNegativeNumber(answers.housing?.charges, 'housing.charges');

    const householdSize = integerInRange(answers.householdSize, 1, 1, 8);
    const monthlyResources = salary + unemployment;
    const resourcesPerPerson = monthlyResources / householdSize;
    const housingStatus = String(answers.housing?.status || '');
    const territory = String(answers.territory || answers.zipCode || '').trim();

    // These thresholds are frozen orientation heuristics for the local Strasbourg release.
    // They are NOT legal thresholds and must not be presented as official eligibility rules.
    const rsaResourceCeiling = 1200 + (householdSize - 1) * 450;
    const rsaEligible = age >= 25 && monthlyResources <= rsaResourceCeiling;
    const rsaBase = 650 + (householdSize - 1) * 220;
    const rsaAmount = rsaEligible ? Math.max(0, rsaBase - monthlyResources * 0.38) : 0;

    const tenant = housingStatus === 'tenant' || housingStatus === 'tenant_hlm';
    const aplResourceCeiling = 2200 + (householdSize - 1) * 450;
    const aplRaw = rent * 0.32 - monthlyResources * 0.06;
    const aplEligible = tenant && rent > 0 && monthlyResources <= aplResourceCeiling && aplRaw >= 20;
    const aplAmount = aplEligible ? Math.min(350, Math.max(20, aplRaw)) : 0;

    // DTA S2A (A6): the territory is DATA (api/lib/territoryScopes.js), not a regex; a postal code only tells "inside the declared département" or not
    const fajEligible = age >= 16 && age <= 25 && territoryStatus('faj-strasbourg', territory) === 'DECLARED_AREA' && monthlyResources <= 1600;

    const rights = [
        right({
            code: 'rsa',
            label: 'RSA — pré-orientation locale',
            eligible: rsaEligible,
            amount: rsaAmount,
            explain: rsaEligible
                ? 'La situation correspond aux critères de pré-orientation de la simulation locale. Une vérification officielle reste nécessaire.'
                : 'La simulation locale ne repère pas de pré-orientation RSA pour les données déclarées.',
            explainFalc: rsaEligible
                ? 'Vous pouvez peut-être demander le RSA. La CAF doit vérifier votre situation.'
                : 'Avec ces informations, la simulation locale ne repère pas le RSA.',
            nextSteps: [{ type: 'aide', slug: 'rsa' }],
            category: 'minimum_social',
        }),
        right({
            code: 'apl',
            label: 'APL — pré-orientation locale',
            eligible: aplEligible,
            amount: aplAmount,
            explain: aplEligible
                ? 'La situation de logement et de ressources justifie une pré-orientation vers une aide au logement. Le montant affiché est uniquement indicatif.'
                : 'La simulation locale ne repère pas de pré-orientation APL pour les données déclarées.',
            explainFalc: aplEligible
                ? 'Vous pouvez peut-être avoir une aide pour votre loyer. La CAF doit calculer le vrai montant.'
                : "Avec ces informations, la simulation locale ne repère pas l'APL.",
            nextSteps: [{ type: 'aide', slug: 'apl' }],
            category: 'logement',
        }),
        right({
            code: 'faj-strasbourg',
            label: "FAJ'EMS Strasbourg — pré-orientation locale",
            eligible: fajEligible,
            amount: 0,
            amountType: 'variable_not_estimated',
            explain: fajEligible
                ? "La situation correspond à une pré-orientation vers le FAJ'EMS. Le montant dépend du projet et de l'évaluation par le référent/commission."
                : "La simulation locale ne repère pas de pré-orientation FAJ'EMS pour les données déclarées.",
            explainFalc: fajEligible
                ? `Vous avez entre 16 et 25 ans et votre code postal est dans le département concerné par cette aide (${TERRITORY_SCOPES['faj-strasbourg'].territory_scope}, à vérifier pour votre commune). Un professionnel peut vérifier si le FAJ'EMS peut vous aider.`
                : "Avec ces informations, la simulation locale ne repère pas le FAJ'EMS.",
            nextSteps: [{ type: 'aide', slug: 'faj-strasbourg' }],
            category: 'budget',
        }),
    ];

    return {
        mode: LOCAL_SIMULATION_MODE,
        authoritative: false,
        disclaimer: LOCAL_SIMULATION_DISCLAIMER,
        scenarioFixture: LOCAL_SIMULATION_FIXTURE,
        period: '2026-09',
        rights,
        meta: {
            source: 'local-rules-engine',
            engineVersion: 'ws3-local-rules-v1',
            referenceDate: LOCAL_REFERENCE_DATE,
            householdSize,
            resourcesPerPerson: round2(resourcesPerPerson),
            remoteCallUsed: false,
        },
    };
}

export default runLocalSimulation;
