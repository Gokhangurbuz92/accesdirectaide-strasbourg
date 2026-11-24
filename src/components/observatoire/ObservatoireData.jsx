// @ts-nocheck — display of the public answer (schema ada.observatoire.v1, validated server-side by assertAggregateOnly); typed by its tests
import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { formatDate, formatNumber, useT } from '@/i18n';
import reference from '../../../data/reference/social-domains.v1.json';
import steps from '../../../data/reference/parcours-step-types.v1.json';
import { situationLabel } from '@/lib/situationLabels';
import { topicTone } from '@/design/categoryTone';

/**
 * G14-OBS — the published data of /observatoire (GET /api/public/observatoire). Every chart is a TABLE first (caption, header cells, scope): the bars are
 * decoration (aria-hidden) beside the number, and every reading (« aucun lieu publié »…) is written in words, never shown by colour alone. Masked cells
 * say « masqué » (below 5, or hidden to protect another value); a supply band says « 1 à 4 ». Logical properties only (RTL). Codes and quarter labels are isolated (<bdi>) in right-to-left text.
 */

const SUBS = new Map(reference.domains.flatMap((d) => d.subdomains.map((s) => [s.id, s.fr])));
const DOMAINS = new Map(reference.domains.map((d) => [d.id, d.fr]));
const STEPS = new Map(steps.types.map((s) => [s.code, s.label]));

function useLabels() {
  const { t } = useT('observatory');
  const situations = /** @type {Record<string, string>} */ ({
    'loyer-impaye': t('observatory:situation.loyer-impaye', 'Loyer impayé'), expulsion: t('observatory:situation.expulsion', 'Menace d’expulsion'),
    'sans-logement': t('observatory:situation.sans-logement', 'Sans logement'), 'factures-impayees': t('observatory:situation.factures-impayees', 'Factures impayées'),
    dettes: t('observatory:situation.dettes', 'Dettes'), 'perte-emploi': t('observatory:situation.perte-emploi', 'Perte d’emploi'),
    'sans-ressources': t('observatory:situation.sans-ressources', 'Sans ressources'), 'arrivee-strasbourg': t('observatory:situation.arrivee-strasbourg', 'Arrivée à Strasbourg'),
    violences: t('observatory:situation.violences', 'Violences'), 'enfant-danger': t('observatory:situation.enfant-danger', 'Enfant en danger'),
    detresse: t('observatory:situation.detresse', 'Détresse psychologique'), 'parent-seul': t('observatory:situation.parent-seul', 'Parent seul'),
    'proche-age': t('observatory:situation.proche-age', 'Proche âgé'), handicap: t('observatory:situation.handicap', 'Handicap'),
    'sans-titre-sejour': t('observatory:situation.sans-titre-sejour', 'Sans titre de séjour'), 'sortie-ase': t('observatory:situation.sortie-ase', 'Sortie de l’aide sociale à l’enfance'),
    'demarches-papiers': t('observatory:situation.demarches-papiers', 'Démarches et papiers'), scolarite: t('observatory:situation.scolarite', 'Scolarité'),
    retraite: t('observatory:situation.retraite', 'Retraite'),
  });
  const reasons = /** @type {Record<string, string>} */ ({
    HOUSING: t('observatory:reason.HOUSING', 'Logement'), EMPLOYMENT: t('observatory:reason.EMPLOYMENT', 'Emploi et insertion'), TRAINING: t('observatory:reason.TRAINING', 'Formation'),
    INCOME_BUDGET: t('observatory:reason.INCOME_BUDGET', 'Ressources et budget'), ENERGY: t('observatory:reason.ENERGY', 'Énergie et factures'),
    ADMIN_PROCEDURES: t('observatory:reason.ADMIN_PROCEDURES', 'Démarches administratives'), ACCESS_TO_RIGHTS: t('observatory:reason.ACCESS_TO_RIGHTS', 'Accès aux droits'),
    MOBILITY: t('observatory:reason.MOBILITY', 'Mobilité'), DIGITAL: t('observatory:reason.DIGITAL', 'Numérique'), FOOD: t('observatory:reason.FOOD', 'Alimentation'),
  });
  const categories = /** @type {Record<string, string>} */ ({
    LOGEMENT: t('about:indicators.domain.logement', 'Logement'), SANTE: t('about:indicators.domain.sante', 'Santé'), HANDICAP: t('about:indicators.domain.handicap', 'Handicap'),
    EMPLOI: t('about:indicators.domain.emploi', 'Emploi'), FAMILLE: t('about:indicators.domain.famille', 'Famille'), ETUDES: t('about:indicators.domain.etudes', 'Études'),
    MOBILITE: t('about:indicators.domain.mobilite', 'Mobilité'), ENERGIE: t('about:indicators.domain.energie', 'Énergie'), ALIMENTATION: t('about:indicators.domain.alimentation', 'Alimentation'),
    JUSTICE: t('about:indicators.domain.justice', 'Justice'), NUMERIQUE: t('about:indicators.domain.numerique', 'Numérique'), AUTRE: t('about:indicators.domain.autre', 'Autre ou non classé'),
  });
  const domain = (/** @type {string} */ id) => (id === 'non_classe' ? t('observatory:domain.unclassified', 'Non classé') : t(`reference:domain.${id}`, DOMAINS.get(id) || id));
  const sub = (/** @type {string} */ id) => t(`reference:sub.${id}`, SUBS.get(id) || id);
  const step = (/** @type {string} */ code) => t(`compte:parcours.type.${code}`, STEPS.get(code) || code);
  return { t, situations, reasons, categories, domain, sub, step };
}

