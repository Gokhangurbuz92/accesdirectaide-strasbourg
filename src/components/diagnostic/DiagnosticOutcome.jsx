// @ts-nocheck
import { rememberOwnerSecret } from '@/lib/shareOwner';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Check, Compass, FileDown, Link as LinkIcon, Loader2, Share2 } from 'lucide-react';
import QRCode from 'react-qr-code';
import { csrfFetch } from '@/lib/csrf';
import { readAssessment, shareableResults } from '@/lib/assessmentLabels';
import { openAssistantWithAssessment } from '@/lib/assistantBridge';
import AssessmentView from '@/components/diagnostic/AssessmentView';
import ActionPlan from '@/components/diagnostic/ActionPlan';

/**
 * DTA S1 stage 2b — result area of the diagnostic page, built on the assessment contract only.
 * What leaves this component (PDF, /api/share/create) is `shareableResults(results)`: the contract, never the legacy rights[] / amounts / totals.
 * The RC5 sharing flow (owner secret, organization-bound passport link, CSRF header) is unchanged.
 */
export default function DiagnosticOutcome({ results, situation, structureLoader }) {
    const { period, meta } = results;
    const exportable = shareableResults(results);

    // R18: a failed PDF is said (the button did nothing and said nothing)
    const [pdfProblem, setPdfProblem] = useState('');
    const handleDownloadPDF = async () => {
        setPdfProblem('');
        try {
            const { generateSocialPassport } = await import('@/lib/pdf-generator');
            generateSocialPassport(situation || {}, exportable);
        } catch (err) {
            if (import.meta.env.DEV) console.error('[PDF] Generation failed:', err);
            setPdfProblem('Le PDF n’a pas pu être créé. Vous pouvez réessayer, ou imprimer cette page.');
        }
    };

    const [shareState, setShareState] = useState({ loading: false, url: null, copied: false, passportUrl: null, error: null, copyFailed: false });

    const handleShare = async () => {
        // R14: a dossier already created is never lost — the link is shown before the copy is tried (Safari refuses a copy after an awaited request), a
        // refused copy says « copy it yourself », and a refused creation says why (it used to return silently to the idle button)
        setShareState((s) => ({ ...s, loading: true, error: null, copyFailed: false }));
        try {
            const res = await csrfFetch('/api/share/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ situation: situation || {}, results: exportable }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setShareState((s) => ({ ...s, loading: false, error: res.status === 429 ? 'Trop de partages en peu de temps : réessayez dans quelques minutes.' : 'Le partage n’a pas pu être créé. Réessayez plus tard.' }));
                return;
            }

            const fullUrl = `${window.location.origin}${json.shareUrl}`;
            rememberOwnerSecret(json.shareId, json.ownerSecret, json.expiresAt);
            const passportUrl = json.passportUrl ? `${window.location.origin}${json.passportUrl}` : null;
            setShareState({ loading: false, url: fullUrl, copied: false, passportUrl, error: null, copyFailed: false });
            try {
                await navigator.clipboard.writeText(fullUrl);
                setShareState((s) => ({ ...s, copied: true }));
                setTimeout(() => setShareState((s) => ({ ...s, copied: false })), 4000);
            } catch {
                setShareState((s) => ({ ...s, copyFailed: true }));
            }
        } catch (err) {
            if (import.meta.env.DEV) console.error('[Share] Error:', err);
            setShareState((s) => ({ ...s, loading: false, error: 'Le partage n’a pas pu être créé (réseau). Réessayez.' }));
        }
    };

    return (
        <div className="space-y-6">
            <AssessmentView results={results} linkAides />

            <ActionPlan results={results} structureLoader={structureLoader} />

            {readAssessment(results).usable && (
                <div className="rounded-xl border border-teal-200 bg-teal-50 p-4">
                    <button
                        type="button"
                        data-testid="diagnostic-ask-assistant"
                        onClick={() => openAssistantWithAssessment(results)}
                        className="flex min-h-11 items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                    >
                        <Compass className="h-4 w-4" aria-hidden="true" />
                        Poser une question sur ces pistes
                    </button>
                    <p className="mt-2 text-xs leading-relaxed text-teal-900">
                        La Boussole Sociale reçoit seulement le nom de chaque piste et son état, en lecture seule, et ne les enregistre pas.
                        Elle explique avec les fiches officielles ; elle ne décide pas de vos droits.
                    </p>
                </div>
            )}

            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-amber-900">
                    Ces pistes viennent d&#39;une simulation locale non officielle. Elles ne sont ni une décision, ni une promesse, ni un refus.
                    Pour une demande officielle, adressez-vous à l&#39;organisme compétent (CAF, MSA, Département...).
                </p>
            </div>

            <p data-testid="assisted-note" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
                Vous faites ce diagnostic pour un proche ? ADA ne permet pas d&apos;agir à distance à la place d&apos;une autre personne. Faites-le avec elle, ou orientez-la vers un professionnel.
            </p>

            {pdfProblem ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-testid="pdf-problem">{pdfProblem}</p> : null}
            <div id="share-actions" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                    type="button"
                    onClick={handleDownloadPDF}
                    className="flex min-h-11 items-center justify-center gap-3 rounded-2xl border-2 border-indigo-200 bg-indigo-50 px-5 py-4 text-sm font-bold text-indigo-800 transition-all hover:border-indigo-400 hover:bg-indigo-100 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 active:scale-[0.98]"
                >
                    <FileDown className="h-5 w-5" aria-hidden="true" />
                    Télécharger PDF
                </button>
                <button
                    type="button"
                    onClick={handleShare}
                    disabled={shareState.loading}
                    className={`flex min-h-11 items-center justify-center gap-3 rounded-2xl border-2 px-5 py-4 text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 active:scale-[0.98] ${shareState.copied
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 hover:shadow-md'
                        }`}
                >
                    {shareState.loading ? (
                        <><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Création…</>
                    ) : shareState.copied ? (
                        <><Check className="h-5 w-5" aria-hidden="true" /> Lien copié !</>
                    ) : (
                        <><Share2 className="h-5 w-5" aria-hidden="true" /> Partager le dossier</>
                    )}
                </button>
            </div>

            <div className="mt-6">
                <Link to="/ressources?emergency=1" data-testid="diagnostic-emergency-resources" className="font-semibold text-red-700 underline focus:outline-none focus:ring-2 focus:ring-red-500">
                    Besoin d’aide urgente ? Voir les ressources d’urgence
                </Link>
            </div>

            <p role="status" data-testid="share-status" className={shareState.error || shareState.copyFailed ? 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900' : 'sr-only'}>
                {shareState.error || (shareState.copyFailed ? 'Le lien n’a pas pu être copié automatiquement : sélectionnez-le ci-dessous et copiez-le.' : shareState.copied ? 'Lien copié.' : '')}
            </p>

            {shareState.url && (
                <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2">
                        <LinkIcon className="h-4 w-4 flex-shrink-0 text-indigo-500" aria-hidden="true" />
                        <code className="flex-1 truncate text-xs text-slate-600">{shareState.url}</code>
                        <button
                            type="button"
                            onClick={() => {
                                navigator.clipboard.writeText(shareState.url);
                                setShareState((s) => ({ ...s, copied: true }));
                                setTimeout(() => setShareState((s) => ({ ...s, copied: false })), 3000);
                            }}
                            className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                        >
                            Copier
                        </button>
                    </div>
                    {shareState.passportUrl && (
                        <p className="text-xs text-slate-600">
                            Pour <strong>partager avec une structure</strong>, retirer un accès ou supprimer vos données (lien privé, ne le donnez à personne) :{' '}
                            <a className="underline break-all text-indigo-700" href={shareState.passportUrl}>Mon partage</a>
                        </p>
                    )}
                    <div className="flex flex-col items-center justify-center gap-3 pt-2">
                        <div className="text-center">
                            <p className="text-sm font-bold text-slate-700">Continuité diagnostic</p>
                            <p className="text-xs text-slate-500">Scannez ce QR Code pour reprendre sur votre mobile</p>
                        </div>
                        <div className="rounded-xl bg-white p-3 shadow-sm border border-slate-200">
                            <QRCode value={shareState.url} size={160} level="M" />
                        </div>
                    </div>
                </div>
            )}

            {meta && (
                <p className="text-center text-xs text-slate-700">
                    ID : {meta.requestId} • Durée : {meta.duration_ms}ms{period ? ` • Période : ${period}` : ''}
                </p>
            )}
        </div>
    );
}
