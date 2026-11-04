// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SEO from '@/components/SEO';
import {
    ShieldCheck,
    Loader2,
    Smartphone,
    Lock,
    CheckCircle2,
    AlertCircle,
    Copy,
    ArrowRight,
    ArrowLeft,
    ShieldOff,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { getCsrfHeaders } from '@/lib/csrf';
import { pendingInvitePath, takePendingInvite } from '@/lib/pendingInvite';
import { useT } from '@/i18n';
/**
 * MfaSettings — TOTP setup / disable page
 *
 * Route: /pro/mfa-settings
 *
 * Step 1: Introduction — start setup
 * Step 2: Show secret (copy-paste into authenticator app)
 * Step 3: Verify initial code → enable MFA
 * Step 4: Success confirmation
 */

function getAuthHeaders() {
    const token = localStorage.getItem('pro_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * R42-A08: the enrolment grant (from register-invite, or from redeeming the e-mailed invitation) lives in this tab only; the invitation link carries its
 * token in the URL FRAGMENT (#invitation=…), never sent to a server and removed from the address bar as soon as it is read.
 */
export const MFA_ENROLMENT_KEY = 'ada_pro_mfa_enrolment';
const readGrant = () => { try { return sessionStorage.getItem(MFA_ENROLMENT_KEY) || ''; } catch { return ''; } };
const dropGrant = () => { try { sessionStorage.removeItem(MFA_ENROLMENT_KEY); } catch { /* nothing kept */ } };
function invitationFromLocation() {
    let hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (!/^#invitation=/.test(hash) && pendingInvitePath() === '/pro/mfa-settings') hash = takePendingInvite('/pro/mfa-settings');
    const m = /^#invitation=([^&]+)/.exec(hash || '');
    if (typeof window !== 'undefined' && /^#invitation=/.test(window.location.hash)) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return m ? decodeURIComponent(m[1]) : '';
}

export default function MfaSettings() {
    const { t } = useT('pro');
    // the server error codes, in the interface language (unknown codes stay as sent)
    const mfaError = (c) => ({
        MFA_ALREADY_ENABLED: t('pro:mfa.error.already_enabled', 'La double authentification est déjà activée sur votre compte.'),
        MFA_NOT_ENABLED: t('pro:mfa.error.not_enabled', 'La double authentification n’est pas activée.'),
        INVALID_CODE: t('pro:mfa.error.invalid_code', 'Code incorrect ou expiré.'),
        MFA_UNAVAILABLE: t('pro:mfa.error.unavailable', 'La double authentification est momentanément indisponible.'),
        MFA_INVITATION_REQUIRED: t('pro:mfa.error.invitation_required', 'La double authentification s’active uniquement avec une invitation envoyée par un administrateur de votre structure. Demandez-lui une invitation, puis ouvrez le lien reçu par e-mail.'),
        MFA_INVITATION_INVALID: t('pro:mfa.error.invitation_invalid', 'Ce lien d’activation n’est pas valable pour votre compte (déjà utilisé, expiré ou destiné à une autre personne). Demandez une nouvelle invitation à un administrateur de votre structure.'),
    })[c];
    const mfaRequired = useLocation().state?.mfaRequired === true;   // R34: sent here because ADA Pro requires the second factor
    const [step, setStep] = useState(0); // 0 = loading, 1 = intro, 2 = secret, 3 = verify, 4 = success
    const [secret, setSecret] = useState('');
    const [otpauthUrl, setOtpauthUrl] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [mfaEnabled, setMfaEnabled] = useState(false);
    const [copied, setCopied] = useState(false);
    const [hasGrant, setHasGrant] = useState(() => Boolean(readGrant()));

    // Check MFA status on mount
    useState(() => {
        (async () => {
            try {
                const res = await fetch('/api/pro/me', { headers: getAuthHeaders() });
                if (res.ok) {
                    const data = await res.json();
                    const enabled = data.user?.mfa_enabled ?? false;
                    setMfaEnabled(enabled);
                    const invitation = invitationFromLocation();
                    if (!enabled && invitation) {
                        // R42-A08: the invitation is redeemed by THIS signed-in account only (the server checks structure, e-mail and role)
                        const r = await fetch('/api/pro/mfa-enrolment', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...getCsrfHeaders() }, body: JSON.stringify({ token: invitation }) });
                        const out = await r.json().catch(() => ({}));
                        if (r.ok && out.enrolmentToken) {
                            try { sessionStorage.setItem(MFA_ENROLMENT_KEY, out.enrolmentToken); } catch { /* the setup below is refused and says why */ }
                            setHasGrant(true);
                        } else {
                            setError(mfaError(out.error) || out.message || t('pro:mfa.error.server', 'Erreur serveur'));
                        }
                    }
                    setStep(1);
                } else {
                    setStep(1);
                }
            } catch {
                setStep(1);
            }
        })();
    });

    const startSetup = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/pro/mfa-setup', { headers: { ...getAuthHeaders(), 'x-ada-mfa-enrolment': readGrant() } });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || mfaError(data.error) || data.error || t('pro:mfa.error.server', 'Erreur serveur'));
            setSecret(data.secret);
            setOtpauthUrl(data.otpauthUrl);
            setStep(2);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- t only changes the message language

    const verifyAndEnable = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/pro/mfa-setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...getCsrfHeaders() },
                body: JSON.stringify({ code, enrolmentToken: readGrant() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || mfaError(data.error) || data.error || t('pro:mfa.error.code', 'Code incorrect'));
            // R34: the server hands a session that passed the second factor: the dossiers open without signing in again
            if (data.token) localStorage.setItem('pro_token', data.token);
            dropGrant();
            setHasGrant(false);
            setMfaEnabled(true);
            setStep(4);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [code]);   // eslint-disable-line react-hooks/exhaustive-deps -- t only changes the message language

    const disableMfa = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/pro/mfa-setup', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...getCsrfHeaders() },
                body: JSON.stringify({ code }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || t('pro:mfa.error.generic', 'Erreur'));
            setMfaEnabled(false);
            setCode('');
            setStep(1);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [code]);   // eslint-disable-line react-hooks/exhaustive-deps -- t only changes the message language

    const copySecret = useCallback(() => {
        navigator.clipboard?.writeText(secret);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [secret]);

    if (step === 0) {
        return (
            <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <SEO title={t('pro:mfa.seo_title', 'Double Authentification — AccesDirectAide')} noindex />
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-3 p-3 bg-teal-50 rounded-xl w-fit">
                        {step === 4 ? (
                            <CheckCircle2 className="text-emerald-700" size={28} />
                        ) : (
                            <ShieldCheck className="text-teal-600" size={28} />
                        )}
                    </div>
                    <CardTitle as="h1">{t('pro:mfa.title', 'Double Authentification')}</CardTitle>
                    <CardDescription>
                        {step === 4
                            ? t('pro:mfa.subtitle.success', 'MFA activé avec succès')
                            : mfaEnabled
                                ? t('pro:mfa.subtitle.active', 'MFA est actuellement actif sur votre compte')
                                : t('pro:mfa.subtitle.intro', 'Protégez votre compte avec un code temporaire')}
                    </CardDescription>
                    {mfaRequired && step !== 4 && (
                        <p role="status" data-testid="mfa-required-notice" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900">
                            {t('pro:mfa.required_notice', 'La double authentification est obligatoire pour accéder aux dossiers et aux messages d’ADA Pro. Activez-la pour continuer.')}
                        </p>
                    )}
                </CardHeader>

                <CardContent className="space-y-4">
                    {error && (
                        <Alert variant="destructive" role="alert">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {/* Step 1: Intro / Status */}
                    {step === 1 && !mfaEnabled && (
                        <>
                            <div className="space-y-2">
                                <div className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-lg text-sm text-slate-600">
                                    <Smartphone className="text-teal-600 shrink-0" size={16} />
                                    {t('pro:mfa.apps', 'Google Authenticator, Authy ou FreeOTP')}
                                </div>
                                <div className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-lg text-sm text-slate-600">
                                    <Lock className="text-teal-600 shrink-0" size={16} />
                                    {t('pro:mfa.code_every_30s', 'Code unique toutes les 30 secondes')}
                                </div>
                            </div>
                            {hasGrant ? (
                                <Button onClick={startSetup} disabled={loading} className="w-full">
                                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                                    {t('pro:mfa.configure', 'Configurer le MFA')}
                                </Button>
                            ) : (
                                <p role="status" data-testid="mfa-invitation-required" className="rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-800">
                                    {t('pro:mfa.invitation_required_notice', 'Pour protéger votre compte, la double authentification s’active uniquement avec une invitation envoyée par un administrateur de votre structure (le mot de passe seul ne suffit pas). Demandez-lui une invitation, puis ouvrez le lien reçu par e-mail en étant connecté·e.')}
                                </p>
                            )}
                        </>
                    )}

                    {/* Step 1 with MFA already enabled — show disable option */}
                    {step === 1 && mfaEnabled && (
                        <>
                            <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100 text-center">
                                <CheckCircle2 className="text-emerald-700 mx-auto mb-2" size={20} />
                                <p className="text-sm font-medium text-emerald-800">
                                    {t('pro:mfa.is_active', 'La double authentification est active.')}
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="disable-code">{t('pro:mfa.disable_label', 'Pour désactiver, entrez votre code actuel')}</Label>
                                <Input
                                    id="disable-code"
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="000000"
                                    maxLength={6}
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    className="text-center text-xl tracking-[0.3em] font-mono"
                                />
                            </div>
                            <Button
                                variant="destructive"
                                onClick={disableMfa}
                                disabled={loading || code.length !== 6}
                                className="w-full"
                            >
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldOff className="mr-2 h-4 w-4" />}
                                {t('pro:mfa.disable', 'Désactiver le MFA')}
                            </Button>
                        </>
                    )}

                    {/* Step 2: Show secret */}
                    {step === 2 && (
                        <>
                            <p className="text-sm text-slate-600 text-center">
                                {t('pro:mfa.copy_secret_intro', 'Copiez ce secret dans votre application d\'authentification :')}
                            </p>
                            <div className="relative">
                                <code className="block w-full p-3 bg-slate-100 rounded-lg text-center font-mono text-sm tracking-wider break-all select-all">
                                    {secret}
                                </code>
                                <button
                                    type="button"
                                    onClick={copySecret}
                                    className="absolute top-2 right-2 p-1.5 rounded-md bg-white border border-slate-200 text-slate-600 hover:text-slate-700"
                                    title={t('pro:mfa.copy', 'Copier')}
                                >
                                    {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                </button>
                            </div>
                            <details className="text-xs text-slate-600">
                                <summary className="cursor-pointer hover:text-slate-600">{t('pro:mfa.otpauth_url', 'URL otpauth (avancé)')}</summary>
                                <code className="block mt-1 p-2 bg-slate-50 rounded text-[10px] break-all">{otpauthUrl}</code>
                            </details>
                            <Button onClick={() => setStep(3)} className="w-full">
                                <ArrowRight className="mr-2 h-4 w-4" />
                                {t('pro:mfa.secret_added', 'J\'ai ajouté le secret')}
                            </Button>
                            <button
                                type="button"
                                onClick={() => setStep(1)}
                                className="w-full text-sm text-slate-700 hover:text-slate-700 flex items-center justify-center gap-1"
                            >
                                <ArrowLeft size={14} /> {t('pro:mfa.cancel', 'Annuler')}
                            </button>
                        </>
                    )}

                    {/* Step 3: Verify code */}
                    {step === 3 && (
                        <>
                            <p className="text-sm text-slate-600 text-center">
                                {t('pro:mfa.enter_code_intro', 'Entrez le code à 6 chiffres affiché dans votre application :')}
                            </p>
                            <div className="space-y-2">
                                <Label htmlFor="verify-code">{t('pro:mfa.verify_label', 'Code de vérification')}</Label>
                                <Input
                                    id="verify-code"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    placeholder="000000"
                                    maxLength={6}
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    className="text-center text-xl tracking-[0.3em] font-mono"
                                />
                            </div>
                            <Button onClick={verifyAndEnable} disabled={loading || code.length !== 6} className="w-full">
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                {t('pro:mfa.enable', 'Activer le MFA')}
                            </Button>
                            <button
                                type="button"
                                onClick={() => { setStep(2); setCode(''); }}
                                className="w-full text-sm text-slate-700 hover:text-slate-700 flex items-center justify-center gap-1"
                            >
                                <ArrowLeft size={14} /> {t('pro:mfa.review_secret', 'Revoir le secret')}
                            </button>
                        </>
                    )}

                    {/* Step 4: Success */}
                    {step === 4 && (
                        <>
                            <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100 text-center">
                                <p className="text-sm font-medium text-emerald-800">
                                    {t('pro:mfa.protected', 'Votre compte est protégé par la double authentification.')}
                                </p>
                            </div>
                            <a href="/pro/dashboard">
                                <Button className="w-full">{t('pro:mfa.back_dashboard', 'Retour au tableau de bord')}</Button>
                            </a>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
