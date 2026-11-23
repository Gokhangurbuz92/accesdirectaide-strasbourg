// @ts-nocheck
import { useContext, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, CalendarCheck, ExternalLink, FileText, Info, ListPlus, MapPin, Phone, Search } from 'lucide-react';
import SEO from '@/components/SEO';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { frontendEnv } from '@/config/env';
import { formatDate, useLanguage, useT } from '@/i18n';
import { rdvMessagingClient } from '@/api/rdv-messaging-client';
import { citizenApi } from '@/lib/citizenApi';
import { bookingOpened, isBetaRestrictedPath, parcoursOpened } from '@/lib/publicBeta';
import { needLabel } from '@/lib/rightsPublicView';
import { NEED_BY_ID, needBookingHref, needName } from '@/lib/socialNeeds';
import { EMERGENCY_FICHE, EMERGENCY_NUMBERS, FAMILIES, SITUATIONS, SITUATION_BY_ID, directoryHref, searchSituations } from '@/lib/lifeSituations';
import { familyLabel, situationLabel } from '@/lib/situationLabels';
import SituationSignalOptIn from '@/components/observatoire/SituationSignalOptIn';
import { sendSituationSignal, situationSignalsOpened } from '@/lib/observatoire';
import serviceTerritory from '../../data/geography/service-territory.v1.json';

/**
 * G14-RG (owner approval 23/11/2026) — « Ma situation »: the one-door flow of the Rights Graph. A person picks a life situation, or writes a few words that
 * are matched IN THIS BROWSER (src/lib/lifeSituations.js: deterministic keywords of the six languages — no AI, no request, nothing stored or logged; the
 * text never enters the address), and gets on one page: the emergency numbers when the situation implies danger, the aides to CHECK (official fiches with
 * their dates — never « vous avez droit »: the body that receives the request decides), the démarches (Mon Parcours codes and official fiches), who can help
 * nearby (the directory filtered by type and commune: a link, so this page sends nothing), « Prendre rendez-vous » only where online booking is open in this
 * build (the directory's « Rendez-vous en ligne » filter), « Ajouter à Mon Parcours » only for codes of its closed list and only while Mon Parcours is open
 * and the person is signed in, and the link to « Vérifier mes droits » (/orientation) when that screen is open.
 * Owner decision C4: no D11 rule and no condition of access is shown; the official texts stay in French, marked lang="fr" dir="ltr".
 */

const COMMUNES = /** @type {[string, string][]} */ (serviceTerritory.communes);
const tel = (/** @type {string} */ n) => (n.length === 10 && n.startsWith('0') ? `${n.slice(0, 1)} ${n.slice(1, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}` : n);
const day = (/** @type {string | null} */ d) => (d ? formatDate(`${d}T12:00:00Z`) : '');
const linkClass = 'inline-flex min-h-11 items-center gap-1.5 font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-950';


