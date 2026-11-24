import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, CalendarClock, ExternalLink, FileText, Info, MapPin, Phone, Route as RouteIcon } from 'lucide-react';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import { OFFICIAL_TOOLS, toolText } from '@/config/officialTools';
import { formatDate, useLanguage, useT } from '@/i18n';
import { FICHES, NEEDS, SOURCES_READ_AT, TERRITORIES, inWindow, needLabel } from '@/lib/rightsPublicView';
import reference from '../../data/reference/social-domains.v1.json';
import { frontendEnv } from '@/config/env';
import { bookingOpened } from '@/lib/publicBeta';
import { NEED_BY_ID, needBookingHref } from '@/lib/socialNeeds';
import { TONES, topicTone } from '@/design/categoryTone';
import { ToneBar, ToneIcon } from '@/components/ui/Tone';

/**
 * G3 (19/11/2026) — « Explorer les droits par besoin »: the public, anonymous view of the Rights Graph (founder directive 19/11, track 1).
 * Per need: the official Service-Public fiches (with DILA's dates and the date the archive was read), who decides or where to ask, what to do next (official
 * advice, numbers, the directory, the official online services of /outils) and where it applies (national, Alsace-Moselle).
 * The data is data/reference/rights-public-view.v1.json, generated at build time from api/lib/rightsGraph.js by scripts/rights-public-view.mjs: the page
 * asks nothing and sends nothing (no field, no request of its own). Owner decision C4 (18/11/2026): no D11 rule and no condition of access is shown —
 * the generated view excludes them, and the advice sentences that state a condition are left out (the fiche, linked, says them).
 * The official texts (fiche titles, advice, body names) stay in French, marked lang="fr"; the frame follows the interface language.
 */

const EMERGENCY = new Map(Object.entries(reference.emergency));
const tel = (/** @type {string} */ n) => (n.length === 10 && n.startsWith('0') ? `${n.slice(0, 1)} ${n.slice(1, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}` : n);
const day = (/** @type {string | null} */ d) => (d ? formatDate(`${d}T12:00:00Z`) : '');
/** @typedef {import('@/lib/rightsPublicView').PublicNeed} PublicNeed @typedef {import('@/lib/rightsPublicView').PublicFiche} PublicFiche */

/** @param {{ fiche: PublicFiche, fr: object }} props */
function FicheItem({ fiche, fr }) {
  const { t } = useT('rights');
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4" data-testid={`rights-fiche-${fiche.id}`}>
      <a href={fiche.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1.5 font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-950">
        <FileText className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
        <span {...fr}>{fiche.title || fiche.id}</span>
        <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
        <span className="sr-only">{t('rights:fiche.new-tab', '(service-public.gouv.fr, nouvel onglet)')}</span>
      </a>
      <p className="mt-1 text-sm text-slate-700">{t('rights:fiche.source', 'Fiche officielle {{id}} de Service-Public (DILA)', { id: fiche.id })}</p>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex flex-wrap gap-x-1"><dt className="text-slate-700">{t('rights:fiche.changed', 'Dernière mise à jour par Service-Public :')}</dt>
          <dd className="font-medium text-slate-900">{fiche.modifiedAt || fiche.importantChangeAt ? day(fiche.modifiedAt || fiche.importantChangeAt) : t('rights:fiche.no-date', 'date non indiquée')}</dd></div>
        <div className="flex flex-wrap gap-x-1"><dt className="text-slate-700">{t('rights:fiche.read', 'Relue dans l’archive officielle le')}</dt>
          <dd className="font-medium text-slate-900">{fiche.readAt ? day(fiche.readAt) : t('rights:fiche.no-date', 'date non indiquée')}</dd></div>
      </dl>
      {fiche.localGuide && (
        <Link to={`/bonnes-pratiques/${fiche.localGuide}`} className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-950" data-testid="rights-local-guide">
          {t('rights:fiche.local', 'Lire cette fiche sur AccesDirectAide')}<ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        </Link>
      )}
    </li>
  );
}

