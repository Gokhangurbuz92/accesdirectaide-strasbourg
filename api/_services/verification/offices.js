// @ts-nocheck
/**
 * Automatic verification chain — public offices from the Annuaire de l'administration (DILA) as directory records.
 *
 * The Annuaire is the State's own directory of public offices: its address, telephones (with their hours), opening hours, accessible line and website are
 * authoritative for a public office, so the chain copies them as they are (the evidence is the office's page on lannuaire.service-public.gouv.fr).
 * What each kind of office does is written once, here, in a normal version and a FALC version (no model: the same few sentences for every CAF, every Point-justice…).
 * These are the general missions of that kind of public office; being listed by the Annuaire proves the office's identity and contact details, not that this
 * particular place offers every service of its kind — so every text says the services vary from one place to another and to ask before going.
 */
import { digits } from './registries.js';
import { readableCase } from './structure-check.js';

const parseList = (v) => { if (Array.isArray(v)) return v; try { const p = JSON.parse(String(v || '[]')); return Array.isArray(p) ? p : []; } catch { return []; } };

/** The kinds of office the directory takes from the Annuaire (social rights, health, family, housing, justice, employment, youth, older people, foreigners). */
export const OFFICE_KINDS = {
  caf: { label: "Caf (Caisse d'allocations familiales)", categorie: 'Organisme social',
    resume: "La Caisse d'allocations familiales (Caf) verse les aides de la branche famille : aides au logement, prime d'activité, revenu de solidarité active (RSA), allocations familiales, allocation aux adultes handicapés (AAH). Elle répond aux questions des allocataires et les reçoit, souvent sur rendez-vous.",
    falc: ["La Caf (Caisse d'allocations familiales) verse des aides.", "Par exemple : l'aide pour payer le loyer.", 'Vous pouvez lui poser vos questions sur vos aides.', 'Souvent, il faut prendre rendez-vous.'] },
  cpam: { label: "CPAM (caisse primaire d'assurance maladie)", categorie: 'Organisme social',
    resume: "La caisse primaire d'assurance maladie (CPAM) rembourse les soins, gère la carte Vitale, la complémentaire santé solidaire et les indemnités journalières en cas d'arrêt de travail. Elle accueille les assurés, souvent sur rendez-vous.",
    falc: ["La CPAM (caisse d'assurance maladie) rembourse vos soins.", 'Elle s’occupe de votre carte Vitale.', 'Elle peut vous aider à avoir une complémentaire santé.', 'Souvent, il faut prendre rendez-vous.'] },
  msa: { label: 'MSA (Mutualité sociale agricole)', categorie: 'Organisme social',
    resume: "La Mutualité sociale agricole (MSA) est la sécurité sociale des personnes qui travaillent dans l'agriculture et de leur famille : santé, famille, logement, retraite.",
    falc: ['La MSA (Mutualité sociale agricole) aide les personnes du monde agricole.', 'Elle rembourse les soins.', 'Elle verse des aides pour la famille et la retraite.'] },
  carsat: { label: 'Carsat (caisse de retraite)', categorie: 'Organisme social',
    resume: "La Carsat gère la retraite des salariés du régime général et aide les retraités et futurs retraités dans leurs démarches de retraite.",
    falc: ['La Carsat (caisse de retraite) s’occupe de votre retraite.', 'Elle vous aide pour demander votre retraite.'] },
  cicas: { label: 'Cicas (retraite complémentaire)', categorie: 'Organisme social',
    resume: "Le Cicas informe les salariés et les retraités sur la retraite complémentaire Agirc-Arrco et les aide à la demander.",
    falc: ['Le Cicas vous aide pour la retraite complémentaire.', 'C’est une partie de la retraite des salariés.'] },
  urssaf: { label: 'Urssaf', categorie: 'Organisme social',
    resume: "L'Urssaf collecte les cotisations sociales des employeurs, des indépendants et des particuliers employeurs, et les renseigne sur leurs démarches.",
    falc: ["L'Urssaf (organisme qui collecte les cotisations sociales) reçoit les cotisations.", 'Elle aide les employeurs et les travailleurs indépendants.'] },
  france_services: { label: 'Espace France Services', categorie: 'Accès aux droits',
    resume: "Dans un espace France Services, des agents formés vous aident gratuitement pour vos démarches administratives : Caf, Assurance maladie, retraite, impôts, France Travail, papiers d'identité, démarches en ligne.",
    falc: ['Des agents vous aident pour vos démarches.', 'C’est gratuit.', 'Par exemple : la Caf (Caisse d’allocations familiales), les impôts, la retraite.', 'Ils vous aident aussi à faire les démarches sur internet.'] },
  mds: { label: 'Maison des solidarités (Espace Solidarités)', categorie: 'Action sociale',
    resume: "Les maisons des solidarités de la Collectivité européenne d'Alsace (« Espaces Solidarités ») accueillent les habitants pour un accompagnement social : accès aux droits, logement, budget, famille et enfance, autonomie. Les professionnels reçoivent sur rendez-vous.",
    falc: ['Des professionnels vous aident si vous avez des difficultés.', 'Par exemple : pour le logement, l’argent ou la famille.', 'Il faut prendre rendez-vous.'] },
  maison_handicapees: { label: 'MDPH (maison des personnes handicapées)', categorie: 'Handicap',
    resume: "La maison départementale des personnes handicapées (MDPH) informe et accompagne les personnes handicapées et leurs proches. Elle reçoit les demandes de droits liés au handicap : allocation aux adultes handicapés (AAH), prestation de compensation du handicap (PCH), carte mobilité inclusion, orientation.",
    falc: ['La MDPH (maison des personnes handicapées) aide les personnes handicapées.', 'Elle aide aussi leurs proches.', 'Vous lui envoyez vos demandes d’aides liées au handicap.'] },
  mission_locale: { label: 'Mission locale (jeunes de 16 à 25 ans)', categorie: 'Emploi et jeunesse',
    resume: "La mission locale accompagne les jeunes de 16 à 25 ans qui ne sont plus à l'école : emploi, formation, logement, santé, mobilité, contrat d'engagement jeune.",
    falc: ['La mission locale aide les jeunes de 16 à 25 ans.', 'Elle vous aide à trouver un travail ou une formation.', 'Elle peut aussi vous aider pour le logement ou la santé.'] },
  france_travail: { label: 'France Travail', categorie: 'Emploi',
    resume: "L'agence France Travail inscrit les demandeurs d'emploi, verse les allocations chômage et accompagne vers l'emploi et la formation.",
    falc: ['France Travail vous aide à trouver un travail.', 'Vous pouvez vous y inscrire si vous cherchez un emploi.', 'France Travail verse aussi les allocations chômage.'] },
  maison_emploi: { label: "Maison de l'emploi", categorie: 'Emploi',
    resume: "La maison de l'emploi informe et accompagne les personnes qui cherchent un emploi ou une formation, avec les acteurs locaux de l'emploi.",
    falc: ['La maison de l’emploi vous aide à trouver un travail.', 'Elle peut aussi vous aider à trouver une formation.'] },
  ccas: { label: "CCAS (centre communal d'action sociale)", categorie: 'Action sociale',
    resume: "Le centre communal d'action sociale (CCAS) aide les habitants de la commune qui ont des difficultés : demandes d'aide sociale, aides ponctuelles, domiciliation, orientation vers les bons services.",
    falc: ["Le CCAS (centre communal d'action sociale) aide les habitants en difficulté.", 'Il vous aide à demander des aides.', 'Il peut vous donner une adresse pour recevoir votre courrier.'] },
  mairie: { label: 'Mairie', categorie: 'Service public de proximité',
    resume: "La mairie accueille les habitants pour l'état civil (naissance, mariage, décès), les listes électorales et de nombreuses démarches de la commune. Elle oriente vers le centre communal d'action sociale (CCAS) et les services sociaux.",
    falc: ['La mairie vous aide pour les papiers de votre commune.', 'Par exemple : un acte de naissance.', 'Elle peut vous dire où demander de l’aide.'] },
  pmi: { label: 'PMI (protection maternelle et infantile)', categorie: 'Santé et famille',
    resume: "Le service de protection maternelle et infantile (PMI) suit gratuitement la santé des femmes enceintes et des enfants de moins de 6 ans : consultations, vaccinations, conseils aux parents.",
    falc: ['La PMI (protection maternelle et infantile) suit la santé des bébés.', 'Elle suit les enfants de moins de 6 ans.', 'Elle aide aussi les femmes enceintes.', 'C’est gratuit.'] },
  clic: { label: 'Point d’information pour les personnes âgées', categorie: 'Personnes âgées',
    resume: "Ce service informe et accompagne les personnes âgées et leurs proches : aides pour rester à domicile, aides financières, hébergement, démarches.",
    falc: ['Ce service aide les personnes âgées.', 'Il aide aussi leurs proches.', 'Il vous informe sur les aides pour rester chez vous.'] },
  point_justice: { label: 'Point-justice (accès au droit)', categorie: 'Accès au droit',
    resume: "Au Point-justice, des professionnels du droit vous informent gratuitement sur vos droits et vos démarches : logement, famille, travail, dettes, litiges.",
    falc: ['Au Point-justice, on vous explique vos droits.', 'C’est gratuit.', 'Par exemple : pour le logement, la famille ou le travail.'] },
  mjd: { label: 'Maison de justice et du droit', categorie: 'Accès au droit',
    resume: "La maison de justice et du droit informe gratuitement sur les droits et les démarches, propose des consultations juridiques et la médiation.",
    falc: ['On vous explique vos droits.', 'C’est gratuit.', 'On peut vous aider à régler un conflit.'] },
  cdad: { label: "Accès au droit (conseil départemental de l'accès au droit)", categorie: 'Accès au droit',
    resume: "Le conseil départemental de l'accès au droit organise l'information gratuite sur les droits dans le département : points-justice, consultations juridiques.",
    falc: ['Ce service organise des aides gratuites pour connaître vos droits.'] },
  bav: { label: "Bureau d'aide aux victimes", categorie: 'Accès au droit',
    resume: "Le bureau d'aide aux victimes informe et accompagne gratuitement les victimes d'infractions dans leurs démarches.",
    falc: ['Ce bureau aide les victimes.', 'C’est gratuit.', 'Il vous aide dans vos démarches.'] },
  cidf: { label: 'CIDFF (droits des femmes et des familles)', categorie: 'Accès au droit',
    resume: "Le centre d'information sur les droits des femmes et des familles (CIDFF) informe gratuitement sur le droit de la famille, les violences, l'emploi et la vie quotidienne.",
    falc: ['Le CIDFF vous informe sur vos droits.', 'Il aide les femmes et les familles.', 'C’est gratuit.'] },
  adil: { label: 'ADIL (information logement)', categorie: 'Logement',
    resume: "L'agence départementale d'information sur le logement (ADIL) conseille gratuitement sur le logement : location, achat, droits et devoirs des locataires et propriétaires, aides.",
    falc: ['L’ADIL vous conseille sur le logement.', 'C’est gratuit.', 'Par exemple : si vous louez un logement.'] },
  pif: { label: 'Point info famille', categorie: 'Famille',
    resume: "Le point info famille informe les familles sur les services et les aides qui existent près de chez elles.",
    falc: ['Ce point vous informe sur les aides pour les familles.'] },
  cij: { label: 'Information jeunesse', categorie: 'Jeunesse',
    resume: "Le centre d'information jeunesse informe gratuitement les jeunes : études, emploi, logement, santé, loisirs, mobilité.",
    falc: ['Ce centre informe les jeunes.', 'C’est gratuit.', 'Par exemple : sur les études ou le travail.'] },
  cio: { label: "CIO (centre d'information et d'orientation)", categorie: 'Jeunesse',
    resume: "Le centre d'information et d'orientation (CIO) aide gratuitement les élèves, les étudiants et leurs familles à choisir des études ou une formation.",
    falc: ['Le CIO vous aide à choisir des études.', 'C’est gratuit.'] },
  crous: { label: 'Crous (aides aux étudiants)', categorie: 'Jeunesse',
    resume: "Le Crous aide les étudiants : bourses, logement, restauration, aides sociales et accompagnement social.",
    falc: ['Le Crous aide les étudiants.', 'Par exemple : une bourse ou un logement.'] },
  point_accueil_numerique: { label: 'Point d’accueil numérique', categorie: 'Accès aux droits',
    resume: "Le point d'accueil numérique aide à faire ses démarches administratives en ligne, avec un ordinateur et l'aide d'un agent ou d'un médiateur.",
    falc: ['On vous aide à faire vos démarches sur internet.'] },
  fr_renov: { label: "France Rénov' (conseil logement)", categorie: 'Logement',
    resume: "L'espace conseil France Rénov' conseille gratuitement pour rénover son logement et connaître les aides, comme MaPrimeRénov'.",
    falc: ['Ce service vous conseille pour rénover votre logement.', 'Il vous dit quelles aides existent.', 'C’est gratuit.'] },
  ofii: { label: "OFII (Office français de l'immigration et de l'intégration)", categorie: 'Étrangers',
    resume: "L'Office français de l'immigration et de l'intégration (OFII) accueille les étrangers qui s'installent en France : contrat d'intégration, cours de français, accompagnement des demandeurs d'asile.",
    falc: ['L’OFII aide les étrangers qui arrivent en France.', 'Il propose des cours de français.'] },
  plateforme_naturalisation: { label: 'Plateforme de naturalisation', categorie: 'Étrangers',
    resume: 'La plateforme de naturalisation étudie les demandes de nationalité française.',
    falc: ['Ce service étudie les demandes pour devenir Français.'] },
  sip: { label: 'Service des impôts des particuliers', categorie: 'Impôts',
    resume: "Le service des impôts des particuliers répond aux questions sur l'impôt sur le revenu et les impôts locaux, et reçoit le public, souvent sur rendez-vous.",
    falc: ['Ce service répond à vos questions sur les impôts.', 'Souvent, il faut prendre rendez-vous.'] },
  prefecture: { label: 'Préfecture', categorie: "Services de l'État",
    resume: "La préfecture représente l'État dans le département. Elle traite notamment les démarches des étrangers (titres de séjour) et des associations.",
    falc: ['La préfecture représente l’État.', 'Elle s’occupe par exemple des titres de séjour.'] },
  sous_pref: { label: 'Sous-préfecture', categorie: "Services de l'État",
    resume: "La sous-préfecture représente l'État dans l'arrondissement et accueille le public pour certaines démarches.",
    falc: ['La sous-préfecture représente l’État près de chez vous.'] },
};

