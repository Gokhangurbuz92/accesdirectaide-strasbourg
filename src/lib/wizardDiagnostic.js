// @ts-nocheck
/**
 * PKG-11 / P16 — the /orientation wizard asks for the diagnostic with the SAME contract as /diagnostic (src/pages/DiagnosticPage.jsx, whose source is pinned by
 * tests/unit/ws3-diagnostic-ui-contract.test.js, hence this mirror instead of a shared import): explicit SIMULATION_MODE; an exact date OR an age band (never both);
 * a BLANK amount is « not answered » (the assessment reports it as missing), an explicit 0 is a known zero; rent only for tenants; territory only when it is a
 * readable postal code. Before: blanks were sent as 0, the wizard's free fields were posted as answers, and the result screen read the legacy `rights` list.
 */
export const answered = (key, raw) => (String(raw ?? '').trim() !== '' && Number.isFinite(Number(raw)) ? { [key]: Number(raw) } : {});
export const isTenant = (status) => status === 'tenant' || status === 'tenant_hlm';
const HOUSEHOLD_FROM_PROFILE = { seul: '1', couple: '2' };   // « avec enfant(s) »: the size is asked, never guessed
const STATUT_FROM_PROFILE = { emploi: 'salarié', chomage: 'sans_emploi', etudiant: 'étudiant', retraite: 'retraité' };

export const defaultHousehold = (profileSituation) => HOUSEHOLD_FROM_PROFILE[profileSituation] || '';

/** @param {Record<string, any>} data merged wizard data (need, territory, situation, statut, urgency, and the last step's fields) */
export function buildWizardDiagnostic(data) {
  const zip = String(data.territory || '').trim();
  const territory = /^\d{5}$/.test(zip) ? zip : '';
  const answers = {
    ...(data.birthDate ? { birthDate: data.birthDate } : data.ageBand ? { ageBand: data.ageBand } : {}),
    ...answered('householdSize', data.householdSize),
    territory,
    statut: STATUT_FROM_PROFILE[data.statut] || '',
    income: { ...answered('salary', data.salary), ...answered('unemployment', data.unemployment) },
    housing: {
      ...(isTenant(data.housingStatus) ? answered('rent', data.rent) : { rent: 0 }),
      ...answered('charges', data.charges),
      status: data.housingStatus || '',
    },
  };
  // what may be kept with a shared dossier: the same fields as the /diagnostic page (no free text, no need / urgency)
  const situation = { birthDate: data.birthDate || '', ageBand: data.birthDate ? '' : (data.ageBand || ''), householdSize: String(data.householdSize || ''), zipCode: territory, housingStatus: data.housingStatus || '' };
  return { body: { mode: 'SIMULATION_MODE', answers }, situation };
}