/** the certainty of an advice's official source, in words @param {{ value: string }} props */
function Certainty({ value }) {
  const { t } = useT('rights');
  const text = value === 'etabli' ? t('rights:certainty.etabli', 'Établi : une fiche officielle le dit')
    : value === 'inconnu' ? t('rights:certainty.inconnu', 'Inconnu : aucune fiche officielle citée')
      : t('rights:certainty.a_verifier', 'À vérifier : selon votre situation, l’organisme décide');
  const tone = value === 'etabli' ? 'bg-emerald-50 text-emerald-900' : value === 'inconnu' ? 'bg-slate-100 text-slate-800' : 'bg-amber-50 text-amber-900';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`} data-certainty={value}>{text}</span>;
}

/** @param {{ need: PublicNeed }} props */
function NeedDetail({ need }) {
  const { t } = useT('rights');
  const { t: tShared } = useT('shared');
  const { isSource } = useLanguage();
  const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
  const urgentNumbers = need.numbers.filter((x) => EMERGENCY.has(x));
  const tools = need.tools.map((id) => OFFICIAL_TOOLS.find((x) => x.id === id)).filter((x) => x !== undefined);
  const localAids = need.aids.filter((a) => a.territory !== 'FR');
  return (
    <article aria-labelledby="rights-need-title" data-testid={`rights-need-${need.id}`} className="space-y-8">
      <div className="flex items-center gap-3"><ToneIcon tone={need.urgent ? TONES.red : topicTone(need.id)} icon={RouteIcon} /><span aria-hidden="true" className={`h-1 flex-1 rounded-full ${(need.urgent ? TONES.red : topicTone(need.id)).bar}`} /></div>
      {!isSource && <p className="text-sm text-slate-700">{t('rights:need.official-name', 'Nom officiel en français :')} <span {...fr} className="font-medium">{need.label}</span></p>}
      {urgentNumbers.length > 0 && (
        <section aria-labelledby="rights-numbers" className="rounded-lg border border-red-300 bg-red-50 p-4">
          <h2 id="rights-numbers" className="text-lg font-semibold text-red-950">{t('rights:numbers.title', 'Numéros à appeler')}</h2>
          <ul className="mt-2 space-y-1">
            {urgentNumbers.map((x) => (
              <li key={x} className="flex flex-wrap items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-red-800" aria-hidden="true" />
                <a href={`tel:${x}`} className="inline-flex min-h-11 items-center font-semibold text-red-900 underline" dir="ltr">{tel(x)}</a>
                <span {...fr}>{EMERGENCY.get(x)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="rights-fiches">
        <h2 id="rights-fiches" className="text-xl font-semibold text-slate-900">{t('rights:fiches.title', 'Fiches officielles')}</h2>
        {need.fiches.length ? (
          <ul className="mt-3 space-y-3">{need.fiches.map((f) => <FicheItem key={f.id} fiche={f} fr={fr} />)}</ul>
        ) : (
          <p className="mt-2 text-slate-800">{t('rights:fiches.none', 'Aucune fiche de Service-Public n’est citée pour ce besoin : les conseils ci-dessous sont à vérifier auprès des organismes nommés.')}</p>
        )}
      </section>

      <section aria-labelledby="rights-bodies">
        <h2 id="rights-bodies" className="text-xl font-semibold text-slate-900">{t('rights:bodies.title', 'Qui décide, à qui s’adresser')}</h2>
        <p className="mt-1 text-slate-800">{t('rights:bodies.intro', 'C’est l’organisme qui reçoit la demande qui décide. AccesDirectAide ne décide rien et ne transmet rien.')}</p>
        {need.bodies.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" data-testid="rights-bodies">
            {need.bodies.map((b) => <li key={b.id} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"><Building2 className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" /><span {...fr}>{b.label}</span></li>)}
          </ul>
        )}
        {need.offices.length > 0 && (
          <>
            <h3 className="mt-4 text-base font-semibold text-slate-900">{t('rights:offices.title', 'Trouver un lieu d’accueil (« Où s’adresser » de la fiche officielle)')}</h3>
            <ul className="mt-2 space-y-1" data-testid="rights-offices">
              {need.offices.map((o) => (
                <li key={o.type}>
                  <Link to={`/structures?type=${encodeURIComponent(o.type)}`} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-blue-800 underline underline-offset-2 hover:text-blue-950">
                    <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" /><span {...fr}>{o.type}</span>
                    <span className="sr-only">{t('rights:offices.link', ' : chercher dans l’annuaire des lieux')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {/* G14 release 3: « Prendre rendez-vous » for this need — the places where an appointment for it can be asked on AccesDirectAide or that book on
            their own reviewed page; offered only while booking is open in this build (the directory applies the server's rules) */}
        {bookingOpened(frontendEnv.flags.publicBeta) && NEED_BY_ID.has(need.id) && (
          <p className="mt-4">
            <Link to={needBookingHref(need.id)} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-blue-800 underline underline-offset-2 hover:text-blue-950" data-testid="rights-need-booking">
              <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />{t('rights:booking.link', 'Trouver où prendre rendez-vous pour ce besoin')}
            </Link>
          </p>
        )}
      </section>

      <section aria-labelledby="rights-next">
        <h2 id="rights-next" className="text-xl font-semibold text-slate-900">{t('rights:next.title', 'Que faire maintenant')}</h2>
        {need.actions.length > 0 && (
          <ul className="mt-3 space-y-3">
            {need.actions.map((a) => (
              <li key={a.text} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-slate-900" {...fr}>{a.text}</p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
                  <Certainty value={a.uncertainty} />
                  {a.sources.length > 0 && <span>{t('rights:next.source', 'Source :')} {a.sources.map((s) => `${s}`).join(', ')}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
        {need.omittedActions > 0 && (
          <p className="mt-3 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800" data-testid="rights-omitted">
            {t('rights:next.omitted', 'Les conditions pour obtenir une aide (âge, ressources, situation…) ne sont pas reprises ici tant qu’un expert ne les a pas relues : lisez-les sur la fiche officielle, l’organisme vous dira ce qui s’applique à vous.')}
          </p>
        )}
        {need.rules.map((r) => {
          const now = r.window ? inWindow(r.window) : true;
          return (
            <p key={r.text} className="mt-3 rounded-md bg-blue-50 p-3 text-sm text-slate-900" data-testid="rights-rule">
              <CalendarClock className="me-1.5 inline h-4 w-4 text-blue-800" aria-hidden="true" />
              <span className="font-semibold">{t('rights:next.rule', 'Règle officielle')}{now ? ` · ${t('rights:next.rule-now', 'en vigueur en ce moment')}` : ''} : </span>
              <span {...fr}>{r.text}</span> ({r.sheet})
            </p>
          );
        })}
        <ul className="mt-4 space-y-1">
          <li>
            <Link to={`/recherche?q=${encodeURIComponent(need.topic)}`} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-950" data-testid="rights-search-link">
              <RouteIcon className="h-4 w-4 shrink-0" aria-hidden="true" />{t('rights:next.search', 'Lieux, aides et démarches publiés pour ce besoin')}
            </Link>
          </li>
          {tools.map((tool) => {
            const host = new URL(tool.url).hostname.replace(/^www\./, '');
            return (
              <li key={tool.id}>
                <a href={tool.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-950" data-testid="rights-tool">
                  {toolText(tool, tShared).titre} ({host})<ExternalLink className="h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
                  <span className="sr-only">{t('rights:next.tool-new-tab', ' (service officiel, nouvel onglet)')}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="rights-where">
        <h2 id="rights-where" className="text-xl font-semibold text-slate-900">{t('rights:where.title', 'Où cela s’applique')}</h2>
        <p className="mt-1 text-slate-800">{t('rights:where.national', 'Les fiches de Service-Public décrivent les règles nationales, valables dans toute la France.')}</p>
        {need.aids.length > 0 && (
          <ul className="mt-3 space-y-2" data-testid="rights-aids">
            {need.aids.map((a) => {
              const terr = TERRITORIES[a.territory];
              const f = a.sheet ? FICHES.get(a.sheet) : null;
              return (
                <li key={a.id} className="rounded-md border border-slate-200 bg-white p-3" data-territory={a.territory}>
                  <span className="font-medium text-slate-900" {...fr}>{a.label}</span>
                  <span className="ms-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
                    {a.territory === 'FR' ? t('rights:where.everywhere', 'Partout en France') : t('rights:where.local', 'Seulement : {{territory}}', { territory: terr?.label ?? a.territory })}
                  </span>
                  {f && <span className="ms-2 text-sm text-slate-700">({t('rights:fiche.short', 'fiche {{id}}', { id: f.id })})</span>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-sm text-slate-800">
          {localAids.length
            ? t('rights:where.alsace-moselle-has', 'Une procédure de cette liste n’existe qu’en Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle), d’après la fiche officielle.')
            : t('rights:where.alsace-moselle', 'À Strasbourg et dans le reste de l’Alsace-Moselle, des règles locales peuvent s’ajouter : l’organisme vous le dira.')}
        </p>
      </section>
    </article>
  );
}

export default function Droits() {
  const { t } = useT('rights');
  const { need: needId } = useParams();
  const need = needId ? NEEDS.find((n) => n.id === needId) : null;
  const readDay = day(SOURCES_READ_AT);
  const title = need ? needLabel(need.id, t, need.label) : t('rights:title', 'Explorer les droits par besoin');
  return (
    <div>
      <SEO
        title={need ? t('rights:seo.need-title', '{{need}} — droits et démarches', { need: title }) : t('rights:seo.title', 'Explorer les droits par besoin')}
        description={t('rights:seo.description', 'Pour chaque besoin : les fiches officielles de Service-Public, l’organisme qui décide et les démarches possibles. Sans question, sans compte.')}
        path={need ? `/droits/${need.id}` : '/droits'}
      />
      <PageHeader eyebrow={need ? t('rights:title', 'Explorer les droits par besoin') : null} title={title} width="reading"
        description={need ? null : t('rights:intro', 'Choisissez un besoin : vous verrez les fiches officielles, qui décide et les démarches possibles.')} />
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
        <section aria-labelledby="rights-about" className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 text-slate-900" data-testid="rights-about">
          <h2 id="rights-about" className="flex items-center gap-2 text-base font-semibold"><Info className="h-5 w-5 shrink-0" aria-hidden="true" />{t('rights:about.title', 'Ce que cette page dit, et ce qu’elle ne dit pas')}</h2>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
            <li>{t('rights:about.decides', 'Elle ne dit pas si une aide vous est due : seul l’organisme concerné décide, après votre demande.')}</li>
            <li>{t('rights:about.conditions', 'Les conditions d’accès ne sont pas affichées tant qu’un expert ne les a pas relues : la fiche officielle les donne.')}</li>
            <li>{t('rights:about.nothing-sent', 'Aucune question, aucun compte : rien de ce que vous lisez ici n’est enregistré ni envoyé.')}</li>
            <li>{t('rights:about.fresh', 'Fiches relues dans l’archive officielle de Service-Public le {{date}}.', { date: readDay })}</li>
          </ul>
          <p className="mt-2 text-sm">{t('rights:about.help', 'Pour être accompagné : le CCAS de votre commune, une Maison des solidarités ou un espace France services.')}</p>
        </section>

        {needId && !need && (
          <section aria-labelledby="rights-unknown" data-testid="rights-unknown">
            <h2 id="rights-unknown" className="text-xl font-semibold text-slate-900">{t('rights:unknown.title', 'Ce besoin n’existe pas dans la liste')}</h2>
          </section>
        )}

        {need ? <NeedDetail need={need} /> : (
          <nav aria-labelledby="rights-needs-title">
            <h2 id="rights-needs-title" className="text-xl font-semibold text-slate-900">{t('rights:needs.title', 'Les besoins, du plus urgent au moins urgent')}</h2>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="rights-needs">
              {NEEDS.map((n) => (
                <li key={n.id}>
                  <Link to={`/droits/${n.id}`} className={`relative flex min-h-11 h-full items-center justify-between gap-2 overflow-hidden rounded-lg border bg-white py-2 pe-3 ps-4 text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${n.urgent ? 'border-red-300' : `border-slate-300 ${topicTone(n.id).hover}`}`} data-need={n.id}>
                    <ToneBar tone={n.urgent ? TONES.red : topicTone(n.id)} side="start" />
                    <span className="font-medium">{needLabel(n.id, t, n.label)}</span>
                    <span className="flex shrink-0 items-center gap-2 text-sm text-slate-700">
                      {n.urgent && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">{t('rights:needs.urgent', 'Urgent')}</span>}
                      <span>{t('rights:needs.fiches', { count: n.fiches.length, defaultValue_one: '{{count}} fiche', defaultValue_other: '{{count}} fiches' })}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {needId && (
          <p><Link to="/droits" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-950"><ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{t('rights:back', 'Tous les besoins')}</Link></p>
        )}
      </div>
    </div>
  );
}
