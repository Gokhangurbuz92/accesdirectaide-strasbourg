// @ts-nocheck
import { useEffect, useState } from 'react';
import { adminClient } from '@/api/client';
import { useOutletContext, Link } from 'react-router-dom';
import {
    User, Bell, Shield, Mail, CheckCircle,
    AlertTriangle, Eye, ExternalLink
} from 'lucide-react';

import SEO from '@/components/SEO';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ─── Profil Tab ──────────────────────────────────────────────

function ProfilTab({ user }) {
    const roleBadge = (role) => {
        const styles = {
            admin: 'bg-red-50 text-red-700 border-red-200',
            superadmin: 'bg-purple-50 text-purple-700 border-purple-200',
            moderator: 'bg-amber-50 text-amber-700 border-amber-200',
        };
        const labels = {
            admin: 'Administrateur',
            superadmin: 'Super Admin',
            moderator: 'Modérateur',
        };
        const r = String(role || 'admin').toLowerCase();
        return (
            <Badge variant="outline" className={styles[r] || styles.admin}>
                {labels[r] || role || 'Admin'}
            </Badge>
        );
    };

    return (
        <div className="space-y-6">
            <h3 className="text-lg font-semibold">Profil administrateur</h3>
            <div className="space-y-3">
                <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                    <Mail className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-slate-700">Email</span>
                        <p className="text-sm font-semibold text-slate-900 break-all">{user?.email || '-'}</p>
                    </div>
                </div>

                <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                    <Shield className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <span className="text-sm font-medium text-slate-700">Rôle</span>
                        <div className="mt-1">{roleBadge(user?.role)}</div>
                    </div>
                </div>

                <div className="p-4 rounded-lg border bg-slate-50 text-sm text-slate-600 space-y-1">
                    <p>Dernière connexion : <span className="font-medium">{user?.lastLogin ? new Date(user.lastLogin).toLocaleString('fr-FR') : 'Session actuelle'}</span></p>
                    {user?.createdAt && (
                        <p>Compte créé le : <span className="font-medium">{new Date(user.createdAt).toLocaleDateString('fr-FR')}</span></p>
                    )}
                </div>
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                <p>💡 Les informations du profil admin sont gérées de manière centralisée. Contactez le Super Admin pour toute modification.</p>
            </div>
        </div>
    );
}

// ─── Notifications Tab ───────────────────────────────────────
// Launch-readiness items 57 / 66: this tab used to show four switches (system errors, weekly report, new validations, security alerts) kept only in this browser
// and read by nothing — no weekly report exists, and an alert never depended on them. It now says where alerts really go.

function NotificationsTab() {
    return (
        <div className="space-y-6" data-testid="admin-notifications-routing">
            <h3 className="text-lg font-semibold">Où arrivent les alertes</h3>
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-800">
                <li><strong>Pannes et erreurs critiques</strong> : envoyées au webhook d’alerte configuré sur le serveur (ALERT_WEBHOOK_URL) et au suivi des erreurs ; visibles dans « Observabilité ».</li>
                <li><strong>Contenu à traiter</strong> (signalements, demandes, décisions en attente) : la page « À traiter » du tableau de bord.</li>
                <li><strong>Veille automatique</strong> : le compte rendu de chaque nuit est dans « Veille ».</li>
                <li><strong>Sécurité des comptes</strong> : connexions, verrouillages et élévations sont dans le journal des sessions.</li>
            </ul>
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
                Il n’y a pas de rapport hebdomadaire par e-mail, et aucun réglage de cette page ne change l’envoi des alertes.
            </p>
        </div>
    );
}

// ─── Security Tab ────────────────────────────────────────────