/** the official fiche, with the date Service-Public last changed it and the date the archive was read */
function FicheLink({ fiche, fr }) {
  const { t } = useT('situation');
  return (
    <>
      <a href={fiche.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1.5 font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-950">
        <FileText className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
        <span {...fr}>{fiche.title || fiche.id}</span>
        <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
        <span className="sr-only">{t('situation:fiche.new-tab', '(service-public.gouv.fr, nouvel onglet)')}</span>
      </a>
      <p className="mt-1 text-sm text-slate-700" data-testid="situation-source">
        {t('situation:fiche.source', 'Source : fiche {{id}} de Service-Public, mise à jour le {{changed}}, relue le {{read}}.', { id: fiche.id, changed: day(fiche.modifiedAt), read: day(fiche.readAt) })}
      </p>
    </>
  );
}

/** is a citizen signed in — the header's session query (same key: no extra request), asked only while Mon Parcours is open */
function useSignedIn(open) {
  const auth = useQuery({ queryKey: ['header-auth-check'], queryFn: () => rdvMessagingClient.authMe(), staleTime: 60_000, retry: false, refetchOnWindowFocus: false, enabled: open });
  return open && auth.data?.session?.kind === 'user';
}

/** « Ajouter à Mon Parcours » for ONE code of the closed list: the server stores the code only (no text) */
function AddStepType({ code }) {
  const { t } = useT('situation');
  const [state, setState] = useState({ busy: false, done: '', error: '' });
  const add = async () => {
    setState({ busy: true, done: '', error: '' });
    try {
      const out = await citizenApi.parcours({ action: 'add', stepType: code });
      setState({ busy: false, done: out && out.added === false ? 'already' : 'added', error: '' });
    } catch (err) {
      setState({ busy: false, done: '', error: err?.message || t('situation:parcours.failed', 'La démarche n’a pas pu être ajoutée. Réessayez.') });
    }
  };
  return (
    <div className="mt-2" data-testid={`situation-parcours-${code}`}>
      <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={state.busy || Boolean(state.done)} onClick={add}>
        <ListPlus className="me-2 h-4 w-4 shrink-0" aria-hidden="true" />{t('situation:parcours.add', 'Ajouter à Mon Parcours')}
      </Button>
      <p role="status" aria-live="polite" className="mt-1 text-sm text-slate-800">
        {state.done ? (
          <>
            {state.done === 'already' ? t('situation:parcours.already', 'Cette démarche est déjà dans Mon Parcours.') : t('situation:parcours.added', 'Démarche ajoutée à Mon Parcours.')}{' '}
            <Link to="/compte/parcours" className="font-medium text-blue-800 underline">{t('situation:parcours.open', 'Ouvrir Mon Parcours')}</Link>
          </>
        ) : null}
      </p>
      {state.error ? <p role="alert" className="mt-1 text-sm text-red-800">{state.error}</p> : null}
    </div>
  );
}

function ParcoursGate({ children, fallback }) {
  const open = parcoursOpened(frontendEnv.flags.publicBeta);
  const signedIn = useSignedIn(open);
  if (!open) return null;
  return signedIn ? children : fallback;
}

/** the gate is only evaluated inside a query client (the app has one; a bare render shows nothing and asks nothing) */
function WithParcours({ children, fallback = null }) {
  const client = useContext(QueryClientContext);
  if (!client || !parcoursOpened(frontendEnv.flags.publicBeta)) return null;
  return <ParcoursGate fallback={fallback}>{children}</ParcoursGate>;
}

function Emergency({ numbers, fr }) {
  const { t } = useT('situation');
  return (
    <section aria-labelledby="situation-emergency" className="rounded-lg border-2 border-red-400 bg-red-50 p-4" data-testid="situation-emergency">
      <h2 id="situation-emergency" className="flex items-center gap-2 text-xl font-semibold text-red-950">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />{t('situation:emergency.title', 'En danger ? Appelez maintenant')}
      </h2>
      <p className="mt-1 text-red-950">{t('situation:emergency.body', 'Ces numéros sont gratuits. Quelqu’un vous répond.')}</p>
      <ul className="mt-2 space-y-1">
        {numbers.map((x) => (
          <li key={x} className="flex flex-wrap items-center gap-2">
            <Phone className="h-4 w-4 shrink-0 text-red-800" aria-hidden="true" />
            <a href={`tel:${x}`} className="inline-flex min-h-11 items-center text-lg font-bold text-red-900 underline" dir="ltr">{tel(x)}</a>
            <span {...fr}>{EMERGENCY_NUMBERS[x]}</span>
          </li>
        ))}
      </ul>
      {EMERGENCY_FICHE && <p className="mt-2 text-sm text-red-950">{t('situation:emergency.source', 'Source : fiche {{id}} de Service-Public.', { id: EMERGENCY_FICHE.id })}</p>}
    </section>
  );
}

function Result({ s }) {
  const { t } = useT('situation');
  const { isSource } = useLanguage();
  const fr = isSource ? {} : { lang: 'fr', dir: 'ltr' };
  const [commune, setCommune] = useState('');
  const communeId = useId();
  const beta = frontendEnv.flags.publicBeta;
  // G14 release 3: the situation's needs (subdomains of the 20 × 86 taxonomy) → the places that take appointments for each of them
  const bookingNeeds = (s.subdomains || []).filter((id) => NEED_BY_ID.has(id));
  const booking = bookingOpened(beta) && (s.structures.length > 0 || bookingNeeds.length > 0);
  const orientationOpen = !beta || !isBetaRestrictedPath('/orientation');
  const label = situationLabel(s.id, t);
  const stepCodes = s.steps.filter((x) => x.kind === 'stepType');
  return (
    <article aria-label={label} className="space-y-8" data-testid={`situation-result-${s.id}`}>
      {s.danger && s.emergency.length > 0 && <Emergency numbers={s.emergency} fr={fr} />}

      <section aria-labelledby="situation-rights">
        <h2 id="situation-rights" className="text-xl font-semibold text-slate-900">{t('situation:rights.title', 'Vos droits possibles (à vérifier)')}</h2>
        <p className="mt-1 text-slate-800">{t('situation:rights.intro', 'Vous pouvez vérifier si ces aides peuvent vous concerner. Lisez la fiche officielle. C’est l’organisme qui décide, après votre demande.')}</p>
        {s.rights.length ? (
          <ul className="mt-3 space-y-3" data-testid="situation-rights">
            {s.rights.map((f) => <li key={f.id} className="rounded-lg border border-slate-200 bg-white p-4" data-testid={`situation-right-${f.id}`}><FicheLink fiche={f} fr={fr} /></li>)}
          </ul>
        ) : (
          <p className="mt-2 rounded-md bg-slate-50 p-3 text-slate-800" data-testid="situation-rights-none">{t('situation:rights.none', 'Aucune aide n’est listée ici pour cette situation. Les démarches et les lieux ci-dessous peuvent vous aider.')}</p>
        )}
      </section>

      <section aria-labelledby="situation-steps">
        <h2 id="situation-steps" className="text-xl font-semibold text-slate-900">{t('situation:steps.title', 'Les démarches')}</h2>
        {s.steps.length === 0 && <p className="mt-2 rounded-md bg-slate-50 p-3 text-slate-800" data-testid="situation-steps-none">{t('situation:steps.none', 'Aucune démarche n’est listée ici pour cette situation. Les lieux ci-dessous peuvent vous aider à la faire.')}</p>}
        {s.steps.length > 0 && <ol className="mt-3 space-y-3" data-testid="situation-steps">
          {s.steps.map((st) => (st.kind === 'stepType' ? (
            <li key={st.code} className="rounded-lg border border-slate-200 bg-white p-4" data-step={st.code}>
              <p className="font-semibold text-slate-900">{t(`compte:parcours.type.${st.code}`, st.label)}</p>
              <ul className="mt-2 space-y-2">{st.sources.map((f) => <li key={f.id}><FicheLink fiche={f} fr={fr} /></li>)}</ul>
              <WithParcours><AddStepType code={st.code} /></WithParcours>
            </li>
          ) : (
            <li key={st.fiche.id} className="rounded-lg border border-slate-200 bg-white p-4" data-fiche={st.fiche.id}><FicheLink fiche={st.fiche} fr={fr} /></li>
          )))}
        </ol>}
        {stepCodes.length > 0 && (
          <WithParcours fallback={(
            <p className="mt-3 text-sm text-slate-800" data-testid="situation-parcours-signin">
              <Link to="/compte/parcours" className="font-medium text-blue-800 underline">{t('situation:parcours.signin', 'Connectez-vous pour garder ces démarches dans Mon Parcours.')}</Link>
            </p>
          )}>{null}</WithParcours>
        )}
      </section>

      <section aria-labelledby="situation-help">
        <h2 id="situation-help" className="text-xl font-semibold text-slate-900">{t('situation:help.title', 'Qui peut vous aider près de chez vous')}</h2>
        {s.bodies.length > 0 && (
          <>
            <p className="mt-1 text-slate-800">{t('situation:help.bodies', 'Les organismes qui décident ou qui informent :')}</p>
            <ul className="mt-2 flex flex-wrap gap-2" data-testid="situation-bodies">
              {s.bodies.map((b) => <li key={b.id} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"><Building2 className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" /><span {...fr}>{b.label}</span></li>)}
            </ul>
          </>
        )}
        {s.structures.length > 0 ? (
          <>
            <div className="mt-4">
              <label htmlFor={communeId} className="block text-sm font-medium text-slate-900">{t('situation:help.commune', 'Votre commune (facultatif)')}</label>
              <select id={communeId} data-testid="situation-commune" className="mt-1 min-h-11 w-full max-w-sm rounded-md border border-slate-400 bg-white p-2 text-slate-900" value={commune} onChange={(e) => setCommune(e.target.value)}>
                <option value="">{t('situation:help.commune-all', 'Toute l’Eurométropole')}</option>
                {COMMUNES.map(([code, name]) => <option key={code} value={name}>{name}</option>)}
              </select>
              <p className="mt-1 text-sm text-slate-700">{t('situation:help.commune-note', 'Ce choix reste sur votre appareil. Il sert seulement à préparer les liens vers l’annuaire.')}</p>
            </div>
            <ul className="mt-3 space-y-1" data-testid="situation-structures">
              {s.structures.map((type) => (
                <li key={type}>
                  <Link to={directoryHref(type, commune)} className={linkClass}>
                    <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" /><span {...fr}>{type}</span>
                    <span className="sr-only">{t('situation:help.link', ' : voir les lieux dans l’annuaire')}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-slate-700">{t('situation:help.listing', 'L’annuaire montre des lieux publiés. Un lieu listé ne garantit pas une place ou un rendez-vous.')}</p>
          </>
        ) : (
          <p className="mt-2 text-slate-800">{t('situation:help.none', 'Pour cette situation, appelez d’abord les numéros ci-dessus.')}</p>
        )}
      </section>

      {booking && (
        <section aria-labelledby="situation-booking" data-testid="situation-booking">
          <h2 id="situation-booking" className="text-xl font-semibold text-slate-900">{t('situation:booking.title', 'Prendre rendez-vous')}</h2>
          <p className="mt-1 text-slate-800">{t('situation:booking.intro', 'Ces liens montrent seulement les lieux où vous pouvez demander un rendez-vous en ligne.')}</p>
          <ul className="mt-2 space-y-1">
            {s.structures.map((type) => (
              <li key={type}>
                <Link to={directoryHref(type, commune, true)} className={linkClass}>
                  <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden="true" /><span {...fr}>{type}</span>
                  <span className="sr-only">{t('situation:booking.link', ' : lieux avec rendez-vous en ligne')}</span>
                </Link>
              </li>
            ))}
          </ul>
          {bookingNeeds.length > 0 && (
            <>
              <h3 className="mt-3 text-base font-semibold text-slate-900">{t('situation:booking.needs_title', 'Par besoin')}</h3>
              <ul className="mt-1 space-y-1" data-testid="situation-booking-needs">
                {bookingNeeds.map((id) => (
                  <li key={id}>
                    <Link to={needBookingHref(id)} className={linkClass}>
                      <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{needName(t, id)}</span>
                      <span className="sr-only">{t('situation:booking.need_link', ' : lieux où prendre rendez-vous pour ce besoin')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="situation-more">
        <h2 id="situation-more" className="text-xl font-semibold text-slate-900">{t('situation:more.title', 'Aller plus loin')}</h2>
        <ul className="mt-2 space-y-1">
          {orientationOpen && (
            <li><Link to="/orientation" className={linkClass} data-testid="situation-orientation"><ArrowRight className="h-4 w-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />{t('situation:more.orientation', 'Vérifier mes droits (questionnaire, sans compte)')}</Link></li>
          )}
          {s.needs.map((n) => (
            <li key={n.id}><Link to={`/droits/${n.id}`} className={linkClass}><ArrowRight className="h-4 w-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />{t('situation:more.need', 'Fiches officielles : {{need}}', { need: needLabel(n.id, t, n.label) })}</Link></li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function Finder({ onChoose }) {
  const { t } = useT('situation');
  const [text, setText] = useState('');
  const [hits, setHits] = useState(null);
  const inputId = useId();
  const submit = (e) => { e.preventDefault(); setHits(searchSituations(text, (id) => situationLabel(id, t))); };
  return (
    <section aria-labelledby="situation-finder" className="rounded-lg border border-slate-200 bg-white p-4" data-testid="situation-finder">
      <h2 id="situation-finder" className="text-xl font-semibold text-slate-900">{t('situation:finder.title', 'Dites-le avec vos mots')}</h2>
      <form role="search" onSubmit={submit} className="mt-2" autoComplete="off">
        <label htmlFor={inputId} className="block text-slate-900">{t('situation:finder.label', 'Votre situation en quelques mots')}</label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input id={inputId} type="text" data-testid="situation-text" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false}
            placeholder={t('situation:finder.example', 'Exemple : je n’arrive plus à payer mon loyer')} className="min-h-11 flex-1 rounded-md border border-slate-400 bg-white px-3 text-slate-900" />
          <Button type="submit" className="min-h-11" data-testid="situation-find"><Search className="me-2 h-4 w-4" aria-hidden="true" />{t('situation:finder.submit', 'Trouver')}</Button>
        </div>
        <p className="mt-1 text-sm text-slate-700">{t('situation:finder.private', 'Ce que vous écrivez reste sur votre appareil. Rien n’est envoyé ni enregistré.')}</p>
      </form>
      <div role="status" aria-live="polite" className="mt-3" data-testid="situation-hits">
        {hits && (hits.length ? (
          <>
            <p className="font-medium text-slate-900">{t('situation:finder.found', 'Cela ressemble peut-être à :')}</p>
            <ul className="mt-1 space-y-1">
              {hits.map((h) => (
                <li key={h.id}>
                  <Link to={`/situation/${h.id}`} className={`${linkClass} ${h.danger ? 'text-red-900' : ''}`} data-situation={h.id} onClick={() => onChoose(h.id)}>
                    {h.danger && <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />}{situationLabel(h.id, t)}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : <p className="text-slate-800">{t('situation:finder.none', 'Nous n’avons pas reconnu votre situation. Choisissez dans la liste ci-dessous.')}</p>)}
      </div>
    </section>
  );
}

export default function Situation() {
  const { t } = useT('situation');
  const { id } = useParams();
  const s = id ? SITUATION_BY_ID.get(id) : null;
  const title = s ? situationLabel(s.id, t) : t('situation:title', 'Ma situation : par où commencer ?');
  // G14-OBS: the opt-in counter — unticked by default, kept in this page's memory only; the chosen situation's id is sent only when ticked
  const [optIn, setOptIn] = useState(false);
  const choose = (/** @type {string} */ sid) => { sendSituationSignal(sid, { optedIn: optIn }); };
  const signalsOpen = situationSignalsOpened();
  return (
    <div>
      <SEO title={s ? t('situation:seo.item', '{{situation}} — aides, démarches, lieux', { situation: title }) : t('situation:seo.title', 'Ma situation : par où commencer ?')}
        description={t('situation:seo.description', 'Choisissez votre situation : les aides à vérifier, les démarches et les lieux qui peuvent vous aider. Sans compte.')} path={s ? `/situation/${s.id}` : '/situation'} />
      <PageHeader eyebrow={s ? t('situation:title', 'Ma situation : par où commencer ?') : null} title={title} width="reading"
        description={s ? null : t('situation:intro', 'Choisissez ce qui vous arrive. Vous verrez sur une seule page les aides à vérifier, les démarches et les lieux près de chez vous.')} />
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
        <section aria-labelledby="situation-about" className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 text-slate-900" data-testid="situation-about">
          <h2 id="situation-about" className="flex items-center gap-2 text-base font-semibold"><Info className="h-5 w-5 shrink-0" aria-hidden="true" />{t('situation:about.title', 'À savoir')}</h2>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
            <li>{t('situation:about.decides', 'Cette page ne dit pas si une aide vous est due. L’organisme décide, après votre demande.')}</li>
            <li>{t('situation:about.sources', 'Chaque aide et chaque démarche renvoie à une fiche officielle, avec sa date.')}</li>
            <li>{signalsOpen
              ? t('situation:about.nothing-sent-optin', 'Pas de compte. Rien de ce que vous écrivez ici n’est envoyé. La situation choisie est envoyée, sans votre nom, seulement si vous cochez la case.')
              : t('situation:about.nothing-sent', 'Pas de compte. Rien de ce que vous choisissez ou écrivez ici n’est envoyé ni enregistré.')}</li>
          </ul>
        </section>

        {id && !s && (
          <section aria-labelledby="situation-unknown" data-testid="situation-unknown">
            <h2 id="situation-unknown" className="text-xl font-semibold text-slate-900">{t('situation:unknown', 'Cette situation n’est pas dans la liste')}</h2>
          </section>
        )}

        {s ? <Result s={s} /> : (
          <>
            <section aria-labelledby="situation-urgent-title" className="rounded-lg border-2 border-red-300 bg-white p-4" data-testid="situation-urgent">
              <h2 id="situation-urgent-title" className="flex items-center gap-2 text-xl font-semibold text-red-950"><AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />{t('situation:urgent.title', 'En danger maintenant ?')}</h2>
              <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SITUATIONS.filter((x) => x.danger).map((x) => (
                  <li key={x.id}><Link to={`/situation/${x.id}`} data-situation={x.id} className={`${linkClass} text-red-900`} onClick={() => choose(x.id)}>{situationLabel(x.id, t)}</Link></li>
                ))}
              </ul>
            </section>
            <SituationSignalOptIn checked={optIn} onChange={setOptIn} opened={signalsOpen} />
            <Finder onChoose={choose} />
            <nav aria-labelledby="situation-list-title" data-testid="situation-list">
              <h2 id="situation-list-title" className="text-xl font-semibold text-slate-900">{t('situation:list.title', 'Ou choisissez votre situation')}</h2>
              <p className="mt-1 text-slate-800">{t('situation:list.families', 'Les situations sont rangées par thème :')}</p>
              <ul className="mt-2 flex flex-wrap gap-2" data-testid="situation-families">
                {FAMILIES.map((f) => (
                  <li key={f}><a href={`#famille-${f}`} className="inline-flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-blue-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">{familyLabel(f, t)}</a></li>
                ))}
              </ul>
              {FAMILIES.map((f) => (
                <section key={f} id={`famille-${f}`} aria-labelledby={`famille-${f}-title`} className="mt-6 scroll-mt-24" data-family={f}>
                  <h3 id={`famille-${f}-title`} className="text-lg font-semibold text-slate-900">{familyLabel(f, t)}</h3>
                  <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SITUATIONS.filter((x) => x.family === f).map((x) => (
                      <li key={x.id}>
                        <Link to={`/situation/${x.id}`} data-situation={x.id} onClick={() => choose(x.id)}
                          className={`flex min-h-11 h-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${x.danger ? 'border-red-300' : 'border-slate-300'}`}>
                          <span>{situationLabel(x.id, t)}</span>
                          {x.danger && <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">{t('situation:list.urgent', 'Urgent')}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </nav>
          </>
        )}

        {id && (
          <p><Link to="/situation" className={linkClass}><ArrowLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{t('situation:back', 'Toutes les situations')}</Link></p>
        )}
      </div>
    </div>
  );
}
