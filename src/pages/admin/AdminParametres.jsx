// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { adminClient } from '@/api/client';
import { useOutletContext, Link } from 'react-router-dom';
import {
  User,
  Bell,
  Shield,
  Mail,
  Eye,
  ExternalLink,
} from 'lucide-react';

import SEO from '@/components/SEO';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trans } from 'react-i18next';
import i18n, { useT } from '@/i18n';

// ─── Profil Tab ──────────────────────────────────────────────

function ProfilTab({ user }) {
    const { t } = useT('admin');
    const roleBadge = (role) => {
        const styles = {
            admin: 'bg-red-50 text-red-700 border-red-200',
            superadmin: 'bg-purple-50 text-purple-700 border-purple-200',
            moderator: 'bg-amber-50 text-amber-700 border-amber-200',
        };
        const labels = {
            admin: t('admin:parametres.role_admin', 'Administrateur'),
            superadmin: t('admin:parametres.role_superadmin', 'Super Admin'),
            moderator: t('admin:parametres.role_moderator', 'Modérateur'),
        };
        const r = String(role || 'admin').toLowerCase();
        return (
            <Badge variant="outline" className={styles[r] || styles.admin}>
                {labels[r] || role || t('admin:parametres.role_fallback', 'Admin')}
            </Badge>
        );
    };

    return (
        <div className="space-y-6">
            <h3 className="text-lg font-semibold">{t('admin:parametres.profile_title', 'Profil administrateur')}</h3>
            <div className="space-y-3">
                <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                    <Mail className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-slate-700">{t('admin:parametres.email', 'Email')}</span>
                        <p className="text-sm font-semibold text-slate-900 break-all">{user?.email || '-'}</p>
                    </div>
                </div>

                <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                    <Shield className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <span className="text-sm font-medium text-slate-700">{t('admin:parametres.role', 'Rôle')}</span>
                        <div className="mt-1">{roleBadge(user?.role)}</div>
                    </div>
                </div>

                <div className="p-4 rounded-lg border bg-slate-50 text-sm text-slate-600 space-y-1">
                    <p>{t('admin:parametres.last_login', 'Dernière connexion :')} <span className="font-medium">{user?.lastLogin ? new Date(user.lastLogin).toLocaleString('fr-FR') : t('admin:parametres.current_session_value', 'Session actuelle')}</span></p>
                    {user?.createdAt && (
                        <p>{t('admin:parametres.created_on', 'Compte créé le :')} <span className="font-medium">{new Date(user.createdAt).toLocaleDateString('fr-FR')}</span></p>
                    )}
                </div>
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                <p>{t('admin:parametres.profile_note', '💡 Les informations du profil admin sont gérées de manière centralisée. Contactez le Super Admin pour toute modification.')}</p>
            </div>
        </div>
    );
}

// ─── Notifications Tab ───────────────────────────────────────
// Launch-readiness items 57 / 66: this tab used to show four switches (system errors, weekly report, new validations, security alerts) kept only in this browser
// and read by nothing — no weekly report exists, and an alert never depended on them. It now says where alerts really go.

function NotificationsTab() {
    const { t } = useT('admin');
    return (
        <div className="space-y-6" data-testid="admin-notifications-routing">
            <h3 className="text-lg font-semibold">{t('admin:parametres.alerts_title', 'Où arrivent les alertes')}</h3>
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-800">
                <li><Trans i18n={i18n} i18nKey="admin:parametres.alerts_outages" defaults="<0>Pannes et erreurs critiques</0> : envoyées au webhook d’alerte configuré sur le serveur (ALERT_WEBHOOK_URL) et au suivi des erreurs ; visibles dans « Observabilité »." components={[<strong key="s" />]} /></li>
                <li><Trans i18n={i18n} i18nKey="admin:parametres.alerts_content" defaults="<0>Contenu à traiter</0> (signalements, demandes, décisions en attente) : la page « À traiter » du tableau de bord." components={[<strong key="s" />]} /></li>
                <li><Trans i18n={i18n} i18nKey="admin:parametres.alerts_veille" defaults="<0>Veille automatique</0> : le compte rendu de chaque nuit est dans « Veille »." components={[<strong key="s" />]} /></li>
                <li><Trans i18n={i18n} i18nKey="admin:parametres.alerts_security" defaults="<0>Sécurité des comptes</0> : connexions, verrouillages et élévations sont dans le journal des sessions." components={[<strong key="s" />]} /></li>
            </ul>
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
                {t('admin:parametres.no_weekly_report', 'Il n’y a pas de rapport hebdomadaire par e-mail, et aucun réglage de cette page ne change l’envoi des alertes.')}
            </p>
        </div>
    );
}

