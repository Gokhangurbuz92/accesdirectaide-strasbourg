// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate } from '@/lib/monEspace';

/**
 * PKG-2 / C13 — Mon Espace (/compte): one page that says where the person stands — Mon Parcours, the next deadline and appointment, Mon Coffre, favourites and the dossiers
 * attached to the account — with a link to each. Everything comes from ONE server call scoped to the session (GET /api/citizen/espace).
 */
/** C13: message state from the server summary (no unread count exists: none is invented). */
function messagesText(m) {
  if (!m || !m.conversations) return 'Aucun échange avec une structure pour le moment.';
  const when = m.lastMessageAt ? new Date(m.lastMessageAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' }) : null;
  const base = `${m.conversations} conversation(s)`;
  if (!when) return `${base}, aucun message encore.`;
  return m.lastFromStructure ? `${base} — dernier message d’une structure le ${when} : pensez à le lire.` : `${base} — votre dernier message date du ${when}.`;
}

export default function MonEspace() {
  const [state, setState] = useState({ loading: true, error: '', summary: null });
  const load = async () => {
    setState((s) => ({ ...s, loading: !s.summary, error: '' }));
    try { setState({ loading: false, error: '', summary: await citizenApi.espace() }); }
    catch (err) { setState({ loading: false, error: err.status === 401 ? 'Connectez-vous pour accéder à Mon Espace.' : err.message, summary: null }); }
  };
  useEffect(() => { load(); }, []);

  if (state.loading) return <div className="container mx-auto max-w-4xl px-4 py-8" role="status">Chargement de Mon Espace…</div>;
  if (!state.summary) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8" data-testid="mon-espace-error">
        <SEO title="Mon Espace" noindex />
        <h1 className="mb-3 text-2xl font-bold text-slate-900">Mon Espace</h1>   {/* Q10 sweep: a heading in the failure state too */}
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error || 'Mon Espace est indisponible.'}</p>
        <div className="mt-4 flex gap-3"><Button onClick={load}>Réessayer</Button><Button asChild variant="outline"><Link to="/auth/login?next=/compte">Se connecter</Link></Button></div>
      </div>
    );
  }
  const s = state.summary;
  const tiles = [
    { to: '/compte/parcours', testid: 'tile-parcours', title: 'Mon Parcours', body: s.parcours.total ? `${s.parcours.open} étape(s) en cours sur ${s.parcours.total}` : 'Aucune étape suivie pour le moment.' },
    { to: '/compte/coffre', testid: 'tile-coffre', title: 'Mon Coffre', body: s.documents ? `${s.documents} document(s) protégé(s)` : 'Aucun document enregistré.' },
    { to: '/compte/favoris', testid: 'tile-favoris', title: 'Mes favoris', body: s.favorites ? `${s.favorites} fiche(s) gardée(s)` : 'Aucun favori.' },
    // R18: the profile has its own tile; the dossiers tile goes straight to the dossiers (it opened the top of the profile)
    { to: '/compte/profil', testid: 'tile-profil', title: 'Mon profil', body: 'Informations personnelles, foyer et notifications.' },
    { to: '/compte/profil#mes-dossiers', testid: 'tile-dossiers', title: 'Mes dossiers partagés', body: s.dossiers ? `${s.dossiers} dossier(s) rattaché(s) à votre compte` : 'Aucun dossier rattaché.' },
    { to: '/compte/orientations', testid: 'tile-orientations', title: 'Mes orientations', body: 'Propositions de transmission de votre dossier : rien n’est transmis sans votre accord.' },
    { to: '/compte/rendez-vous', testid: 'tile-rdv', title: 'Mes rendez-vous', body: s.nextAppointment ? `Prochain : ${new Date(s.nextAppointment.startAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'medium', timeStyle: 'short' })}` : 'Aucun rendez-vous à venir.' },
    { to: '/compte/messages', testid: 'tile-messages', title: 'Mes messages', body: messagesText(s.messages) },
    { to: '/compte/historique', testid: 'tile-historique', title: 'Mon historique', body: 'Facultatif : à activer si vous le souhaitez.' },
    { to: '/compte/delegations', testid: 'tile-delegations', title: 'Personnes de confiance', body: 'Donner ou consulter un accès en lecture seule, limité et révocable.' },
  ];
  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8" data-testid="mon-espace">
      <SEO title="Mon Espace" noindex />
      <h1 className="text-2xl font-bold text-slate-900">Mon Espace</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card data-testid="espace-next-due">
          <CardHeader><CardTitle className="text-base">Prochaine échéance</CardTitle></CardHeader>
          <CardContent className="text-sm text-slate-800">
            {s.parcours.nextDue ? <p><strong>{formatDate(s.parcours.nextDue.dueDate)}</strong> — {s.parcours.nextDue.title}</p> : <p>Aucune échéance enregistrée. Une échéance n’est ajoutée qu’avec sa source officielle.</p>}
          </CardContent>
        </Card>
        <Card data-testid="espace-next-appointment">
          <CardHeader><CardTitle className="text-base">Prochain rendez-vous</CardTitle></CardHeader>
          <CardContent className="text-sm text-slate-800">
            {s.nextAppointment ? <p><strong>{new Date(s.nextAppointment.startAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' })}</strong></p> : <p>Aucun rendez-vous à venir.</p>}
          </CardContent>
        </Card>
      </div>
      <nav aria-label="Rubriques de Mon Espace">
        <ul className="grid gap-4 sm:grid-cols-2">
          {tiles.map((t) => (
            <li key={t.to}>
              <Link to={t.to} data-testid={t.testid} className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                <span className="block text-base font-semibold text-slate-900">{t.title}</span>
                <span className="mt-1 block text-sm text-slate-700">{t.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
