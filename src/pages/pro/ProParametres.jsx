// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import {
    Building2, Users, Calendar, Bell, Shield, Plug,
    Mail, Phone, MapPin, Clock, CheckCircle, ExternalLink,
    AlertTriangle, Eye, UserPlus, Trash2, Download
} from 'lucide-react';

import SEO from '@/components/SEO';
import { proRdvRequest } from '@/api/pro-rdv-client';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

// ─── Local Preferences helpers ────────────────────────────────

// ─── Tab: Structure ───────────────────────────────────────────

// @ts-ignore
function StructureTab({ structure, user, loadFailed, onRetry }) {
    // R8: a failed reading of the account is not « no structure »
    if (loadFailed) {
        return (
            <div role="alert" data-testid="pro-settings-load-error" className="p-6 text-center text-rose-900">
                <p>Les informations de votre compte n’ont pas pu être chargées.</p>
                <Button variant="outline" size="sm" className="mt-3" data-testid="pro-settings-retry" onClick={onRetry}>Réessayer</Button>
            </div>
        );
    }
    if (!structure) {
        return (
            <div className="p-6 text-center text-slate-700">
                <Building2 className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p>Aucune structure associée à ce compte.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold mb-4">Informations de la structure</h3>
                <div className="space-y-3">
                    <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                        <Building2 className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <span className="text-sm font-medium text-slate-700">Nom de la structure</span>
                            <p className="text-sm font-semibold text-slate-900">{structure.nom || structure.name || '-'}</p>
                        </div>
                    </div>

                    {(structure.adresse || structure.address) && (
                        <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                            <MapPin className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <span className="text-sm font-medium text-slate-700">Adresse</span>
                                <p className="text-sm text-slate-900">{structure.adresse || structure.address}</p>
                                {(structure.code_postal || structure.zipCode) && (
                                    <p className="text-xs text-slate-700 mt-0.5">
                                        {structure.code_postal || structure.zipCode} {structure.ville || structure.city}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                        <Mail className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <span className="text-sm font-medium text-slate-700">Email de contact</span>
                            <p className="text-sm text-slate-900">{user?.email || structure.email || '-'}</p>
                        </div>
                    </div>

                    {(structure.telephone || structure.phone) && (
                        <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                            <Phone className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <span className="text-sm font-medium text-slate-700">Téléphone</span>
                                <p className="text-sm text-slate-900">{structure.telephone || structure.phone}</p>
                            </div>
                        </div>
                    )}

                    <div className="p-4 rounded-lg border bg-slate-50 text-sm text-slate-600">
                        <p>Module RDV : {structure.is_pro_enabled ? (
                            <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50">Activé</Badge>
                        ) : (
                            <Badge variant="outline" className="text-slate-700">Non activé</Badge>
                        )}</p>
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
                <p className="font-medium mb-1">✏️ Modifier les informations</p>
                <p>
                    Pour modifier les informations de votre structure, rendez-vous sur la{' '}
                    <Link to="/pro/structure" className="underline font-medium">page Structure</Link>.
                </p>
            </div>
        </div>
    );
}

// ─── Tab: Équipe ──────────────────────────────────────────────

function TeamTab({ structure }) {
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold mb-4">Gestion de l'équipe</h3>
                <div className="space-y-4">
                    <div className="p-4 rounded-lg border bg-white">
                        <div className="flex items-start gap-4">
                            <Users className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <span className="text-sm font-medium">Membres de l'équipe</span>
                                <p className="text-xs text-slate-700 mt-1">
                                    Gérez les accès de votre équipe à l'espace professionnel.
                                </p>
                                <Button variant="outline" size="sm" className="mt-3" asChild>
                                    <Link to="/pro/team">
                                        <Users className="h-3.5 w-3.5 mr-1.5" />
                                        Gérer l'équipe
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 rounded-lg border bg-white">
                        <div className="flex items-start gap-4">
                            <UserPlus className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <span className="text-sm font-medium">Inviter un collaborateur</span>
                                <p className="text-xs text-slate-700 mt-1">
                                    Les invitations se font depuis la page Équipe : l’invité reçoit un lien pour créer son compte dans votre structure.
                                </p>
                                {/* owner usefulness pass (2026-10-25): this was a disabled form « bientôt disponible » although invitations work on /pro/team */}
                                <Button variant="outline" size="sm" className="mt-3" asChild>
                                    <Link to="/pro/team">Inviter depuis la page Équipe</Link>
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Tab: Rendez-vous ─────────────────────────────────────────

function RdvTab() {
    // owner usefulness pass (2026-10-25): the « Rappels 24h / 1h » and « Confirmation automatique » switches were saved in this browser only and nothing read
    // them; the page now states what the platform really does.
    return (
        <div className="space-y-6" data-testid="pro-settings-rdv">
            <div>
                <h3 className="text-lg font-semibold mb-4">Rendez-vous</h3>
                <ul className="space-y-3 text-sm text-slate-800">
                    <li className="p-4 rounded-lg border bg-white"><span className="font-medium">Rappel la veille :</span> la personne reçoit un rappel par e-mail la veille du rendez-vous si elle a accepté les rappels (elle peut les refuser dans son espace). Aucun rappel « 1 heure avant » n’existe.</li>
                    <li className="p-4 rounded-lg border bg-white"><span className="font-medium">Confirmation :</span> un rendez-vous pris par une personne sur un créneau publié est confirmé à la réservation ; vous pouvez ensuite le reporter ou l’annuler depuis l’agenda, la personne est prévenue.</li>
                    <li className="p-4 rounded-lg border bg-white"><span className="font-medium">Vos e-mails :</span> les notifications qui vous sont envoyées se règlent dans l’onglet Notifications.</li>
                </ul>
            </div>

            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
                <p>
                    Pour configurer vos services, disponibilités et absences, utilisez la{' '}
                    <Link to="/pro/rdv" className="underline font-medium">section Rendez-vous</Link>.
                </p>
            </div>
        </div>
    );
}

// ─── Tab: Notifications ───────────────────────────────────────

function NotificationsProTab() {
    // PKG-4 / R20: preferences are stored and APPLIED by the server (/api/pro/notifications?view=preferences). In-app notices are always kept;
    // only the e-mail copy can be switched off, globally or per category. SMS reminders and a daily digest do not exist for professionals: not offered.
    const [state, setState] = useState({ loading: true, error: '', preferences: null, categories: {} });
    const [saving, setSaving] = useState(false); const [message, setMessage] = useState(''); const [problem, setProblem] = useState('');
    const load = () => {
        setState((x) => ({ ...x, loading: true, error: '' }));
        proRdvRequest('/api/pro/notifications', { query: { view: 'preferences' } })
            .then((out) => setState({ loading: false, error: '', preferences: out.preferences, categories: out.categories || {} }))
            .catch(() => setState({ loading: false, error: 'Impossible de charger vos préférences.', preferences: null, categories: {} }));
    };
    useEffect(() => { load(); }, []);
    const save = async (patch) => {
        setSaving(true); setMessage(''); setProblem('');
        try { const out = await proRdvRequest('/api/pro/notifications', { method: 'PATCH', body: { preferences: patch } }); setState((x) => ({ ...x, preferences: out.preferences })); setMessage('Préférences enregistrées.'); }
        catch { setProblem('Enregistrement impossible : vos préférences n’ont pas changé. Réessayez.'); } finally { setSaving(false); }   // R8: a failure is an alert, not a status
    };
    if (state.loading) return <p role="status">Chargement…</p>;
    if (state.error) return <div role="alert" data-testid="pro-notif-load-error" className="text-red-800"><p>{state.error}</p><Button variant="outline" size="sm" className="mt-2" data-testid="pro-notif-retry" onClick={load}>Réessayer</Button></div>;
    const p = state.preferences;
    return (
        <div className="space-y-6" data-testid="pro-notif-prefs">
            <div>
                <h3 className="text-lg font-semibold mb-2">Notifications professionnelles</h3>
                <p className="text-sm text-slate-600 mb-4">Toutes les notifications restent visibles dans l’application. Vous choisissez seulement celles qui vous sont aussi envoyées par e-mail (sans nom ni contenu de dossier).</p>
                <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                    <Label htmlFor="sw-pro-email" className="text-sm font-medium">Recevoir des e-mails</Label>
                    <Switch id="sw-pro-email" data-testid="pro-notif-email" checked={p.email} disabled={saving} onCheckedChange={(v) => save({ email: v })} />
                </div>
                <div className="space-y-3 mt-3">
                    {Object.entries(state.categories).map(([k, label]) => (
                        <div key={k} className="flex items-center justify-between p-4 rounded-lg border bg-white">
                            <Label htmlFor={`sw-pro-cat-${k}`} className="text-sm font-medium">{label}</Label>
                            <Switch id={`sw-pro-cat-${k}`} data-testid={`pro-notif-cat-${k}`} checked={p.email && p.categories[k] !== false} disabled={saving || !p.email} onCheckedChange={(v) => save({ categories: { ...p.categories, [k]: v } })} />
                        </div>
                    ))}
                </div>
            </div>
            <div aria-live="polite" role="status" data-testid="pro-notif-status" className="text-sm">{message}</div>
            {problem ? <p role="alert" data-testid="pro-notif-error" className="text-sm text-red-800">{problem}</p> : null}
        </div>
    );
}

// ─── Tab: Sécurité ────────────────────────────────────────────

function SecurityProTab({ user }) {
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold mb-4">Sécurité du compte professionnel</h3>
                <div className="space-y-4">
                    <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                        <Mail className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <span className="text-sm font-medium">Email professionnel</span>
                            <p className="text-sm text-slate-900 mt-0.5">{user?.email || '-'}</p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                        <div className="flex items-start gap-4">
                            <Shield className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <span className="text-sm font-medium">Mot de passe</span>
                                <p className="text-xs text-slate-700 mt-0.5">Le changement se fait par un lien envoyé à votre adresse e-mail.</p>
                            </div>
                        </div>
                        <Button variant="outline" size="sm" asChild>
                            <Link to="/pro/forgot-password">
                                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                Recevoir le lien
                            </Link>
                        </Button>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                        <div className="flex items-start gap-4">
                            <Shield className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <span className="text-sm font-medium">Authentification à deux facteurs (2FA)</span>
                                <p className="text-xs text-slate-700 mt-0.5">Renforcez la sécurité de votre compte</p>
                            </div>
                        </div>
                        <Button variant="outline" size="sm" asChild>
                            <Link to="/pro/mfa-settings">
                                Configurer
                            </Link>
                        </Button>
                    </div>

                    <div className="p-4 rounded-lg border bg-white">
                        <div className="flex items-start gap-4 mb-3">
                            <Eye className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <span className="text-sm font-medium">Journal d'audit</span>
                                <p className="text-xs text-slate-700 mt-0.5">Historique des actions sur votre compte</p>
                            </div>
                        </div>
                        <div className="ml-9">
                            <Button variant="outline" size="sm" asChild>
                                <Link to="/pro/audit">
                                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                    Voir le journal
                                </Link>
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Tab: Intégrations ────────────────────────────────────────

function IntegrationsTab() {
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold mb-4">Intégrations & API</h3>
                <div className="space-y-4">
                    {/* launch-readiness item 66: a catalogue of « Bientôt » integrations (Google Calendar, Microsoft 365, webhooks, CSV) used to be shown — none is planned
                        or decided; the structure's data export is on « Ma structure ». */}
                    <div className="p-6 rounded-lg border border-dashed bg-slate-50" data-testid="pro-integrations-none">
                        <Plug className="h-10 w-10 mb-3 text-slate-400" />
                        <p className="text-sm font-medium text-slate-700">Aucune intégration avec un outil extérieur n’est disponible.</p>
                        <p className="text-xs text-slate-700 mt-2">L’export des données de votre structure se trouve sur la page « Ma structure ».</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────

export default function ProParametres() {
    const [structure, setStructure] = useState(null);
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const fetchData = async () => {
            setLoadFailed(false);
            try {
                const token = localStorage.getItem('pro_token');
                if (!token) return;
                const res = await fetch('/api/pro/me', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setStructure(data.structure);
                    setUser(data.user || data);
                } else setLoadFailed(true);
            } catch (e) {
                if (import.meta.env.DEV) console.error('[ProParametres] fetch error:', e);
                setLoadFailed(true);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [attempt]);

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <SEO
                title="Paramètres Pro"
                description="Gérez votre structure, équipe, rendez-vous et sécurité."
                path="/pro/parametres"
                noindex={true}
            />

            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Paramètres</h1>
                <p className="text-sm text-slate-700 mt-1">
                    {structure?.nom || 'Ma structure'} — Configuration et préférences
                </p>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="structure" className="space-y-6">
                <TabsList className="grid w-full grid-cols-6 h-auto p-1">
                    <TabsTrigger value="structure" className="text-xs sm:text-sm gap-1 py-2.5">
                        <Building2 className="h-4 w-4 hidden sm:block" />
                        Structure
                    </TabsTrigger>
                    <TabsTrigger value="team" className="text-xs sm:text-sm gap-1 py-2.5">
                        <Users className="h-4 w-4 hidden sm:block" />
                        Équipe
                    </TabsTrigger>
                    <TabsTrigger value="rdv" className="text-xs sm:text-sm gap-1 py-2.5">
                        <Calendar className="h-4 w-4 hidden sm:block" />
                        RDV
                    </TabsTrigger>
                    <TabsTrigger value="notifications" className="text-xs sm:text-sm gap-1 py-2.5">
                        <Bell className="h-4 w-4 hidden sm:block" />
                        Notifs
                    </TabsTrigger>
                    <TabsTrigger value="security" className="text-xs sm:text-sm gap-1 py-2.5">
                        <Shield className="h-4 w-4 hidden sm:block" />
                        Sécurité
                    </TabsTrigger>
                    <TabsTrigger value="integrations" className="text-xs sm:text-sm gap-1 py-2.5">
                        <Plug className="h-4 w-4 hidden sm:block" />
                        Intégr.
                    </TabsTrigger>
                </TabsList>

                <Card>
                    <CardContent className="pt-6">
                        <TabsContent value="structure" className="mt-0">
                            <StructureTab structure={structure} user={user} loadFailed={loadFailed} onRetry={() => setAttempt((n) => n + 1)} />
                        </TabsContent>
                        <TabsContent value="team" className="mt-0">
                            <TeamTab structure={structure} />
                        </TabsContent>
                        <TabsContent value="rdv" className="mt-0">
                            <RdvTab />
                        </TabsContent>
                        <TabsContent value="notifications" className="mt-0">
                            <NotificationsProTab />
                        </TabsContent>
                        <TabsContent value="security" className="mt-0">
                            <SecurityProTab user={user} />
                        </TabsContent>
                        <TabsContent value="integrations" className="mt-0">
                            <IntegrationsTab />
                        </TabsContent>
                    </CardContent>
                </Card>
            </Tabs>
        </div>
    );
}