// ─── Security Tab ────────────────────────────────────────────

function SecurityTab() {
    const { t } = useT('admin');
    return (
        <div className="space-y-6">
            <h3 className="text-lg font-semibold">{t('admin:parametres.security_title', 'Sécurité du compte admin')}</h3>
            <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                    <div className="flex items-start gap-4">
                        <Shield className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div>
                            <span className="text-sm font-medium">{t('admin:parametres.password', 'Mot de passe')}</span>
                            <p className="text-xs text-slate-700 mt-0.5">{t('admin:parametres.password_note', "Pas encore modifiable ici : demandez le changement à un autre administrateur d'ADA.")}</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                    <div className="flex items-start gap-4">
                        <Shield className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div>
                            <span className="text-sm font-medium">{t('admin:parametres.twofa', 'Authentification 2FA')}</span>
                            <p className="text-xs text-slate-700 mt-0.5">{t('admin:parametres.twofa_note', "Obligatoire pour toute modification : sans le code à usage unique de votre application d'authentification, la session reste en lecture seule.")}</p>
                        </div>
                    </div>
                    <Badge variant="outline" className="text-emerald-800 border-emerald-200 bg-emerald-50">
                        {t('admin:parametres.active', 'Active')}
                    </Badge>
                </div>

                <div className="p-4 rounded-lg border bg-white">
                    <div className="flex items-start gap-4 mb-3">
                        <Eye className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <span className="text-sm font-medium">{t('admin:parametres.current_session', 'Session actuelle')}</span>
                            <p className="text-xs text-slate-700 mt-0.5">{t('admin:parametres.device_note', "Appareil connecté à l'interface admin")}</p>
                        </div>
                    </div>
                    <div className="ml-9 p-3 bg-slate-50 rounded text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full" />
                            <span>{typeof navigator !== 'undefined' ? navigator.userAgent.split('(')[1]?.split(')')[0] || t('admin:parametres.browser', 'Navigateur') : t('admin:parametres.browser', 'Navigateur')}</span>
                        </div>
                    </div>
                </div>

                <div className="p-4 rounded-lg border bg-white">
                    <div className="flex items-start gap-4">
                        <Shield className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <span className="text-sm font-medium">{t('admin:parametres.audit_log', "Journal d'audit")}</span>
                            <p className="text-xs text-slate-700 mt-1">{t('admin:parametres.audit_log_note', 'Historique complet des actions administratives')}</p>
                            <Button variant="outline" size="sm" className="mt-3" asChild>
                                <Link to="/admin/audit">
                                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                    {t('admin:parametres.see_log', 'Voir le journal')}
                                </Link>
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-800">
                <p className="font-medium mb-1">{t('admin:parametres.reinforced', '⚠️ Sécurité renforcée')}</p>
                <p>{t('admin:parametres.reinforced_note', "Les comptes admin ont des privilèges élevés. Utilisez un mot de passe unique et ne partagez jamais vos identifiants ni votre application d'authentification.")}</p>
            </div>
        </div>
    );
}

