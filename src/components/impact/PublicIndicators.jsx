import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { LANGUAGES, formatDate, formatDateTime, formatNumber, useT } from '@/i18n';
import { loadPublicIndicators } from '@/lib/publicIndicators';
/** @typedef {import('@/lib/publicIndicators').Indicators} Indicators */

/**
 * G8 — the public indicators of the Observatoire on /impact (GET /api/public/indicators, api/lib/public-indicators.js). Shown only when the build sets
 * VITE_PUBLIC_INDICATORS=open (src/lib/publicBeta.js); the server answers only under ADA_PUBLIC_INDICATORS=open. Every figure counts PUBLIC records or the
 * platform's checks of them — never a person, a visit, a search, an account, a referral or an appointment — and every card says what it does NOT mean.
 * The values are dated (« Calculé le … »); a figure that is not measured says so instead of showing 0.
 */

/** @param {{ title: string, isNot: string, children: import('react').ReactNode, testId: string }} props */
function Card({ title, isNot, children, testId }) {
  const { t } = useT('about');
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid={testId}>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 flex-1 text-sm text-slate-800">{children}</div>
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-600"><span className="font-semibold">{t('about:indicators.is_not', 'Ce que ce chiffre ne dit pas :')}</span> {isNot}</p>
    </div>
  );
}
Card.propTypes = { title: PropTypes.string.isRequired, isNot: PropTypes.string.isRequired, children: PropTypes.node, testId: PropTypes.string.isRequired };

/**
 * G11: a breakdown where every published benefit sits in the catch-all bucket (« autre ou non classé », « échelon non précisé ») is not a measurement: the
 * zeros would read as « no housing benefit ». @param {Array<Record<string, any>>} rows @param {string} key @param {string} catchAll
 */
function classifiedCount(rows, key, catchAll) {
  return (rows || []).reduce((sum, r) => sum + (r[key] === catchAll ? 0 : Number(r.count) || 0), 0);
}

/** @param {{ rows: string[][] }} props (label, value[, lang of the label — a French source term keeps lang="fr"]) */
function Pairs({ rows }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
      {rows.map(([k, v, lang]) => (<div key={k} className="contents"><dt className="text-slate-700" lang={lang || undefined}>{k}</dt><dd className="text-end font-semibold tabular-nums text-slate-900">{v}</dd></div>))}
    </dl>
  );
}
Pairs.propTypes = { rows: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.string)).isRequired };

