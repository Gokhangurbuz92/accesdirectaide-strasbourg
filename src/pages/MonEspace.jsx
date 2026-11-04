// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useT } from '@/i18n';

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

export default function MonEspace() {
  const { t } = useT('compte');
  const [state, setState] = useState({ loading: true, error: '', summary: null });
  // R42: `t` is a dependency (it changes with the language), so the error message is never left in the previous language
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: !s.summary, error: '' }));
    try { setState({ loading: false, error: '', summary: await citizenApi.espace() }); }
    catch (err) { setState({ loading: false, error: err.status === 401 ? t('compte:space.login_required', 'Connectez-vous pour accéder à Mon Espace.') : err.message, summary: null }); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  if (state.loading) return <div className="container mx-auto max-w-4xl px-4 py-8" role="status">{t('compte:space.loading', 'Chargement de Mon Espace…')}</div>;
  if (!state.summary) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8" data-testid="mon-espace-error">
        <SEO title={t('compte:space.title', 'Mon Espace')} noindex />
        <h1 className="mb-3 text-2xl font-bold text-slate-900">{t('compte:space.title', 'Mon Espace')}</h1>   {/* Q10 sweep: a heading in the failure state too */}
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error || t('compte:space.unavailable', 'Mon Espace est indisponible.')}</p>
        <div className="mt-4 flex gap-3"><Button onClick={load}>{t('compte:common.retry', 'Réessayer')}</Button><Button asChild variant="outline"><Link to="/auth/login?next=/compte">{t('compte:common.sign_in', 'Se connecter')}</Link></Button></div>
      </div>
    );
  }
  const s = state.summary;
  const tiles = [
    { to: '/compte/parcours', testid: 'tile-parcours', title: t('compte:space.tile.parcours', 'Mon Parcours'), body: s.parcours.total ? t('compte:space.tile.parcours_body', '{{open}} étape(s) en cours sur {{total}}', { open: s.parcours.open, total: s.parcours.total }) : t('compte:space.tile.parcours_empty', 'Aucune étape suivie pour le moment.') },
    { to: '/compte/coffre', testid: 'tile-coffre', title: t('compte:space.tile.coffre', 'Mon Coffre'), body: s.documents ? t('compte:space.tile.coffre_body', '{{n}} document(s) protégé(s)', { n: s.documents }) : t('compte:space.tile.coffre_empty', 'Aucun document enregistré.') },
    { to: '/compte/favoris', testid: 'tile-favoris', title: t('compte:space.tile.favoris', 'Mes favoris'), body: s.favorites ? t('compte:space.tile.favoris_body', '{{n}} fiche(s) gardée(s)', { n: s.favorites }) : t('compte:space.tile.favoris_empty', 'Aucun favori.') },
    // R18: the profile has its own tile; the dossiers tile goes straight to the dossiers (it opened the top of the profile)
    { to: '/compte/profil', testid: 'tile-profil', title: t('compte:space.tile.profil', 'Mon profil'), body: t('compte:space.tile.profil_body', 'Informations personnelles, foyer et notifications.') },
    { to: '/compte/profil#mes-dossiers', testid: 'tile-dossiers', title: t('compte:space.tile.dossiers', 'Mes dossiers partagés'), body: s.dossiers ? t('compte:space.tile.dossiers_body', '{{n}} dossier(s) rattaché(s) à votre compte', { n: s.dossiers }) : t('compte:space.tile.dossiers_empty', 'Aucun dossier rattaché.') },
    { to: '/compte/orientations', testid: 'tile-orientations', title: t('compte:space.tile.orientations', 'Mes orientations'), body: t('compte:space.tile.orientations_body', 'Propositions de transmission de votre dossier : rien n’est transmis sans votre accord.') },
    { to: '/compte/rendez-vous', testid: 'tile-rdv', title: t('compte:space.tile.rdv', 'Mes rendez-vous'), body: s.nextAppointment ? t('compte:space.tile.rdv_next', 'Prochain : {{when}}', { when: formatDate(s.nextAppointment.startAt, { dateStyle: 'medium', timeStyle: 'short' }) }) : t('compte:space.no_appointment', 'Aucun rendez-vous à venir.') },
    { to: '/compte/messages', testid: 'tile-messages', title: t('compte:space.tile.messages', 'Mes messages'), body: messagesText(s.messages, t) },
    { to: '/compte/historique', testid: 'tile-historique', title: t('compte:space.tile.historique', 'Mon historique'), body: t('compte:space.tile.historique_body', 'Facultatif : à activer si vous le souhaitez.') },
    { to: '/compte/delegations', testid: 'tile-delegations', title: t('compte:space.tile.delegations', 'Personnes de confiance'), body: t('compte:space.tile.delegations_body', 'Donner ou consulter un accès en lecture seule, limité et révocable.') },
  ];
  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8" data-testid="mon-espace">
      <SEO title={t('compte:space.title', 'Mon Espace')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('compte:space.title', 'Mon Espace')}</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card data-testid="espace-next-due">
          <CardHeader><CardTitle className="text-base">{t('compte:space.next_due', 'Prochaine échéance')}</CardTitle></CardHeader>
          <CardContent className="text-sm text-slate-800">
            {s.parcours.nextDue ? <p><strong>{formatDate(s.parcours.nextDue.dueDate)}</strong> — {s.parcours.nextDue.title}</p> : <p>{t('compte:space.next_due_empty', 'Aucune échéance enregistrée. Une échéance n’est ajoutée qu’avec sa source officielle.')}</p>}
          </CardContent>
        </Card>
        <Card data-testid="espace-next-appointment">
          <CardHeader><CardTitle className="text-base">{t('compte:space.next_appointment', 'Prochain rendez-vous')}</CardTitle></CardHeader>
          <CardContent className="text-sm text-slate-800">
            {s.nextAppointment ? <p><strong>{formatDate(s.nextAppointment.startAt, { dateStyle: 'full', timeStyle: 'short' })}</strong></p> : <p>{t('compte:space.no_appointment', 'Aucun rendez-vous à venir.')}</p>}
          </CardContent>
        </Card>
      </div>
      <nav aria-label={t('compte:space.nav_label', 'Rubriques de Mon Espace')}>
        <ul className="grid gap-4 sm:grid-cols-2">
          {tiles.map((tile) => (
            <li key={tile.to}>
              <Link to={tile.to} data-testid={tile.testid} className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                <span className="block text-base font-semibold text-slate-900">{tile.title}</span>
                <span className="mt-1 block text-sm text-slate-700">{tile.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
