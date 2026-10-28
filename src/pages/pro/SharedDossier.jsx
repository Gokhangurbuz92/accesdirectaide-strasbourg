// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import SecureChat from '@/components/Messaging/SecureChat';
import FileVault from '@/components/FileVault';
import ExpertTools from '@/components/ExpertTools';
import { takePendingInvite } from '@/lib/pendingInvite';
import { getCsrfHeaders } from '@/lib/csrf';
import AssessmentView from '@/components/diagnostic/AssessmentView';
import ActionPlan from '@/components/diagnostic/ActionPlan';
import {
    FileText,
    User,
    ShieldCheck,
    ArrowLeft,
    CheckCircle2,
    Clock,
    AlertCircle,
    ClipboardList,
    Download,
    Loader2,
    Lock,
    Eye,
    TrendingUp,
} from 'lucide-react';

/**
 * SharedDossier — Vue Pro d'un diagnostic partagé
 *
 * Route: /pro/dossier/:shareId
 *
 * - Récupère le diagnostic via /api/pro/dossier?shareId=...
 * - Affiche situation + résultats en lecture seule
 * - Permet de changer le statut de suivi (PATCH)
 * - Intègre le SecureChat existant (chiffré à l'enregistrement, pas de bout en bout) pour communiquer avec l'usager
 */
