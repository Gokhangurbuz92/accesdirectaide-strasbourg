// @ts-nocheck
/**
 * Automatic verification chain — public contact details of an organization, never a person's own.
 *
 * A directory listing shows how to reach a SERVICE: its switchboard, its generic mailbox (contact@, accueil@, strasbourg@…), its official contact form. An
 * address of the form prénom.nom@… is an employee's personal work address (the WS2 records held one for the Caf du Bas-Rhin and one for the Mission locale):
 * it is personal data, it changes with staff, and the official directories never publish it. The chain removes it from the public listing (the previous
 * version is kept in the record's history) and uses the office's generic address from the Annuaire de l'administration when there is one.
 * Detection is deliberately cautious in one direction only: an address that looks personal is withheld (a generic one wrongly withheld costs a line, a
 * personal one wrongly published costs someone's privacy).
 */

/** words of a generic (service) mailbox: an address made of one of these is not a person's */
const SERVICE_WORDS = new Set(['contact', 'contacts', 'accueil', 'info', 'infos', 'information', 'informations', 'secretariat', 'secretaire', 'direction', 'admin', 'administration',
  'mairie', 'ccas', 'cias', 'service', 'services', 'social', 'sociale', 'action', 'aide', 'aides', 'public', 'publics', 'association', 'asso', 'bureau', 'standard', 'courrier',
  'reception', 'permanence', 'rdv', 'rendez', 'vous', 'equipe', 'team', 'hello', 'bonjour', 'office', 'siege', 'antenne', 'agence', 'centre', 'ville', 'maison', 'espace',
  'point', 'relais', 'pole', 'cellule', 'mission', 'locale', 'emploi', 'insertion', 'jeunes', 'jeunesse', 'famille', 'familles', 'enfance', 'solidarite', 'solidarites',
  'logement', 'sante', 'handicap', 'autonomie', 'seniors', 'retraite', 'benevoles', 'benevolat', 'adherents', 'dons', 'presse', 'communication', 'compta', 'comptabilite',
  'facturation', 'rh', 'recrutement', 'formation', 'support', 'aide-sociale', 'noreply', 'no-reply', 'ne-pas-repondre', 'webmaster', 'courriel', 'mail', 'email', 'general',
  'strasbourg', 'alsace', 'bas', 'rhin', 'grand', 'est', 'eurometropole', 'nord', 'sud', 'ouest', 'centre-ville', 'neudorf', 'meinau', 'hautepierre', 'cronenbourg',
  'koenigshoffen', 'robertsau', 'neuhof', 'esplanade', 'elsau', 'montagne', 'verte', 'port', 'rhin', 'gare', 'krutenau', 'orangerie', 'conseil', 'juridique', 'droit',
  'droits', 'justice', 'victimes', 'femmes', 'cidff', 'adil', 'caf', 'cpam', 'msa', 'urssaf', 'carsat', 'ape', 'france', 'travail', 'services-publics']);

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Does this e-mail address name a person (prénom.nom@…, p.nom@…, prenom-nom@…)? @param {string | null | undefined} email
 * @returns {boolean} true: withhold it from the public listing
 */
export function nominativeEmail(email) {
  const m = String(email || '').trim().match(/^([^@\s]+)@([^@\s]+\.[a-z]{2,})$/i);
  if (!m) return false;
  const local = norm(m[1]);
  if (/\d/.test(local)) return false;                                     // ape.67013@, accueil67@: a service code, not a name
  const parts = local.split(/[._]/).filter(Boolean);
  if (parts.length < 2) return false;                                       // contact@, strasbourg@, centre-ville@
  if (parts.some((p) => SERVICE_WORDS.has(p) || p.split('-').some((x) => SERVICE_WORDS.has(x)))) return false;
  // two or three alphabetic parts, each a plausible name part (initial or word): prénom.nom, p.nom, prénom.nom-composé
  return parts.length <= 3 && parts.every((p) => /^[a-z][a-z-]*$/.test(p)) && parts.some((p) => p.replace(/-/g, '').length >= 3);
}

/** The e-mail the public listing may show: the record's own when it is a service address, else the office's generic one, else none. */
export function publicEmail(recordEmail, officeEmail) {
  if (recordEmail && !nominativeEmail(recordEmail)) return recordEmail;
  if (officeEmail && !nominativeEmail(officeEmail)) return officeEmail;
  return null;
}