// ─── Sessions (PKG-11 / ADM-10) ────────────────────────────────
const eventLabels = (t) => ({ ADMIN_LOGIN_SUCCEEDED: t('admin:parametres.ev.login_succeeded', 'Connexion'), ADMIN_LOGIN_FAILED: t('admin:parametres.ev.login_failed', 'Échec de connexion'), ADMIN_LOGIN_LOCKED: t('admin:parametres.ev.login_locked', 'Compte verrouillé'), ADMIN_LOGIN_DISABLED: t('admin:parametres.ev.login_disabled', 'Connexion refusée (compte désactivé)'),
    ADMIN_LOGOUT: t('admin:parametres.ev.logout', 'Fin de toutes les sessions'), ADMIN_SESSIONS_REVOKED: t('admin:parametres.ev.sessions_revoked', 'Sessions terminées par un super-administrateur'), ADMIN_DISABLED: t('admin:parametres.ev.disabled', 'Compte désactivé'), ADMIN_ENABLED: t('admin:parametres.ev.enabled', 'Compte réactivé'),
    ADMIN_MFA_ENROLLED: t('admin:parametres.ev.mfa_enrolled', 'MFA configurée'), ADMIN_MFA_VERIFIED: t('admin:parametres.ev.mfa_verified', 'Code MFA validé'), ADMIN_MFA_FAILED: t('admin:parametres.ev.mfa_failed', 'Code MFA refusé'), ADMIN_ACCOUNT_CREATED_LOCAL: t('admin:parametres.ev.account_created_local', 'Compte créé sur cette machine'), ADMIN_ACCOUNT_BOOTSTRAP: t('admin:parametres.ev.account_bootstrap', 'Compte créé par l’amorçage sécurisé'),
    ADMIN_MFA_RESET_LOCAL: t('admin:parametres.ev.mfa_reset_local', 'MFA réinitialisée sur cette machine'), ADMIN_PASSWORD_RESET_LOCAL: t('admin:parametres.ev.password_reset_local', 'Mot de passe remplacé sur cette machine') });
const when = (d) => (d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '—');

