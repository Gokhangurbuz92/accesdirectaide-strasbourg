import { Link } from 'react-router-dom';
import { Phone, ExternalLink, AlertTriangle, ArrowRight } from 'lucide-react';
import { useT } from '@/i18n';
import reference from '../../../data/reference/social-domains.v1.json';

/** French official text inside any interface language: marked French and left-to-right (an Arabic page would otherwise flip its punctuation) */
const FR = { lang: 'fr', dir: 'ltr' };
/** the official emergency numbers and their French names (data/reference/social-domains.v1.json) */
const EMERGENCY = new Map(Object.entries(reference.emergency));
const tel = (/** @type {string} */ n) => (n.length === 10 && n.startsWith('0') ? `${n.slice(0, 1)} ${n.slice(1, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}` : n);

/** @typedef {{ title: string, url: string, slug: string | null }} OrientationSource  an official sheet, resolved by api/_handlers/search.js */
/** @typedef {{ text: string, sheet: string, inForceNow: boolean }} OrientationRule */
/** @typedef {{ id: string, label: string, urgent: boolean, numbers: string[], actions: string[], rules: OrientationRule[], sheets: string[], topic: string }} OrientationNeed */
/** @typedef {{ id: string, text: string, sheets: string[] }} OrientationCaution */
/** @typedef {{ id: string, text: string, options: { label: string, add: string }[] }} OrientationQuestion */
/**
 * the `orientation` of a search answer (api/lib/multi-need.js analyseNeeds, its sheets resolved)
 * @typedef {{ needs?: OrientationNeed[], cautions?: OrientationCaution[], questions?: OrientationQuestion[], sources?: Record<string, OrientationSource>, multi?: boolean }} Orientation
 */

/**
 * one official sheet: its page on AccesDirectAide when published, else on service-public.gouv.fr (new tab)
 * @param {{ id: string, sources: Record<string, OrientationSource>, newTab: string }} props  newTab: the screen-reader hint, in the interface language
 */
function Sheet({ id, sources, newTab }) {
  const s = sources[id];
  if (!s) return null;
  return s.slug
    ? <Link to={`/bonnes-pratiques/${s.slug}`} className="font-medium text-blue-800 underline" {...FR}>{s.title}</Link>
    : (
      <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-800 underline" {...FR}>
        {s.title}<ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="sr-only"> {newTab}</span>
      </a>
    );
}

/**
 * R37 — « Votre situation »: the needs a multi-need query describes (api/lib/multi-need.js), most urgent first, above the ordinary results. Each need:
 * the official numbers, what to do next, the official rules and sheets, and a search of the places and aides for it. Then what to check before asking
 * for an aide the results list (cautions), and the one question that changes the answer. The texts are French official wording (lang="fr"); the frame
 * is in the interface language. Nothing here decides a right.
 * @param {{ orientation: Orientation | null | undefined, query: string }} props
 */
