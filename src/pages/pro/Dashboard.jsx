// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback } from 'react';
import { useOutletContext, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { proRdvRequest } from '@/api/pro-rdv-client';
import {
    Calendar,
    Users,
    Building2,
    MessageCircle,
    Video,
    Clock,
    ChevronRight,
    ShieldCheck,
    Plus,
    ExternalLink,
    CheckCircle2,
    Loader2,
} from 'lucide-react';
import { proRole } from '@/lib/proLabels.js';

/**
 * ProDashboard — Hub central de l'Espace Professionnel
 *
 * Affiche :
 * - Prochains RDV avec lancement visio
 * - Équipe en ligne (aperçu)
 * - Protection des échanges (chiffrement à l’enregistrement, pas de bout en bout)
 * - Bouton synchronisation Outlook
 */
export default function ProDashboard() {
    const { user } = useOutletContext();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [appointments, setAppointments] = useState([]);
    const [teamMembers, setTeamMembers] = useState([]);
    const [structure, setStructure] = useState(null);   // owner usefulness pass: the real state of the structure (it was a hard-coded « Actif »)
    const [teamAccess, setTeamAccess] = useState('loading');   // R18: 'ok' | 'admins' (the team is managed by admins: a PRO member gets 403) | 'error'
    const [loading, setLoading] = useState(true);
    // PKG-11 audit pass 2: the Outlook state comes from the server (it used to follow any ?outlook=connected in the address)
    const [outlook, setOutlook] = useState({ status: 'unknown', message: '' });
    const outlookConnected = outlook.status === 'connected';
    const outlookOff = ['not_configured', 'disabled'].includes(outlook.status);
    // PKG-4 / R03: the work queue (the same server rules as the Dossiers suivis / Orientations screens; counts only, no dossier content)
    const [queue, setQueue] = useState({ loading: true, error: '', mine: null, unassigned: null, toHandle: null, overdue: null });
    useEffect(() => {
        let alive = true;
        Promise.all([proRdvRequest('/api/pro/cases', { query: { scope: 'mine' } }), proRdvRequest('/api/pro/referrals', { query: { box: 'inbox' } })])
            .then(([cases, refs]) => {
                if (!alive) return;
                const open = (refs.referrals || []).filter((r) => ['SENT', 'ACKNOWLEDGED', 'NEEDS_INFO'].includes(r.status));
                setQueue({ loading: false, error: '', mine: cases.counts?.mine ?? 0, unassigned: cases.counts?.unassigned ?? 0, toHandle: open.length, overdue: open.filter((r) => r.overdue).length });
            })
            .catch((e) => alive && setQueue((q) => ({ ...q, loading: false,
                // R18: an organization not (or no longer) activated by ADA has no work queue yet — said as such, not as an outage
                error: e?.status === 403 ? 'La file de travail s’ouvrira quand ADA aura activé votre structure (voir « Ma structure »).' : 'File de travail indisponible.' })));
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        let alive = true;
        proRdvRequest('/api/pro/outlook', { query: { action: 'status' } })
            .then((d) => { if (alive) setOutlook({ status: d?.ok === false ? (d.status || 'not_configured') : (d?.status || 'not_connected'), message: d?.message || '' }); })
            .catch(() => { if (alive) setOutlook({ status: 'unknown', message: '' }); });
        return () => { alive = false; };
    }, [searchParams]);

    const fetchDashboardData = useCallback(async () => {
        setLoading(true);
        const token = localStorage.getItem('pro_token');
        const headers = { Authorization: `Bearer ${token}` };

        try {
            // Fetch upcoming appointments
            // owner usefulness pass (2026-10-25): « à venir » = from now on, every active status (citizen bookings are 'confirmed', structure-created ones
            // 'booked'); the query asked for 'booked' only, oldest first and with no date, so citizen bookings never showed and past ones counted as « à venir »
            const [apptRes, teamRes, structRes] = await Promise.allSettled([
                fetch(`/api/pro/appointments?limit=20&from=${encodeURIComponent(new Date().toISOString())}`, { headers }),
                fetch('/api/pro/team?limit=50', { headers }),
                fetch('/api/pro/structure', { headers }),
            ]);

            if (apptRes.status === 'fulfilled' && apptRes.value.ok) {
                const data = await apptRes.value.json();
                setAppointments((data.items || data.appointments || []).filter((a) => ['booked', 'confirmed', 'requested', 'pending'].includes(String(a.status || '').toLowerCase())));
            }

            if (teamRes.status === 'fulfilled' && teamRes.value.ok) {
                const data = await teamRes.value.json();
                setTeamMembers((data.users || []).filter((u) => String(u.status || '').toLowerCase() === 'active'));
                setTeamAccess('ok');
            } else setTeamAccess(teamRes.status === 'fulfilled' && teamRes.value.status === 403 ? 'admins' : 'error');
            if (structRes.status === 'fulfilled' && structRes.value.ok) {
                const data = await structRes.value.json();
                setStructure(data.structure || null);
            }
        } catch (e) {
            if (import.meta.env.DEV) console.error('[ProDashboard] Erreur:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    // PKG-11 audit pass 2: the address comes from /api/pro/outlook?action=authorize (signed state bound to this professional); the button used to build it here
    // with an unsigned state=user.id that the callback refuses, so every attempt ended in an error
    const handleOutlookSync = async () => {
        try {
            const d = await proRdvRequest('/api/pro/outlook', { query: { action: 'authorize' } });
            if (d?.authUrl) { window.location.href = d.authUrl; return; }
            alert(d?.message || 'Outlook n’est pas encore activé.');
        } catch {
            alert('Outlook est indisponible pour le moment.');
        }
    };

    // the video controls live on the appointment page (VisioTrigger); /pro/visio is not a working room
    const handleLaunchVisio = (/** @type {number} */ appointmentId) => {
        navigate(`/pro/appointments/${appointmentId}`);
    };

    return (
        <div className="space-y-8">
            {/* PKG-4 / R03: work queue */}
            <section aria-labelledby="pro-queue-title" data-testid="pro-dashboard-queue" className="order-first">
                <h2 id="pro-queue-title" className="sr-only">File de travail</h2>
                {queue.error ? <p role="alert" className="text-sm text-red-800">{queue.error}</p> : (
                    <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {[['mine', 'Mes dossiers', '/pro/dossiers'], ['unassigned', 'Dossiers à attribuer', '/pro/dossiers'], ['toHandle', 'Orientations à traiter', '/pro/orientations'], ['overdue', 'Orientations en retard', '/pro/orientations']].map(([k, label, to]) => (
                            <li key={k}><Link to={to} data-testid={`pro-queue-${k}`} className="block rounded-lg border border-slate-200 bg-white p-3 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-600">
                                <span className="block text-xs text-slate-600">{label}</span>
                                <span className="text-2xl font-bold text-slate-900" data-testid={`pro-queue-${k}-value`}>{queue.loading ? '…' : queue[k]}</span>
                            </Link></li>
                        ))}
                    </ul>
                )}
            </section>
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                        Tableau de Bord
                    </h1>
                    <p className="text-sm text-slate-700">
                        Bienvenue, {user?.email}
                    </p>
                </div>
                <div className="flex gap-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate('/pro/rdv/new')}
                    >
                        <Plus className="mr-2 h-4 w-4" /> Nouveau rendez-vous
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleOutlookSync}
                        disabled={outlookOff || outlookConnected}
                        title={outlookOff ? 'Outlook n’est pas encore activé sur ADA.' : undefined}
                        className="bg-indigo-600 hover:bg-indigo-700"
                    >
                        <Calendar className="mr-2 h-4 w-4" />
                        {outlookConnected ? 'Outlook connecté' : outlookOff ? 'Outlook (pas encore activé)' : 'Connecter Outlook'}
                    </Button>
                </div>
            </div>

            {/* Outlook success banner */}
            {outlookConnected && searchParams.get('outlook') === 'connected' && (
                <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800" role="status">
                    <CheckCircle2 size={20} aria-hidden="true" />
                    <p className="text-sm font-medium">
                        Votre agenda Outlook est connecté.
                    </p>
                </div>
            )}

            {/* Stats cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Rendez-vous</CardTitle>
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{appointments.length}</div>
                        <p className="text-xs text-muted-foreground">À venir</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Équipe</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{teamAccess === 'ok' ? teamMembers.length : '—'}</div>
                        <p className="text-xs text-muted-foreground">Membres actifs</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Structure</CardTitle>
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        {/* owner usefulness pass: the real state of the record and of ADA's verification, with the next step */}
                        <div className="text-lg font-bold" data-testid="pro-dashboard-structure-state">{!structure ? '—' : structure.statut === 'actif' ? 'Fiche active' : structure.statut === 'suspendu' ? 'Fiche suspendue' : 'Fiche en attente d’activation'}</div>
                        <p className="text-xs text-muted-foreground">{!structure ? '' : structure.verification_status === 'VERIFIED' ? `Vérifiée par ADA${structure.date_verification ? ` le ${new Date(structure.date_verification).toLocaleDateString('fr-FR')}` : ''}` : 'Pas encore vérifiée par ADA : elle n’apparaît pas dans l’annuaire public'}</p>
                        <Link to="/pro/structure" className="mt-1 inline-block text-xs font-medium text-indigo-700 underline">Voir ma structure</Link>
                    </CardContent>
                </Card>
                <Card className="border-indigo-200 bg-indigo-50/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-indigo-700">
                            Visioconférence
                        </CardTitle>
                        <Video className="h-4 w-4 text-indigo-500" />
                    </CardHeader>
                    <CardContent>
                        <Button
                            size="sm"
                            variant="outline"
                            className="mt-1 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                            onClick={() => navigate('/pro/visio')}
                        >
                            <Video className="mr-2 h-3 w-3" /> Comment fonctionne la visio
                        </Button>
                    </CardContent>
                </Card>
            </div>

            {/* Main content grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                {/* Upcoming Appointments */}
                <div className="xl:col-span-2 space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
                            <Clock className="text-indigo-500" size={16} />
                            Prochaines Consultations
                        </h2>
                        <Link
                            to="/pro/rdv/agenda"
                            className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                        >
                            Voir tout <ExternalLink size={12} />
                        </Link>
                    </div>

                    {loading ? <div className="p-6"><SkeletonList count={3} variant="card" /></div> : appointments.length === 0 ? (
                        <Card className="border-dashed">
                            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                                <Calendar className="text-slate-300 mb-4" size={40} />
                                <p className="text-sm font-medium text-slate-700">
                                    Aucun rendez-vous à venir
                                </p>
                                <p className="text-xs text-slate-600 mt-1">
                                    Pour recevoir des rendez-vous : un service, puis vos disponibilités
                                </p>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-4"
                                    onClick={() => navigate('/pro/rdv/disponibilites')}
                                >
                                    <Plus className="mr-2 h-3 w-3" /> Définir mes disponibilités
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-3">
                            {appointments.slice(0, 5).map((rdv) => (
                                <Card
                                    key={rdv.id}
                                    className="hover:border-indigo-200 transition-colors"
                                >
                                    <CardContent className="flex items-center justify-between p-4">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 bg-slate-100 text-indigo-600 rounded-xl flex items-center justify-center font-bold text-sm border border-slate-200">
                                                {(rdv.beneficiaryName || '?')[0].toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="font-semibold text-slate-900 text-sm">
                                                    {rdv.beneficiaryName || 'Bénéficiaire'}
                                                </p>
                                                <p className="text-xs text-slate-600">
                                                    {rdv.startAt
                                                        ? new Date(rdv.startAt).toLocaleDateString('fr-FR', {
                                                            weekday: 'short',
                                                            day: 'numeric',
                                                            month: 'short',
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        })
                                                        : '--'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {String(rdv.mode || '').toUpperCase() === 'VIDEO' ? (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="text-indigo-600 hover:bg-indigo-50"
                                                onClick={() => handleLaunchVisio(rdv.id)}
                                                title="Ouvrir le rendez-vous en visio"
                                                aria-label="Ouvrir le rendez-vous en visio"
                                            >
                                                <Video size={16} />
                                            </Button>
                                            ) : null}
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() =>
                                                    navigate(`/pro/appointments/${rdv.id}`)
                                                }
                                            >
                                                Dossier <ChevronRight className="ml-1" size={14} />
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>

                {/* Sidebar widgets */}
                <div className="space-y-6">
                    {/* Team preview */}
                    <Card>
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <Users className="text-indigo-500" size={14} />
                                    Équipe
                                </CardTitle>
                                <Link
                                    to="/pro/team"
                                    className="text-xs text-indigo-600 hover:underline"
                                >
                                    Gérer
                                </Link>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {teamAccess === 'admins' ? (
                                <p className="text-xs text-slate-600" data-testid="dashboard-team-admins-only">L’équipe est gérée par les administrateurs de la structure.</p>
                            ) : teamAccess === 'error' ? (
                                <p className="text-xs text-red-800" role="alert">L’équipe n’a pas pu être chargée.</p>
                            ) : teamMembers.length === 0 ? (
                                <p className="text-xs text-slate-600">
                                    Aucun membre trouvé
                                </p>
                            ) : (
                                teamMembers.slice(0, 4).map((m) => (
                                    <div
                                        key={m.id}
                                        className="flex items-center justify-between"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="relative w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-xs font-bold text-slate-700">
                                                {(m.email || '?')[0].toUpperCase()}
                                                {m.status === 'active' && (
                                                    <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full" />
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-xs font-medium text-slate-800 truncate max-w-[140px]">
                                                    {m.email}
                                                </p>
                                                <p className="text-[10px] text-slate-600">{proRole(m.role)}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </CardContent>
                    </Card>

                    {/* Messages shortcut */}
                    <Card className="cursor-pointer hover:border-indigo-200 transition-colors" onClick={() => navigate('/pro/messages')}>
                        <CardContent className="flex items-center gap-3 p-4">
                            <div className="p-2 bg-indigo-50 rounded-lg">
                                <MessageCircle className="text-indigo-600" size={18} />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-slate-800">
                                    Messagerie sécurisée
                                </p>
                                <p className="text-xs text-slate-600">
                                    Messages chiffrés à l’enregistrement
                                </p>
                            </div>
                            <ChevronRight className="ml-auto text-slate-300" size={16} />
                        </CardContent>
                    </Card>

                    {/* PKG-11 audit pass 2: what is really protected (it claimed end-to-end encryption and « no storage in clear »; the server holds the keys) */}
                    <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-100">
                        <div className="flex items-center gap-2 mb-2">
                            <ShieldCheck className="text-emerald-700" size={18} aria-hidden="true" />
                            <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                                Protection des échanges
                            </h4>
                        </div>
                        <p className="text-xs text-emerald-800 leading-relaxed">
                            Messages, notes et documents sont chiffrés à l&apos;enregistrement et chaque accès est journalisé.
                            Ce n&apos;est pas un chiffrement de bout en bout : nos serveurs détiennent les clés.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
