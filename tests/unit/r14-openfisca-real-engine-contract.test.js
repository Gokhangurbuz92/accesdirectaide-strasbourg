/**
 * R14 (D10) — the OpenFisca request we build, checked against the REAL engine's own declarations (OpenFisca-France 176.1.6 / Core 44.7.1, GET /variable/{name},
 * captured in tests/fixtures/openfisca-france-176-variables.json — no engine needed to run this test). Run against the real engine on 27/10/2026, every
 * request was refused (400: « ass » and « aah » are defined on the person, we asked them on the family), the form's activity values were not mapped (everyone
 * « inactif »), « sans_domicile » is not a housing status, a postal code was sent as a commune code, and resources were given for the current month only
 * (RSA and housing aid read past months and taxable income). Evidence: STRASBOURG_FULL_PRODUCT_PLAN/evidence/d10-openfisca-real-engine-2026-10-27.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTestCase, parseResults } from '../../api/lib/openfiscaMapping.js';
import { RIGHTS_CATALOG } from '../../api/lib/openfiscaRightsCatalog.js';

const ENGINE = JSON.parse(fs.readFileSync('tests/fixtures/openfisca-france-176-variables.json', 'utf8')).variables;
const PLURAL = { individu: 'individus', famille: 'familles', menage: 'menages', foyer_fiscal: 'foyers_fiscaux' };
const p = '2026-09';
const FORM = [
  { birthDate: '1992-03-10', statut: 'sans_emploi', income: { salary: 0, unemployment: 700 }, housing: { rent: 480, charges: 0, status: 'tenant' }, territory: '67000' },
  { birthDate: '1997-05-02', statut: 'salarié', income: { salary: 1450 }, housing: { rent: 720, status: 'tenant_hlm' } },
  { birthDate: '1948-01-20', statut: 'retraité', income: {}, housing: { status: 'owner' } },
  { birthDate: '2001-01-01', statut: 'étudiant', income: {}, housing: { status: 'homeless' } },
  { birthDate: '1985-01-01', statut: 'indépendant', situation_familiale: 'couple', nombre_enfants: 2, income: { salary: 1600 }, housing: { rent: 850, status: 'tenant_furnished' } },
];

describe('R14 D10: our OpenFisca request matches the real engine', () => {
  it('every output is requested on the entity the engine defines it on, for its period', () => {
    for (const answers of FORM) {
      const tc = buildTestCase(answers, p);
      for (const { variable } of RIGHTS_CATALOG) {
        const def = ENGINE[variable]; expect(def, variable).toBeTruthy(); expect(def.definitionPeriod).toBe('MONTH');
        const holders = Object.entries(tc).filter(([, ents]) => Object.values(ents).some((e) => e && Object.prototype.hasOwnProperty.call(e, variable))).map(([k]) => k);
        expect(holders, variable).toEqual([PLURAL[def.entity]]);
      }
    }
  });
  it('every input is on its entity, every enum value exists, no postal code is sent as a commune code', () => {
    for (const answers of FORM) {
      const tc = buildTestCase(answers, p);
      for (const [plural, ents] of Object.entries(tc)) for (const e of Object.values(ents)) for (const [name, v] of Object.entries(e)) {
        if (!ENGINE[name] || typeof v !== 'object' || Array.isArray(v)) continue;
        expect(PLURAL[ENGINE[name].entity], name).toBe(plural);
        if (ENGINE[name].possibleValues) for (const x of Object.values(v)) if (x !== null) expect(ENGINE[name].possibleValues, `${name}=${x}`).toContain(x);
      }
      expect(tc.menages.men_1.depcom).toBeUndefined();
    }
    expect(buildTestCase({ ...FORM[0], depcom: '67482' }, p).menages.men_1.depcom).toEqual({ [p]: '67482' });
  });
  it('the form\'s activity values are mapped (never everyone « inactif »); resources cover the past months the engine reads, net and taxable', () => {
    const acts = FORM.map((a) => buildTestCase(a, p).individus.ind_1.activite[p]);
    expect(acts).toEqual(['chomeur', 'actif', 'retraite', 'etudiant', 'actif']);
    const ind = buildTestCase(FORM[1], p).individus.ind_1;
    for (const v of ['salaire_net', 'salaire_imposable']) { expect(Object.keys(ind[v])).toHaveLength(25); expect(ind[v]['2024-09']).toBe(1450); expect(ind[v][p]).toBe(1450); }
  });
  it('a person-level amount (AAH, ASS) is read on the people, not on the family', () => {
    const r = parseResults({ familles: { fam_1: { rsa: { [p]: 0 } } }, individus: { ind_1: { aah: { [p]: 1016.05 } }, ind_2: { aah: { [p]: 0 } } } }, p);
    expect(r.find((x) => x.code === RIGHTS_CATALOG.find((c) => c.variable === 'aah').code).amount).toBe(1016.05);
  });
});