/** @param {{ load?: () => Promise<Indicators | null> }} props */
export default function PublicIndicators({ load = loadPublicIndicators }) {
  const { t } = useT('about');
  const [data, setData] = useState(/** @type {Indicators | null | undefined} */ (undefined));
  useEffect(() => { let live = true; load().then((d) => { if (live) setData(d); }); return () => { live = false; }; }, [load]);
  const n = (/** @type {unknown} */ v) => formatNumber(v);

  const domain = /** @type {Record<string, string>} */ ({
    LOGEMENT: t('about:indicators.domain.logement', 'Logement'), SANTE: t('about:indicators.domain.sante', 'Santé'), HANDICAP: t('about:indicators.domain.handicap', 'Handicap'),
    EMPLOI: t('about:indicators.domain.emploi', 'Emploi'), FAMILLE: t('about:indicators.domain.famille', 'Famille'), ETUDES: t('about:indicators.domain.etudes', 'Études'),
    MOBILITE: t('about:indicators.domain.mobilite', 'Mobilité'), ENERGIE: t('about:indicators.domain.energie', 'Énergie'), ALIMENTATION: t('about:indicators.domain.alimentation', 'Alimentation'),
    JUSTICE: t('about:indicators.domain.justice', 'Justice'), NUMERIQUE: t('about:indicators.domain.numerique', 'Numérique'), AUTRE: t('about:indicators.domain.autre', 'Autre ou non classé'),
  });
  const scope = /** @type {Record<string, string>} */ ({
    NATIONAL: t('about:indicators.scope.national', 'Nationales'), REGIONAL: t('about:indicators.scope.regional', 'Régionales'), DEPARTMENTAL: t('about:indicators.scope.departmental', 'Départementales'),
    COMMUNAL: t('about:indicators.scope.communal', 'Communales'), UNSPECIFIED: t('about:indicators.scope.unspecified', 'Échelon non précisé'),
  });
  const kinds = /** @type {Record<string, string>} */ ({
    aide: t('about:indicators.kind.aides', 'Aides'), demarche: t('about:indicators.kind.demarches', 'Démarches'), structure: t('about:indicators.kind.structures', 'Lieux d’accueil'),
    dispositif: t('about:indicators.kind.dispositifs', 'Dispositifs'), guide: t('about:indicators.kind.guides', 'Guides pratiques'), actualite: t('about:indicators.kind.actualites', 'Actualités'),
  });

  return (
    <section aria-labelledby="public-indicators-title" data-testid="public-indicators">
      <h2 id="public-indicators-title" className="text-xl font-bold text-slate-900">{t('about:indicators.title', 'Indicateurs publics')}</h2>
      <p className="mt-2 max-w-3xl text-slate-700">{t('about:indicators.intro', 'Ces indicateurs comptent les fiches publiques du site et les contrôles que la plateforme fait sur leurs sources officielles. Ils ne comptent aucune personne : ni visites, ni recherches, ni comptes, ni personnes aidées. Ils ne mesurent pas le non-recours.')}</p>
      {data === undefined && <p className="mt-4 text-slate-600" role="status">{t('about:indicators.loading', 'Chargement des indicateurs…')}</p>}
      {data === null && <p className="mt-4 text-slate-700" role="status" data-testid="public-indicators-unavailable">{t('about:indicators.unavailable', 'Les indicateurs ne peuvent pas être lus pour le moment.')}</p>}
      {data && (
        <>
          <p className="mt-2 text-sm font-medium text-slate-800" data-testid="public-indicators-computed">{t('about:indicators.computed_at', 'Calculé le {{date}}', { date: formatDateTime(data.computedAt) })}</p>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card testId="ind-catalogue" title={t('about:indicators.catalogue.title', 'Fiches publiées')}
              isNot={t('about:indicators.catalogue.is_not', 'Ce n’est ni un nombre de personnes, ni une mesure de l’accès aux droits. Une aide publiée n’est pas une aide obtenue.')}>
              <Pairs rows={[['aide', 'aides'], ['demarche', 'demarches'], ['structure', 'structures'], ['dispositif', 'dispositifs'], ['guide', 'guides'], ['actualite', 'actualites']].map(([k, c]) => [kinds[k], n(data.catalogue[c])])} />
            </Card>

            <Card testId="ind-freshness" title={t('about:indicators.freshness.title', 'Fraîcheur des vérifications')}
              isNot={t('about:indicators.freshness.is_not', 'Une fiche vérifiée récemment reste une information générale : seul l’organisme concerné décide des droits d’une personne.')}>
              <p className="mb-2 text-slate-700">{t('about:indicators.freshness.text', 'Fiches dont la dernière vérification sur la source officielle date de 90 jours au plus, sur l’ensemble des fiches publiées. Au-delà de 180 jours, une fiche n’est plus publiée.')}</p>
              <Pairs rows={['aide', 'demarche', 'structure', 'dispositif'].map((k) => [kinds[k], data.freshness[k]?.visible
                ? t('about:indicators.freshness.value', '{{current}} sur {{visible}} ({{share}} %)', { current: n(data.freshness[k].current), visible: n(data.freshness[k].visible), share: n(data.freshness[k].currentShare) })
                : t('about:indicators.none', 'aucune fiche')])} />
            </Card>

            <Card testId="ind-links" title={t('about:indicators.links.title', 'État des liens officiels')}
              isNot={t('about:indicators.links.is_not', 'Un lien accessible ne garantit pas que la page dit toujours la même chose : le contenu est contrôlé par la vérification des fiches.')}>
              {data.linkHealth.measured ? (
                <>
                  <p className="mb-2 text-slate-700">{t('about:indicators.links.text', 'Adresses officielles contrôlées au cours des {{days}} derniers jours, selon leur dernier résultat (dernier contrôle le {{date}}).', { days: n(data.linkHealth.windowDays), date: formatDate(`${data.linkHealth.lastCheckedOn}T12:00:00Z`) })}</p>
                  <Pairs rows={[[t('about:indicators.links.reachable', 'Accessibles'), n(data.linkHealth.reachable)], [t('about:indicators.links.redirected', 'Redirigées'), n(data.linkHealth.redirected)],
                    [t('about:indicators.links.broken', 'Introuvables (404, 410)'), n(data.linkHealth.broken)], [t('about:indicators.links.inconclusive', 'Non concluantes'), n(data.linkHealth.inconclusive)]]} />
                </>
              ) : <p data-testid="ind-links-not-measured">{t('about:indicators.links.not_measured', 'Non mesuré : aucun contrôle des liens dans les {{days}} derniers jours.', { days: n(data.linkHealth.windowDays) })}</p>}
            </Card>

            <Card testId="ind-translations" title={t('about:indicators.translations.title', 'Fiches traduites')}
              isNot={t('about:indicators.translations.is_not', 'Le texte français reste la référence. Ce n’est pas un nombre de lecteurs par langue : les langues choisies par les visiteurs ne sont pas mesurées.')}>
              <p className="mb-2 text-slate-700">{t('about:indicators.translations.text', 'Fiches dont la traduction contrôlée est montrée (entièrement + en partie), sur {{total}} fiches publiées.', { total: n(Object.values(data.translations.of).reduce((a, b) => a + b, 0)) })}</p>
              <Pairs rows={LANGUAGES.filter((l) => data.translations.languages[l.code]).map((l) => {
                const per = Object.values(data.translations.languages[l.code]);
                return [l.name, t('about:indicators.translations.value', '{{full}} + {{partial}}', { full: n(per.reduce((a, x) => a + x.full, 0)), partial: n(per.reduce((a, x) => a + x.partial, 0)) })];
              })} />
            </Card>

            <Card testId="ind-structures-info" title={t('about:indicators.info.title', 'Informations pratiques des lieux')}
              isNot={t('about:indicators.info.is_not', 'Un lieu sans mention n’est pas un lieu inaccessible : l’information manque simplement dans la source.')}>
              <Pairs rows={[[t('about:indicators.info.visible', 'Lieux publiés'), n(data.structuresInformation.visible)],
                [t('about:indicators.info.step_free', 'Accès PMR indiqué'), n(data.structuresInformation.stepFreeAccessIndicated)],
                [t('about:indicators.info.hours', 'Horaires indiqués'), n(data.structuresInformation.openingHoursIndicated)]]} />
            </Card>

            {data.rightsNeeds && (
              <Card testId="ind-rights" title={t('about:indicators.rights.title', 'Besoins expliqués dans « Explorer les droits »')}
                isNot={t('about:indicators.rights.is_not', 'Ce n’est pas une liste des besoins des habitants : ce sont les situations que la page explique.')}>
                <Pairs rows={[[t('about:indicators.rights.needs', 'Besoins présentés'), n(data.rightsNeeds.needs)], [t('about:indicators.rights.fiches', 'Fiches officielles reliées'), n(data.rightsNeeds.officialFiches)],
                  ...(data.rightsNeeds.sourcesReadOn ? [([t('about:indicators.rights.read', 'Archive officielle lue le'), formatDate(`${data.rightsNeeds.sourcesReadOn}T12:00:00Z`)])] : [])]} />
              </Card>
            )}

            <Card testId="ind-domains" title={t('about:indicators.domains.title', 'Aides publiées par domaine')}
              isNot={t('about:indicators.domains.is_not', 'Ce n’est pas l’importance des besoins dans un domaine : seulement le nombre de fiches du catalogue.')}>
              {classifiedCount(data.aidesByDomain, 'domain', 'AUTRE') > 0
                ? <Pairs rows={data.aidesByDomain.map((d) => [domain[d.domain] || d.domain, n(d.count)])} />
                : <p data-testid="ind-domains-unclassified" className="text-slate-700">{t('about:indicators.domains.unclassified', 'Pas encore mesurable : les {{n}} aides publiées ne sont pas encore classées par domaine dans le catalogue. Cette répartition sera affichée quand elles le seront.', { n: n(data.catalogue.aides) })}</p>}
            </Card>

            {Array.isArray(data.aidesBySourceTheme) && data.aidesBySourceTheme.length > 0 && (
              <Card testId="ind-themes" title={t('about:indicators.themes.title', 'Aides publiées par thème de la source officielle')}
                isNot={t('about:indicators.themes.is_not', 'Ce n’est pas l’importance des besoins dans un domaine : seulement le nombre de fiches du catalogue, classées comme le fait la source.')}>
                <p className="mb-2 text-slate-700">{t('about:indicators.themes.text', 'Le thème est celui que la source officielle (Service-Public…) donne à la fiche ; il reste en français.')}</p>
                <Pairs rows={data.aidesBySourceTheme.map((r) => (r.theme === null ? [t('about:indicators.themes.none', 'Thème non indiqué par la source'), n(r.count)] : [r.theme, n(r.count), 'fr']))} />
              </Card>
            )}

            <Card testId="ind-scopes" title={t('about:indicators.scopes.title', 'Aides publiées par échelon')}
              isNot={t('about:indicators.scopes.is_not', 'Ce n’est pas une couverture du territoire : une aide nationale s’applique partout.')}>
              {classifiedCount(data.aidesByScope, 'scope', 'UNSPECIFIED') > 0
                ? <Pairs rows={data.aidesByScope.map((s) => [scope[s.scope] || s.scope, n(s.count)])} />
                : <p data-testid="ind-scopes-unclassified" className="text-slate-700">{t('about:indicators.scopes.unclassified', 'Pas encore mesurable : les {{n}} aides publiées n’indiquent pas encore leur échelon (national, régional, départemental, communal) dans le catalogue. Cette répartition sera affichée quand elles l’indiqueront.', { n: n(data.catalogue.aides) })}</p>}
            </Card>

            <Card testId="ind-communes" title={t('about:indicators.communes.title', 'Lieux d’accueil publiés par commune')}
              isNot={t('about:indicators.communes.is_not', 'Ce n’est pas l’offre réelle d’une commune : un lieu peut servir plusieurs communes, et beaucoup de lieux ne sont pas encore publiés.')}>
              <p className="mb-2 text-slate-700">{t('about:indicators.communes.text', 'D’après l’adresse déclarée. Une commune de moins de {{k}} lieux n’est pas affichée.', { k: n(data.structuresByCommune.kMin) })}</p>
              <Pairs rows={[...data.structuresByCommune.cells.map((c) => [c.label, n(c.count)]),
                [t('about:indicators.communes.masked', 'Communes non affichées'), n(data.structuresByCommune.maskedCommunes)],
                [t('about:indicators.communes.not_located', 'Lieux non localisés'), data.structuresByCommune.notLocated === null ? t('about:indicators.masked', 'masqué') : n(data.structuresByCommune.notLocated)]]} />
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
PublicIndicators.propTypes = { load: PropTypes.func };