export default function OrientationPanel({ orientation, query }) {
  const { t } = useT('search');
  if (!orientation || (!orientation.needs?.length && !orientation.questions?.length)) return null;
  const { needs = [], cautions = [], questions = [], sources = {} } = orientation;
  const newTab = t('search:orientation.new_tab', '(service-public.gouv.fr, nouvel onglet)');
  return (
    <section aria-labelledby="orientation-title" data-testid="search-orientation" className="mb-6 rounded-xl border border-blue-200 bg-blue-50/60 p-4 sm:p-5">
      <h2 id="orientation-title" className="text-lg font-semibold text-slate-900">
        {needs.length > 1
          ? t('search:orientation.title_many', 'Votre situation : {{n}} besoins, du plus urgent au moins urgent', { n: needs.length })
          : t('search:orientation.title_one', 'Votre situation')}
      </h2>
      <p className="mt-1 text-sm text-slate-700">{t('search:orientation.intro', 'Ces pistes viennent des fiches officielles de Service-Public. Elles ne disent pas qu’une aide vous est due : seul l’organisme concerné décide.')}</p>

      {questions.map((q) => (
        <div key={q.id} className="mt-4 rounded-lg border border-slate-200 bg-white p-3" data-testid={`orientation-question-${q.id}`}>
          <p className="font-medium text-slate-900" {...FR}>{q.text}</p>
          <p className="mt-1 text-sm text-slate-600">{t('search:orientation.question_hint', 'La réponse change ce qui vous est proposé. Rien n’est enregistré.')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {q.options.map((o) => (
              <Link key={o.add} to={`/recherche?q=${encodeURIComponent(`${query} ${o.add}`)}`} className="ada-target inline-flex min-h-11 items-center rounded-md border border-blue-300 bg-white px-4 font-medium text-blue-800 hover:bg-blue-50" {...FR}>{o.label}</Link>
            ))}
          </div>
        </div>
      ))}

      <ol className="mt-4 space-y-3">
        {needs.map((n, i) => (
          <li key={n.id} className={`rounded-lg border bg-white p-4 ${n.urgent ? 'border-red-300' : 'border-slate-200'}`} data-testid={`orientation-need-${n.id}`}>
            <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-900 px-1 text-xs font-bold text-white" aria-hidden="true">{i + 1}</span>
              <span {...FR}>{n.label}</span>
              {n.urgent && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">{t('search:orientation.urgent', 'Urgent')}</span>}
            </h3>
            {n.numbers.some((x) => EMERGENCY.has(x)) && (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {n.numbers.filter((x) => EMERGENCY.has(x)).map((x) => (
                  <li key={x} className="flex items-center gap-1.5">
                    <Phone className="h-4 w-4 shrink-0 text-red-800" aria-hidden="true" />
                    <a href={`tel:${x}`} className="ada-target font-semibold text-red-900 underline" dir="ltr">{tel(x)}</a>
                    <span {...FR}>{EMERGENCY.get(x)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm font-semibold text-slate-800">{t('search:orientation.next', 'Que faire maintenant')}</p>
            <ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-slate-800" {...FR}>
              {n.actions.map((a) => <li key={a}>{a}</li>)}
            </ul>
            {n.rules.map((r) => (
              <p key={r.text} className="mt-2 rounded-md bg-slate-50 p-2 text-sm text-slate-800" data-testid="orientation-rule">
                <span className="font-semibold">{t('search:orientation.rule', 'Règle officielle')}{r.inForceNow ? ` · ${t('search:orientation.in_force', 'en ce moment')}` : ''} : </span>
                <span {...FR}>{r.text}</span>{' '}(<Sheet id={r.sheet} sources={sources} newTab={newTab} />)
              </p>
            ))}
            {n.sheets.length > 0 && (
              <div className="mt-2 text-sm">
                <span className="text-slate-700">{t('search:orientation.sheets', 'Fiches officielles :')} </span>
                <ul className="inline">
                  {n.sheets.map((id, k) => <li key={id} className="inline">{k > 0 && ' · '}<Sheet id={id} sources={sources} newTab={newTab} /></li>)}
                </ul>
              </div>
            )}
            <Link to={`/recherche?q=${encodeURIComponent(n.topic)}`} className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-blue-800 hover:underline">
              {t('search:orientation.search_topic', 'Lieux et aides pour ce besoin')}<ArrowRight className="h-4 w-4 rtl-flip" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>

      {cautions.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3" data-testid="orientation-cautions">
          <p className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{t('search:orientation.check', 'À vérifier avant de demander une aide de la liste')}</p>
          <ul className="mt-2 space-y-2 text-sm text-amber-950">
            {cautions.map((c) => (
              <li key={c.id} data-testid={`orientation-caution-${c.id}`}><span {...FR}>{c.text}</span>{' '}({c.sheets.map((id, k) => <span key={id}>{k > 0 && ', '}<Sheet id={id} sources={sources} newTab={newTab} /></span>)})</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-sm text-slate-700">{t('search:orientation.human', 'Pour être accompagné : le CCAS de votre commune, une Maison des solidarités ou un espace France Services.')}</p>
    </section>
  );
}
