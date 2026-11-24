// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import InstallApp from '@/components/pwa/InstallApp';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Archive, Bell, BookOpen, CalendarClock, CalendarDays, Compass, FolderOpen, Gavel, HandHelping, History, Lock, MessageSquare, Route, Scale, Share2,
  Star, UserRound, Users,
} from 'lucide-react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useT } from '@/i18n';
import { frontendEnv } from '@/config/env';
import { openLinks } from '@/lib/publicBeta';
import { passeportLocalEnabled } from '@/lib/passeport/flag';
import NotificationCenter from '@/components/account/NotificationCenter';
import FindAndBook from '@/components/account/FindAndBook';
import TermsChangeNotice from '@/components/account/TermsChangeNotice';
import { ToneIcon } from '@/components/ui/Tone';
import { sectionTone } from '@/design/categoryTone';
import { cn } from '@/lib/utils';

/**
 * PKG-2 / C13 — Mon Espace (/compte): one page that says where the person stands — Mon Parcours, the next deadline and appointment, Mon Coffre, favourites and the dossiers
 * attached to the account — with a link to each. Everything comes from ONE server call scoped to the session (GET /api/citizen/espace).
 */
/** C13: message state from the server summary (no unread count exists: none is invented). */
function messagesText(m, t) {
  if (!m || !m.conversations) return t('compte:space.messages.none', 'Aucun échange avec une structure pour le moment.');
  const when = m.lastMessageAt ? formatDate(m.lastMessageAt, { day: 'numeric', month: 'long' }) : null;
  const n = m.conversations;
  if (!when) return t('compte:space.messages.no_message', '{{n}} conversation(s), aucun message encore.', { n });
  return m.lastFromStructure
    ? t('compte:space.messages.from_structure', '{{n}} conversation(s) — dernier message d’une structure le {{when}} : pensez à le lire.', { n, when })
    : t('compte:space.messages.from_you', '{{n}} conversation(s) — votre dernier message date du {{when}}.', { n, when });
}

/** UI modernisation: one icon per rubric (decorative, aria-hidden) — the title stays the accessible name */
const TILE_ICONS = {
  'tile-parcours': Route, 'tile-coffre': Lock, 'tile-favoris': Star, 'tile-profil': UserRound, 'tile-dossiers': FolderOpen, 'tile-orientations': Share2,
  'tile-rdv': CalendarDays, 'tile-messages': MessageSquare, 'tile-historique': History, 'tile-delegations': Users, 'tile-accompagnement': HandHelping,
  'tile-protection-juridique': Scale, 'tile-moderation': Gavel, 'tile-situation': Compass, 'tile-orientations-sociales': Share2, 'tile-passeport': Archive, 'tile-guide': BookOpen,
};
/** colour system (src/design/categoryTone.js): each rubric takes its section colour, the same as in its page header */
const TILE_SECTION = {
  'tile-parcours': 'parcours', 'tile-coffre': 'coffre', 'tile-favoris': 'favoris', 'tile-profil': 'profil', 'tile-dossiers': 'dossiers', 'tile-orientations': 'orientations',
  'tile-rdv': 'rendez-vous', 'tile-messages': 'messages', 'tile-historique': 'historique', 'tile-delegations': 'confiance', 'tile-accompagnement': 'accompagnant',
  'tile-protection-juridique': 'protection', 'tile-moderation': 'moderation', 'tile-situation': 'situation', 'tile-orientations-sociales': 'orientations', 'tile-passeport': 'coffre', 'tile-guide': 'guide',
};
/** the page frame shared by every state of the page (loading, error, content): wide enough to use a desktop, a readable gutter on a phone */
const FRAME = 'mx-auto w-full max-w-6xl px-[var(--ada-gutter)] py-8 sm:py-10';