function SecurityTab({ user }) {
    return (
        <div className="space-y-6">
            <h3 className="text-lg font-semibold">Sécurité du compte admin</h3>
            <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                    <div className="flex items-start gap-4">
                        <Shield className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div>
                            <span className="text-sm font-medium">Mot de passe</span>
                            <p className="text-xs text-slate-700 mt-0.5">Pas encore modifiable ici : demandez le changement à un autre administrateur d&apos;ADA.</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                    <div className="flex items-start gap-4">
                        <Shield className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div>
                            <span className="text-sm font-medium">Authentification 2FA</span>
                            <p className="text-xs text-slate-700 mt-0.5">Obligatoire pour toute modification : sans le code à usage unique de votre application d&apos;authentification, la session reste en lecture seule.</p>
                        </div>
                    </div>
                    <Badge variant="outline" className="text-emerald-800 border-emerald-200 bg-emerald-50">
                        Active
                    </Badge>
                </div>

                <div className="p-4 rounded-lg border bg-white">
                    <div className="flex items-start gap-4 mb-3">
                        <Eye className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <span className="text-sm font-medium">Session actuelle</span>
                            <p className="text-xs text-slate-700 mt-0.5">Appareil connecté à l'interface admin</p>
                        </div>
                    </div>
                    <div className="ml-9 p-3 bg-slate-50 rounded text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full" />
                            <span>{typeof navigator !== 'undefined' ? navigator.userAgent.split('(')[1]?.split(')')[0] || 'Navigateur' : 'Navigateur'}</span>
                        </div>
                    </div>
                </div>

                <div className="p-4 rounded-lg border bg-white">
                    <div className="flex items-start gap-4">
                        <Shield className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <span className="text-sm font-medium">Journal d'audit</span>
                            <p className="text-xs text-slate-700 mt-1">Historique complet des actions administratives</p>
                            <Button variant="outline" size="sm" className="mt-3" asChild>
                                <Link to="/admin/audit">
                                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                    Voir le journal
                                </Link>
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-800">
                <p className="font-medium mb-1">⚠️ Sécurité renforcée</p>
                <p>Les comptes admin ont des privilèges élevés. Utilisez un mot de passe unique et ne partagez jamais vos identifiants ni votre application d&apos;authentification.</p>
            </div>
        </div>
    );
}

// ─── Sessions (PKG-11 / ADM-10) ────────────────────────────────
const EVENT_LABELS = { ADMIN_LOGIN_SUCCEEDED: 'Connexion', ADMIN_LOGIN_FAILED: 'Échec de connexion', ADMIN_LOGIN_LOCKED: 'Compte verrouillé', ADMIN_LOGIN_DISABLED: 'Connexion refusée (compte désactivé)',
    ADMIN_LOGOUT: 'Fin de toutes les sessions', ADMIN_SESSIONS_REVOKED: 'Sessions terminées par un super-administrateur', ADMIN_DISABLED: 'Compte désactivé', ADMIN_ENABLED: 'Compte réactivé',
    ADMIN_MFA_ENROLLED: 'MFA configurée', ADMIN_MFA_VERIFIED: 'Code MFA validé', ADMIN_MFA_FAILED: 'Code MFA refusé', ADMIN_ACCOUNT_CREATED_LOCAL: 'Compte créé sur cette machine', ADMIN_ACCOUNT_BOOTSTRAP: 'Compte créé par l’amorçage sécurisé',
    ADMIN_MFA_RESET_LOCAL: 'MFA réinitialisée sur cette machine', ADMIN_PASSWORD_RESET_LOCAL: 'Mot de passe remplacé sur cette machine' };
const when = (d) => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '—');

