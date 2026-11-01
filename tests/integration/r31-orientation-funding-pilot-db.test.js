/**
 * R31 on REAL PostgreSQL (synthetic data only; skipped without DATABASE_URL):
 *   R18 — orientation baskets: verified records only, sealed label, author/administrator access, organization isolation, item withdrawn from the catalogue,
 *         case link under the case's own rules, summary sent as a citizen-visible case note, refusal once the person revokes the grant;
 *   P27 — funding dossiers: validated prefill, warnings, honesty refusals, compare-and-set, status chain, versions, export;
 *   Q14 — pilot sessions: consent CHECK in the database, suppression below K, withdrawal of consent, technical indicators equal to direct counts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const id = (k) => `r31-${k}-${TS}`;
const verified = (extra) => ({ statut: 'publie', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'verification-automatique', territory_verified: true, publication_hold: null,
  data_origin: 'official_source', date_verification: new Date(Date.now() - 5 * 86400000), source_url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F12006', ...extra });

describe.skipIf(!hasDatabase)('R31 — orientation baskets, funding dossiers, pilot sessions (real DB)', () => {
  let db, schema, basket, funding, pilot, openText;
  const ctxA = { structureId: id('s1'), userId: id('pro-a'), role: 'PRO' };
  const ctxB = { structureId: id('s1'), userId: id('pro-b'), role: 'PRO' };
  const ctxAdmin = { structureId: id('s1'), userId: id('admin'), role: 'STRUCTURE_ADMIN' };
  const ctxOther = { structureId: id('s2'), userId: id('pro-d'), role: 'PRO' };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    basket = await import('../../api/_services/orientation-basket.js');
    funding = await import('../../api/_services/funding-dossiers.js');
    pilot = await import('../../api/_services/pilot-measures.js');
    ({ openText } = await import('../../api/lib/data-keys.js'));
    for (const s of ['s1', 's2']) await db.insert(schema.Structure).values({ id: id(s), nom: `Structure synthétique ${s}`, services: [], publics_accueillis: [], categories_aidees: [], statut: 'actif' });
    for (const [k, s, role] of [['pro-a', 's1', 'PRO'], ['pro-b', 's1', 'PRO'], ['admin', 's1', 'STRUCTURE_ADMIN'], ['pro-d', 's2', 'PRO']]) {
      await db.insert(schema.ProUser).values({ id: id(k), email: `${id(k)}@example.test`, password_hash: 'synthetic-not-a-hash', role, structureId: id(s), status: 'active' });
    }
    await db.insert(schema.Aide).values({ id: id('aide-loyer'), slug: id('aide-loyer'), titre: 'Aide synthétique au paiement du loyer à Strasbourg', categorie: 'logement', ...verified() });
    await db.insert(schema.Aide).values({ id: id('aide-draft'), slug: id('aide-draft'), titre: 'Aide synthétique au loyer non publiée', categorie: 'logement', ...verified({ statut: 'brouillon' }) });
    await db.insert(schema.Demarche).values({ id: id('dem'), slug: id('dem'), titre: 'Démarche synthétique pour le loyer', categorie: 'social', ...verified() });
    await db.insert(schema.SharedDiagnostic).values({ id: id('dossier'), expiresAt: new Date(Date.now() + 30 * 86400000), situation: { synthetic: true }, results: {}, viewCount: 0 });
    await db.insert(schema.SharedDossierGrant).values({ id: id('grant'), sharedDiagnosticId: id('dossier'), structureId: id('s1'), grantedByProUserId: id('pro-a') });
    await db.insert(schema.ProCase).values({ id: id('case'), sharedDiagnosticId: id('dossier'), structureId: id('s1'), status: 'IN_PROGRESS', assigneeProUserId: id('pro-b') });
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.ProOrientationBasket).where(inArray(schema.ProOrientationBasket.structureId, [id('s1'), id('s2')]));
    await db.delete(schema.ProCase).where(eq(schema.ProCase.id, id('case')));
    await db.delete(schema.SharedDossierGrant).where(eq(schema.SharedDossierGrant.id, id('grant')));
    await db.delete(schema.SharedDiagnostic).where(eq(schema.SharedDiagnostic.id, id('dossier')));
    await db.delete(schema.Aide).where(inArray(schema.Aide.id, [id('aide-loyer'), id('aide-draft')]));
    await db.delete(schema.Demarche).where(eq(schema.Demarche.id, id('dem')));
    await db.delete(schema.ProUser).where(inArray(schema.ProUser.structureId, [id('s1'), id('s2')]));
    await db.delete(schema.Structure).where(inArray(schema.Structure.id, [id('s1'), id('s2')]));
    await db.execute(sql`DELETE FROM "FundingDossier" WHERE "createdBy" = ${'r31-test@example.test'}`);
    await db.execute(sql`DELETE FROM "PilotSession" WHERE "recordedBy" = ${'r31-test@example.test'}`);
  });

  let basketId;
  it('R18: a selection is created with its needs; its label is sealed in the database', async () => {
    const out = await basket.createBasket(ctxA, { label: 'Jeune sans logement, premier entretien', needCodes: ['LOGEMENT', 'NOT_A_NEED'] });
    expect(out.ok).toBe(true);
    basketId = out.basket.id;
    expect(out.basket.needCodes).toEqual(['LOGEMENT']);
    const [raw] = (await db.execute(sql`SELECT "privateEncrypted" FROM "ProOrientationBasket" WHERE id = ${basketId}`)).rows;
    expect(raw.privateEncrypted).not.toContain('logement');
    expect(raw.privateEncrypted.startsWith('v2:')).toBe(true);
  });

  it('R18: the search reads only verified records, accents ignored', async () => {
    const out = await basket.searchCatalogue(ctxA, { q: 'loyer a strasbourg', needCodes: ['LOGEMENT'] });
    expect(out.results.map((r) => r.refId)).toEqual([id('aide-loyer')]);
    const all = await basket.searchCatalogue(ctxA, { q: 'synthétique' });
    expect(all.results.map((r) => r.refId)).not.toContain(id('aide-draft'));
    expect(all.results.map((r) => r.refId)).toEqual(expect.arrayContaining([id('aide-loyer'), id('dem')]));
    expect((await basket.searchCatalogue({ ...ctxA, userId: 'nobody' }, { q: 'loyer' })).status).toBe(403);
  });

  it('R18: only a published, verified record can be added; why, source and date come from the catalogue', async () => {
    const added = await basket.addItem(basketId, ctxA, { kind: 'aide', refId: id('aide-loyer'), reason: 'Loyer impayé depuis deux mois' });
    expect(added.ok).toBe(true);
    const item = added.basket.items[0];
    expect(item.why).toContain('« Logement, hébergement »');
    expect(item.why).toContain('Motif indiqué : Loyer impayé depuis deux mois');
    expect(item.sourceUrl).toMatch(/^https:\/\/www\.service-public\.gouv\.fr/);
    expect(item.path).toBe(`/aides/${id('aide-loyer')}`);
    expect((await basket.addItem(basketId, ctxA, { kind: 'aide', refId: id('aide-draft') })).code).toBe('NOT_PUBLIC');
    expect((await basket.addItem(basketId, ctxA, { kind: 'aide', refId: id('aide-loyer') })).code).toBe('ALREADY_IN');
    const dem = await basket.addItem(basketId, ctxA, { kind: 'demarche', refId: id('dem') });
    expect(dem.basket.items[1].why).toContain('ne correspond à aucun des besoins choisis');
  });

  it('R18: the author and the organization’s administrators see it; a colleague and another organization do not', async () => {
    expect((await basket.getBasket(basketId, ctxA)).ok).toBe(true);
    expect((await basket.getBasket(basketId, ctxAdmin)).ok).toBe(true);
    expect((await basket.getBasket(basketId, ctxB)).status).toBe(404);
    expect((await basket.getBasket(basketId, { ...ctxOther, structureId: id('s2') })).status).toBe(404);
    expect((await basket.listBaskets(ctxB)).baskets.map((b) => b.id)).not.toContain(basketId);
    expect((await basket.listBaskets(ctxAdmin)).baskets.map((b) => b.id)).toContain(basketId);
  });

  it('R18: a case is linked only if the caller may open it; the summary reaches the person as a citizen-visible note', async () => {
    expect((await basket.linkCase(basketId, ctxA, id('case'))).code).toBe('CASE_NOT_AVAILABLE');   // assigned to a colleague
    expect((await basket.shareToCase(basketId, ctxA)).code).toBe('NO_CASE');
    await db.update(schema.ProCase).set({ assigneeProUserId: id('pro-a') }).where(eq(schema.ProCase.id, id('case')));
    expect((await basket.linkCase(basketId, ctxA, id('case'))).ok).toBe(true);
    const shared = await basket.shareToCase(basketId, ctxA, { structureName: 'Structure synthétique s1', origin: 'https://example.test' });
    expect(shared.ok).toBe(true);
    expect(shared.basket.items.every((i) => i.followUp === 'PROPOSE')).toBe(true);
    const [note] = await db.select().from(schema.ProCaseNote).where(eq(schema.ProCaseNote.id, shared.noteId));
    expect(note.visibility).toBe('CITIZEN');
    const body = openText(note.bodyEncrypted, { purpose: 'case-note', context: `case:${id('case')}` });
    expect(body).toContain('pas une décision');
    expect(body).toContain('Aide synthétique au paiement du loyer à Strasbourg');
    expect(body).toContain('https://example.test/aides/');
    expect(body).not.toContain('Jeune sans logement');   // the working label stays with the professional
    expect(body).not.toContain('Loyer impayé');          // and so do the professional's reasons
    expect(body).toContain('En lien avec votre besoin « Logement, hébergement »');
  });

  it('R18: once the person revokes the grant, nothing more is sent; a withdrawn record is said and left out', async () => {
    await db.update(schema.Aide).set({ statut: 'archive' }).where(eq(schema.Aide.id, id('aide-loyer')));
    const b = (await basket.getBasket(basketId, ctxA)).basket;
    const gone = b.items.find((i) => i.refId === id('aide-loyer'));
    expect(gone.stillPublic).toBe(false);
    expect(basket.summaryText(b)).not.toContain('paiement du loyer');
    await db.update(schema.SharedDossierGrant).set({ revokedAt: new Date() }).where(eq(schema.SharedDossierGrant.id, id('grant')));
    expect((await basket.shareToCase(basketId, ctxA)).ok).toBe(false);
    await db.update(schema.Aide).set({ statut: 'publie' }).where(eq(schema.Aide.id, id('aide-loyer')));
  });

  it('R18: follow-up, removal and archiving', async () => {
    const b = (await basket.getBasket(basketId, ctxA)).basket;
    const key = b.items[1].key;
    expect((await basket.updateItem(basketId, ctxA, { key, followUp: 'FAIT' })).basket.items[1].followUpLabel).toBe('Démarche faite');
    expect((await basket.updateItem(basketId, ctxA, { key, followUp: 'NOPE' })).code).toBe('INVALID_FOLLOW_UP');
    expect((await basket.removeItem(basketId, ctxA, key)).basket.items).toHaveLength(1);
    expect((await basket.updateBasket(basketId, ctxA, { status: 'ARCHIVED' })).basket.status).toBe('ARCHIVED');
    expect((await basket.addItem(basketId, ctxA, { kind: 'demarche', refId: id('dem') })).code).toBe('ARCHIVED');
  });

  const BY = 'r31-test@example.test';
  it('P27: a new dossier is prefilled with validated facts only and lists what is missing', async () => {
    const out = await funding.createDossier({ title: 'Demande de subvention synthétique', funderName: 'Financeur fictif', deadline: '2099-01-31' }, BY);
    expect(out.ok).toBe(true);
    const d = out.dossier;
    expect(d.content.sections.presentation).toContain('en cours de constitution');
    expect(d.content.sections.presentation).toMatch(/\d+ aides, \d+ démarches et \d+ lieux d’accueil vérifiés et publiés/);
    expect(d.content.pieces).toHaveLength(funding.DEFAULT_PIECES.length);
    const codes = d.warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(['SECTION_EMPTY', 'AMOUNT_MISSING', 'PIECES_MISSING', 'NOT_REGISTERED']));
    expect((await funding.setStatus(d.id, { status: 'PRET_POUR_VALIDATION' }, BY)).code).toBe('NOT_READY');
    const [v] = (await db.execute(sql`SELECT count(*)::int AS n FROM "FundingDossierVersion" WHERE "dossierId" = ${d.id}`)).rows;
    expect(v.n).toBe(1);
  });

  it('P27: untrue states are refused; a complete dossier goes through the status chain, each step a version', async () => {
    const [d] = await db.select().from(schema.FundingDossier).where(eq(schema.FundingDossier.createdBy, BY));
    const sections = Object.fromEntries(funding.SECTIONS.map(([k]) => [k, `Texte synthétique ${k}`]));
    const content = { ...d.content, sections, budget: [{ poste: 'Hébergement', nature: 'CHARGE', montant: '240', statut: 'MESURE', justification: 'factures synthétiques' }, { poste: 'Subvention demandée', nature: 'PRODUIT', montant: '240', statut: 'PROVISOIRE' }] };
    expect((await funding.saveDossier(d.id, { version: d.version + 5, content }, BY)).code).toBe('CONFLICT');
    expect((await funding.saveDossier(d.id, { version: d.version, content: { ...content, budget: [{ poste: 'X', nature: 'CHARGE', montant: 10, statut: 'CONFIRME' }] } }, BY)).code).toBe('JUSTIFICATION_REQUIRED');
    expect((await funding.saveDossier(d.id, { version: d.version, content: { ...content, financement: [{ financeur: 'Ville', montant: 240, statut: 'ACCORDE' }] } }, BY)).code).toBe('DECISION_REQUIRED');
    const saved = await funding.saveDossier(d.id, { version: d.version, content, note: 'sections rédigées' }, BY);
    expect(saved.ok).toBe(true);
    expect(saved.dossier.warnings.filter((w) => w.blocking)).toEqual([]);
    expect(saved.dossier.totals).toMatchObject({ charges: 240, produits: 240 });
    expect((await funding.setStatus(d.id, { status: 'PRET_POUR_VALIDATION' }, BY)).ok).toBe(true);
    expect((await funding.setStatus(d.id, { status: 'DEPOSE' }, BY)).code).toBe('DATE_REQUIRED');
    expect((await funding.setStatus(d.id, { status: 'DEPOSE', date: '2026-11-02' }, BY)).ok).toBe(true);
    expect((await funding.setStatus(d.id, { status: 'ACCORDE', date: '2026-12-01' }, BY)).code).toBe('DECISION_REQUIRED');
    const awarded = await funding.setStatus(d.id, { status: 'ACCORDE', date: '2026-12-01', reference: 'Décision synthétique n° 1' }, BY);
    expect(awarded.dossier.decisionRef).toBe('Décision synthétique n° 1');
    expect((await funding.saveDossier(d.id, { version: awarded.dossier.version, content }, BY)).code).toBe('CLOSED');
    const full = await funding.getDossier(d.id);
    expect(full.versions.map((x) => x.version)).toEqual([5, 4, 3, 2, 1]);
    const md = (await funding.exportDossier(d.id)).markdown;
    expect(md).toContain('Document de travail');
    expect(md).toContain('| Hébergement | Charge | 240,00 € | Mesuré | factures synthétiques |');
  });

  it('Q14: the database itself refuses a session without consent', async () => {
    await expect(db.execute(sql`INSERT INTO "PilotSession" (id, "protocolVersion", "participantCode", "journeyCode", "deviceType", outcome, assistance, "consentRecorded", "conductedAt", "recordedBy")
      VALUES (${id('nocons')}, 'x', 'P-AAAAAA', 'J1_AIDE_LOGEMENT', 'TELEPHONE', 'REUSSI', 'AUCUNE', false, now(), ${BY})`)).rejects.toThrow();
  });

  it('Q14: results stay hidden below K sessions, appear at K, and a withdrawal of consent removes the person’s sessions', async () => {
    const codes = Array.from({ length: 5 }, () => pilot.newParticipantCode());
    const base = { journeyCode: 'J3_LIEU', deviceType: 'TELEPHONE', assistance: 'AUCUNE', consentRecorded: true, durationSeconds: 120, clarity: 4 };
    for (let i = 0; i < 4; i += 1) expect((await pilot.recordSession({ ...base, participantCode: codes[i], outcome: i === 0 ? 'ECHEC' : 'REUSSI' }, BY)).ok).toBe(true);
    let report = await pilot.pilotReport();
    let j3 = report.journeys.find((j) => j.journeyCode === 'J3_LIEU');
    expect(j3.suppressed).toBe(true);
    expect(j3.successAlone).toBeUndefined();
    await pilot.recordSession({ ...base, participantCode: codes[4], outcome: 'REUSSI_AVEC_AIDE', assistance: 'INDICE', accessibilityIssues: ['VOCABULAIRE'] }, BY);
    report = await pilot.pilotReport();
    j3 = report.journeys.find((j) => j.journeyCode === 'J3_LIEU');
    expect(j3).toMatchObject({ suppressed: false, sessions: 5, participants: 5, successAlone: 60, successWithHelp: 20, failure: 20, medianDurationSeconds: 120 });
    expect(j3.clarity).toEqual({ n: 5, mean: 4 });
    expect((await pilot.deleteSessions({ participantCode: codes[0] })).deleted).toBe(1);
    expect((await pilot.pilotReport()).journeys.find((j) => j.journeyCode === 'J3_LIEU').suppressed).toBe(true);
  });

  it('Q14: pseudonymised sessions — the day only is stored, an assistive technology needs the separate explicit consent', async () => {
    const code = pilot.newParticipantCode();
    const base = { participantCode: code, journeyCode: 'J4_GUIDE', deviceType: 'ORDINATEUR', outcome: 'REUSSI', assistance: 'AUCUNE', consentRecorded: true, conductedAt: '2026-10-30T16:47:12+01:00' };
    expect((await pilot.recordSession({ ...base, assistiveTech: 'LOUPE' }, BY)).code).toBe('EXPLICIT_CONSENT_REQUIRED');
    expect((await pilot.recordSession({ ...base, assistiveTech: 'LOUPE', explicitConsent: true }, BY)).ok).toBe(true);
    const [row] = (await db.execute(sql`SELECT "assistiveTech", to_char("conductedAt", 'YYYY-MM-DD HH24:MI:SS') AS at FROM "PilotSession" WHERE "participantCode" = ${code}`)).rows;
    expect(row).toEqual({ assistiveTech: 'LOUPE', at: '2026-10-30 12:00:00' });
    expect((await pilot.deleteSessions({ participantCode: code })).deleted).toBe(1);
  });

  it('Q14: technical indicators equal the direct counts of the verified catalogue', async () => {
    const t = await pilot.technicalIndicators();
    const { visibleSql } = await import('../../api/lib/publicVisibility.js');
    const [r] = (await db.execute(sql`SELECT count(*)::int AS n FROM "Aide" WHERE ${visibleSql('aide')}`)).rows;
    expect(t.catalogue.find((c) => c.kind === 'aide').visible).toBe(r.n);
    expect(t.catalogue.find((c) => c.kind === 'aide').heldBack).toBeGreaterThanOrEqual(0);
  });
});