export default function MonEspace() {
  const { t } = useT('compte');
  const [state, setState] = useState({ loading: true, error: '', summary: null, auth: false });
  const headingRef = useRef(null);
  // R42: `t` is a dependency (it changes with the language), so the error message is never left in the previous language
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: !s.summary, error: '' }));
    try { setState({ loading: false, error: '', summary: await citizenApi.espace(), auth: false }); }
    catch (err) { setState({ loading: false, error: err.status === 401 ? t('compte:space.login_required', 'Connectez-vous pour accéder à Mon Espace.') : err.message, summary: null, auth: err.status === 401 }); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  // G14-LITE: the loading state is a screen tall (like Mon Parcours), so the footer does not jump when the page arrives (CLS)
  if (state.loading) return <div className="mx-auto min-h-screen w-full max-w-6xl px-[var(--ada-gutter)] py-8 text-ada-ink-2 sm:py-10" role="status">{t('compte:space.loading', 'Chargement de Mon Espace…')}</div>;
  if (!state.summary) {
    return (
      <div className={FRAME} data-testid="mon-espace-error">
        <SEO title={t('compte:space.title', 'Mon Espace')} noindex />
        <h1 className="mb-3 text-3xl font-bold text-ada-ink">{t('compte:space.title', 'Mon Espace')}</h1>   {/* Q10 sweep: a heading in the failure state too */}
        {state.auth
          ? <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-900" data-testid="mon-espace-login-required">{state.error}</p>
          : <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error || t('compte:space.unavailable', 'Mon Espace est indisponible.')}</p>}
        {/* R3H (live audit 24/11/2026): a visitor without a session saw a red error and « Réessayer », which can never succeed; like Mes rendez-vous (R18) and
            Mon Parcours, a missing session (401) offers « Se connecter » only, any other failure « Réessayer » */}
        <div className="mt-4 flex gap-3">{state.auth
          ? <Button asChild><Link to="/auth/login?next=/compte" data-testid="mon-espace-sign-in">{t('compte:common.sign_in', 'Se connecter')}</Link></Button>
          : <Button onClick={load} data-testid="mon-espace-retry">{t('compte:common.retry', 'Réessayer')}</Button>}</div>
      </div>
    );
  }
  const s = state.summary;
  const tiles = [
    { to: '/compte/parcours', testid: 'tile-parcours', part: 'parcours', title: t('compte:space.tile.parcours', 'Mon Parcours'), body: s.parcours?.total ? t('compte:space.tile.parcours_body', '{{open}} étape(s) en cours sur {{total}}', { open: s.parcours.open, total: s.parcours.total }) : t('compte:space.tile.parcours_empty', 'Aucune étape suivie pour le moment.') },
    { to: '/compte/coffre', testid: 'tile-coffre', part: 'documents', title: t('compte:space.tile.coffre', 'Mon Coffre'), body: s.documents ? t('compte:space.tile.coffre_body', '{{n}} document(s) protégé(s)', { n: s.documents }) : t('compte:space.tile.coffre_empty', 'Aucun document enregistré.') },
    { to: '/compte/favoris', testid: 'tile-favoris', part: 'favorites', title: t('compte:space.tile.favoris', 'Mes favoris'), body: s.favorites ? t('compte:space.tile.favoris_body', '{{n}} fiche(s) gardée(s)', { n: s.favorites }) : t('compte:space.tile.favoris_empty', 'Aucun favori.') },
    // R18: the profile has its own tile; the dossiers tile goes straight to the dossiers (it opened the top of the profile)
    { to: '/compte/profil', testid: 'tile-profil', title: t('compte:space.tile.profil', 'Mon profil'), body: t('compte:space.tile.profil_body', 'Informations personnelles, foyer et notifications.') },
    { to: '/compte/profil#mes-dossiers', testid: 'tile-dossiers', part: 'dossiers', title: t('compte:space.tile.dossiers', 'Mes dossiers partagés'), body: s.dossiers ? t('compte:space.tile.dossiers_body', '{{n}} dossier(s) rattaché(s) à votre compte', { n: s.dossiers }) : t('compte:space.tile.dossiers_empty', 'Aucun dossier rattaché.') },
    { to: '/compte/orientations', testid: 'tile-orientations', title: t('compte:space.tile.orientations', 'Mes orientations'), body: t('compte:space.tile.orientations_body', 'Propositions de transmission de votre dossier : rien n’est transmis sans votre accord.') },
    { to: '/compte/rendez-vous', testid: 'tile-rdv', part: 'nextAppointment', title: t('compte:space.tile.rdv', 'Mes rendez-vous'), body: s.nextAppointment ? t('compte:space.tile.rdv_next', 'Prochain : {{when}}', { when: formatDate(s.nextAppointment.startAt, { dateStyle: 'medium', timeStyle: 'short' }) }) : t('compte:space.no_appointment', 'Aucun rendez-vous à venir.') },
    { to: '/compte/messages', testid: 'tile-messages', part: 'messages', title: t('compte:space.tile.messages', 'Mes messages'), body: messagesText(s.messages, t) },
    { to: '/compte/historique', testid: 'tile-historique', title: t('compte:space.tile.historique', 'Mon historique'), body: t('compte:space.tile.historique_body', 'Facultatif : à activer si vous le souhaitez.') },
    { to: '/compte/delegations', testid: 'tile-delegations', title: t('compte:space.tile.delegations', 'Personnes de confiance'), body: t('compte:space.tile.delegations_body', 'Donner ou consulter un accès en lecture seule, limité et révocable.') },
    { to: '/compte/accompagnement', testid: 'tile-accompagnement', title: t('compte:space.tile.accompagnement', 'Mode accompagnant'), body: t('compte:space.tile.accompagnement_body', 'Se faire aider, à côté de vous, pendant 2 heures au plus.') },   // G14-AID
    // G14-R3G: tutelle, curatelle, habilitation familiale, mandat spécial — the protected person and the representative (accounts extra « legal_protection »)
    { to: '/compte/protection-juridique', testid: 'tile-protection-juridique', title: t('legalprotection:tile.title', 'Protection juridique'), body: t('legalprotection:tile.body', 'Tutelle, curatelle, habilitation familiale : voir qui vous représente, ou déclarer la personne que vous protégez.') },
    // G14 / DSA art. 17, 20: statements of reasons and appeals (surface « notices »: hidden by openLinks while it is closed)
    { to: '/compte/moderation', testid: 'tile-moderation', title: t('compte:space.tile.moderation', 'Décisions de modération'), body: t('compte:space.tile.moderation_body', 'Décisions sur vos contenus ou vos signalements, et contestations.') },
    // G14-RG: « Ma situation » (public, no account needed) — offered here too
    { to: '/situation', testid: 'tile-situation', public: true, title: t('compte:space.tile.situation', 'Ma situation'), body: t('compte:space.tile.situation_body', 'Aides à vérifier, démarches et lieux, selon ce qui vous arrive.') },
    // G14-PS: the social referrals (surface « social_referrals »: hidden by openLinks while it is closed)
    { to: '/compte/orientations-sociales', testid: 'tile-orientations-sociales', title: t('compte:space.tile.orientations_sociales', 'Mes orientations sociales'), body: t('compte:space.tile.orientations_sociales_body', 'Propositions d’une structure de vous orienter vers une autre : rien n’est transmis sans votre accord.') },
    // G14-PS: the Passeport Social is browser-only, offered only when the build sets VITE_PASSEPORT_SOCIAL=local
    // 24/11/2026: the user guide (static help, open with the accounts in every scope); `public` so it does not count as an account screen for « Pour commencer »
    { to: '/compte/guide', testid: 'tile-guide', public: true, title: t('compte:space.tile.guide', 'Guide d’utilisation'), body: t('compte:space.tile.guide_body', 'Comment utiliser chaque rubrique, pas à pas.') },
    ...(passeportLocalEnabled() ? [{ to: '/passeport-social', testid: 'tile-passeport', title: t('compte:space.tile.passeport', 'Passeport Social'), body: t('compte:space.tile.passeport_body', 'Vos documents et votre résumé, chiffrés sur cet appareil seulement.') }] : []),
  ];
  // R43 (E2): during the beta, a tile of a screen this build keeps closed (narrow accounts scope) is not offered
  // R45 (ENG-LR-6): a part the server did not return (its capability is closed) has no tile
  const visibleTiles = openLinks(tiles.filter((tile) => !tile.part || Object.prototype.hasOwnProperty.call(s, tile.part)), frontendEnv.flags.publicBeta, (tile) => tile.to);
  const statusCards = (
    <>
      {s.parcours ? (<Card data-testid="espace-next-due">
        <CardHeader className="flex-row items-center gap-3 space-y-0 pb-3">
          <ToneIcon tone={sectionTone('parcours')} icon={CalendarClock} className="h-9 w-9 rounded-lg" />
          <CardTitle className="text-base">{t('compte:space.next_due', 'Prochaine échéance')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-ada-ink-2">
          {s.parcours?.nextDue ? <p><strong className="text-ada-ink">{formatDate(s.parcours.nextDue.dueDate)}</strong> — {s.parcours.nextDue.title}</p> : <p>{t('compte:space.next_due_empty', 'Aucune échéance enregistrée. Une échéance n’est ajoutée qu’avec sa source officielle.')}</p>}
        </CardContent>
      </Card>) : null}
      {'nextAppointment' in s ? (<Card data-testid="espace-next-appointment">
        <CardHeader className="flex-row items-center gap-3 space-y-0 pb-3">
          <ToneIcon tone={sectionTone('rendez-vous')} icon={CalendarDays} className="h-9 w-9 rounded-lg" />
          <CardTitle className="text-base">{t('compte:space.next_appointment', 'Prochain rendez-vous')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-ada-ink-2">
          {s.nextAppointment ? <p><strong className="text-ada-ink">{formatDate(s.nextAppointment.startAt, { dateStyle: 'full', timeStyle: 'short' })}</strong></p> : <p>{t('compte:space.no_appointment', 'Aucun rendez-vous à venir.')}</p>}
        </CardContent>
      </Card>) : null}
    </>
  );
  // UI modernisation (24/11/2026): a two-column dashboard from 1024 px (search and quick links | where I stand: deadlines, appointment, notifications),
  // then the rubrics as equal cards (1 → 2 → 3 → 4 columns). On a foldable held open, the two columns sit on either side of the hinge (.ada-fold-split).
  return (
    <div className={FRAME} data-testid="mon-espace">
      <SEO title={t('compte:space.title', 'Mon Espace')} noindex />
      <header className="mb-6 sm:mb-8">
        <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold tracking-tight text-ada-ink focus:outline-none sm:text-4xl">{t('compte:space.title', 'Mon Espace')}</h1>
        <p className="mt-2 max-w-prose text-base text-ada-ink-3">{t('compte:space.subtitle', 'Vos démarches, vos rendez-vous et vos documents, au même endroit.')}</p>
        <Link to="/compte/guide" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ada-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bt-accent rounded" data-testid="mon-espace-guide"><BookOpen className="h-4 w-4" aria-hidden="true" />{t('compte:space.guide_link', 'Comment utiliser Mon Espace ? Voir le guide')}</Link>
      </header>
      <div className="space-y-6">
        {/* Release 3 (owner 24/11/2026): the account holders are told here that the citizen terms changed — once, only when the build puts them in force */}
        <TermsChangeNotice focusAfterDismiss={() => headingRef.current?.focus()} />
        <div className="ada-fold-split grid gap-6 lg:grid-cols-3 lg:items-start">
          {/* G14-FIND: « find and book » first — the page was empty in the restricted beta (every tile closed): now a real search and open screens */}
          <div className="lg:col-span-2">
            <FindAndBook showGuide={visibleTiles.every((tile) => tile.public)} />   {/* the guide while no account screen is open (a public tile such as « Ma situation » does not count) */}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {statusCards}
            <div className="sm:col-span-2 lg:col-span-1"><NotificationCenter /></div>
          </div>
        </div>
        {visibleTiles.length > 0 && <nav aria-labelledby="mon-espace-rubriques">
          <h2 id="mon-espace-rubriques" className="mb-4 mt-4 text-xl font-bold text-ada-ink">{t('compte:space.nav_label', 'Rubriques de Mon Espace')}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visibleTiles.map((tile) => {
              const Icon = TILE_ICONS[tile.testid] || Bell;
              const tone = sectionTone(TILE_SECTION[tile.testid]);
              return (
                <li key={tile.to} className="flex">
                  <Link to={tile.to} data-testid={tile.testid} className={cn('ada-tile group', tone.hover)}>
                    <ToneIcon tone={tone} icon={Icon} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold text-ada-ink group-hover:underline group-hover:underline-offset-2">{tile.title}</span>
                      <span className="mt-1 block text-sm text-ada-ink-3">{tile.body}</span>
                    </span>
                    <ArrowRight className="rtl-flip mt-1 h-4 w-4 shrink-0 text-ada-link" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>}
        {/* 24/11/2026: install Mon Espace as an app on this phone / computer */}
        <div className="mt-8 max-w-2xl"><InstallApp /></div>
      </div>
    </div>
  );
}
