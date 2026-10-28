// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import SEO from '@/components/SEO';
import SmsToggle from '@/components/SmsToggle';
import { getCsrfHeaders } from '@/lib/csrf';
import { OWNER_HEADER, resolveOwnerSecret, forgetOwnerSecret } from '@/lib/shareOwner';
import CitizenSharingPanel from '@/components/sharing/CitizenSharingPanel';
import {
    ShieldCheck,
    Calendar,
    FileText,
    Trash2,
    Download,
    Clock,
    CheckCircle2,
    AlertTriangle,
    User,
    Lock,
    Video,
    MapPin,
    ArrowLeft,
    File,
} from 'lucide-react';

/**
 * UserPassport — Espace souverain du citoyen
 *
 * Route: /passport/:shareId
 *
 * No account needed — the private OWNER link (`/passport/:id#owner=...`, or the secret remembered in this browser)
 * proves ownership; the shareId alone is only an identifier. The citizen can:
 * - View upcoming appointments
 * - See consent & file status
 * - Revoke all access (RGPD right to be forgotten)
 */
export default function UserPassport() {
    const { shareId } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [revokeStep, setRevokeStep] = useState('idle'); // idle | confirm | revoking | done

    const [ownerSecret] = useState(() => resolveOwnerSecret(shareId));

    const fetchPassport = useCallback(async () => {
        setLoading(true);
        if (!ownerSecret) {
            setError('Lien privé requis : ouvrez le lien « passeport » fourni lors de la création du partage.');
            setLoading(false);
            return;
        }
        try {
            const res = await fetch(
                `/api/public/passport?shareId=${encodeURIComponent(shareId)}`,
                { headers: { [OWNER_HEADER]: ownerSecret } }
            );
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                setError(d.error || 'Dossier introuvable.');
                return;
            }
            setData(await res.json());
        } catch {
            setError('Impossible de charger votre passeport.');
        } finally {
            setLoading(false);
        }
    }, [shareId, ownerSecret]);

    useEffect(() => {
        fetchPassport();
    }, [fetchPassport]);

    // Revoked state
    if (revokeStep === 'done') {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <SEO title="Données supprimées — ADA" noindex />
                <Card className="max-w-sm w-full text-center">
                    <CardContent className="p-8">
                        <div className="w-14 h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Trash2 size={24} />
                        </div>
                        <h1 className="text-lg font-bold text-slate-900 mb-2" data-testid="passport-erased">
                            Données supprimées
                        </h1>
                        <p className="text-sm text-slate-500 mb-6">
                            Conformément à vos droits RGPD, votre dossier partagé a été supprimé
                            et plus aucune structure n&apos;y a accès. Certaines traces techniques peuvent être conservées pour respecter la loi.
                        </p>
                        <Button asChild className="w-full">
                            <Link to="/">Retour à l&apos;accueil</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Loading
    if (loading) {
        return (
            <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
        );
    }

    // Error
    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <Card className="max-w-sm w-full text-center">
                    <CardContent className="p-8">
                        <AlertTriangle className="text-amber-500 mx-auto mb-4" size={28} />
                        <h1 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">Dossier partagé</h1>{/* Q10: the page heading; the state below keeps its h2 */}
                        <h2 className="text-lg font-bold text-slate-900 mb-2">
                            Dossier inaccessible
                        </h2>
                        <p className="text-sm text-slate-500 mb-4">{error}</p>
                        <Button variant="outline" asChild>
                            <Link to="/">
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Accueil
                            </Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const passport = data?.passport || {};
    const appointments = passport.appointments || [];

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <
// @ts-ignore
            SEO title="Mon Passeport — ADA" noindex />
            <div className="max-w-xl mx-auto space-y-5">
                {/* Header */}
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-600 text-white rounded-xl">
                        <User size={18} />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-slate-900">
                            Mon Passeport ADA
                        </h1>
                        <p className="text-xs text-emerald-800 font-semibold flex items-center gap-1">
                            <ShieldCheck size={12} aria-hidden="true" /> Connexion chiffrée (HTTPS)
                        </p>
                    </div>
                </div>

                {/* Status cards */}
                <div className="grid grid-cols-2 gap-3">
                    <Card>
                        <CardContent className="p-4">
                            <p className="text-[10px] font-bold text-slate-600 uppercase mb-1">
                                Statut
                            </p>
                            <p className="text-sm font-bold flex items-center gap-1.5">
                                {passport.isExpired ? (
                                    <><Clock size={12} className="text-red-500" /> Expiré</>
                                ) : (
                                    <><CheckCircle2 size={12} className="text-emerald-500" /> Actif</>
                                )}
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <p className="text-[10px] font-bold text-slate-600 uppercase mb-1">
                                Expire le
                            </p>
                            <p className="text-sm font-bold text-slate-900">
                                {passport.expiresAt
                                    ? new Date(passport.expiresAt).toLocaleDateString('fr-FR')
                                    : '--'}
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <p className="text-[10px] font-bold text-slate-600 uppercase mb-1">
                                Consentement
                            </p>
                            <p className="text-sm font-bold flex items-center gap-1.5">
                                {passport.hasConsent ? (
                                    <><CheckCircle2 size={12} className="text-emerald-500" /> Signé</>
                                ) : (
                                    <><Clock size={12} className="text-amber-500" /> En attente</>
                                )}
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <p className="text-[10px] font-bold text-slate-600 uppercase mb-1">
                                Justificatifs
                            </p>
                            <p className="text-sm font-bold flex items-center gap-1.5">
                                <File size={12} className="text-indigo-500" />
                                {passport.filesCount || 0} fichier(s)
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Appointments */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold flex items-center gap-2">
                            <Calendar size={14} className="text-indigo-500" />
                            Vos rendez-vous
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {appointments.length === 0 ? (
                            <p className="text-sm text-slate-600 py-4 text-center">
                                Aucun rendez-vous à venir
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {appointments.map((/** @type {{ date: string | number, id: string | number, mode: string | number, professional: string | number, service: string | number }} */ apt) => (
                                    <div
                                        key={apt.id}
                                        className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3"
                                    >
                                        <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center text-indigo-600 border border-slate-100">
                                            {apt.mode === 'visio' ? (
                                                <Video size={14} />
                                            ) : (
                                                <MapPin size={14} />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-slate-900">
                                                {apt.service}
                                            </p>
                                            <p className="text-[10px] text-slate-600">
                                                {new Date(apt.date).toLocaleDateString('fr-FR', {
                                                    weekday: 'short',
                                                    day: 'numeric',
                                                    month: 'short',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}{' '}
                                                {apt.professional ? ` · ${apt.professional}` : null}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* SMS Reminder — shown for each upcoming appointment */}
                {appointments.length > 0 && (
                    <SmsToggle appointmentId={appointments[0].id} shareId={shareId} ownerSecret={ownerSecret} />
                )}

                {/* Sharing & data control: share with one organization / remove one / stop all / erase - four distinct actions */}
                <CitizenSharingPanel shareId={shareId} ownerSecret={ownerSecret} onErased={() => { forgetOwnerSecret(shareId); setRevokeStep('done'); }} />

                {/* Footer */}
                {/* PKG-11 audit pass 2: the dossier's situation and results are stored as plain JSON; only documents and messages are encrypted at rest */}
                <p className="text-center text-xs text-slate-600 py-2">
                    Connexion chiffrée (HTTPS). Vos justificatifs et vos messages sont chiffrés à l’enregistrement ; le résumé de votre situation ne l’est pas.
                </p>
            </div>
        </div>
    );
}
