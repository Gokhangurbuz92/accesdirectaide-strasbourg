// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Loader2,
    UserPlus,
    Mail,
    Users,
    Calendar,
    MessageCircle,
    ShieldCheck,
    BarChart3,
    Crown,
    UserCog,
    UserX,
    TrendingUp,
    RefreshCw,
    Trash2,
    AlertTriangle,
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

import { getCsrfHeaders } from '@/lib/csrf';
import { Trans } from 'react-i18next';
import i18n, { useT } from '@/i18n';
import { ErrorSummary, FieldError } from '@/components/forms/FieldErrors';
import { useFormErrors } from '@/components/forms/useFormErrors';
import { emailMessage, fieldA11y, looksLikeEmail, requiredMessage } from '@/lib/fieldErrors';
/**
 * ProTeam — Page enrichie de gestion d'équipe
 *
 * Affiche les statistiques globales et par agent, les invitations
 * en attente, et permet d'inviter ou désactiver des membres.
 *
 * Accessible uniquement aux STRUCTURE_ADMIN et SUPERADMIN.
 */
export default function ProTeam() {
    const { t } = useT('pro');
    const { user } = useOutletContext();
    const [data, setData] = useState({ users: [], invitations: [] });
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [inviting, setInviting] = useState(false);
    const [disablingId, setDisablingId] = useState(null);
    const [confirmDisable, setConfirmDisable] = useState(null);
    const [resendingId, setResendingId] = useState(null);
    // R42-A08: invitation to enrol the second factor (and the lost-device reset, confirmed in a dialog)
    const [mfaInvitingId, setMfaInvitingId] = useState(null);
    const [confirmMfaReset, setConfirmMfaReset] = useState(null);
    const [cancellingId, setCancellingId] = useState(null);
    // R18: the team screen offers what the server already supports — paging past the first page, role change, reactivation, a named successor on departure
    const [page, setPage] = useState(1);
    const [changingId, setChangingId] = useState(null);
    const [successorId, setSuccessorId] = useState('');

    const token = typeof window !== 'undefined' ? localStorage.getItem('pro_token') : null;
    const headers = { Authorization: `Bearer ${token}` };

    // R8: a refused or failed load is said (a member of the PRO role, or an outage, read as an empty team « 0 membre actif »)
    const [loadProblem, setLoadProblem] = useState('');
    const fetchTeam = useCallback(async () => {
        setLoading(true); setLoadProblem('');
        try {
            const [teamRes, statsRes] = await Promise.allSettled([
                fetch(`/api/pro/team?limit=50&page=${page}`, { headers }),
                fetch('/api/pro/team/stats', { headers }),
            ]);

            if (teamRes.status === 'fulfilled' && teamRes.value.ok) {
                setData(await teamRes.value.json());
            } else {
                const st = teamRes.status === 'fulfilled' ? teamRes.value.status : 0;
                setData({ users: [], invitations: [] });
                setLoadProblem(st === 403 ? t('pro:team.load_forbidden', 'La gestion de l’équipe est réservée aux administrateurs de la structure.') : st === 401 ? t('pro:team.load_expired', 'Votre session a expiré : reconnectez-vous.') : t('pro:team.load_failed', 'L’équipe n’a pas pu être chargée.'));
            }
            if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
                setStats(await statsRes.value.json());
            }
        } catch (e) {
            if (import.meta.env.DEV) console.error('[ProTeam] Erreur:', e);
            setLoadProblem(t('pro:team.load_failed', 'L’équipe n’a pas pu être chargée.'));
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page]);

    useEffect(() => {
        fetchTeam();
    }, [fetchTeam]);

    const [isInviteOpen, setIsInviteOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    // R43 (A5): the address is checked in the dialog (own message, focused summary); a refusal of the server is said in the dialog too (a toast alone
    // disappears and is outside the dialog the keyboard is trapped in)
    const inviteErr = useFormErrors();
    const [inviteProblem, setInviteProblem] = useState('');
    const [inviteRole, setInviteRole] = useState('PRO');

    const handleInvite = async (/** @type {{ preventDefault: () => void; }} */ e) => {
        e.preventDefault();
        setInviteProblem('');
        const lbl = t('pro:team.email', 'Email');
        if (!inviteErr.check(!inviteEmail.trim() ? { 'invite-email': requiredMessage(t, lbl) } : looksLikeEmail(inviteEmail) ? {} : { 'invite-email': emailMessage(t, lbl) })) return;
        setInviting(true);
        try {
            const res = await fetch('/api/pro/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers, ...getCsrfHeaders() },
                body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
            });
            if (res.ok) {
                const out = await res.json().catch(() => ({}));
                // PKG-11 audit: « envoyée » only when a provider accepted the e-mail (or the LAB test outbox recorded it)
                if (['PROVIDER_ACCEPTED', 'TEST_RECORDED'].includes(out?.mailStatus)) toast.success(t('pro:team.invite_sent', 'Invitation transmise à {{email}}', { email: inviteEmail }));
                else toast.warning(t('pro:team.invite_not_mailed', 'Invitation créée pour {{email}}, mais l’e-mail n’a pas pu être envoyé : renvoyez-la plus tard.', { email: inviteEmail }));
                fetchTeam();
                setIsInviteOpen(false);
                setInviteEmail('');
            } else {
                const err = await res.json().catch(() => ({}));
                const why = err.error || t('pro:team.invite_error', 'Erreur lors de l\'envoi');
                setInviteProblem(why); toast.error(why);
            }
        } catch {
            setInviteProblem(t('pro:team.network_retry', 'Erreur réseau. Veuillez réessayer.'));
            toast.error(t('pro:team.network_retry', 'Erreur réseau. Veuillez réessayer.'));
        } finally {
            setInviting(false);
        }
    };

    const handleDisable = async (/** @type {import("react").SetStateAction<null>} */ targetUserId) => {
        setDisablingId(targetUserId);
        try {
            const res = await fetch(`/api/pro/team?userId=${encodeURIComponent(targetUserId)}${successorId ? `&successorUserId=${encodeURIComponent(successorId)}` : ''}`, {
                method: 'DELETE',
                headers,
            });
            if (res.ok) {
                const out = await res.json().catch(() => ({}));
                toast.success(out?.movedCases ? (successorId ? t('pro:team.disabled_moved_successor', 'Collaborateur désactivé. {{n}} dossier(s) confiés au successeur.', { n: out.movedCases }) : t('pro:team.disabled_moved_queue', 'Collaborateur désactivé. {{n}} dossier(s) remis dans la file de l’équipe.', { n: out.movedCases })) : t('pro:team.disabled', 'Collaborateur désactivé.'));
                fetchTeam();
            } else {
                toast.error((await res.json().catch(() => ({}))).error || t('pro:team.disable_error', 'Erreur lors de la désactivation.'));   // R8: the server's reason (successor rule, unknown member)
            }
        } catch {
            toast.error(t('pro:team.network_error', 'Erreur réseau.'));
        } finally {
            setDisablingId(null);
            setConfirmDisable(null);
            setSuccessorId('');
        }
    };

    /** PATCH the member: a new role, or the reactivation of a disabled member (the server re-checks admin rights and the structure). */
    const patchMember = async (/** @type {any} */ member, /** @type {Record<string, unknown>} */ body, /** @type {string} */ done) => {
        setChangingId(member.id);
        try {
            const res = await fetch('/api/pro/team', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...headers, ...getCsrfHeaders() },
                body: JSON.stringify({ targetUserId: member.id, ...body }),
            });
            if (res.ok) { toast.success(done); fetchTeam(); }
            else toast.error((await res.json().catch(() => ({}))).error || t('pro:team.patch_error', 'La modification a échoué.'));
        } catch {
            toast.error(t('pro:team.network_error', 'Erreur réseau.'));
        } finally {
            setChangingId(null);
        }
    };

    const handleMfaInvitation = async (/** @type {{ id: string, email: string }} */ member, /** @type {boolean} */ lostDevice) => {
        setMfaInvitingId(member.id);
        try {
            const res = await fetch('/api/pro/mfa-invitation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers, ...getCsrfHeaders() },
                body: JSON.stringify({ memberId: member.id, lostDevice }),
            });
            const out = await res.json().catch(() => ({}));
            if (res.ok) {
                if (['PROVIDER_ACCEPTED', 'TEST_RECORDED'].includes(out?.mailStatus)) toast.success(t('pro:team.mfa_invite_sent', 'Invitation à la double authentification transmise à {{email}}', { email: member.email }));
                else toast.warning(t('pro:team.mfa_invite_not_mailed', 'Invitation créée pour {{email}}, mais l’e-mail n’a pas pu être envoyé.', { email: member.email }));
                setConfirmMfaReset(null);
                fetchTeam();
            } else {
                toast.error(out?.message || out?.error || t('pro:team.mfa_invite_error', 'L’invitation n’a pas pu être créée.'));
            }
        } catch {
            toast.error(t('pro:team.network_error', 'Erreur réseau.'));
        } finally {
            setMfaInvitingId(null);
        }
    };

    const handleResendInvitation = async (/** @type {any} */ invitationId, /** @type {any} */ email) => {
        setResendingId(invitationId);
        try {
            const res = await fetch('/api/pro/resend-invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers, ...getCsrfHeaders() },
                body: JSON.stringify({ invitationId }),
            });
            if (res.ok) {
                const out = await res.json().catch(() => ({}));
                if (['PROVIDER_ACCEPTED', 'TEST_RECORDED'].includes(out?.mailStatus)) toast.success(t('pro:team.resend_sent', 'Nouveau lien transmis à {{email}}', { email }));
                else toast.warning(t('pro:team.resend_not_mailed', 'Nouveau lien créé pour {{email}}, mais l’e-mail n’a pas pu être envoyé.', { email }));
            } else {
                const err = await res.json();
                toast.error(err.error || t('pro:team.resend_error', 'Erreur lors de la relance'));
            }
        } catch {
            toast.error(t('pro:team.network_error', 'Erreur réseau.'));
        } finally {
            setResendingId(null);
        }
    };

    // @ts-ignore
    const handleCancelInvitation = async (/** @type {any} */ invitationId, /** @type {any} */ email) => {
        setCancellingId(invitationId);
        try {
            const res = await fetch(`/api/pro/invite?id=${invitationId}`, {
                method: 'DELETE',
                headers,
            });
            if (res.ok) {
                toast.success(t('pro:team.invite_cancelled', 'Invitation annulée pour {{email}}', { email }));
                fetchTeam();
            } else {
                toast.error((await res.json().catch(() => ({}))).error || t('pro:team.cancel_error', 'Erreur lors de l\'annulation.'));
            }
        } catch {
            toast.error(t('pro:team.network_error', 'Erreur réseau.'));
        } finally {
            setCancellingId(null);
        }
    };

    if (loading) {
        return (
            <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
        );
    }

    const globalStats = stats?.global || {};
    const memberStats = stats?.members || [];
    const activeMemberCount = data.users.filter((u) => u.status === 'active').length;

    // Build a lookup for per-member appointment counts from stats
    const memberCountMap = {};
    for (const m of memberStats) {
        memberCountMap[m.id] = m.appointmentsCount || 0;
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">{t('pro:team.title', 'Mon Équipe')}</h1>
                    <p className="text-sm text-slate-700">
                        {t('pro:team.subtitle', 'Gestion et pilotage de votre structure')}
                    </p>
                </div>
                <Button onClick={() => setIsInviteOpen(true)}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    {t('pro:team.invite_button', 'Inviter un collaborateur')}
                </Button>
            </div>

            {loadProblem ? (
                <div role="alert" data-testid="pro-team-problem" className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                    <p>{loadProblem}</p>
                    <Button variant="outline" size="sm" className="mt-2" data-testid="pro-team-retry" onClick={fetchTeam}>{t('pro:team.retry', 'Réessayer')}</Button>
                </div>
            ) : null}
            {loadProblem ? null : <>
            {/* Stats cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    icon={<Users className="text-indigo-500" size={18} />}
                    label={t('pro:team.stat_active_members', 'Membres actifs')}
                    value={activeMemberCount}
                />
                <StatCard
                    icon={<Calendar className="text-emerald-500" size={18} />}
                    label={t('pro:team.stat_today', 'RDV aujourd\'hui')}
                    value={globalStats.appointmentsToday ?? '--'}
                />
                <StatCard
                    icon={<TrendingUp className="text-amber-500" size={18} />}
                    label={t('pro:team.stat_upcoming', 'RDV à venir')}
                    value={globalStats.appointmentsUpcoming ?? '--'}
                />
                <StatCard
                    icon={<MessageCircle className="text-purple-500" size={18} />}
                    label={t('pro:team.stat_conversations', 'Conversations actives')}
                    value={globalStats.conversationsActive ?? '--'}
                />
            </div>

            {/* Encryption notice (not end-to-end — see RC4_SECURITY_REVIEW.md) */}
            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                <ShieldCheck className="text-emerald-700 shrink-0" size={18} />
                <p className="text-xs text-emerald-700">
                    <Trans i18n={i18n} i18nKey="pro:team.privacy_notice" defaults="<0>Confidentialité :</0> les messages entre agents et usagers sont chiffrés au stockage (pas de bout en bout) et accessibles aux membres habilités de la structure concernée." components={[<strong key="0" />]} />
                </p>
            </div>

            {/* Members table */}
            <div>
                <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <BarChart3 size={16} className="text-indigo-500" />
                    {t('pro:team.members_heading', 'Membres et Performance')}
                </h2>
                <div className="space-y-3">
                    {data.users.map((u) => (
                        <Card
                            key={u.id}
                            className={
                                u.status === 'disabled'
                                    ? 'opacity-50'
                                    : u.status === 'active'
                                        ? ''
                                        : 'bg-slate-50'
                            }
                        >
                            <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4">
                                <div className="flex items-center gap-4 min-w-0">
                                    <div className="relative w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-sm font-bold text-slate-700 shrink-0">
                                        {(u.email || '?')[0].toUpperCase()}
                                        {u.status === 'active' && (
                                            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full" />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-medium text-slate-900 text-sm truncate">
                                            {u.email}
                                        </p>
                                        <div className="flex items-center gap-2 text-xs text-slate-700 mt-0.5">
                                            <RoleBadge role={u.role} />
                                            <span>•</span>
                                            <span
                                                className={
                                                    u.status === 'active'
                                                        ? 'text-emerald-700'
                                                        : 'text-slate-600'
                                                }
                                            >
                                                {u.status === 'active' ? t('pro:team.status_active', 'Actif') : u.status}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    {/* Stat pill */}
                                    <div className="flex items-center gap-1.5 text-xs text-slate-700 bg-slate-50 px-3 py-1.5 rounded-lg">
                                        <Calendar size={12} />
                                        <span className="font-semibold text-slate-700">
                                            {memberCountMap[u.id] ?? 0}
                                        </span>
                                        <span>{t('pro:team.appointments_short', 'RDV')}</span>
                                    </div>

                                    {/* Actions */}
                                    {u.id !== user?.id && u.status === 'active' && (u.role === 'PRO' || u.role === 'STRUCTURE_ADMIN') && (
                                        <label className="flex items-center gap-1 text-xs text-slate-700">
                                            <span className="sr-only">{t('pro:team.role_of', 'Rôle de {{email}}', { email: u.email })}</span>
                                            <select
                                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                                                value={u.role}
                                                disabled={changingId === u.id}
                                                onChange={(e) => patchMember(u, { role: e.target.value }, t('pro:team.role_changed', 'Rôle de {{email}} modifié.', { email: u.email }))}
                                                data-testid={`team-role-${u.id}`}
                                            >
                                                <option value="PRO">{t('pro:team.role_pro', 'Professionnel')}</option>
                                                <option value="STRUCTURE_ADMIN">{t('pro:team.role_admin', 'Administrateur')}</option>
                                            </select>
                                        </label>
                                    )}
                                    {/* R24 (owner decision R18.5): the administrator explicitly delegates the structure's schedule to a member */}
                                    {u.status === 'active' && u.role === 'PRO' && (
                                        <label className="flex items-center gap-1 text-xs text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={u.canManageSchedule === true}
                                                disabled={changingId === u.id}
                                                onChange={(e) => patchMember(u, { canManageSchedule: e.target.checked }, e.target.checked ? t('pro:team.schedule_on', '{{email}} gère désormais le planning.', { email: u.email }) : t('pro:team.schedule_off', '{{email}} ne gère plus le planning.', { email: u.email }))}
                                                data-testid={`team-schedule-${u.id}`}
                                            />
                                            <span>{t('pro:team.manages_schedule', 'Gère le planning')}<span className="sr-only">{t('pro:team.manages_schedule_sr', ' (horaires et absences de l’équipe) : {{email}}', { email: u.email })}</span></span>
                                        </label>
                                    )}
                                    {/* R42-A08: the second factor is enrolled only through an invitation sent by another administrator */}
                                    {u.id !== user?.id && u.status === 'active' && (
                                        u.mfa_enabled ? (
                                            <Button variant="outline" size="sm" onClick={() => setConfirmMfaReset(u)} disabled={mfaInvitingId === u.id} data-testid={`team-mfa-reset-${u.id}`}>
                                                <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                                {t('pro:team.mfa_lost_device', 'Appareil perdu')}<span className="sr-only">{t('pro:team.mfa_lost_device_sr', ' : réinitialiser la double authentification de {{email}}', { email: u.email })}</span>
                                            </Button>
                                        ) : (
                                            <Button variant="outline" size="sm" onClick={() => handleMfaInvitation(u, false)} disabled={mfaInvitingId === u.id} data-testid={`team-mfa-invite-${u.id}`}>
                                                {mfaInvitingId === u.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                                                {t('pro:team.mfa_invite', 'Inviter à la double authentification')}<span className="sr-only">{t('pro:team.mfa_invite_sr', ' : {{email}}', { email: u.email })}</span>
                                            </Button>
                                        )
                                    )}
                                    {u.id !== user?.id && u.status === 'disabled' && (
                                        <Button variant="outline" size="sm" onClick={() => patchMember(u, { reactivate: true }, t('pro:team.reactivated', '{{email}} est de nouveau actif.', { email: u.email }))} disabled={changingId === u.id} data-testid={`team-reactivate-${u.id}`}>
                                            {t('pro:team.reactivate', 'Réactiver')}
                                        </Button>
                                    )}
                                    {u.id !== user?.id && u.status !== 'disabled' && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-red-700 hover:text-red-800 hover:bg-red-50"
                                            onClick={() => setConfirmDisable(u)}
                                            disabled={disablingId === u.id}
                                        >
                                            {disablingId === u.id ? (
                                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <UserX className="mr-1 h-3.5 w-3.5" />
                                            )}
                                            {t('pro:team.disable', 'Désactiver')}
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
                {(data.pagination?.totalPages || 1) > 1 && (
                    <nav className="mt-4 flex items-center justify-between text-sm" aria-label={t('pro:team.pages_label', 'Pages de l’équipe')}>
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{t('pro:team.page_prev', 'Page précédente')}</Button>
                        <span>{t('pro:team.page_of', 'Page {{page}} sur {{pages}} ({{total}} comptes)', { page, pages: data.pagination.totalPages, total: data.pagination.total })}</span>
                        <Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>{t('pro:team.page_next', 'Page suivante')}</Button>
                    </nav>
                )}
            </div>

            {/* Pending Invitations */}
            {data.invitations.length > 0 && (
                <div>
                    <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Mail size={16} className="text-indigo-500" />
                        {t('pro:team.pending_heading', 'Invitations en attente')}
                    </h2>
                    <div className="space-y-2">
                        {data.invitations.map((inv) => (
                            <Card key={inv.id} className="bg-slate-50">
                                <CardContent className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4">
                                    <div>
                                        <p className="font-medium text-sm">{inv.email}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <RoleBadge role={inv.role} />
                                            <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-semibold">{t('pro:team.pending', 'En attente')}</span>
                                        </div>
                                        {inv.senderRevoked ? (
                                            <p className="mt-1 text-xs text-red-700" data-testid={`team-invitation-sender-revoked-${inv.id}`}>
                                                {t('pro:team.sender_revoked', 'Plus utilisable : la personne qui l’a envoyée n’est plus administratrice. « Relancer » envoie un nouveau lien en votre nom.')}
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleResendInvitation(inv.id, inv.email)}
                                            disabled={resendingId === inv.id}
                                        >
                                            {resendingId === inv.id ? (
                                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                                            )}
                                            {t('pro:team.resend', 'Relancer')}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-red-700 hover:text-red-800 hover:bg-red-50"
                                            onClick={() => handleCancelInvitation(inv.id, inv.email)}
                                            disabled={cancellingId === inv.id}
                                        >
                                            {cancellingId === inv.id ? (
                                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Trash2 className="mr-1 h-3.5 w-3.5" />
                                            )}
                                            {t('pro:team.cancel', 'Annuler')}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* Invite Dialog */}
            <Dialog open={isInviteOpen} onOpenChange={(open) => { setIsInviteOpen(open); if (!open) { inviteErr.reset(); setInviteProblem(''); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('pro:team.invite_dialog_title', 'Inviter un membre')}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleInvite} className="space-y-4" noValidate aria-busy={inviting || undefined}>
                        <ErrorSummary ref={inviteErr.summaryRef} errors={inviteErr.errors} order={['invite-email']} testid="team-invite-errors" />
                        {inviteProblem ? <p role="alert" data-testid="team-invite-problem" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{inviteProblem}</p> : null}
                        <div>
                            <Label htmlFor="invite-email">{t('pro:team.email', 'Email')}</Label>
                            <Input
                                id="invite-email"
                                type="email"
                                autoComplete="off"
                                value={inviteEmail}
                                {...fieldA11y('invite-email', inviteErr.errors)}
                                onChange={(e) => { setInviteEmail(e.target.value); inviteErr.clear('invite-email'); }}
                                required
                            />
                            <FieldError field="invite-email" errors={inviteErr.errors} />
                        </div>
                        <div>
                            <Label htmlFor="invite-role">{t('pro:team.role', 'Rôle')}</Label>
                            <Select value={inviteRole} onValueChange={setInviteRole}>
                                <SelectTrigger id="invite-role">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="PRO">
                                        {t('pro:team.invite_role_pro', 'Professionnel (Lecture seule équipe)')}
                                    </SelectItem>
                                    <SelectItem value="STRUCTURE_ADMIN">
                                        {t('pro:team.invite_role_admin', 'Administrateur (Gestion équipe/services)')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <DialogFooter>
                            <Button type="submit" disabled={inviting}>
                                {inviting ? (
                                    <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                ) : (
                                    <UserPlus className="me-2 h-4 w-4" aria-hidden="true" />
                                )}
                                {inviting ? t('pro:team.sending', 'Envoi...') : t('pro:team.invite', 'Inviter')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Confirm Disable Dialog */}
            <Dialog open={!!confirmMfaReset} onOpenChange={() => setConfirmMfaReset(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden="true" />
                            {t('pro:team.mfa_reset_title', 'Réinitialiser la double authentification ?')}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-slate-700">
                        {t('pro:team.mfa_reset_text', 'Vérifiez d’abord l’identité de {{email}} par un moyen sûr (en personne ou en rappelant un numéro connu de la structure). Son authentificateur actuel cessera de fonctionner, toutes ses sessions prendront fin et une nouvelle invitation, valable 72 heures, lui sera envoyée.', { email: confirmMfaReset?.email })}
                    </p>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setConfirmMfaReset(null)}>
                            {t('pro:team.cancel', 'Annuler')}
                        </Button>
                        <Button variant="destructive" onClick={() => confirmMfaReset && handleMfaInvitation(confirmMfaReset, true)} disabled={mfaInvitingId === confirmMfaReset?.id} data-testid="team-mfa-reset-confirm">
                            {t('pro:team.mfa_reset_confirm', 'Réinitialiser et envoyer l’invitation')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!confirmDisable} onOpenChange={() => setConfirmDisable(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-red-500" />
                            {t('pro:team.disable_confirm_title', 'Désactiver ce collaborateur ?')}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-slate-600">
                        <Trans i18n={i18n} i18nKey="pro:team.disable_confirm_text" defaults="Le compte de <0>{{email}}</0> sera désactivé. Il ne pourra plus accéder à l'Espace Pro et ses sessions ouvertes prennent fin." values={{ email: confirmDisable?.email }} components={[<strong key="0" />]} />
                    </p>
                    <label className="block space-y-1 text-sm text-slate-700">
                        <span>{t('pro:team.successor_label', 'Ses dossiers ouverts vont à :')}</span>
                        <select className="w-full rounded border border-slate-300 bg-white px-2 py-1.5" value={successorId} onChange={(e) => setSuccessorId(e.target.value)} data-testid="team-successor">
                            <option value="">{t('pro:team.successor_queue', 'la file de l’équipe (non attribués)')}</option>
                            {data.users.filter((m) => m.status === 'active' && m.id !== confirmDisable?.id).map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                        </select>
                    </label>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setConfirmDisable(null)}>
                            {t('pro:team.cancel', 'Annuler')}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => handleDisable(confirmDisable?.id)}
                            disabled={disablingId === confirmDisable?.id}
                        >
                            {disablingId === confirmDisable?.id ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <UserX className="mr-2 h-4 w-4" />
                            )}
                            {t('pro:team.disable_confirm', 'Confirmer la désactivation')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            </>}
        </div>
    );
}

// @ts-ignore
function StatCard({ icon, label, value }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-slate-700">
                    {label}
                </CardTitle>
                {icon}
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
            </CardContent>
        </Card>
    );
}

function RoleBadge(/** @type {{ role: string | number | boolean | null | undefined }} */ { role }) {
    const { t } = useT('pro');
    if (role === 'STRUCTURE_ADMIN' || role === 'SUPERADMIN') {
        return (
            <span className="inline-flex items-center gap-1 text-amber-800">
                <Crown size={10} />
                {role === 'SUPERADMIN' ? t('pro:team.badge_superadmin', 'Super Admin') : t('pro:team.badge_admin', 'Responsable')}
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1">
            <UserCog size={10} />
            {t('pro:team.badge_agent', 'Agent')}
        </span>
    );
}
