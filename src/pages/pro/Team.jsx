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
/**
 * ProTeam — Page enrichie de gestion d'équipe
 *
 * Affiche les statistiques globales et par agent, les invitations
 * en attente, et permet d'inviter ou désactiver des membres.
 *
 * Accessible uniquement aux STRUCTURE_ADMIN et SUPERADMIN.
 */
export default function ProTeam() {
    const { user } = useOutletContext();
    const [data, setData] = useState({ users: [], invitations: [] });
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [inviting, setInviting] = useState(false);
    const [disablingId, setDisablingId] = useState(null);
    const [confirmDisable, setConfirmDisable] = useState(null);
    const [resendingId, setResendingId] = useState(null);
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
                setLoadProblem(st === 403 ? 'La gestion de l’équipe est réservée aux administrateurs de la structure.' : st === 401 ? 'Votre session a expiré : reconnectez-vous.' : 'L’équipe n’a pas pu être chargée.');
            }
            if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
                setStats(await statsRes.value.json());
            }
        } catch (e) {
            if (import.meta.env.DEV) console.error('[ProTeam] Erreur:', e);
            setLoadProblem('L’équipe n’a pas pu être chargée.');
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
    const [inviteRole, setInviteRole] = useState('PRO');

    const handleInvite = async (/** @type {{ preventDefault: () => void; }} */ e) => {
        e.preventDefault();
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
                if (['PROVIDER_ACCEPTED', 'TEST_RECORDED'].includes(out?.mailStatus)) toast.success(`Invitation transmise à ${inviteEmail}`);
                else toast.warning(`Invitation créée pour ${inviteEmail}, mais l’e-mail n’a pas pu être envoyé : renvoyez-la plus tard.`);
                fetchTeam();
                setIsInviteOpen(false);
                setInviteEmail('');
            } else {
                const err = await res.json();
                toast.error(err.error || 'Erreur lors de l\'envoi');
            }
        } catch {
            toast.error('Erreur réseau. Veuillez réessayer.');
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
                toast.success(out?.movedCases ? `Collaborateur désactivé. ${out.movedCases} dossier(s) ${successorId ? 'confiés au successeur' : 'remis dans la file de l’équipe'}.` : 'Collaborateur désactivé.');
                fetchTeam();
            } else {
                toast.error((await res.json().catch(() => ({}))).error || 'Erreur lors de la désactivation.');   // R8: the server's reason (successor rule, unknown member)
            }
        } catch {
            toast.error('Erreur réseau.');
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
            else toast.error((await res.json().catch(() => ({}))).error || 'La modification a échoué.');
        } catch {
            toast.error('Erreur réseau.');
        } finally {
            setChangingId(null);
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
                if (['PROVIDER_ACCEPTED', 'TEST_RECORDED'].includes(out?.mailStatus)) toast.success(`Nouveau lien transmis à ${email}`);
                else toast.warning(`Nouveau lien créé pour ${email}, mais l’e-mail n’a pas pu être envoyé.`);
            } else {
                const err = await res.json();
                toast.error(err.error || 'Erreur lors de la relance');
            }
        } catch {
            toast.error('Erreur réseau.');
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
                toast.success(`Invitation annulée pour ${email}`);
                fetchTeam();
            } else {
                toast.error((await res.json().catch(() => ({}))).error || 'Erreur lors de l\'annulation.');
            }
        } catch {
            toast.error('Erreur réseau.');
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
                    <h1 className="text-2xl font-bold text-slate-900">Mon Équipe</h1>
                    <p className="text-sm text-slate-700">
                        Gestion et pilotage de votre structure
                    </p>
                </div>
                <Button onClick={() => setIsInviteOpen(true)}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Inviter un collaborateur
                </Button>
            </div>

            {loadProblem ? (
                <div role="alert" data-testid="pro-team-problem" className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                    <p>{loadProblem}</p>
                    <Button variant="outline" size="sm" className="mt-2" data-testid="pro-team-retry" onClick={fetchTeam}>Réessayer</Button>
                </div>
            ) : null}
            {loadProblem ? null : <>
            {/* Stats cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    icon={<Users className="text-indigo-500" size={18} />}
                    label="Membres actifs"
                    value={activeMemberCount}
                />
                <StatCard
                    icon={<Calendar className="text-emerald-500" size={18} />}
                    label="RDV aujourd'hui"
                    value={globalStats.appointmentsToday ?? '--'}
                />
                <StatCard
                    icon={<TrendingUp className="text-amber-500" size={18} />}
                    label="RDV à venir"
                    value={globalStats.appointmentsUpcoming ?? '--'}
                />
                <StatCard
                    icon={<MessageCircle className="text-purple-500" size={18} />}
                    label="Conversations actives"
                    value={globalStats.conversationsActive ?? '--'}
                />
            </div>

            {/* Encryption notice (not end-to-end — see RC4_SECURITY_REVIEW.md) */}
            <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                <ShieldCheck className="text-emerald-700 shrink-0" size={18} />
                <p className="text-xs text-emerald-700">
                    <strong>Confidentialité :</strong> les messages entre agents et usagers
                    sont chiffrés au stockage (pas de bout en bout) et accessibles aux
                    membres habilités de la structure concernée.
                </p>
            </div>

            {/* Members table */}
            <div>
                <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <BarChart3 size={16} className="text-indigo-500" />
                    Membres et Performance
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
                                                {u.status === 'active' ? 'Actif' : u.status}
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
                                        <span>RDV</span>
                                    </div>

                                    {/* Actions */}
                                    {u.id !== user?.id && u.status === 'active' && (u.role === 'PRO' || u.role === 'STRUCTURE_ADMIN') && (
                                        <label className="flex items-center gap-1 text-xs text-slate-700">
                                            <span className="sr-only">Rôle de {u.email}</span>
                                            <select
                                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                                                value={u.role}
                                                disabled={changingId === u.id}
                                                onChange={(e) => patchMember(u, { role: e.target.value }, `Rôle de ${u.email} modifié.`)}
                                                data-testid={`team-role-${u.id}`}
                                            >
                                                <option value="PRO">Professionnel</option>
                                                <option value="STRUCTURE_ADMIN">Administrateur</option>
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
                                                onChange={(e) => patchMember(u, { canManageSchedule: e.target.checked }, e.target.checked ? `${u.email} gère désormais le planning.` : `${u.email} ne gère plus le planning.`)}
                                                data-testid={`team-schedule-${u.id}`}
                                            />
                                            <span>Gère le planning<span className="sr-only"> (horaires et absences de l’équipe) : {u.email}</span></span>
                                        </label>
                                    )}
                                    {u.id !== user?.id && u.status === 'disabled' && (
                                        <Button variant="outline" size="sm" onClick={() => patchMember(u, { reactivate: true }, `${u.email} est de nouveau actif.`)} disabled={changingId === u.id} data-testid={`team-reactivate-${u.id}`}>
                                            Réactiver
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
                                            Désactiver
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
                {(data.pagination?.totalPages || 1) > 1 && (
                    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages de l’équipe">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Page précédente</Button>
                        <span>Page {page} sur {data.pagination.totalPages} ({data.pagination.total} comptes)</span>
                        <Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Page suivante</Button>
                    </nav>
                )}
            </div>

            {/* Pending Invitations */}
            {data.invitations.length > 0 && (
                <div>
                    <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Mail size={16} className="text-indigo-500" />
                        Invitations en attente
                    </h2>
                    <div className="space-y-2">
                        {data.invitations.map((inv) => (
                            <Card key={inv.id} className="bg-slate-50">
                                <CardContent className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4">
                                    <div>
                                        <p className="font-medium text-sm">{inv.email}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <RoleBadge role={inv.role} />
                                            <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-semibold">En attente</span>
                                        </div>
                                        {inv.senderRevoked ? (
                                            <p className="mt-1 text-xs text-red-700" data-testid={`team-invitation-sender-revoked-${inv.id}`}>
                                                Plus utilisable : la personne qui l’a envoyée n’est plus administratrice. « Relancer » envoie un nouveau lien en votre nom.
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
                                            Relancer
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
                                            Annuler
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* Invite Dialog */}
            <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Inviter un membre</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleInvite} className="space-y-4">
                        <div>
                            <Label htmlFor="invite-email">Email</Label>
                            <Input
                                id="invite-email"
                                type="email"
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <Label htmlFor="invite-role">Rôle</Label>
                            <Select value={inviteRole} onValueChange={setInviteRole}>
                                <SelectTrigger id="invite-role">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="PRO">
                                        Professionnel (Lecture seule équipe)
                                    </SelectItem>
                                    <SelectItem value="STRUCTURE_ADMIN">
                                        Administrateur (Gestion équipe/services)
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <DialogFooter>
                            <Button type="submit" disabled={inviting}>
                                {inviting ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <UserPlus className="mr-2 h-4 w-4" />
                                )}
                                {inviting ? 'Envoi...' : 'Inviter'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Confirm Disable Dialog */}
            <Dialog open={!!confirmDisable} onOpenChange={() => setConfirmDisable(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-red-500" />
                            Désactiver ce collaborateur ?
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-slate-600">
                        Le compte de <strong>{confirmDisable?.email}</strong> sera désactivé.
                        Il ne pourra plus accéder à l&apos;Espace Pro et ses sessions ouvertes prennent fin.
                    </p>
                    <label className="block space-y-1 text-sm text-slate-700">
                        <span>Ses dossiers ouverts vont à :</span>
                        <select className="w-full rounded border border-slate-300 bg-white px-2 py-1.5" value={successorId} onChange={(e) => setSuccessorId(e.target.value)} data-testid="team-successor">
                            <option value="">la file de l’équipe (non attribués)</option>
                            {data.users.filter((m) => m.status === 'active' && m.id !== confirmDisable?.id).map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                        </select>
                    </label>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setConfirmDisable(null)}>
                            Annuler
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
                            Confirmer la désactivation
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
    if (role === 'STRUCTURE_ADMIN' || role === 'SUPERADMIN') {
        return (
            <span className="inline-flex items-center gap-1 text-amber-800">
                <Crown size={10} />
                {role === 'SUPERADMIN' ? 'Super Admin' : 'Responsable'}
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1">
            <UserCog size={10} />
            Agent
        </span>
    );
}
