/**
 * Automatic verification chain (owner decision 2026-10-25) — the parts that decide, without network or database:
 *  - the Service-Public feed: a fiche's text, facts, online services, places to go, acronyms; a dossier; the redirections; matching a record to its fiche;
 *  - the texts: no invented number, FALC rules (sentence length, « vous », jargon, acronyms explained), a FALC that is not the normal summary again, the
 *    faithfulness reading (a refused summary sentence fails the texts; a refused list item is removed), the model unavailable;
 *  - the registry: attested sites of public bodies, shared platforms never attested, levels;
 *  - the offices of the Annuaire: hours, phones, texts;
 *  - the fetcher: attested domains allowed, other hosts refused, network switch;
 *  - what the public sees of an automatic check, and the FALC labels.
 */
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { loadArchive, parseFiche, readSource, resolveId, matchFiche, ficheMeta } from '../../api/_services/verification/dila.js';
import { checkTexts, inventedNumbers, explainFirstUse, explanationsFor, withoutGlossary, writeTexts, sentences, wordCount, sourceExcerpt, contradictions } from '../../api/_services/verification/texts.js';
import { attestedSites, levelOf, isShared, SEED_SOURCES } from '../../api/_services/verification/sources.js';
import { officeRecord, officeTexts, hoursText, OFFICE_KINDS } from '../../api/_services/verification/offices.js';
import { fetchable, officialGet, SourceError } from '../../api/_services/verification/fetcher.js';
import { publicAutoCheck, stripReviewFields } from '../../api/lib/publicVisibility.js';
import { falcLabel, falcFieldNote } from '../../src/lib/falcLabel.js';
import { asList } from '../../src/lib/textLists.js';

const FICHE = (id, title, { date = '2026-07-01', body = '', abbr = '' } = {}) => `<?xml version="1.0" encoding="UTF-8"?><Publication xmlns:dc="http://purl.org/dc/elements/1.1/" ID="${id}" type="Fiche d'information conditionnée" dateDerniereModificationImportante="${date}T00:00:00" spUrl="https://www.service-public.gouv.fr/particuliers/vosdroits/${id}"><dc:title>${title}</dc:title><dc:description>Résumé officiel de ${title}.</dc:description><dc:subject>Logement</dc:subject><dc:date>modified ${date}</dc:date><dc:coverage>France entière</dc:coverage><Audience>Particuliers</Audience><FilDAriane><Niveau ID="Particuliers">Accueil particuliers</Niveau><Niveau ID="N19808">Logement</Niveau></FilDAriane><Introduction><Texte><Paragraphe>Vous pouvez recevoir ${title} si vous respectez certaines conditions.</Paragraphe></Texte></Introduction><Texte><Chapitre><Titre><Paragraphe>Qui peut en bénéficier ?</Paragraphe></Titre><Paragraphe>Vous devez avoir moins de 30 ans.</Paragraphe><Liste type="puce"><Item><Paragraphe>Être locataire</Paragraphe></Item><Item><Paragraphe>Avoir des revenus inférieurs à <Valeur>30 000 €</Valeur> par an</Paragraphe></Item></Liste>${body}</Chapitre><Chapitre><Titre><Paragraphe>Comment faire la demande ?</Paragraphe></Titre><Paragraphe>Faites la demande en ligne.</Paragraphe><ServiceEnLigne ID="R1" URL="https://www.caf.fr/demande" type="Téléservice"><Titre>Demander l'aide en ligne</Titre><Source ID="R2">Caf</Source></ServiceEnLigne><OuSAdresser ID="R3" type="Local personnalisé sur SP"><Titre>Caisse d'allocations familiales (Caf)</Titre><PivotLocal>caf</PivotLocal></OuSAdresser><Tableau><TitreRiche><Paragraphe>Plafonds</Paragraphe></TitreRiche><Rangée type="header"><Cellule><Paragraphe>Personnes</Paragraphe></Cellule><Cellule><Paragraphe>Plafond</Paragraphe></Cellule></Rangée><Rangée type="normal"><Cellule><Paragraphe>1 personne</Paragraphe></Cellule><Cellule><Paragraphe><Valeur>10 421 €</Valeur></Paragraphe></Cellule></Rangée></Tableau></Chapitre></Texte>${abbr}<Reference type="Texte de référence" URL="https://www.legifrance.gouv.fr/codes/id/X" ID="R9"><Titre>Code de test : article 1</Titre></Reference></Publication>`;
const DOSSIER = `<?xml version="1.0" encoding="UTF-8"?><Publication xmlns:dc="http://purl.org/dc/elements/1.1/" ID="N900" type="Dossier" spUrl="https://www.service-public.gouv.fr/particuliers/vosdroits/N900"><dc:title>Aide de test (ADT)</dc:title><dc:description>Le dossier de test.</dc:description><Introduction><Texte><Paragraphe>Introduction du dossier.</Paragraphe></Texte></Introduction><SousDossier><Fiche ID="F901">Cas général</Fiche><Fiche ID="F902">Cas particulier</Fiche></SousDossier></Publication>`;
const archive = () => loadArchive(zipSync({
  'F900.xml': strToU8(FICHE('F900', 'Allocation de logement test (ALT)')), 'F901.xml': strToU8(FICHE('F901', 'Aide de test : cas général', { date: '2026-05-01' })),
  'F902.xml': strToU8(FICHE('F902', 'Aide de test : cas particulier', { date: '2026-06-01' })), 'N900.xml': strToU8(DOSSIER),
  'redirections.xml': strToU8('<Redirections><dc:date xmlns:dc="x">2026-10-24T16:16:33</dc:date><Redirection from="F100" to="F900" date="2024-01-01"/></Redirections>'),
}));

