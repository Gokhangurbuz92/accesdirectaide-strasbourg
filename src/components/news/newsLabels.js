/**
 * Actualités v2 — the words of the editorial filters, in the interface language (explicit keys, French defaults; the five other languages are in
 * src/i18n/locales/<lang>/news.json). Names of publishers, laws and places are never translated.
 */

/** @param {string} id @param {(k: string, d: string) => string} t */
export function topicLabel(id, t) {
  switch (id) {
    case 'une': return t('news:topic.une', 'À la une');
    case 'societe': return t('news:topic.societe', 'Société');
    case 'politique': return t('news:topic.politique', 'Politique');
    case 'economie': return t('news:topic.economie', 'Économie');
    case 'international': return t('news:topic.international', 'International');
    case 'sante': return t('news:topic.sante', 'Santé');
    case 'environnement': return t('news:topic.environnement', 'Environnement');
    case 'justice': return t('news:topic.justice', 'Justice');
    case 'emploi': return t('news:topic.emploi', 'Emploi');
    case 'education': return t('news:topic.education', 'Éducation');
    case 'technologie': return t('news:topic.technologie', 'Technologie');
    case 'culture': return t('news:topic.culture', 'Culture');
    case 'logement': return t('news:topic.logement', 'Logement');
    case 'handicap': return t('news:topic.handicap', 'Handicap');
    case 'famille': return t('news:topic.famille', 'Famille');
    case 'droits': return t('news:topic.droits', 'Droits & aides');
    case 'strasbourg': return t('news:topic.strasbourg', 'Strasbourg / Alsace');
    default: return id;
  }
}

/** @param {string} scope @param {(k: string, d: string) => string} t @param {string} [area] 'grand_est' for regional news outside Alsace */
export function geoLabel(scope, t, area) {
  if (scope === 'alsace' && area === 'grand_est') return t('news:geo.grand_est', 'Grand Est');
  if (scope === 'monde') return t('news:geo.monde', 'Monde');
  if (scope === 'alsace') return t('news:geo.alsace', 'Alsace / Strasbourg');
  if (scope === 'all') return t('news:geo.all', 'Tout');
  return t('news:geo.france', 'France');
}

export const GEO_TABS = Object.freeze([
  { id: '', flag: '🇫🇷🌍' }, { id: 'france', flag: '🇫🇷' }, { id: 'monde', flag: '🌍' }, { id: 'alsace', flag: '📍' },
]);

/** the categories offered as chips, in the owner's order */
export const TOPIC_CHIPS = Object.freeze(['une', 'societe', 'politique', 'economie', 'international', 'sante', 'environnement', 'justice', 'emploi', 'education', 'technologie', 'culture', 'logement', 'handicap', 'famille', 'droits', 'strasbourg']);

/** what kind of text the reader has in front of them @param {{ lane?: string, auto_publish?: boolean }} item @param {(k: string, d: string) => string} t */
export function laneLabel(item, t) {
  if (item.lane === 'ADA') return t('news:lane.ada', 'Article AccesDirectAide');
  if (item.lane === 'OWN') return t('news:lane.own', 'Information AccesDirectAide');
  if (item.lane === 'A') return t('news:lane.licensed', 'Texte officiel sous licence ouverte');
  return t('news:lane.external', 'À lire sur le site de l’éditeur');
}