function SessionsTab() {
    const { t } = useT('admin');
    const EVENT_LABELS = eventLabels(t);
    const [data, setData] = useState(null); const [msg, setMsg] = useState(''); const [form, setForm] = useState({ email: '', reason: '', action: 'revoke' });
    const [refused, setRefused] = useState(false);   // R42 (A5): a refusal is an alert that describes the fields (not aria-invalid: the server may refuse for a reason that is not a field), a success a status
    const load = useCallback(() => adminClient.admin.getSessions().then(setData).catch(() => setMsg(t('admin:parametres.sessions_load_failed', 'Les sessions n’ont pas pu être chargées.'))), [t]);
    useEffect(() => { load(); }, [load]);
    const act = async () => {
        setMsg(''); setRefused(false);
        try { await adminClient.admin.sessions(form); setMsg(t('admin:parametres.action_saved', 'Action enregistrée.')); setForm((f) => ({ ...f, reason: '' })); load(); }
        catch (e) { setRefused(true); setMsg(e?.payload?.message || t('admin:parametres.action_refused', 'Action refusée.')); }   // the server's French message, never « API Error: 400 »
    };
    return (
        <div className="space-y-6" data-testid="admin-sessions">
            <h3 className="text-lg font-semibold">{t('admin:parametres.sessions_title', 'Sessions administrateur')}</h3>
            <p className="text-sm text-slate-700">{t('admin:parametres.sessions_intro', "Chaque session est vérifiée à chaque requête : un compte désactivé ou une session terminée n'ouvre plus rien.")}</p>
            <Button variant="outline" onClick={() => adminClient.auth.logout()} data-testid="admin-logout-all">{t('admin:parametres.logout_all', 'Terminer toutes mes sessions')}</Button>
            {msg && <p id="admin-sessions-message" role={refused ? 'alert' : 'status'} className={refused ? 'text-sm font-medium text-red-700' : 'text-sm text-slate-800'}>{msg}</p>}
            {data && (
                <>
                    <table className="w-full text-sm" data-testid="admin-session-admins">
                        <caption className="text-left font-medium mb-2">{t('admin:parametres.admins_caption', 'Administrateurs')}</caption>
                        <thead><tr className="text-left"><th scope="col">{t('admin:parametres.col_address', 'Adresse')}</th><th scope="col">{t('admin:parametres.col_holder', 'Titulaire')}</th><th scope="col">{t('admin:parametres.role', 'Rôle')}</th><th scope="col">{t('admin:parametres.col_mfa', 'Double authentification')}</th><th scope="col">{t('admin:parametres.col_last_login', 'Dernière connexion')}</th><th scope="col">{t('admin:parametres.col_state', 'État')}</th></tr></thead>
                        <tbody>{data.admins.map((a) => (
                            <tr key={a.email}><td>{a.email}</td><td>{a.holder || t('admin:parametres.holder_missing', 'non renseigné')}</td><td>{a.role}</td><td>{a.mfa ? t('admin:parametres.mfa_active', 'active') : t('admin:parametres.mfa_todo', 'à configurer')}</td><td>{when(a.lastLogin)}</td><td>{a.disabledAt ? t('admin:parametres.disabled_on', 'désactivé le {{date}}', { date: when(a.disabledAt) }) : t('admin:parametres.state_active', 'actif')}</td></tr>
                        ))}</tbody>
                    </table>
                    <fieldset className="space-y-2 rounded border p-3">
                        <legend className="text-sm font-medium px-1">{t('admin:parametres.act_legend', 'Agir sur un autre administrateur (super-administrateur avec élévation en cours)')}</legend>
                        <Label htmlFor="sess-email">{t('admin:parametres.admin_address', "Adresse de l'administrateur")}</Label>
                        <input id="sess-email" className="w-full rounded border p-2" aria-required="true" {...(refused ? { 'aria-describedby': 'admin-sessions-message' } : {})} value={form.email} onChange={(e) => { setRefused(false); setForm({ ...form, email: e.target.value }); }} />
                        <Label htmlFor="sess-action">{t('admin:parametres.action', 'Action')}</Label>
                        <select id="sess-action" className="w-full rounded border p-2" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
                            <option value="revoke">{t('admin:parametres.opt_revoke', 'Terminer ses sessions')}</option><option value="disable">{t('admin:parametres.opt_disable', 'Désactiver le compte')}</option><option value="enable">{t('admin:parametres.opt_enable', 'Réactiver le compte')}</option>
                        </select>
                        <Label htmlFor="sess-reason">{t('admin:parametres.reason', 'Raison (au moins 10 caractères)')}</Label>
                        <input id="sess-reason" className="w-full rounded border p-2" aria-required="true" {...(refused ? { 'aria-describedby': 'admin-sessions-message' } : {})} value={form.reason} onChange={(e) => { setRefused(false); setForm({ ...form, reason: e.target.value }); }} />
                        <Button onClick={act} disabled={!form.email || form.reason.trim().length < 10}>{t('admin:parametres.apply', 'Appliquer')}</Button>
                    </fieldset>
                    <table className="w-full text-sm" data-testid="admin-session-events">
                        <caption className="text-left font-medium mb-2">{t('admin:parametres.events_caption', 'Événements de session récents')}</caption>
                        <thead><tr className="text-left"><th scope="col">{t('admin:parametres.col_date', 'Date')}</th><th scope="col">{t('admin:parametres.col_event', 'Événement')}</th><th scope="col">{t('admin:parametres.col_by', 'Par')}</th><th scope="col">{t('admin:parametres.col_target', 'Concerné')}</th></tr></thead>
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
    const { t } = useT('admin');
    const { user } = useOutletContext();

    return (
        <div className="space-y-6">
            <SEO
                title={t('admin:parametres.seo_title', 'Paramètres Admin')}
                description={t('admin:parametres.seo_description', 'Configuration du compte administrateur.')}
                path="/admin/parametres"
                noindex={true}
            />

            <div>
                <h1 className="text-2xl font-bold text-slate-900">{t('admin:parametres.title', 'Paramètres')}</h1>
                <p className="text-sm text-slate-700 mt-1">{t('admin:parametres.subtitle', 'Configuration de votre compte administrateur')}</p>
            </div>

            <Tabs defaultValue="profil" className="space-y-6">
                <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto p-1">
                    <TabsTrigger value="profil" className="gap-1.5 py-2.5">
                        <User className="h-4 w-4 hidden sm:block" />
                        {t('admin:parametres.tab_profile', 'Profil')}
                    </TabsTrigger>
                    <TabsTrigger value="notifications" className="gap-1.5 py-2.5">
                        <Bell className="h-4 w-4 hidden sm:block" />
                        {t('admin:parametres.tab_notifications', 'Notifications')}
                    </TabsTrigger>
                    <TabsTrigger value="security" className="gap-1.5 py-2.5">
                        <Shield className="h-4 w-4 hidden sm:block" />
                        {t('admin:parametres.tab_security', 'Sécurité')}
                    </TabsTrigger>
                    <TabsTrigger value="sessions" className="gap-1.5 py-2.5">
                        <Shield className="h-4 w-4 hidden sm:block" />
                        {t('admin:parametres.tab_sessions', 'Sessions')}
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
