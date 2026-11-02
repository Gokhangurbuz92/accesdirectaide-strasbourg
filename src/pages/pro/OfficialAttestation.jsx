// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import SEO from '@/components/SEO';
import brand from '@/lib/brand-config';
import { readAssessment } from '@/lib/assessmentLabels';
import { useAssessmentLabels } from '@/lib/assessmentLabelsI18n';
import { Printer, ArrowLeft, Info } from 'lucide-react';
import i18n, { useT } from '@/i18n';
import { Trans } from 'react-i18next';

/**
 * Printable dossier RECAP for the professional who holds access — Route: /pro/attestation/:shareId (data: /api/pro/attestation-data).
 * PKG-6 / G: before, this page called itself a « certified » attestation with an « authorized signatory », a « digital seal », a QR « integrity check » on a
 * portal that does not exist and an « administrative evidentiary document (art. L.114-8 CRPA) » notice — and showed DEMO data when the request failed.
 * None of that was true. It is now an explicitly UNSIGNED recap; a failed request shows an error, never invented data. A real electronic signature needs a
 * qualified trust service and an identity check (external prerequisite), not this page.
 */
export default function OfficialAttestation() {
    const { t } = useT('pro');
    const { state: STATE_LABELS } = useAssessmentLabels();
    const { shareId } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const [error, setError] = useState('');

    const fetchData = useCallback(async () => {
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('pro_token') : null;
            const res = await fetch(`/api/pro/attestation-data?shareId=${encodeURIComponent(shareId)}`, {
                credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (res.ok) {
                setData((await res.json()).attestation);
            } else {
                setError(res.status === 410 ? t('pro:attestation.expired', 'Ce dossier a expiré.') : res.status === 401 ? t('pro:attestation.session_expired', 'Votre session a expiré : reconnectez-vous.') : t('pro:attestation.not_found', 'Ce dossier est introuvable ou n’est plus partagé avec votre structure.'));
            }
        } catch {
            setError(t('pro:attestation.load_failed', 'Le récapitulatif n’a pas pu être chargé. Réessayez.'));
        } finally {
            setLoading(false);
        }
    }, [shareId]);   // eslint-disable-line react-hooks/exhaustive-deps -- the message follows the language at load time

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    if (loading) {
        return (
            <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
        );
    }

    if (error || !data) {
        return (
            <div className="max-w-xl mx-auto p-6" role="alert" data-testid="recap-error">
                <h1 className="text-xl font-bold text-slate-900 mb-2">{t('pro:attestation.title', 'Récapitulatif d\'accompagnement')}</h1>
                <p className="text-sm text-slate-800">{error || t('pro:attestation.unavailable', 'Récapitulatif indisponible.')}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate(-1)}>{t('pro:attestation.back', 'Retour')}</Button>
            </div>
        );
    }

    const att = data;
    const { items } = readAssessment(att.results);

    return (
        <div className="min-h-screen bg-slate-100 pb-16">
            <SEO title={t('pro:attestation.seo_title', 'Récapitulatif {{ref}} — ADA', { ref: att.reference })} noindex />

            {/* Toolbar (hidden on print) */}
            <div className="print:hidden sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-3">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label={t('pro:attestation.back', 'Retour')}>
                            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <div>
                            <p className="text-xs font-bold text-slate-900">{t('pro:attestation.toolbar_title', 'Récapitulatif du dossier')}</p>
                            <p className="text-xs text-slate-600">{t('pro:attestation.ref', 'Réf. {{ref}}', { ref: att.reference })}</p>
                        </div>
                    </div>
                    <Button size="sm" onClick={() => window.print()}>
                        <Printer className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        {t('pro:attestation.print', 'Imprimer ou enregistrer en PDF')}
                    </Button>
                </div>
            </div>

            <div className="max-w-3xl mx-auto mt-6 print:mt-0">
                <article className="bg-white shadow-xl print:shadow-none border border-slate-200 print:border-none p-8 md:p-14" data-testid="dossier-recap">
                    <header className="flex justify-between items-start border-b-2 pb-6 mb-8" style={{ borderColor: brand.colors.primary }}>
                        <div>
                            <p className="text-sm font-bold uppercase" style={{ color: brand.colors.primary }}>{brand.name}</p>
                            <p className="text-xs text-slate-600">{brand.region}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-slate-600 uppercase font-bold mb-1">{t('pro:attestation.printed_on', 'Imprimé le')}</p>
                            <p className="text-base font-bold text-slate-900">{att.date}</p>
                        </div>
                    </header>

                    <h1 className="text-xl md:text-2xl font-bold text-slate-900 mb-2">{t('pro:attestation.title', 'Récapitulatif d\'accompagnement')}</h1>
                    <p className="text-sm text-slate-800 mb-6" data-testid="recap-unsigned-notice">
                        <Trans i18n={i18n} i18nKey="pro:attestation.unsigned_notice" defaults="Document non signé, sans valeur d'attestation officielle. Il reprend les pistes d'orientation du dossier partagé par la personne (jeton <0>{{token}}</0>). Ce ne sont pas des décisions : chaque piste doit être vérifiée auprès de l'organisme concerné." values={{ token: att.usagerToken }} components={[<strong key="0" />]} />
                    </p>

                    <dl className="grid grid-cols-2 gap-6 py-6 border-y border-slate-200 mb-8">
                        <div><dt className="text-xs font-bold text-slate-600 uppercase mb-1">{t('pro:attestation.reference', 'Référence')}</dt><dd className="text-sm font-bold text-slate-900">{att.reference}</dd></div>
                        <div><dt className="text-xs font-bold text-slate-600 uppercase mb-1">{t('pro:attestation.valid_until', 'Partage valable jusqu\'au')}</dt><dd className="text-sm font-bold text-slate-900">{att.expiresAt ? new Date(att.expiresAt).toLocaleDateString('fr-FR') : t('pro:attestation.not_specified', 'Non précisé')}</dd></div>
                        <div><dt className="text-xs font-bold text-slate-600 uppercase mb-1">{t('pro:attestation.prepared_by', 'Préparé par')}</dt><dd className="text-sm text-slate-900">{att.professional?.name} ({att.professional?.role})</dd></div>
                        <div><dt className="text-xs font-bold text-slate-600 uppercase mb-1">{t('pro:attestation.signature', 'Signature')}</dt><dd className="text-sm text-slate-900">{t('pro:attestation.no_signature', 'Aucune (document non signé)')}</dd></div>
                    </dl>

                    <section aria-labelledby="recap-items-title">
                        <h2 id="recap-items-title" className="text-base font-bold text-slate-900 mb-3">{t('pro:attestation.items_title', 'Pistes d\'orientation')}</h2>
                        {items.length ? (
                            <ul className="space-y-2" data-testid="recap-items">
                                {items.map((it) => (
                                    <li key={it.code || it.label} className="text-sm text-slate-800">
                                        <strong>{it.label}</strong> — {STATE_LABELS[it.state]}{it.whoToAsk ? ` (${t('pro:attestation.who_to_ask', 'à demander à : {{who}}', { who: it.whoToAsk })})` : ''}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-slate-700">{t('pro:attestation.no_items', 'Aucune piste d\'orientation dans ce dossier.')}</p>
                        )}
                    </section>

                    <footer className="mt-10 pt-4 border-t border-slate-200">
                        <p className="text-xs text-slate-600 break-all">{t('pro:attestation.fingerprint', 'Empreinte du contenu (SHA-256) : {{fp}}', { fp: att.fingerprint })}</p>
                        <p className="text-xs text-slate-600">{t('pro:attestation.fingerprint_note', 'L\'empreinte permet de comparer deux impressions ; elle ne prouve ni l\'auteur ni la validité du document.')}</p>
                    </footer>
                </article>

                <div className="mt-6 print:hidden rounded-lg border border-slate-300 bg-white p-4 flex items-start gap-3">
                    <Info size={16} className="text-slate-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <p className="text-xs text-slate-700">
                        {t('pro:attestation.no_esign', 'AccesDirectAide ne propose pas encore de signature électronique. Une attestation signée nécessite un prestataire de confiance qualifié et la vérification de l\'identité du signataire.')}
                    </p>
                </div>
            </div>
        </div>
    );
}
