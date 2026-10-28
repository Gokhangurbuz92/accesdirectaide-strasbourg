/**
 * Automatic verification chain — hardening after the owner's definitive directive (D-5 v2 confirmed, 2026-10-25), the parts that decide without network or
 * database, each with the real case that showed the need:
 *  - contacts: an employee's own e-mail never becomes a public contact (the WS2 records of the Caf du Bas-Rhin and of the Mission locale held one);
 *  - the machine: no run during a native QA campaign or under the disk floor, the model only with free memory, its threads by time of day;
 *  - the schedule: one run per night, caught up after sleep or a stop, a dead run continued, errors retried once;
 *  - identity: an office matched by name only when every distinctive word or the street agrees (France Travail « Seyboth » is not « Pont Matthis »);
 *  - authority: a site is a source only for what it is an authority on (an online service cited by Service-Public is a source for a démarche, not for the
 *    rules of an aide; Fluo Grand Est for the Carte solidaire; an unknown site never);
 *  - conditions: a general « sans condition de ressources » forbids writing one (PCH); an exception (aide juridictionnelle of a minor, Aspa, some costs) does not;
 *  - matching: the Service-Public dossier of a right before its particular cases and its questions-answers (prime d'activité); a fiche of another territory never;
 *  - texts: repeated attempts never lower the checks;
 *  - registry: the online services Service-Public cites, with their body; the Annuaire sites left out and why.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
const { nominativeEmail, publicEmail } = await import('../../api/_services/verification/contacts.js');
const { allowed, parseSwap, modelOptions, QA_PROCESS } = await import('../../api/_services/verification/resources.js');
const { dueNow, lastSlot, nextNightly } = await import('../../api/_services/verification/schedule.js');
const { matchOffice, authorityFor, rankCandidates, isPublicOfficeName } = await import('../../api/_services/verification/chain.js');
const { contradictions, writeTexts } = await import('../../api/_services/verification/texts.js');
const { loadArchive, ficheMeta } = await import('../../api/_services/verification/dila.js');
const { onlineServiceHosts, rejectedSites, onlineLevel, levelOf } = await import('../../api/_services/verification/sources.js');
const { officeTexts, OFFICE_KINDS, officeRecord } = await import('../../api/_services/verification/offices.js');
const { WITHDRAW_ON } = await import('../../api/_services/verification/audit.js');
const { readableCase, streetOnly, sameStreetNumber } = await import('../../api/_services/verification/structure-check.js');

describe('contacts: never a person’s own address in a public listing', () => {
  it('the employees’ addresses of the WS2 records are withheld; service mailboxes are kept', () => {
    for (const e of ['camille.exemple@caf67.caf.fr', 'alex.exemple@mlpe.eu', 'j.dupont@mairie-x.fr', 'marie-claire.durand@asso.fr']) expect(nominativeEmail(e), e).toBe(true);
    for (const e of ['centre-ville@mlpe.eu', 'contact@mlpe.eu', 'strasbourg@cidff67.fr', 'accueil@etage.fr', 'ape.67013@francetravail.fr', 'mairie.obernai@wanadoo.fr', 'ccas.strasbourg@strasbourg.eu', 'service.social@ville.fr']) expect(nominativeEmail(e), e).toBe(false);
  });
  it('the public e-mail: the record’s service address, else the office’s generic one, else none', () => {
    expect(publicEmail('contact@x.fr', 'accueil@y.fr')).toBe('contact@x.fr');
    expect(publicEmail('camille.exemple@caf67.caf.fr', 'accueil@caf67.caf.fr')).toBe('accueil@caf67.caf.fr');
    expect(publicEmail('alex.exemple@mlpe.eu', 'jean.martin@mlpe.eu')).toBeNull();
  });
});

describe('the machine: native QA, disk, memory, threads', () => {
  const p = (x = {}) => ({ disk: { freeGb: 25 }, memory: { availablePct: 70, swapUsedGb: 3 }, load: { one: 1, cores: 10 }, qa: { running: false }, ...x });
  it('does not start during a native QA campaign or under the disk floor (the QA needs 8 GiB)', () => {
    expect(allowed(p(), 'start', {})).toEqual({ ok: true });
    expect(allowed(p({ qa: { running: true, detail: 'ADA_RC29_PKG12_QA_v1.command' } }), 'start', {})).toMatchObject({ ok: false, code: 'NATIVE_QA_RUNNING' });
    expect(allowed(p({ disk: { freeGb: 9.5 } }), 'start', {})).toMatchObject({ ok: false, code: 'DISK_LOW' });
    expect(allowed(p({ disk: { freeGb: 9.5 } }), 'start', { ADA_VEILLE_MIN_FREE_GB: '9' })).toEqual({ ok: true });
    expect(QA_PROCESS.test('/bin/bash /Users/x/RC5_AUTHZ_QA/ADA_RC29_PKG12_QA_v2.command')).toBe(true);
    expect(QA_PROCESS.test('postgres -D /Users/x/RC5_AUTHZ_QA/runs/20261025T021204Z-56b5f6/pgdata -p 54391')).toBe(true);
    expect(QA_PROCESS.test('postgres -D /opt/homebrew/var/postgresql@17')).toBe(false);
  });
  it('the local model only with free memory and limited swap; an unknown probe never blocks', () => {
    expect(allowed(p({ memory: { availablePct: 12, swapUsedGb: 2 } }), 'texts', {})).toMatchObject({ ok: false, code: 'MEMORY_LOW' });
    expect(allowed(p({ memory: { availablePct: 60, swapUsedGb: 13 } }), 'texts', {})).toMatchObject({ ok: false, code: 'SWAP_HIGH' });
    expect(allowed(p({ memory: { availablePct: 60, swapUsedGb: 9 } }), 'texts', { ADA_VEILLE_MAX_SWAP_GB: '8' })).toMatchObject({ ok: false, code: 'SWAP_HIGH' });
    expect(allowed(p({ memory: { availablePct: null, swapUsedGb: null } }), 'texts', {})).toEqual({ ok: true });
    // once loaded, the model's own memory is not « available » any more: it keeps writing unless the pressure is critical or swap too high (owner LAB, 2026-10-25)
    expect(allowed(p({ memory: { availablePct: 19, swapUsedGb: 5.2, pressure: 2 }, model: { loaded: true } }), 'texts', {})).toEqual({ ok: true });
    expect(allowed(p({ memory: { availablePct: 19, swapUsedGb: 5.2, pressure: 4 }, model: { loaded: true } }), 'texts', {})).toMatchObject({ ok: false, code: 'MEMORY_CRITICAL' });
    expect(allowed(p({ memory: { availablePct: 19, swapUsedGb: 8.2, pressure: 2 }, model: { loaded: true } }), 'texts', {})).toEqual({ ok: true });   // owner LAB, 2026-10-25: 8.2 GiB is not a reason to stop
    expect(allowed(p({ memory: { availablePct: 19, swapUsedGb: 12.5, pressure: 2 }, model: { loaded: true } }), 'texts', {})).toMatchObject({ ok: false, code: 'SWAP_HIGH' });
    expect(allowed(null, 'start', {})).toEqual({ ok: true });
    expect(parseSwap('total = 4096.00M  used = 3170.69M  free = 925.31M  (encrypted)')).toBeCloseTo(3.096, 2);
    expect(parseSwap('total = 8.00G  used = 6.50G  free = 1.50G')).toBe(6.5);
  });
  it('the model’s threads: the setting, else half of the cores in the day and all at night', () => {
    expect(modelOptions({ ADA_VEILLE_MODEL_THREADS: '3' })).toEqual({ num_thread: 3 });
    const day = new Date(); day.setHours(14, 0, 0, 0); const night = new Date(); night.setHours(3, 17, 0, 0);
    expect(modelOptions({}, day).num_thread).toBeGreaterThanOrEqual(2);
    expect(modelOptions({}, night)).toEqual({});
  });
});

describe('the schedule: one run per night, caught up, continued, never twice', () => {
  const at = (h, m = 0, d = 0) => { const x = new Date(2026, 9, 26 + d, h, m, 0, 0); return x; };
  it('the slot is the last 03:17; the next is the following one', () => {
    expect(lastSlot(at(9)).getTime()).toBe(at(3, 17).getTime());
    expect(lastSlot(at(2)).getTime()).toBe(at(3, 17, -1).getTime());
    expect(nextNightly(at(9)).getTime()).toBe(at(3, 17, 1).getTime());
  });
  it('due when nothing ran since the slot (a Mac asleep at 03:17 runs it when it wakes up), not when it is done', () => {
    expect(dueNow([], at(9)).due).toBe(true);
    expect(dueNow([{ status: 'skipped', startedAt: at(3, 17) }], at(9)).due).toBe(true);   // held back by a QA campaign: still due
    for (const status of ['success', 'partial', 'stopped']) expect(dueNow([{ status, startedAt: at(3, 20) }], at(9)).due, status).toBe(false);
  });
  it('R12: a run of some steps only (« --only », a rehearsal) is not the night\'s veille — the full one is still due', () => {
    expect(dueNow([{ status: 'success', scope: 'partial', startedAt: at(3, 43) }], at(9)).due).toBe(true);
    expect(dueNow([{ status: 'success', scope: 'full', startedAt: at(3, 43) }], at(9)).due).toBe(false);
  });
  it('a run in progress blocks a second one; a run whose heartbeat stopped does not (it is continued)', () => {
    expect(dueNow([{ status: 'running', startedAt: at(8, 50), updatedAt: at(8, 59) }], at(9)).due).toBe(false);
    expect(dueNow([{ status: 'running', startedAt: at(3, 17), updatedAt: at(4) }], at(9)).due).toBe(true);
    expect(dueNow([{ status: 'interrupted', startedAt: at(3, 17) }], at(9)).due).toBe(true);
  });
  it('an error is retried once, an hour later', () => {
    expect(dueNow([{ status: 'error', startedAt: at(8, 30) }], at(9)).due).toBe(false);
    expect(dueNow([{ status: 'error', startedAt: at(7, 30) }], at(9)).due).toBe(true);
    expect(dueNow([{ status: 'error', startedAt: at(8, 0) }, { status: 'error', startedAt: at(4) }], at(9, 30)).due).toBe(false);
  });
  it('a run stopped for the machine (native QA, disk) or by the LAB server’s shutdown is continued; the owner’s pause or stop ends the night', () => {
    for (const skipReason of ['NATIVE_QA_RUNNING', 'DISK_LOW', 'SERVER_STOP']) expect(dueNow([{ status: 'stopped', skipReason, startedAt: at(4), updatedAt: at(4, 30) }], at(9))).toEqual({ due: true, why: 'reprise de la veille de cette nuit' });
    for (const skipReason of ['PAUSED', 'STOPPED', null, undefined]) expect(dueNow([{ status: 'stopped', skipReason, startedAt: at(4), updatedAt: at(4, 30) }], at(9)).due).toBe(false);
  });
  it('03:17 is Paris time across both daylight-saving changes (the LAB server runs with TZ=Europe/Paris)', () => {
    const code = `const s = await import(${JSON.stringify(path.resolve('api/_services/verification/schedule.js'))});
      const n = (d) => s.nextNightly(new Date(d)).toISOString(); const l = (d) => s.lastSlot(new Date(d)).toISOString();
      console.log('SLOTS ' + JSON.stringify({ autumnNext: n('2026-10-24T22:00:00Z'), autumnLast: l('2026-10-25T05:00:00Z'), springNext: n('2027-03-27T22:00:00Z'), springLast: l('2027-03-28T05:00:00Z'), summer: l('2026-07-01T12:00:00Z'), winter: n('2026-12-31T23:30:00Z') }));`;
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: process.cwd(), encoding: 'utf8', timeout: 60000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'Europe/Paris', NODE_ENV: 'test', DATABASE_URL: 'postgresql://lab@127.0.0.1:1/none' } });
    const line = String(r.stdout || '').split('\n').find((x) => x.startsWith('SLOTS '));
    expect(line, String(r.stderr || '').slice(-400)).toBeTruthy();
    expect(JSON.parse(line.slice(6))).toEqual({ autumnNext: '2026-10-25T02:17:00.000Z', autumnLast: '2026-10-25T02:17:00.000Z', springNext: '2027-03-28T01:17:00.000Z',
      springLast: '2027-03-28T01:17:00.000Z', summer: '2026-07-01T01:17:00.000Z', winter: '2027-01-01T02:17:00.000Z' });
  }, 60000);
});

describe('identity of a public office: a name is not an identity', () => {
  const office = (annuaireId, nom, adresse, code_postal = '67000', siret = null) => ({ annuaireId, nom, adresse, code_postal, ville: 'Strasbourg', siret });
  const ctx = { hints: new Map(), allOffices: [office('15f2b0ca', 'Agence France Travail STRASBOURG PONT MATTHIS', '2 Rue Gustave Adolphe Hirn', '67000', '13000548120117'),
    office('44f93065', 'Agence France Travail STRASBOURG DANUBE', '31 Avenue du Rhin', '67100', '13000548125629'), office('c429a728', "Mission locale pour l'emploi de Strasbourg", '13 rue Martin-Bucer, Siège social')] };
  it('France Travail « Seyboth » (8 rue Adolphe Seyboth, closed) is not the Pont Matthis agency (2 rue Gustave Adolphe Hirn)', () => {
    expect(matchOffice(ctx, { slug: 'x', nom: 'Agence France Travail STRASBOURG SEYBOTH', adresse: '8 Rue Adolphe Seyboth 67000 Strasbourg', code_postal: '67000', siret: '13000548123491' })).toBeNull();
  });
  it('the same agency under two names and the same street is matched; its recorded id or SIRET too', () => {
    expect(matchOffice(ctx, { slug: 'x', nom: 'France Travail - STRASBOURG DANUBE', adresse: '31 Avenue du Rhin 67100 Strasbourg', code_postal: '67100' })?.annuaireId).toBe('44f93065');
    expect(matchOffice(ctx, { slug: 'x', nom: 'MISSION LOCALE POUR L’EMPLOI STRASBOURG EUROMETROPOLE', adresse: '13 Rue Martin Bucer 67000 Strasbourg', code_postal: '67000' })?.annuaireId).toBe('c429a728');
    expect(matchOffice(ctx, { slug: 'x', nom: 'Autre nom', source_annuaire: '15f2b0ca', code_postal: '67000' })?.annuaireId).toBe('15f2b0ca');
    expect(matchOffice(ctx, { slug: 'x', nom: 'Agence', siret: '13000548120117', code_postal: '67000' })?.annuaireId).toBe('15f2b0ca');
  });
  it('a distinctive word missing and no address to compare: not matched', () => {
    expect(matchOffice(ctx, { slug: 'x', nom: 'Agence France Travail STRASBOURG SEYBOTH', adresse: null, code_postal: '67000' })).toBeNull();
  });
  it('the public reception offices whose existence the Annuaire decides (an agency absent from it is not published on its SIRET alone); associations are not among them', () => {
    for (const n of ['Agence France Travail STRASBOURG SEYBOTH', "CAISSE D'ALLOCATIONS FAMILIALES DU BAS RHIN — CAF 67", "Caisse primaire d'assurance maladie (CPAM) du Bas-Rhin", 'Mairie - Still',
      "Centre communal d'action sociale (CCAS) - Oberbronn", 'Espace Solidarités Alsace de Mutzig', 'France services -  Pays de Sainte-Odile']) expect(isPublicOfficeName(n), n).toBe(true);
    for (const n of ["MISSION LOCALE POUR L'EMPLOI", 'Emmaus Connect', 'CIDFF67', 'Crésus Alsace du Nord', 'Adie Strasbourg']) expect(isPublicOfficeName(n), n).toBe(false);
  });
  it('an address the Annuaire repeats in a complement is written once', () => {
    const o = officeRecord({ id: 'x', nom: 'Caf', pivot: '[{"type_service_local": "caf"}]', adresse: JSON.stringify([{ type_adresse: 'Adresse', numero_voie: "22 route de l'Hôpital", complement1: "22 route de l'Hôpital", complement2: 'Parc du Heyritz', code_postal: '67100', nom_commune: 'Strasbourg' }]) });
    expect(o.adresse).toBe("22 route de l'Hôpital, Parc du Heyritz");
  });
  it('a registry’s capitals are written in readable case; the record’s own wording of the same street and number is kept, not another number', () => {
    expect(readableCase('BAT B DU LYCEE COUFFIGNAL 11 ROUTE DE LA FEDERATION')).toBe('Bat B du Lycee Couffignal 11 route de la Federation');
    expect(readableCase('33 RUE KAGENECK')).toBe('33 rue Kageneck');
    expect(readableCase('QUAI FINKMATT')).toBe('Quai Finkmatt');
    expect(readableCase("12 RUE D'ALSACE")).toBe("12 rue d'Alsace");
    expect(readableCase('11B AVENUE DE COLMAR')).toBe('11B avenue de Colmar');
    expect(readableCase('SAINT-JEAN')).toBe('Saint-Jean');
    expect(readableCase('22 route de l’Hôpital')).toBe('22 route de l’Hôpital');
    expect(streetOnly('11 Route de la Fédération 67000 Strasbourg')).toBe('11 Route de la Fédération');
    expect(sameStreetNumber('11 Route de la Fédération', 'BAT B DU LYCEE COUFFIGNAL 11 ROUTE DE LA FEDERATION', '67100', 'STRASBOURG')).toBe(true);
    expect(sameStreetNumber('Route de la Fédération', '11 ROUTE DE LA FEDERATION', '67100', 'STRASBOURG')).toBe(false);
    expect(sameStreetNumber('13 Route de la Fédération', '11 ROUTE DE LA FEDERATION', '67100', 'STRASBOURG')).toBe(false);
    const cdad = officeRecord({ id: 'y', nom: 'CDAD', pivot: '[{"type_service_local": "cdad"}]', adresse: JSON.stringify([{ type_adresse: 'Adresse', numero_voie: 'QUAI FINKMATT', code_postal: '67000', nom_commune: 'STRASBOURG' }]) }, { any: true });
    expect(cdad).toMatchObject({ adresse: 'Quai Finkmatt', ville: 'Strasbourg' });
    expect(officeTexts(cdad).falc.join(' ')).toContain('L’adresse est : Quai Finkmatt, 67000 Strasbourg.');
  });
});

describe('authority: a site is a source only for what it is an authority on', () => {
  const ctx = { registry: [
    { sourceId: 'caf', level: 'ORGANISME', capabilities: ['aides', 'structures'], trustedDomains: ['caf.fr'] },
    { sourceId: 'defenseur-des-droits', level: 'NATIONAL', capabilities: ['structures'], trustedDomains: ['defenseurdesdroits.fr'] },
    { sourceId: 'region-grand-est', level: 'REGIONAL', capabilities: ['aides'], trustedDomains: ['grandest.fr'] },
    { sourceId: 'annuaire-site:mairie-x.fr', level: 'COMMUNAL', capabilities: ['structures', 'aides', 'demarches'], trustedDomains: ['mairie-x.fr'] },
    { sourceId: 'dila-online:demande-autonomie.gouv.fr', level: 'NATIONAL', capabilities: ['demarches'], trustedDomains: ['demande-autonomie.gouv.fr'] },
  ] };
  it('the Caf for its aides; Fluo Grand Est (the Région’s transport operator) for the Carte solidaire; a commune for its own procedures', () => {
    expect(authorityFor(ctx, 'https://www.caf.fr/allocataires/aides-et-demarches/vacances', 'aide')).toMatchObject({ ok: true, sourceId: 'caf' });
    expect(authorityFor(ctx, 'https://www.fluo.grandest.fr/carte-solidaire', 'aide')).toMatchObject({ ok: true, sourceId: 'region-grand-est' });
    expect(authorityFor(ctx, 'https://www.mairie-x.fr/demarches/carte-identite', 'demarche')).toMatchObject({ ok: true });
  });
  it('a legitimate site outside its field is not a source: the Défenseur des droits for an aide’s rules, an online service for an aide', () => {
    expect(authorityFor(ctx, 'https://www.defenseurdesdroits.fr/une-page', 'aide')).toMatchObject({ ok: false });
    expect(authorityFor(ctx, 'https://demande-autonomie.gouv.fr/', 'aide')).toMatchObject({ ok: false });
    expect(authorityFor(ctx, 'https://demande-autonomie.gouv.fr/', 'demarche')).toMatchObject({ ok: true });
  });
  it('a site nobody attests is never a source, even when its address looks official; the State’s own domains are', () => {
    expect(authorityFor(ctx, 'https://www.service-public-gouv.info/aides', 'aide')).toMatchObject({ ok: false });
    expect(authorityFor(ctx, 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1280', 'aide')).toMatchObject({ ok: true });
  });
});

describe('conditions the official text removes — only when it removes them for everybody', () => {
  const claim = { resume: 'Vos ressources doivent être inférieures à un plafond.', pour_qui: ['Avoir des ressources inférieures au plafond'] };
  const none = { resume: [], pour_qui: [] };
  it('PCH (« attribuée sans condition de ressources »): a resource condition in the texts is refused', () => {
    expect(contradictions(claim, none, 'Ressources. La PCH est attribuée sans condition de ressources.').length).toBeGreaterThan(0);
  });
  it('an exception does not remove the condition for the others: aide juridictionnelle of a minor, Aspa under four conditions, some costs only', () => {
    expect(contradictions(claim, none, "L'aide juridictionnelle est accordée à l'enfant mineur sans condition de ressources des parents.")).toEqual([]);
    expect(contradictions(claim, none, "Il n'y a pas de conditions de ressources si vous répondez aux 4 conditions suivantes : Être âgé de plus de 65 ans.")).toEqual([]);
    expect(contradictions(claim, none, "Prise en charge sans condition de ressources : Des frais d'hébergement.")).toEqual([]);
  });
  it('an age the text says is no condition (AEEH-like « sans condition d’âge » in general) is refused; one stated by the text is kept', () => {
    const ageClaim = { resume: 'Il faut avoir moins de 20 ans.', pour_qui: [] };
    expect(contradictions(ageClaim, none, "L'aide est versée sans condition d'âge.").length).toBeGreaterThan(0);
    expect(contradictions(ageClaim, none, "L'enfant doit avoir moins de 20 ans.")).toEqual([]);
  });
});

describe('matching a record to its Service-Public source', () => {
  const pub = (id, type, title, body, coverage = 'France entière') => `<?xml version="1.0" encoding="UTF-8"?><Publication xmlns:dc="http://purl.org/dc/elements/1.1/" ID="${id}" type="${type}" dateDerniereModificationImportante="2026-07-01T00:00:00" spUrl="https://www.service-public.gouv.fr/particuliers/vosdroits/${id}"><dc:title>${title}</dc:title><dc:description>${body}</dc:description><dc:coverage>${coverage}</dc:coverage><FilDAriane><Niveau ID="N1">Social - Santé</Niveau></FilDAriane><Introduction><Texte><Paragraphe>${body}</Paragraphe></Texte></Introduction>${type === 'Dossier' ? '<SousDossier><Fiche ID="F2882">Salarié ou fonctionnaire</Fiche></SousDossier>' : ''}</Publication>`;
  const body = "La prime d'activité complète les revenus des travailleurs aux ressources modestes. Elle est versée par la Caf ou la MSA chaque mois.";
  const arch = loadArchive(zipSync({
    'N31477.xml': strToU8(pub('N31477', 'Dossier', "Prime d'activité", body)), 'F2882.xml': strToU8(pub('F2882', "Fiche d'information", "Prime d'activité : salarié ou fonctionnaire", body)),
    'F33000.xml': strToU8(pub('F33000', 'Question-réponse', "Prime d'activité : comment la demander ?", body)), 'F34000.xml': strToU8(pub('F34000', "Fiche d'information", "Prime d'activité à Mayotte", body, 'Mayotte')),
    'redirections.xml': strToU8('<Redirections><dc:date xmlns:dc="x">2026-10-24T16:16:33</dc:date></Redirections>'),
  }));
  const ctx = { hints: new Map(), archive: arch, metas: [...arch.fiches.entries()].map(([id, xml]) => ({ ...ficheMeta(xml), id })) };
  it('the prime d’activité record takes the dossier (the right itself), not a particular case or a question-answer; never the fiche of another territory', () => {
    const ranked = rankCandidates(ctx, 'aide', { slug: 'prime', titre: "Prime d'activité", cest_quoi: body });
    expect(ranked[0].m.id).toBe('N31477');
    expect(ranked.map((c) => c.m.id)).not.toContain('F34000');
  });
});

describe('texts: a retry never lowers the checks', () => {
  it('a model that keeps inventing a number never gets its texts accepted, whatever the attempt', async () => {
    const src = { title: 'Aide test', description: 'Une aide.', text: 'Vous pouvez recevoir 100 € par mois si vous avez moins de 25 ans.', abbreviations: {}, definitions: {}, facts: {} };
    const generate = async ({ systemInstruction }) => {
      if (/contrôleur qualité/.test(systemInstruction)) return { model: 'double', content: { verdicts: [] } };
      if (/FALC/.test(systemInstruction)) return { model: 'double', content: { resume: ['Vous pouvez recevoir 900 € par mois.', 'Vous devez avoir moins de 25 ans.'], pour_qui: ['Vous avez moins de 25 ans.'], montant: ['900 € par mois.'], etapes: [] } };
      return { model: 'double', content: { resume: 'Cette aide verse 900 € par mois aux personnes de moins de 25 ans qui la demandent en ligne.', pour_qui: ['Avoir moins de 25 ans'], montant: '900 € par mois', etapes: [], documents: [] } };
    };
    const t = await writeTexts(src, { generate });
    expect(t.ok).toBe(false);
    expect(t.reasons.join(' ')).toMatch(/900/);
  });
});

describe('the registry of sources: what Service-Public cites, what the Annuaire attests, what is left out', () => {
  it('the online services of the fiches, with the body that runs them', () => {
    const xml = (id, url, org) => `<Publication ID="${id}"><ServiceEnLigne ID="R1" URL="${url}" type="Téléservice"><Titre>Demande en ligne</Titre><Source ID="R2">${org}</Source></ServiceEnLigne></Publication>`;
    const hosts = onlineServiceHosts({ fiches: new Map([['F1', xml('F1', 'https://demande-autonomie.gouv.fr/?a=1&amp;b=2', "Caisse nationale de solidarité pour l'autonomie (CNSA)")], ['F2', xml('F2', 'https://apa.paris.fr/portailAPA/', 'Ville de Paris')], ['F3', xml('F3', 'http://insecure.example/', 'X')]]) });
    expect([...hosts.keys()].sort()).toEqual(['apa.paris.fr', 'demande-autonomie.gouv.fr']);
    expect([...hosts.get('demande-autonomie.gouv.fr').orgs.keys()]).toEqual(["Caisse nationale de solidarité pour l'autonomie (CNSA)"]);
  });
  it('a cited online service is labelled for what it is: State, European institution, social security, or a service operator (never « State » by default)', () => {
    expect(onlineLevel('demande-autonomie.gouv.fr', "Caisse nationale de solidarité pour l'autonomie (CNSA)")).toBe('NATIONAL');
    expect(onlineLevel('e-justice.europa.eu', 'Commission européenne')).toBe('EUROPEEN');
    expect(onlineLevel('vacaf.org', 'Caisse nationale des allocations familiales (Cnaf)')).toBe('ORGANISME');
    expect(onlineLevel('ecosystem.eco', 'Ecosystem')).toBe('OPERATEUR');
    expect(onlineLevel('mediation-sncf.my.site.com', 'Société nationale des chemins de fer français (SNCF)')).toBe('OPERATEUR');
  });
  it('an Annuaire body is labelled for what it is: an association or a chamber running a service is an operator, a State service is the State', () => {
    expect(['mission_locale', 'cij', 'pcb', 'fr_renov', 'cidf', 'adil', 'chambre_agriculture', 'ordre_avocats'].map(levelOf)).toEqual(Array(8).fill('OPERATEUR'));
    expect(['gendarmerie', 'tgi', 'crous', 'bdf', 'france_services', 'point_justice'].map(levelOf)).toEqual(Array(6).fill('NATIONAL'));
    expect([levelOf('parc_naturel_regional'), levelOf('ad'), levelOf('credit_municipal')]).toEqual(['REGIONAL', 'DEPARTEMENTAL', 'COMMUNAL']);
  });
  it('an Annuaire site on a shared platform or not a web address is left out, with the reason', () => {
    const rows = [{ nom: 'Mairie A', site_internet: '[{"valeur": "https://www.facebook.com/mairiea"}]' }, { nom: 'Mairie B', site_internet: '[{"valeur": "mairie-b"}]' }, { nom: 'Mairie C', site_internet: '[{"valeur": "https://www.mairie-c.fr"}]' }];
    const r = rejectedSites(rows);
    expect(r.map((x) => x.reason)).toEqual([expect.stringMatching(/plateforme partagée/), expect.stringMatching(/invalide/)]);
  });
});

describe('public offices: general missions, not a promise of every service', () => {
  it('every office text says the services vary from one place to another', () => {
    for (const [type, kind] of Object.entries(OFFICE_KINDS)) {
      const t = officeTexts({ kind, adresse: '1 rue X', code_postal: '67000', ville: 'Strasbourg', telephone: '03 88 00 00 00', horaires: '' });
      expect(t.resume, type).toMatch(/peuvent varier d’un lieu à l’autre/);
      expect(t.falc, type).toContain('Chaque lieu est un peu différent.');
    }
  });
});

describe('self-check (D-5 v2): what is withdrawn at once', () => {
  it('no ledger decision, evidence outside the official sources, a personal address, texts older than their source (contract v2): withdrawn; freshness and duplicates: alerts', () => {
    expect([...WITHDRAW_ON].sort()).toEqual(['EVIDENCE', 'LEDGER', 'PRIVACY', 'TEXTS']);
  });
});