describe('Service-Public feed (DILA)', () => {
  it('reads a fiche: text with headings, lists, tables, facts, online services, places to go, legal references', () => {
    const f = parseFiche(FICHE('F900', 'Allocation de logement test (ALT)'));
    expect(f).toMatchObject({ id: 'F900', title: 'Allocation de logement test (ALT)', importantChangeAt: '2026-07-01', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F900', coverage: 'France entière' });
    expect(f.text).toContain('### Qui peut en bénéficier ?');
    expect(f.text).toContain('- Avoir des revenus inférieurs à 30 000 € par an');
    expect(f.text).toContain('1 personne | 10 421 €');
    expect(f.facts.amounts).toEqual(expect.arrayContaining(['30 000 €', '10 421 €']));
    expect(f.facts.ages).toContain('moins de 30 ans');
    expect(f.online).toEqual([expect.objectContaining({ url: 'https://www.caf.fr/demande', type: 'Téléservice' })]);
    expect(f.whereToGo).toEqual([expect.objectContaining({ pivot: 'caf' })]);
    expect(f.references[0].url).toMatch(/legifrance/);
    expect(f.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(parseFiche(FICHE('F900', 'Allocation de logement test (ALT)', { body: '<Paragraphe>Nouvelle condition.</Paragraphe>' })).fingerprint).not.toBe(f.fingerprint);
  });
  it('an archive: fiches and dossiers, redirections followed, a dossier read as its introduction and main fiche', () => {
    const a = archive();
    expect(a.fiches.size).toBe(4);
    expect(resolveId('F100', a.redirections)).toBe('F900');
    expect(resolveId('F555', a.redirections)).toBe('F555');
    const d = readSource('N900', a);
    expect(d.text).toContain('Introduction du dossier.');
    expect(d.text).toContain('## Situation principale : Cas général');
    expect(d.text).toContain('Autres situations traitées par ce dossier : Cas particulier.');
    expect(d.importantChangeAt).toBe('2026-06-01');
    expect(readSource('F999', a)).toBeNull();
  });
  it('matches a title to its fiche only when the match is clear', () => {
    const metas = [...archive().fiches.values()].map(ficheMeta);
    expect(matchFiche(metas, 'Allocation de logement test (ALT)')?.id).toBe('F900');
    expect(matchFiche(metas, 'Une aide sans rapport')).toBeNull();
  });
});

const SOURCE = `Allocation de logement test\nVous pouvez recevoir cette aide si vous avez moins de 30 ans et des revenus inférieurs à 30 000 € par an. La Caf verse l'aide chaque mois.`;
const NORMAL = { resume: "L'allocation de logement test aide à payer le loyer. Elle s'adresse aux personnes de moins de 30 ans dont les revenus sont inférieurs à 30 000 € par an. La demande se fait en ligne auprès de la Caf.", pour_qui: ['Avoir moins de 30 ans', 'Avoir des revenus inférieurs à 30 000 € par an'], montant: null, etapes: ['Faire la demande en ligne'], documents: [] };
const FALC = { resume: ['Cette aide vous aide à payer votre loyer.', 'Vous devez avoir moins de 30 ans.', 'Vous devez gagner moins de 30 000 € par an.', 'Faites la demande sur internet.'], pour_qui: ['Vous avez moins de 30 ans.'], montant: null, etapes: ['Remplissez la demande sur internet.'] };

describe('texts: automatic checks', () => {
  it('accepts a faithful normal summary and a real FALC version', () => {
    const c = checkTexts(NORMAL, FALC, SOURCE);
    expect(c.problems).toEqual([]);
    expect(c.stats.falcMaxWords).toBeLessThanOrEqual(15);
  });
  it('refuses a number the source does not contain', () => {
    expect(inventedNumbers('Vous recevez 250 € par mois.', SOURCE)).toEqual(['250']);
    expect(inventedNumbers('Revenus inférieurs à 30000 €.', SOURCE)).toEqual([]);   // same number, other spacing
    expect(checkTexts(NORMAL, { ...FALC, montant: 'Vous recevez 250 € par mois.' }, SOURCE).problems.join(' ')).toMatch(/250/);
  });
  it('refuses long FALC sentences, administrative jargon, unexplained acronyms, no « vous », a copy of the normal summary', () => {
    const long = { ...FALC, resume: [...FALC.resume, 'Cette prestation est attribuée par la Caf aux personnes qui remplissent les conditions de ressources fixées par la loi chaque année.'] };
    const p = checkTexts(NORMAL, long, SOURCE).problems.join(' | ');
    expect(p).toMatch(/trop longues/); expect(p).toMatch(/prestation/); expect(p).toMatch(/Sigles à expliquer.*Caf/);
    expect(checkTexts(NORMAL, { ...FALC, resume: ['Cette aide aide à payer le loyer.', 'Il faut avoir moins de 30 ans.', 'La demande se fait en ligne.'], pour_qui: [], etapes: [] }, SOURCE).problems.join(' ')).toMatch(/vous/);
    expect(checkTexts(NORMAL, { ...FALC, resume: sentences(NORMAL.resume) }, SOURCE).problems.join(' ')).toMatch(/ressemble trop|trop longues/);
  });
  it('a difficult word explained where it is first used, inside an explanation, or in the name of the right itself is accepted; left unexplained it is refused', () => {
    const base = { ...FALC, resume: ['Cette aide vous aide à payer votre loyer.', "Le montant dépend de vos ressources (l'argent que vous recevez).", 'Vos ressources changent ?', 'Dites-le.'] };
    expect(checkTexts(NORMAL, base, SOURCE).problems.join(' ')).not.toMatch(/Mots difficiles/);
    expect(checkTexts(NORMAL, { ...base, resume: ['Cette aide vous aide à payer votre loyer.', 'Le montant dépend de vos ressources.', 'Faites la demande.'] }, SOURCE).problems.join(' ')).toMatch(/Mots difficiles.*ressources/);
    const pch = { ...FALC, resume: ['La Prestation de compensation du handicap vous aide.', 'Vous avez un handicap.', 'Faites la demande.'] };
    expect(checkTexts(NORMAL, pch, SOURCE, { title: 'Prestation de compensation du handicap (PCH)' }).problems.join(' ')).not.toMatch(/prestation/);
  });
  it('explains acronyms and difficult words at their first use, from the fiche and the glossary', () => {
    const lines = explainFirstUse(['La Caf verse l’APL si vos ressources sont faibles.', 'La Caf vous répond.'], explanationsFor({ abbreviations: { ALT: 'allocation de logement test' } }));
    expect(lines[0]).toBe("La Caf (Caisse d'allocations familiales) verse l’APL (aide personnalisée au logement) si vos ressources (l'argent que vous recevez) sont faibles.");
    expect(lines[1]).toBe('La Caf vous répond.');
    expect(explainFirstUse(['Le dossier (Caf ou MSA) est envoyé.'], explanationsFor({}))[0]).toBe('Le dossier (Caf ou MSA) est envoyé.');   // no nested brackets
    expect(wordCount('La Caf (Caisse d’allocations familiales) verse cette aide.')).toBe(5);
  });
  it('a difficult word gets its brackets even when its plain words already appear in the line (the check requires them)', () => {
    const [line] = explainFirstUse(['Le montant maximum ne peut pas dépasser 50 % du plafond de la Sécurité sociale.'], explanationsFor({}));
    expect(line).toBe('Le montant maximum ne peut pas dépasser 50 % du plafond (montant maximum) de la Sécurité sociale.');
    expect(checkTexts(NORMAL, { ...FALC, montant: line }, `${SOURCE} 50 %`).problems.join(' ')).not.toMatch(/Mots difficiles/);
    // an acronym written next to its expansion is still left as it is
    expect(explainFirstUse(['L’aide personnalisée au logement, ou APL, vous aide.'], explanationsFor({}))[0]).toBe('L’aide personnalisée au logement, ou APL, vous aide.');
  });
  it('the faithfulness reading gets the sentence without the glossary explanations (they are not claims of the model)', () => {
    const [line] = explainFirstUse(['Toute personne peut souscrire, même avec de faibles ressources.'], explanationsFor({}));
    expect(line).toContain("ressources (l'argent que vous recevez)");
    expect(withoutGlossary(line)).toBe('Toute personne peut souscrire, même avec de faibles ressources.');
    expect(withoutGlossary('La Caf (Caisse d’allocations familiales) paie (selon la fiche).')).toBe('La Caf (Caisse d’allocations familiales) paie (selon la fiche).');   // other brackets stay
  });
  it('a compound acronym (« VLS-TS ») is explained once, and that explains each of its parts', () => {
    const [line] = explainFirstUse(['Validez votre VLS-TS en ligne.'], explanationsFor({}));
    expect(line).toBe('Validez votre VLS-TS (visa de long séjour qui sert de titre de séjour) en ligne.');
    expect(checkTexts(NORMAL, { ...FALC, etapes: [line] }, SOURCE).problems.join(' ')).not.toMatch(/Sigles/);
    expect(checkTexts(NORMAL, { ...FALC, etapes: ['Validez votre VLS-TS en ligne.'] }, SOURCE).problems.join(' ')).toMatch(/Sigles.*VLS/);
    expect(checkTexts(NORMAL, { ...FALC, etapes: ['Le FAJ’EMS (Fonds d’aide aux jeunes) vous aide.'] }, SOURCE).problems.join(' ')).not.toMatch(/Sigles/);
  });
  it('reads the part of a long fiche that matters (introduction and conditions first)', () => {
    const src = { title: 'T', text: ['Intro.', ...Array.from({ length: 40 }, (_, i) => `### Chapitre annexe ${i}\n${'x '.repeat(300)}`), '### Qui peut en bénéficier ?\nVous devez avoir moins de 30 ans.'].join('\n') };
    const ex = sourceExcerpt(src, 3000);
    expect(ex).toContain('Intro.'); expect(ex).toContain('moins de 30 ans'); expect(ex.length).toBeLessThan(3500);
  });
});

/** a local model double: answers the normal summary, the FALC version and the faithfulness reading */
function model({ refuse = [], normal = NORMAL, falc = FALC, down = false } = {}) {
  return async ({ systemInstruction, prompt }) => {
    if (down) return { content: null, safeErrorState: 'UNAVAILABLE' };
    if (/contrôleur qualité/.test(systemInstruction)) {
      const n = (prompt.match(/^\d+\. /gm) || []).length;
      const lines = prompt.split('\n').filter((l) => /^\d+\. /.test(l));
      return { model: 'double', content: { verdicts: Array.from({ length: n }, (_, i) => ({ n: i + 1, ok: !refuse.some((r) => lines[i].includes(r)), raison: 'test' })) } };
    }
    if (/FALC/.test(systemInstruction)) return { model: 'double', content: falc };
    return { model: 'double', content: normal };
  };
}

describe('texts: what the official text says is not a condition', () => {
  const PCH = 'Ressources. La PCH est attribuée sans condition de ressources. Vos dépenses sont prises en charge à 100 % si vos ressources annuelles sont inférieures ou égales à 31 162,62 €, ou 80 % sinon.';
  it('a resource ceiling written as a condition is refused; the rate that depends on the resources is not', () => {
    const c = contradictions({ resume: 'La PCH aide les personnes handicapées. Il faut remplir des conditions d’autonomie, d’âge, de ressources et de résidence.', pour_qui: ['Avoir des ressources inférieures ou égales à 31 162,62 €', 'Vivre en France'] },
      { resume: ['La PCH vous aide.', "Vous recevez 100 % ou 80 % selon vos ressources (l'argent que vous recevez)."], pour_qui: ['Vos ressources sont inférieures à 31 162,62 €.'] }, PCH);
    expect(c.map((x) => x.part).sort()).toEqual(['falc.pour_qui', 'normal.pour_qui', 'normal.resume']);
    expect(c[0].raison).toMatch(/pas de condition de ressources/);
    expect(contradictions({ resume: 'Il faut des ressources faibles.', pour_qui: [] }, { resume: [], pour_qui: [] }, 'Une aide sous conditions de ressources.')).toEqual([]);   // the source states one: fine
  });
});

describe('texts: generation with the checks', () => {
  const src = { title: 'Allocation de logement test', description: '', text: SOURCE };
  it('keeps checked texts', async () => {
    const t = await writeTexts(src, { generate: model() });
    expect(t.ok).toBe(true);
    expect(t.falc.resume[0]).toBe('Cette aide vous aide à payer votre loyer.');
    expect(t.checks.faithfulness.checked).toBeGreaterThan(5);
  });
  it('a summary sentence the faithfulness reading refuses fails the texts; a refused list item is only removed', async () => {
    expect((await writeTexts(src, { generate: model({ refuse: ['Elle s\'adresse'] }) })).ok).toBe(false);
    const t = await writeTexts(src, { generate: model({ refuse: ['Faire la demande en ligne'] }) });
    expect(t.ok).toBe(true); expect(t.normal.etapes).toEqual([]);
  });
  it('a summary sentence refused once comes back to the model with the reason; corrected, the texts are kept', async () => {
    let judged = 0; const base = model();
    const once = async (args) => {
      if (/contrôleur qualité/.test(args.systemInstruction)) { judged += 1; if (judged === 1) return model({ refuse: ['Elle s\'adresse'] })(args); }
      return base(args);
    };
    const t = await writeTexts(src, { generate: once });
    expect(t.ok).toBe(true); expect(t.checks.faithfulness.rounds).toBe(2); expect(judged).toBe(2);
  });
  it('the model unavailable or a refused draft: nothing is kept', async () => {
    expect(await writeTexts(src, { generate: model({ down: true }) })).toMatchObject({ ok: false });
    const bad = await writeTexts(src, { generate: model({ falc: { ...FALC, montant: 'Vous recevez 250 € par mois.' } }) });
    expect(bad.ok).toBe(false); expect(bad.reasons.join(' ')).toMatch(/250/);
  });
});

describe('registry of official sources', () => {
  const row = (id, nom, type, site) => ({ id, nom, pivot: JSON.stringify([{ type_service_local: type }]), site_internet: JSON.stringify([{ valeur: site }]), url_service_public: `https://lannuaire.service-public.gouv.fr/x/${id}` });
  it('attests the site the Annuaire gives for a public body, never a shared platform', () => {
    const s = attestedSites([row('1', 'Mairie - Test', 'mairie', 'https://www.mairie-test.fr'), row('2', 'CCAS', 'ccas', 'https://www.facebook.com/ccas'), row('3', 'Caf', 'caf', 'https://www.caf.fr')]);
    expect([...s.keys()]).toEqual(['mairie-test.fr', 'caf.fr']);
    expect(s.get('mairie-test.fr')).toMatchObject({ level: 'COMMUNAL', evidenceUrl: 'https://lannuaire.service-public.gouv.fr/x/1' });
    expect(isShared('sites.google.com')).toBe(true);
    expect([levelOf('caf'), levelOf('mds'), levelOf('prefecture'), levelOf('cr'), levelOf('france_services')]).toEqual(['ORGANISME', 'DEPARTEMENTAL', 'PREFECTURE', 'REGIONAL', 'NATIONAL']);
  });
  it('the starting list covers every level and says why each source is official', () => {
    expect(new Set(SEED_SOURCES.map((s) => s.level))).toEqual(new Set(['NATIONAL', 'ORGANISME', 'OPERATEUR', 'REGIONAL', 'DEPARTEMENTAL', 'PREFECTURE', 'COMMUNAL', 'REGISTRE']));
    // R11 / D05: data·inclusion is a referential of producers' statements, not an authority — it makes no domain trusted and attests nothing
    for (const s of SEED_SOURCES) { expect(s.attestation.length).toBeGreaterThan(10); if (s.capabilities.join() === 'services:attribues') expect(s.domains).toEqual([]); else expect(s.domains.length).toBeGreaterThan(0); }
  });
});

describe('public offices from the Annuaire', () => {
  const caf = { id: 'abc', nom: 'Caf du Bas-Rhin - Test', pivot: '[{"type_service_local": "caf"}]', code_insee_commune: '67482', url_service_public: 'https://lannuaire.service-public.gouv.fr/grand-est/bas-rhin/abc',
    adresse: '[{"type_adresse": "Adresse", "numero_voie": "22 route de l\'Hôpital", "code_postal": "67100", "nom_commune": "Strasbourg", "latitude": "48.5", "longitude": "7.7"}]',
    telephone: '[{"valeur": "32 30", "description": "Du lundi au vendredi de 13h30 à 16h30."}]', plage_ouverture: '[{"nom_jour_debut": "Lundi", "nom_jour_fin": "Vendredi", "valeur_heure_debut_1": "08:30:00", "valeur_heure_fin_1": "12:00:00", "valeur_heure_debut_2": "", "valeur_heure_fin_2": "", "commentaire": "Uniquement sur rendez-vous."}]',
    telephone_accessible: '[{"valeur": "https://acces.example/caf", "description": "Du lundi au vendredi."}]', date_modification_datetime: '2026-02-23T08:25:34+00:00' };
  it('an office: address, phones with their hours, opening hours, accessible line, evidence', () => {
    const o = officeRecord(caf);
    expect(o).toMatchObject({ type: 'caf', adresse: "22 route de l'Hôpital", code_postal: '67100', telephone: '32 30', latitude: 48.5, evidenceUrl: caf.url_service_public });
    expect(o.horaires).toBe('Lundi au vendredi : 08:30-12:00 (Uniquement sur rendez-vous)');
    expect(o.accessible[0].url).toBe('https://acces.example/caf');
    const t = officeTexts(o);
    expect(t.resume).toContain('Adresse : 22 route de');
    expect(t.falc).toEqual(expect.arrayContaining(['Le téléphone est le 32 30.']));
    for (const s of t.falc) expect(wordCount(s)).toBeLessThanOrEqual(15);
    expect(officeRecord({ ...caf, pivot: '[{"type_service_local": "gendarmerie"}]' })).toBeNull();
    expect(officeRecord({ ...caf, pivot: '[{"type_service_local": "gendarmerie"}]' }, { any: true })).toMatchObject({ kind: null });
    expect(hoursText('[]')).toBeNull();
  });
  it('every kind of office has a short FALC text', () => {
    for (const [k, v] of Object.entries(OFFICE_KINDS)) for (const s of v.falc) expect(wordCount(s), `${k}: ${s}`).toBeLessThanOrEqual(15);
  });
});

describe('fetcher', () => {
  it('reads the allow-list and the attested domains only', () => {
    expect(fetchable('https://www.service-public.gouv.fr/x').safe).toBe(true);
    expect(fetchable('https://www.strasbourg.eu/x').safe).toBe(false);
    expect(fetchable('https://www.strasbourg.eu/x', ['strasbourg.eu']).safe).toBe(true);
    expect(fetchable('http://127.0.0.1/x', ['127.0.0.1']).safe).toBe(false);
  });
  it('follows a redirect only to an allowed site, and stops when the network is switched off', async () => {
    const fetchImpl = async (url) => (url.startsWith('https://www.service-public.fr') ? new Response('', { status: 301, headers: { location: 'https://evil.example/' } }) : new Response('ok'));
    await expect(officialGet('https://www.service-public.fr/x', { fetchImpl, env: { ADA_VERIFICATION_NETWORK: 'on' } })).rejects.toMatchObject({ code: 'URL_REFUSED' });
    await expect(officialGet('https://www.service-public.gouv.fr/x', { fetchImpl, env: { ADA_VERIFICATION_NETWORK: 'off' } })).rejects.toBeInstanceOf(SourceError);
  });
});

describe('what the public is told', () => {
  it('the public part of an automatic check, never its internal data', () => {
    const auto = { checkedAt: '2026-10-25T03:17:00Z', runId: 'r1', origin: 'DILA', sourceUrl: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1280', importantChangeAt: '2026-07-01',
      texts: { at: '2026-10-25T03:20:00Z', checks: { faithfulness: { removed: [{ sentence: 'x' }] } }, model: 'qwen3:8b' }, discovered: { titleScore: 1 } };
    const p = publicAutoCheck(auto);
    expect(p).toMatchObject({ checkedAt: auto.checkedAt, sourceUrl: auto.sourceUrl, textsWrittenAt: '2026-10-25T03:20:00Z' });
    expect(JSON.stringify(p)).not.toMatch(/runId|qwen|removed|titleScore/);
    const row = stripReviewFields({ id: 'a', verified_by: 'ada-veille-automatique', auto_check: auto, titre: 'X' });
    expect(row.auto_check).toBeUndefined(); expect(row.verified_by).toBeUndefined(); expect(row.verification_auto.checkedAt).toBe(auto.checkedAt);
    expect(publicAutoCheck(null)).toBeNull();
  });
  it('labels say « contrôlée automatiquement », never « relue » for an automatic check', () => {
    expect(falcLabel(true, { origin: 'AI_LOCAL', fields: { summary_falc: null }, auto: '2026-10-25T03:20:00Z' })).toBe('Version simplifiée (contrôlée automatiquement)');
    expect(falcLabel(true, { origin: 'AI_LOCAL', fields: { summary_falc: null } })).toBe('Version simplifiée (IA, non relue)');
    expect(falcFieldNote(null, '2026-10-25T03:20:00Z')).toMatch(/^Rédigé à partir de la fiche officielle et contrôlé automatiquement le 25\/10\/2026$/);
    expect(asList('- a\n- b')).toEqual(['a', 'b']); expect(asList(['x', { titre: 'y' }])).toEqual(['x', 'y']); expect(asList(null)).toEqual([]);
  });
});