function SessionsTab() {
    const [data, setData] = useState(null); const [msg, setMsg] = useState(''); const [form, setForm] = useState({ email: '', reason: '', action: 'revoke' });
    const load = () => adminClient.admin.getSessions().then(setData).catch(() => setMsg('Les sessions n’ont pas pu être chargées.'));
    useEffect(() => { load(); }, []);
    const act = async () => {
        setMsg('');
        try { await adminClient.admin.sessions(form); setMsg('Action enregistrée.'); setForm((f) => ({ ...f, reason: '' })); load(); }
        catch (e) { setMsg(e?.payload?.message || 'Action refusée.'); }   // the server's French message, never « API Error: 400 »
    };
    return (
        <div className="space-y-6" data-testid="admin-sessions">
            <h3 className="text-lg font-semibold">Sessions administrateur</h3>
            <p className="text-sm text-slate-700">Chaque session est vérifiée à chaque requête : un compte désactivé ou une session terminée n&apos;ouvre plus rien.</p>
            <Button variant="outline" onClick={() => adminClient.auth.logout()} data-testid="admin-logout-all">Terminer toutes mes sessions</Button>
            {msg && <p role="status" className="text-sm text-slate-800">{msg}</p>}
            {data && (
                <>
                    <table className="w-full text-sm" data-testid="admin-session-admins">
                        <caption className="text-left font-medium mb-2">Administrateurs</caption>
                        <thead><tr className="text-left"><th scope="col">Adresse</th><th scope="col">Titulaire</th><th scope="col">Rôle</th><th scope="col">Double authentification</th><th scope="col">Dernière connexion</th><th scope="col">État</th></tr></thead>
                        <tbody>{data.admins.map((a) => (
                            <tr key={a.email}><td>{a.email}</td><td>{a.holder || 'non renseigné'}</td><td>{a.role}</td><td>{a.mfa ? 'active' : 'à configurer'}</td><td>{when(a.lastLogin)}</td><td>{a.disabledAt ? `désactivé le ${when(a.disabledAt)}` : 'actif'}</td></tr>
                        ))}</tbody>
                    </table>
                    <fieldset className="space-y-2 rounded border p-3">
                        <legend className="text-sm font-medium px-1">Agir sur un autre administrateur (super-administrateur avec élévation en cours)</legend>
                        <Label htmlFor="sess-email">Adresse de l&apos;administrateur</Label>
                        <input id="sess-email" className="w-full rounded border p-2" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                        <Label htmlFor="sess-action">Action</Label>
                        <select id="sess-action" className="w-full rounded border p-2" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
                            <option value="revoke">Terminer ses sessions</option><option value="disable">Désactiver le compte</option><option value="enable">Réactiver le compte</option>
                        </select>
                        <Label htmlFor="sess-reason">Raison (au moins 10 caractères)</Label>
                        <input id="sess-reason" className="w-full rounded border p-2" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                        <Button onClick={act} disabled={!form.email || form.reason.trim().length < 10}>Appliquer</Button>
                    </fieldset>
                    <table className="w-full text-sm" data-testid="admin-session-events">
                        <caption className="text-left font-medium mb-2">Événements de session récents</caption>
                        <thead><tr className="text-left"><th scope="col">Date</th><th scope="col">Événement</th><th scope="col">Par</th><th scope="col">Concerné</th></tr></thead>
                        <tbody>{data.events.map((ev, i) => (
                            <tr key={i}><td>{when(ev.at)}</td><td>{EVENT_LABELS[ev.action] || ev.action}</td><td>{ev.actor || '—'}</td><td>{ev.target || '—'}</td></tr>
                        ))}</tbody>
                    </table>
                </>
            )}
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────

export default function AdminParametres() {
    const { user } = useOutletContext();

    return (
        <div className="space-y-6">
            <SEO
                title="Paramètres Admin"
                description="Configuration du compte administrateur."
                path="/admin/parametres"
                noindex={true}
            />

            <div>
                <h1 className="text-2xl font-bold text-slate-900">Paramètres</h1>
                <p className="text-sm text-slate-700 mt-1">Configuration de votre compte administrateur</p>
            </div>

            <Tabs defaultValue="profil" className="space-y-6">
                <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto p-1">
                    <TabsTrigger value="profil" className="gap-1.5 py-2.5">
                        <User className="h-4 w-4 hidden sm:block" />
                        Profil
                    </TabsTrigger>
                    <TabsTrigger value="notifications" className="gap-1.5 py-2.5">
                        <Bell className="h-4 w-4 hidden sm:block" />
                        Notifications
                    </TabsTrigger>
                    <TabsTrigger value="security" className="gap-1.5 py-2.5">
                        <Shield className="h-4 w-4 hidden sm:block" />
                        Sécurité
                    </TabsTrigger>
                    <TabsTrigger value="sessions" className="gap-1.5 py-2.5">
                        <Shield className="h-4 w-4 hidden sm:block" />
                        Sessions
                    </TabsTrigger>
                </TabsList>

                <Card>
                    <CardContent className="pt-6">
                        <TabsContent value="profil" className="mt-0">
                            <ProfilTab user={user} />
                        </TabsContent>
                        <TabsContent value="notifications" className="mt-0">
                            <NotificationsTab />
                        </TabsContent>
                        <TabsContent value="security" className="mt-0">
                            <SecurityTab user={user} />
                        </TabsContent>
                        <TabsContent value="sessions" className="mt-0">
                            <SessionsTab />
                        </TabsContent>
                    </CardContent>
                </Card>
            </Tabs>
        </div>
    );
}