/** a published demand value: the number, or « moins de 5 » */
function Value({ v }) {
  const { t } = useT('observatory');
  return v === null || v === undefined ? <span className="text-slate-600">{t('observatory:masked', 'masqué')}</span> : <span className="font-semibold tabular-nums">{formatNumber(v)}</span>;
}
Value.propTypes = { v: PropTypes.number };
/** a supply value: the number, 0, or « 1 à 4 » */
function Supply({ v }) {
  const { t } = useT('observatory');
  return v === null || v === undefined ? <span className="text-slate-600">{t('observatory:band', '1 à 4')}</span> : <span className="font-semibold tabular-nums">{formatNumber(v)}</span>;
}
Supply.propTypes = { v: PropTypes.number };
/** decoration only: the number beside it is what is read */
const Bar = ({ v, max }) => (v && max ? <span aria-hidden="true" className="mt-1 block h-2 rounded bg-blue-700" style={{ width: `${Math.max(4, Math.round((100 * v) / max))}%` }} /> : null);
Bar.propTypes = { v: PropTypes.number, max: PropTypes.number };

/** @param {{ caption: string, head: string[], rows: Array<{ key: string, cells: import('react').ReactNode[] }>, testId: string }} props */
function Table({ caption, head, rows, testId }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" data-testid={testId}>
        <caption className="mb-2 text-start font-semibold text-slate-900">{caption}</caption>
        <thead><tr className="border-b border-slate-300">{head.map((h, i) => <th key={h} scope="col" className={`py-2 pe-3 font-semibold text-slate-800 ${i ? 'text-end' : 'text-start'}`}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-slate-100">
              {r.cells.map((c, i) => (i === 0 ? <th key={i} scope="row" className="py-2 pe-3 text-start font-normal text-slate-800">{c}</th> : <td key={i} className="py-2 pe-3 text-end text-slate-900">{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
Table.propTypes = { caption: PropTypes.string.isRequired, head: PropTypes.arrayOf(PropTypes.string).isRequired, rows: PropTypes.array.isRequired, testId: PropTypes.string.isRequired };

/** the reading of a domain gap, in words (never a colour alone) */
function GapText({ g }) {
  const { t } = useT('observatory');
  if (g.kind === 'NO_PLACE') return <span><span aria-hidden="true">⚠ </span>{t('observatory:gap.no_place', 'Aucun lieu publié dans l’Eurométropole')}</span>;
  if (g.kind === 'FEW_PLACES') return <span><span aria-hidden="true">△ </span>{t('observatory:gap.few_places', 'Peu de lieux publiés (1 à 4)')}</span>;
  if (g.kind === 'RATIO') return <span>{t('observatory:gap.ratio', '{{n}} recherches pour 1 lieu publié', { n: formatNumber(g.perPlace) })}</span>;
  return <span className="text-slate-600">{t('observatory:gap.not_measured', 'Pas assez de recherches publiées pour conclure')}</span>;
}
GapText.propTypes = { g: PropTypes.object.isRequired };

/** a code-only signal table (situations, categories, referral reasons), or « not collected » */
function CodesTable({ data, label, caption, head, testId }) {
  const { t } = useT('observatory');
  if (!data) return <p className="text-slate-700" data-testid={`${testId}-not-collected`}>{caption} — {t('observatory:not_collected', 'non collecté ce trimestre.')}</p>;
  const rows = [...data.codes].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
  return <Table testId={testId} caption={caption} head={head} rows={rows.map((r) => ({ key: r.code, cells: [label(r.code), <><Value v={r.value} /><Bar v={r.value} max={max} /></>] }))} />;
}
CodesTable.propTypes = { data: PropTypes.object, label: PropTypes.func.isRequired, caption: PropTypes.string.isRequired, head: PropTypes.arrayOf(PropTypes.string).isRequired, testId: PropTypes.string.isRequired };

/** one frozen quarter */
function Quarter({ q, names }) {
  const L = useLabels(); const { t } = L;
  const search = q.search?.domains || [];
  const gapOf = new Map((q.gaps?.byDomain || []).map((g) => [g.domain, g]));
  const ranked = [...search].sort((a, b) => b.publishedSum - a.publishedSum);
  const max = Math.max(0, ...ranked.map((d) => d.publishedSum));
  const top = ranked.filter((d) => d.publishedSum >= 5).slice(0, 3);
  const leads = (q.gaps?.byDomain || []).filter((g) => g.kind === 'NO_PLACE' || g.kind === 'FEW_PLACES');
  const period = (/** @type {{ from: string, to: string } | null} */ c) => (c ? t('observatory:collected.range', 'du {{from}} au {{to}}', { from: formatDate(`${c.from}T12:00:00Z`), to: formatDate(`${c.to}T12:00:00Z`) }) : t('observatory:collected.none', 'non collecté'));
  return (
    <section aria-labelledby={`q-${q.quarter}`} className="space-y-6" data-testid="obs-quarter">
      <div>
        <h3 id={`q-${q.quarter}`} className="text-lg font-bold text-slate-900">{t('observatory:quarter.title', 'Trimestre')} <bdi>{q.quarter}</bdi></h3>
        <p className="text-sm text-slate-700" data-testid="obs-frozen">{t('observatory:quarter.frozen', 'Chiffres figés le {{date}}. Source : AccesDirectAide (signaux anonymes du site) et annuaire publié du site.', { date: formatDate(q.frozenAt) })}</p>
        <ul className="mt-2 list-disc ps-5 text-sm text-slate-700">
          <li>{t('observatory:collected.search', 'Recherches :')} {period(q.collected.search)}</li>
          <li>{t('observatory:collected.situation', 'Situations choisies :')} {period(q.collected.situation)}</li>
          <li>{t('observatory:collected.parcours', 'Étapes de Mon Parcours :')} {period(q.collected.parcours)}</li>
          <li>{t('observatory:collected.referral', 'Orientations sociales :')} {period(q.collected.referral)}</li>
        </ul>
      </div>

      {q.search ? (
        <div className="space-y-4">
          <h4 className="text-base font-semibold text-slate-900">{t('observatory:search.title', 'Les sujets recherchés et les lieux publiés')}</h4>
          <p className="text-slate-700" data-testid="obs-search-summary">{top.length
            ? t('observatory:search.summary', 'Sujets les plus recherchés : {{list}}.', { list: top.map((d) => `${L.domain(d.domain)} (${formatNumber(d.publishedSum)})`).join(', ') })
            : t('observatory:search.summary_none', 'Aucun sujet n’a atteint 5 recherches ce trimestre.')}</p>
          <Table testId="obs-search-table" caption={t('observatory:search.caption', 'Recherches par domaine, lieux publiés dans l’Eurométropole au moment du gel, et lecture')}
            head={[t('observatory:col.domain', 'Domaine'), t('observatory:col.searches', 'Recherches'), t('observatory:col.places', 'Lieux publiés'), t('observatory:col.reading', 'Lecture')]}
            rows={ranked.map((d) => ({ key: d.domain, cells: [<span key="d" className="inline-flex items-center gap-2"><span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${topicTone(d.domain).dot}`} />{L.domain(d.domain)}</span>,
              <>{d.publishedSum >= 5 ? <span className="font-semibold tabular-nums">{formatNumber(d.publishedSum)}</span> : <span className="text-slate-600">{t('observatory:small_numbers', 'petits nombres, non publiés')}</span>}{d.maskedCells > 0 && d.publishedSum >= 5 ? <span className="block text-xs text-slate-600">{t('observatory:partial', 'au moins (des valeurs sont masquées)')}</span> : null}<Bar v={d.publishedSum} max={max} /></>,
              <Supply key="p" v={gapOf.get(d.domain)?.places ?? null} />, <GapText key="g" g={gapOf.get(d.domain) || { kind: 'NOT_MEASURED' }} />] }))} />
          <div>
            <h4 className="text-base font-semibold text-slate-900">{t('observatory:leads.title', 'Pistes à vérifier : beaucoup de recherches, peu de lieux publiés')}</h4>
            {leads.length || q.gaps?.byCommune?.length ? (
              <ul className="mt-2 list-disc space-y-1 ps-5 text-slate-800" data-testid="obs-leads">
                {leads.map((g) => <li key={g.domain}><strong>{L.domain(g.domain)}</strong> — <GapText g={g} /> ({t('observatory:leads.searches', '{{n}} recherches', { n: formatNumber(g.searches) })})</li>)}
                {(q.gaps?.byCommune || []).map((g) => <li key={`${g.domain}-${g.commune}`}><strong>{L.domain(g.domain)}</strong>, {names.get(g.commune) || g.commune} — {t('observatory:gap.no_place_commune', 'aucun lieu publié dans la commune')} ({t('observatory:leads.searches', '{{n}} recherches', { n: formatNumber(g.searches) })})</li>)}
              </ul>
            ) : <p className="mt-2 text-slate-700">{t('observatory:leads.none', 'Aucune piste ce trimestre.')}</p>}
            <p className="mt-2 text-sm text-slate-600">{t('observatory:leads.caveat', 'Une piste n’est pas un besoin non couvert : l’annuaire du site est incomplet, et une recherche n’est pas une personne.')}</p>
          </div>
          {ranked.filter((d) => d.publishedSum >= 5).map((d) => (
            <details key={d.domain} className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer font-semibold text-slate-900">{t('observatory:details.summary', 'Détail : {{domain}}', { domain: L.domain(d.domain) })}</summary>
              <div className="mt-3 space-y-4">
                <Table testId={`obs-sub-${d.domain}`} caption={t('observatory:details.subdomains', 'Recherches par sujet précis')} head={[t('observatory:col.subject', 'Sujet'), t('observatory:col.searches', 'Recherches')]}
                  rows={d.subdomains.map((s) => ({ key: s.code, cells: [L.sub(s.code), <Value key="v" v={s.value} />] }))} />
                {d.byCommune ? (
                  <Table testId={`obs-commune-${d.domain}`} caption={t('observatory:details.communes', 'Recherches par commune (quand la recherche indique une commune)')} head={[t('observatory:col.commune', 'Commune'), t('observatory:col.searches', 'Recherches')]}
                    rows={[...d.byCommune.communes.map((c) => ({ key: c.commune, cells: [names.get(c.commune) || c.commune, <Value key="v" v={c.value} />] })),
                      { key: 'none', cells: [t('observatory:details.no_commune', 'Sans commune indiquée'), <Value key="v" v={d.byCommune.noCommune} />] },
                      { key: 'out', cells: [t('observatory:details.outside', 'Hors Eurométropole'), <Value key="v" v={d.byCommune.outside} />] }]} />
                ) : <p className="text-sm text-slate-700">{t('observatory:details.no_commune_table', 'Pas de détail par commune : moins de 20 recherches dans ce domaine ce trimestre.')}</p>}
              </div>
            </details>
          ))}
        </div>
      ) : <p className="text-slate-700" data-testid="obs-search-not-collected">{t('observatory:search.not_collected', 'Les recherches n’étaient pas collectées ce trimestre.')}</p>}

      <CodesTable testId="obs-situations" data={q.situations} label={(c) => L.situations[c] || situationLabel(c, t)} caption={t('observatory:situations.caption', 'Situations choisies dans « Ma situation » (seulement par les personnes qui l’ont accepté)')} head={[t('observatory:col.situation', 'Situation'), t('observatory:col.count', 'Nombre')]} />
      {q.parcoursAdded ? (
        <Table testId="obs-parcours" caption={t('observatory:parcours.caption', 'Démarches suivies dans Mon Parcours (déclarées par les personnes)')}
          head={[t('observatory:col.step', 'Démarche'), t('observatory:col.added', 'Ajoutées'), t('observatory:col.closed', 'Terminées')]}
          rows={q.parcoursAdded.codes.map((c, i) => ({ key: c.code, cells: [L.step(c.code), <Value key="a" v={c.value} />, <Value key="c" v={q.parcoursClosed?.codes[i]?.value ?? null} />] }))} />
      ) : <p className="text-slate-700" data-testid="obs-parcours-not-collected">{t('observatory:parcours.caption', 'Démarches suivies dans Mon Parcours (déclarées par les personnes)')} — {t('observatory:not_collected', 'non collecté ce trimestre.')}</p>}
      <CodesTable testId="obs-referrals" data={q.referrals} label={(c) => L.reasons[c] || c} caption={t('observatory:referrals.caption', 'Orientations sociales envoyées, par motif')} head={[t('observatory:col.reason', 'Motif'), t('observatory:col.count', 'Nombre')]} />
      <CodesTable testId="obs-categories" data={q.categories} label={(c) => L.categories[c] || c} caption={t('observatory:categories.caption', 'Recherches filtrées par catégorie d’aide')} head={[t('observatory:col.category', 'Catégorie'), t('observatory:col.count', 'Nombre')]} />
      {q.bookings && (
        <Table testId="obs-bookings" caption={t('observatory:bookings.caption', 'Demandes de rendez-vous et lieux qui proposent un rendez-vous en ligne, par domaine')}
          head={[t('observatory:col.domain', 'Domaine'), t('observatory:col.requested', 'Demandes'), t('observatory:col.bookable', 'Lieux avec rendez-vous en ligne')]}
          rows={q.bookings.byDomain.map((b) => ({ key: b.domain, cells: [L.domain(b.domain), <Value key="r" v={b.requested} />, <Supply key="b" v={b.bookablePlaces} />] }))} />
      )}
    </section>
  );
}
Quarter.propTypes = { q: PropTypes.object.isRequired, names: PropTypes.instanceOf(Map).isRequired };

/** @param {{ data: any }} props */
export default function ObservatoireData({ data }) {
  const L = useLabels(); const { t } = L;
  const [at, setAt] = useState(0);
  const names = useMemo(() => new Map(data.territory.communes.map((/** @type {any} */ c) => [c.code, c.label])), [data]);
  const sup = data.supply;
  const q = data.quarters[at];
  return (
    <div className="space-y-10">
      <section aria-labelledby="obs-demand-title" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 id="obs-demand-title" className="text-xl font-bold text-slate-900">{t('observatory:demand.title', 'Ce que les personnes cherchent')}</h2>
        {data.quarters.length === 0 ? (
          <p className="mt-3 text-slate-700" data-testid="obs-no-quarter">{t('observatory:demand.none', 'Aucun trimestre n’est encore publié. Le premier sera publié quand un trimestre complet sera terminé et figé.')}</p>
        ) : (
          <>
            <div className="mt-4">
              <label htmlFor="obs-quarter-select" className="block font-medium text-slate-900">{t('observatory:demand.choose', 'Choisir un trimestre')}</label>
              <select id="obs-quarter-select" className="mt-1 rounded-lg border border-slate-400 bg-white px-3 py-2 text-slate-900" value={at} onChange={(e) => setAt(Number(e.target.value))}>
                {data.quarters.map((x, i) => <option key={x.quarter} value={i}>{x.quarter}</option>)}
              </select>
            </div>
            <div className="mt-6"><Quarter q={q} names={names} /></div>
          </>
        )}
      </section>

      <section aria-labelledby="obs-supply-title" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="obs-supply">
        <h2 id="obs-supply-title" className="text-xl font-bold text-slate-900">{t('observatory:supply.title', 'Les lieux publiés aujourd’hui dans l’Eurométropole')}</h2>
        <p className="mt-2 text-slate-700">{t('observatory:supply.text', 'Calculé le {{date}} à partir de l’annuaire du site. Un lieu peut compter dans plusieurs domaines. « 1 à 4 » : petit nombre, montré par prudence.', { date: formatDate(sup.computedAt) })}</p>
        <div className="mt-4">
          <Table testId="obs-supply-domains" caption={t('observatory:supply.caption', 'Lieux publiés par domaine')}
            head={[t('observatory:col.domain', 'Domaine'), t('observatory:col.places', 'Lieux publiés'), t('observatory:col.bookable', 'Lieux avec rendez-vous en ligne'), t('observatory:col.hours', 'Horaires indiqués')]}
            rows={sup.byDomain.map((d) => ({ key: d.domain, cells: [L.domain(d.domain), <Supply key="p" v={d.places} />, <Supply key="b" v={d.bookable} />, <Supply key="h" v={d.hours} />] }))} />
        </div>
        <details className="mt-4 rounded-xl border border-slate-200 p-4">
          <summary className="cursor-pointer font-semibold text-slate-900">{t('observatory:supply.communes_summary', 'Lieux publiés par commune')}</summary>
          <div className="mt-3">
            <Table testId="obs-supply-communes" caption={t('observatory:supply.communes_caption', 'Lieux publiés par commune de l’Eurométropole')} head={[t('observatory:col.commune', 'Commune'), t('observatory:col.places', 'Lieux publiés')]}
              rows={sup.byCommune.map((c) => ({ key: c.commune, cells: [names.get(c.commune) || c.commune, <Supply key="p" v={c.places} />] }))} />
          </div>
        </details>
      </section>
    </div>
  );
}
ObservatoireData.propTypes = { data: PropTypes.object.isRequired };