export default function SharedDossier() {
    const { shareId } = useParams();
    const navigate = useNavigate();
    const { user } = useOutletContext();

    const [dossier, setDossier] = useState(null);
    const [access, setAccess] = useState(null);
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [followUp, setFollowUp] = useState('À traiter');
    const [updating, setUpdating] = useState(false);
    const [updateSuccess, setUpdateSuccess] = useState(false);
    const [updateProblem, setUpdateProblem] = useState('');

    const token = typeof window !== 'undefined' ? localStorage.getItem('pro_token') : null;

    // The citizen's INVITATION for this organization (fragment `#invite=`, never sent in a URL; legacy pre-RC5 links use `#token=`) is redeemed once;
    // later visits rely on the grant. After a login redirect the fragment is recovered from this tab's sessionStorage (30 min, single use).
    const [credential] = useState(() => {
        if (typeof window === 'undefined') return { kind: '', value: '' };
        let params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        if (!params.get('invite') && !params.get('token')) params = new URLSearchParams(takePendingInvite(window.location.pathname).replace(/^#/, ''));
        if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        if (params.get('invite')) return { kind: 'inviteToken', value: params.get('invite') };
        if (params.get('token')) return { kind: 'shareToken', value: params.get('token') };
        return { kind: '', value: '' };
    });
    const redeemedRef = useRef(false);

    const fetchDossier = useCallback(async () => {
        if (!shareId) return;
        setLoading(true);
        setError('');
        try {
            if (credential.value && !redeemedRef.current) {
                const grant = await fetch('/api/pro/dossier/redeem', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...getCsrfHeaders() },
                    body: JSON.stringify({ shareId, [credential.kind]: credential.value }),
                });
                if (!grant.ok) {
                    const gb = await grant.json().catch(() => ({}));
                    setError(grant.status === 410
                        ? (gb.error === 'invite_expired' ? 'Cette invitation a expiré. Demandez une nouvelle invitation à l\'usager.' : 'Ce dossier a expiré.')
                        : 'Accès non accordé. L\'invitation est invalide, déjà utilisée, destinée à une autre structure, ou votre compte n\'est plus actif dans cette structure.');
                    return;
                }
                redeemedRef.current = true;
            }
            const res = await fetch(
                `/api/pro/dossier?shareId=${encodeURIComponent(shareId)}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || data.message || 'Dossier introuvable.');
                return;
            }

            setDossier(data.dossier);
            setDocuments(Array.isArray(data.documents) ? data.documents : []);
            setAccess(data.access || null);
            const savedStatus = data.dossier?.results?._followUp?.status;
            if (savedStatus) setFollowUp(savedStatus);
        } catch {
            setError('Impossible de charger le dossier.');
        } finally {
            setLoading(false);
        }
    }, [shareId, token, credential]);

    useEffect(() => {
        fetchDossier();
    }, [fetchDossier]);

    const handleStatusUpdate = async () => {
        setUpdating(true);
        setUpdateSuccess(false);
        setUpdateProblem('');
        try {
            const res = await fetch(
                `/api/pro/dossier?shareId=${encodeURIComponent(shareId)}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                        ...getCsrfHeaders(),
                    },
                    body: JSON.stringify({ status: followUp }),
                }
            );
            if (res.ok) {
                setUpdateSuccess(true);
                setTimeout(() => setUpdateSuccess(false), 3000);
            } else {
                // R7: a refused update is said (it was silent: the person believed the status saved)
                setUpdateProblem(res.status === 401 ? 'Votre session a expiré : reconnectez-vous.' : res.status === 403 || res.status === 404
                    ? 'Ce dossier n’est plus partagé avec votre structure : le statut n’a pas été modifié.' : 'Le statut n’a pas pu être enregistré. Réessayez.');
            }
        } catch {
            setUpdateProblem('Le service est momentanément injoignable : le statut n’a pas été enregistré.');
        } finally {
            setUpdating(false);
        }
    };

    // Loading state
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <SkeletonList count={3} variant="card" />
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                    Chargement sécurisé...
                </p>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="max-w-lg mx-auto py-20">
                <Card className="border-red-200">
                    <CardContent className="p-8 text-center">
                        <AlertCircle className="text-red-400 mx-auto mb-4" size={36} />
                        <h1 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">Dossier partagé</h1>{/* Q10: the page heading; the state below keeps its h2 */}
                        <h2 className="text-lg font-bold text-slate-900 mb-2">
                            Dossier inaccessible
                        </h2>
                        <p className="text-sm text-slate-700 mb-6">{error}</p>
                        <Button variant="outline" onClick={() => navigate('/pro/dashboard')}>
                            <ArrowLeft className="mr-2 h-4 w-4" /> Retour au tableau de bord
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const situation = dossier?.situation || {};
    const results = dossier?.results || {};

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate(-1)}
                        aria-label="Retour"
                    >
                        <ArrowLeft size={18} aria-hidden="true" />
                    </Button>
                    <div>
                        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                            <FileText size={18} className="text-indigo-600" />
                            Dossier #{shareId?.slice(0, 8)}
                        </h1>
                        <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                            <ShieldCheck size={10} aria-hidden="true" /> Accès journalisé
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Eye size={12} />
                    {dossier?.viewCount || 0} consultation(s)
                    <span className="mx-1">•</span>
                    <Clock size={12} />
                    Expire le{' '}
                    {dossier?.expiresAt
                        ? new Date(dossier.expiresAt).toLocaleDateString('fr-FR')
                        : '--'}
                </div>
            </div>

            {/* Content grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Main: Situation + Results */}
                <div className="xl:col-span-2 space-y-6">
                    {/* Situation */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <User size={14} className="text-indigo-500" />
                                Situation de l&apos;usager
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <InfoField
                                    label="Localisation"
                                    value={situation.zipCode || situation.commune || '--'}
                                />
                                <InfoField
                                    label="Logement"
                                    value={situation.housingStatus || situation.statut_logement || '--'}
                                />
                                <InfoField
                                    label="Revenus mensuels"
                                    value={
                                        situation.salary || situation.revenu_mensuel
                                            ? `${situation.salary || situation.revenu_mensuel} €`
                                            : '--'
                                    }
                                />
                                <InfoField
                                    label="Composition"
                                    value={situation.familyStatus || situation.composition || '--'}
                                />
                                <InfoField
                                    label="Statut professionnel"
                                    value={situation.employmentStatus || situation.statut_emploi || '--'}
                                />
                                <InfoField
                                    label="Date diagnostic"
                                    value={
                                        dossier?.createdAt
                                            ? new Date(dossier.createdAt).toLocaleDateString('fr-FR')
                                            : '--'
                                    }
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* AI Results */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <ClipboardList size={14} className="text-indigo-500" />
                                Pistes d&apos;orientation du diagnostic
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {results.legacyRightsOmitted && (
                                <p data-testid="legacy-results-note" className="text-sm text-slate-700">
                                    Ancien partage : le détail des résultats n&apos;est plus repris (aucun montant ni éligibilité n&apos;est affiché).
                                </p>
                            )}
                            <AssessmentView results={results} headingLevel={3} />
                            <ActionPlan results={results} audience="pro" />
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar: Status + Chat */}
                <div className="space-y-6">
                    {/* Follow-up status */}
                    <Card className="bg-slate-900 text-white border-slate-800">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <TrendingUp size={14} />
                                Suivi administratif
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <label
                                    htmlFor="dossier-status"
                                    className="text-[10px] font-bold text-slate-300 uppercase mb-1.5 block"
                                >
                                    État actuel
                                </label>
                                <Select value={followUp} onValueChange={setFollowUp}>
                                    <SelectTrigger
                                        id="dossier-status"
                                        className="bg-slate-800 border-slate-700 text-white"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="À traiter">À traiter</SelectItem>
                                        <SelectItem value="En cours d'instruction">
                                            En cours d&apos;instruction
                                        </SelectItem>
                                        <SelectItem value="Besoin de pièces">
                                            Besoin de pièces
                                        </SelectItem>
                                        <SelectItem value="Dossier validé">
                                            Dossier validé
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <Button
                                onClick={handleStatusUpdate}
                                disabled={updating}
                                className="w-full bg-indigo-600 hover:bg-indigo-700"
                            >
                                {updating ? (
                                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                                )}
                                Mettre à jour
                            </Button>

                            {updateProblem ? <p role="alert" className="text-xs text-red-300" data-testid="dossier-status-problem">{updateProblem}</p> : null}
                            {updateSuccess && (
                                <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                                    <CheckCircle2 size={10} /> Statut mis à jour
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Secure chat */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <Lock size={14} className="text-emerald-700" />
                                Messagerie chiffrée à l’enregistrement
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="h-[350px]">
                                <SecureChat
                                    shareId={shareId}
                                    authToken={token}
                                    senderId={user?.id || 'pro'}
                                    receiverId="citizen"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* File vault */}
                    <FileVault shareId={shareId} documents={documents} onUploadSuccess={fetchDossier} />

                    {/* Expert Tools: AI Synthesis + PDF Signature */}
                    <ExpertTools shareId={shareId} aiAllowed={(access?.purposes || []).includes('PURP-05')} />

                    {/* Security badge */}
                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                        <div className="flex items-center gap-2 mb-1.5">
                            <ShieldCheck className="text-emerald-700" size={14} />
                            <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
                                Audit RGPD
                            </span>
                        </div>
                        <p className="text-[11px] text-emerald-700 leading-relaxed">
                            Chaque accès à ce dossier est enregistré. Les messages sont
                            chiffrés à l&apos;enregistrement. Ce n&apos;est pas un chiffrement
                            de bout en bout.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function InfoField(/** @type {{ label: string | number | boolean | null | undefined, value: string | number | boolean | null | undefined }} */ { label, value }) {
    return (
        <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-0.5">
                {label}
            </p>
            <p className="text-sm font-semibold text-slate-900">{value}</p>
        </div>
    );
}
