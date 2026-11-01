/**
 * R31 — the pure rules of R18 (orientation baskets), P27 (funding dossiers) and Q14 (pilot measures), and the routes' protection. Real-database behaviour:
 * tests/integration/r31-orientation-funding-pilot-db.test.js.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { needsOfCategories, ORIENTATION_NEEDS, fold } from '../../src/config/orientationNeeds.js';
import { personWhy, summaryText, whyText } from '../../api/_services/orientation-basket.js';
import { DEFAULT_PIECES, exportMarkdown, normalizeContent, warningsOf } from '../../api/_services/funding-dossiers.js';
import { aggregate, aggregatesCsv, K, newParticipantCode, normalizeSession, sessionDay } from '../../api/_services/pilot-measures.js';
import { isAllowedInPublicBeta } from '../../api/_utils/public-beta.js';

describe('R18 orientation needs and explanations', () => {
  it('maps the catalogue’s heterogeneous categories to needs, accents and case ignored', () => {
    expect(needsOfCategories(['logement'])).toEqual(['LOGEMENT']);
    expect(needsOfCategories(['Personnes âgées'])).toEqual(['AUTONOMIE']);
    expect(needsOfCategories(['santé'])).toEqual(['SANTE']);
    expect(needsOfCategories(['Accès aux droits', 'Logement'])).toEqual(expect.arrayContaining(['LOGEMENT', 'DROITS']));
    expect(needsOfCategories([])).toEqual([]);
    expect(fold('  Hébergement ')).toBe('hebergement');
    expect(new Set(ORIENTATION_NEEDS.map((n) => n.code)).size).toBe(ORIENTATION_NEEDS.length);
  });
  const item = { title: 'Aide au loyer', kindLabel: 'Aide', needs: ['LOGEMENT'], categories: ['logement'], stillPublic: true, followUp: 'A_PROPOSER', path: '/aides/x', sourceUrl: 'https://www.service-public.gouv.fr/x', verifiedAt: '2026-10-30' };
  it('explains to the professional why an item is suggested, with their own reason', () => {
    expect(whyText(item, ['LOGEMENT'], 'loyer impayé')).toBe('Correspond au besoin « Logement, hébergement » (catégorie de la fiche : logement). Motif indiqué : loyer impayé');
    expect(whyText(item, ['SANTE'], '')).toContain('ne correspond à aucun des besoins choisis');
  });
  it('the person’s text holds catalogue facts only and says it is not a decision', () => {
    expect(personWhy(item, ['LOGEMENT'])).toBe('En lien avec votre besoin « Logement, hébergement ».');
    const text = summaryText({ label: 'Nom de travail', needCodes: ['LOGEMENT'], needs: [{ code: 'LOGEMENT', label: 'Logement, hébergement' }],
      items: [{ ...item, reason: 'motif interne' }, { ...item, title: 'Retirée', stillPublic: false }, { ...item, title: 'Écartée', followUp: 'SANS_SUITE' }] }, { origin: 'https://o.test' });
    expect(text).toContain('pas une décision');
    expect(text).toContain('Source officielle : https://www.service-public.gouv.fr/x (vérifiée le 30/10/2026)');
    expect(text).toContain('Fiche : https://o.test/aides/x');
    for (const hidden of ['Nom de travail', 'motif interne', 'Retirée', 'Écartée']) expect(text).not.toContain(hidden);
  });
});

describe('P27 funding dossiers', () => {
  it('refuses a measured or confirmed amount without its source, and an award without the funder’s decision', () => {
    expect(normalizeContent({ budget: [{ poste: 'A', nature: 'CHARGE', montant: '10', statut: 'CONFIRME' }] }).code).toBe('JUSTIFICATION_REQUIRED');
    expect(normalizeContent({ budget: [{ poste: 'A', montant: '-3' }] }).code).toBe('INVALID_AMOUNT');
    expect(normalizeContent({ financement: [{ financeur: 'Ville', montant: 5, statut: 'ACCORDE' }] }).code).toBe('DECISION_REQUIRED');
    const ok = normalizeContent({ budget: [{ poste: 'A', montant: '12,5' }], financement: [{ financeur: 'Ville', montant: 5, statut: 'BOGUS' }] });
    expect(ok.content.budget[0]).toMatchObject({ montant: 12.5, statut: 'PROVISOIRE', nature: 'CHARGE' });
    expect(ok.content.financement[0].statut).toBe('ENVISAGE');
  });
  it('lists blocking and non-blocking points, including the association’s missing registration', () => {
    const w = warningsOf({ status: 'EN_PREPARATION', deadline: new Date(Date.now() + 3 * 86400000), content: { sections: {}, budget: [{ nature: 'CHARGE', montant: 10, statut: 'PROVISOIRE' }], pieces: [{ libelle: 'Statuts', statut: 'MANQUANTE' }] } });
    const codes = w.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['SECTION_EMPTY', 'BUDGET_UNBALANCED', 'BUDGET_PROVISIONAL', 'PIECES_MISSING', 'NOT_REGISTERED', 'NO_FUNDER', 'DEADLINE_SOON']));
    expect(w.find((x) => x.code === 'NOT_REGISTERED').blocking).toBe(false);
    expect(w.find((x) => x.code === 'BUDGET_UNBALANCED')).toMatchObject({ blocking: true, message: expect.stringMatching(/charges 10,00\s€, produits 0,00\s€/) });
  });
  it('exports a working document that says what it is and marks missing amounts', () => {
    const md = exportMarkdown({ id: 'abcdefgh-1', title: 'Essai', status: 'EN_PREPARATION', version: 2, content: { sections: { presentation: 'Texte' }, budget: [{ poste: 'P', nature: 'CHARGE', montant: null, statut: 'MESURE', justification: 'relevé' }], pieces: DEFAULT_PIECES.map(([code, libelle]) => ({ code, libelle, statut: 'MANQUANTE' })) } });
    expect(md).toContain('Document de travail — version 2');
    expect(md).toContain('Ce document n’est pas une demande déposée.');
    expect(md).toContain('| P | Charge | à renseigner | Mesuré | relevé |');
    expect(md).toContain('- [ ] Statuts de l’association');
  });
});

describe('Q14 pilot measures', () => {
  const ok = { consentRecorded: true, participantCode: newParticipantCode(), journeyCode: 'J1_AIDE_LOGEMENT', outcome: 'REUSSI', assistance: 'AUCUNE', deviceType: 'TELEPHONE' };
  it('records nothing without consent, without a drawn code, or with contact data', () => {
    expect(normalizeSession({ ...ok, consentRecorded: false }).code).toBe('CONSENT_REQUIRED');
    expect(normalizeSession({ ...ok, participantCode: 'Marie Dupont' }).code).toBe('INVALID_CODE');
    expect(normalizeSession({ ...ok, observation: 'rappeler marie@example.org' }).code).toBe('CONTACT_DATA');
    expect(normalizeSession({ ...ok, observation: 'tel 06 12 34 56 78' }).code).toBe('CONTACT_DATA');
    expect(normalizeSession({ ...ok, clarity: 9 }).code).toBe('INVALID_NUMBER');
    expect(normalizeSession({ ...ok, journeyCode: 'X' }).code).toBe('INVALID_FIELD');
    expect(normalizeSession(ok).row).toMatchObject({ consentRecorded: true, errorCount: 0, clarity: null });
    expect(newParticipantCode()).toMatch(/^P-[A-Z2-9]{6}$/);
  });
  it('pseudonymised data: an assistive technology needs the separate explicit consent, the observation describes the site, the day only is kept', () => {
    expect(normalizeSession({ ...ok, assistiveTech: 'LECTEUR_ECRAN' }).code).toBe('EXPLICIT_CONSENT_REQUIRED');
    expect(normalizeSession({ ...ok, accessibilityIssues: ['LECTEUR_ECRAN'] }).code).toBe('EXPLICIT_CONSENT_REQUIRED');
    expect(normalizeSession({ ...ok, assistiveTech: 'LECTEUR_ECRAN', explicitConsent: true }).row.assistiveTech).toBe('LECTEUR_ECRAN');
    expect(normalizeSession({ ...ok, assistiveTech: 'AUCUNE', accessibilityIssues: ['CONTRASTE'] }).ok).toBe(true);
    for (const o of ['Il est malvoyant', 'personne épileptique', 'a cherché l’AAH', 'Handicapée', 'dépression', 'elle est malade']) expect(normalizeSession({ ...ok, observation: o }).code).toBe('HEALTH_DATA');
    for (const o of ['n’a pas vu le bouton « Lire la fiche »', 'texte trop long', 'maladroit avec la souris']) expect(normalizeSession({ ...ok, observation: o }).ok).toBe(true);
    const now = new Date('2026-11-03T10:00:00Z');
    expect(normalizeSession({ ...ok, conductedAt: '2026-11-01T23:30:00Z' }, now).row.conductedAt.toISOString()).toBe('2026-11-02T12:00:00.000Z');
    expect(normalizeSession({ ...ok, conductedAt: '2026-11-01T08:10:00+01:00' }, now).row.conductedAt.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(sessionDay(new Date('2026-07-14T21:59:00Z')).toISOString()).toBe('2026-07-14T12:00:00.000Z');
  });
  it('suppresses every figure below K sessions and computes rates at K', () => {
    const rows = (n) => Array.from({ length: n }, (_, i) => ({ journeyCode: 'J2_DEMARCHE', participantCode: `P-${i}`, outcome: i < 3 ? 'REUSSI' : 'ABANDON', durationSeconds: 60 * (i + 1), errorCount: i, clarity: null, accessibilityIssues: i ? ['LONGUEUR'] : [] }));
    const few = aggregate(rows(K - 1)).find((j) => j.journeyCode === 'J2_DEMARCHE');
    expect(few).toEqual({ journeyCode: 'J2_DEMARCHE', label: expect.any(String), sessions: K - 1, participants: K - 1, suppressed: true, reason: `moins de ${K} séances : résultats non publiés` });
    const enough = aggregate(rows(K)).find((j) => j.journeyCode === 'J2_DEMARCHE');
    expect(enough).toMatchObject({ suppressed: false, successAlone: 60, failure: 40, medianDurationSeconds: 180, medianErrors: 2, clarity: null });
    expect(enough.accessibilityIssues).toEqual([{ code: 'LONGUEUR', label: 'Texte trop long', sessions: null, suppressed: true }]);
    const issueAtK = aggregate([...rows(K), { ...rows(1)[0], participantCode: 'P-X', accessibilityIssues: ['LONGUEUR'] }]).find((j) => j.journeyCode === 'J2_DEMARCHE');
    expect(issueAtK.accessibilityIssues).toEqual([{ code: 'LONGUEUR', label: 'Texte trop long', sessions: K }]);
    const none = aggregate([]).find((j) => j.journeyCode === 'J1_AIDE_LOGEMENT');
    expect(none).toMatchObject({ sessions: 0, suppressed: false, reason: 'aucune séance' });
    expect(aggregatesCsv(aggregate(rows(K - 1))).split('\n').find((l) => l.startsWith('J2_DEMARCHE'))).toBe('J2_DEMARCHE,4,4,non,,,,,,');
  });
});

describe('R31 routes', () => {
  const routes = readFileSync(new URL('../../api/routes.js', import.meta.url), 'utf8');
  it('are registered and refused during the public beta (allowlist)', () => {
    for (const p of ['pro/selections', 'admin/funding', 'admin/pilot']) {
      expect(routes).toContain(`path: '${p}'`);
      expect(isAllowedInPublicBeta('GET', p)).toBe(false);
      expect(isAllowedInPublicBeta('POST', p)).toBe(false);
    }
  });
  it('sit behind the professional context or the administrator gate', () => {
    expect(readFileSync(new URL('../../api/_handlers/pro/orientation-baskets.js', import.meta.url), 'utf8')).toContain('requireProStructureContext(req, res)');
    for (const f of ['funding', 'pilot']) expect(readFileSync(new URL(`../../api/_handlers/admin/${f}.js`, import.meta.url), 'utf8')).toMatch(/adminGate\(req, res, \{ write: true \}\)/);
  });
});