/** opening hours of an office as text, one line per range (« Lundi au vendredi : 08:30-12:00, 13:30-16:30 (uniquement sur rendez-vous) ») */
export function hoursText(plages) {
  const hm = (t) => String(t || '').slice(0, 5);
  return parseList(plages).map((p) => {
    const days = p.nom_jour_debut === p.nom_jour_fin || !p.nom_jour_fin ? p.nom_jour_debut : `${p.nom_jour_debut} au ${String(p.nom_jour_fin).toLowerCase()}`;
    const ranges = [[p.valeur_heure_debut_1, p.valeur_heure_fin_1], [p.valeur_heure_debut_2, p.valeur_heure_fin_2]].filter(([a, b]) => a && b).map(([a, b]) => `${hm(a)}-${hm(b)}`);
    return `${days} : ${ranges.join(', ') || 'horaires non précisés'}${p.commentaire ? ` (${String(p.commentaire).replace(/\.$/, '')})` : ''}`;
  }).filter(Boolean).join('\n') || null;
}

/** An Annuaire row as the directory needs it (null when it is not a kind of office the directory takes, unless opts.any: then kind is null). @param {any} r @param {{ any?: boolean }} [opts] */
export function officeRecord(r, opts = {}) {
  const type = (parseList(r.pivot)[0] || {}).type_service_local || null;
  const kind = OFFICE_KINDS[type] || null; if (!kind && !opts.any) return null;
  const addr = parseList(r.adresse).find((a) => a.type_adresse === 'Adresse') || parseList(r.adresse)[0] || {};
  const phones = parseList(r.telephone);
  // the Annuaire sometimes repeats the street in a complement (« 22 route de l'Hôpital, 22 route de l'Hôpital, Parc du Heyritz »): each part once
  const street = [...new Map([addr.numero_voie, addr.complement1, addr.complement2].filter(Boolean).map((x) => [String(x).trim().toLowerCase().replace(/\s+/g, ' '), String(x).trim()])).values()].join(', ');
  return {
    annuaireId: r.id, type, kind, nom: String(r.nom || '').trim(), adresse: readableCase(street) || null, code_postal: addr.code_postal || null, ville: readableCase(addr.nom_commune) || null,
    insee: r.code_insee_commune || null, latitude: addr.latitude ? Number(addr.latitude) : null, longitude: addr.longitude ? Number(addr.longitude) : null,
    telephone: phones[0]?.valeur || null, telephones: phones.map((t) => ({ numero: t.valeur, precision: t.description || null })), email: r.adresse_courriel || null,
    site_web: (parseList(r.site_internet)[0] || {}).valeur || null, formulaire: r.formulaire_contact || null, horaires: hoursText(r.plage_ouverture),
    accessible: parseList(r.telephone_accessible).map((t) => ({ url: t.valeur, precision: t.description || null })), siret: digits(r.siret) || null,
    updatedAt: r.date_modification_datetime || null, evidenceUrl: r.url_service_public || null,
  };
}

/** The texts of an office record: the kind's description + the office's own practical facts (FALC: one fact per sentence). */
const GENERIC_KIND = { resume: "Service public listé par l'Annuaire de l'administration.", falc: ['C’est un service public.'] };
export function officeTexts(o) {
  const kind = o.kind || GENERIC_KIND;
  const where = [o.adresse, [o.code_postal, o.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const rdv = /rendez-vous/i.test(o.horaires || '');
  const resume = `${kind.resume} Les services proposés peuvent varier d’un lieu à l’autre : renseignez-vous auprès de ce lieu avant de vous déplacer.${where ? ` Adresse : ${where}.` : ''}`;
  const falc = [...kind.falc, 'Chaque lieu est un peu différent.', ...(where ? [`L’adresse est : ${where}.`] : []), ...(o.telephone ? [`Le téléphone est le ${o.telephone}.`, 'Appelez avant de venir.'] : []),
    ...(rdv && !kind.falc.some((s) => /rendez-vous/.test(s)) ? ['Pour certains horaires, il faut prendre rendez-vous.'] : [])];
  return { resume, falc };
}
