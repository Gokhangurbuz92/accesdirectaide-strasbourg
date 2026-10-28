// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useCallback } from 'react';
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
import { MFA_ERROR } from '@/lib/proLabels.js';
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

export default function MfaSettings() {
    const [step, setStep] = useState(0); // 0 = loading, 1 = intro, 2 = secret, 3 = verify, 4 = success
    const [secret, setSecret] = useState('');
    const [otpauthUrl, setOtpauthUrl] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [mfaEnabled, setMfaEnabled] = useState(false);
    const [copied, setCopied] = useState(false);

    // Check MFA status on mount
    useState(() => {
        (async () => {
            try {
                const res = await fetch('/api/pro/me', { headers: getAuthHeaders() });
                if (res.ok) {
                    const data = await res.json();
                    const enabled = data.user?.mfa_enabled ?? false;
                    setMfaEnabled(enabled);
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
            const res = await fetch('/api/pro/mfa-setup', { headers: getAuthHeaders() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || MFA_ERROR[data.error] || data.error || 'Erreur serveur');
            setSecret(data.secret);
            setOtpauthUrl(data.otpauthUrl);
            setStep(2);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const verifyAndEnable = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/pro/mfa-setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...getCsrfHeaders() },
                body: JSON.stringify({ code }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || MFA_ERROR[data.error] || data.error || 'Code incorrect');
            setMfaEnabled(true);
            setStep(4);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [code]);

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
            if (!res.ok) throw new Error(data.error || 'Erreur');
            setMfaEnabled(false);
            setCode('');
            setStep(1);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [code]);

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
            <SEO title="Double Authentification — AccesDirectAide" noindex />
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-3 p-3 bg-teal-50 rounded-xl w-fit">
                        {step === 4 ? (
                            <CheckCircle2 className="text-emerald-700" size={28} />
                        ) : (
                            <ShieldCheck className="text-teal-600" size={28} />
                        )}
                    </div>
                    <CardTitle as="h1">Double Authentification</CardTitle>
                    <CardDescription>
                        {step === 4
                            ? 'MFA activé avec succès'
                            : mfaEnabled
                                ? 'MFA est actuellement actif sur votre compte'
                                : 'Protégez votre compte avec un code temporaire'}
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                    {error && (
                        <Alert variant="destructive">
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
                                    Google Authenticator, Authy ou FreeOTP
                                </div>
                                <div className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-lg text-sm text-slate-600">
                                    <Lock className="text-teal-600 shrink-0" size={16} />
                                    Code unique toutes les 30 secondes
                                </div>
                            </div>
                            <Button onClick={startSetup} disabled={loading} className="w-full">
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                                Configurer le MFA
                            </Button>
                        </>
                    )}

                    {/* Step 1 with MFA already enabled — show disable option */}
                    {step === 1 && mfaEnabled && (
                        <>
                            <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100 text-center">
                                <CheckCircle2 className="text-emerald-700 mx-auto mb-2" size={20} />
                                <p className="text-sm font-medium text-emerald-800">
                                    La double authentification est active.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="disable-code">Pour désactiver, entrez votre code actuel</Label>
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
                                Désactiver le MFA
                            </Button>
                        </>
                    )}

                    {/* Step 2: Show secret */}
                    {step === 2 && (
                        <>
                            <p className="text-sm text-slate-600 text-center">
                                Copiez ce secret dans votre application d&apos;authentification :
                            </p>
                            <div className="relative">
                                <code className="block w-full p-3 bg-slate-100 rounded-lg text-center font-mono text-sm tracking-wider break-all select-all">
                                    {secret}
                                </code>
                                <button
                                    type="button"
                                    onClick={copySecret}
                                    className="absolute top-2 right-2 p-1.5 rounded-md bg-white border border-slate-200 text-slate-600 hover:text-slate-700"
                                    title="Copier"
                                >
                                    {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                </button>
                            </div>
                            <details className="text-xs text-slate-600">
                                <summary className="cursor-pointer hover:text-slate-600">URL otpauth (avancé)</summary>
                                <code className="block mt-1 p-2 bg-slate-50 rounded text-[10px] break-all">{otpauthUrl}</code>
                            </details>
                            <Button onClick={() => setStep(3)} className="w-full">
                                <ArrowRight className="mr-2 h-4 w-4" />
                                J&apos;ai ajouté le secret
                            </Button>
                            <button
                                type="button"
                                onClick={() => setStep(1)}
                                className="w-full text-sm text-slate-700 hover:text-slate-700 flex items-center justify-center gap-1"
                            >
                                <ArrowLeft size={14} /> Annuler
                            </button>
                        </>
                    )}

                    {/* Step 3: Verify code */}
                    {step === 3 && (
                        <>
                            <p className="text-sm text-slate-600 text-center">
                                Entrez le code à 6 chiffres affiché dans votre application :
                            </p>
                            <div className="space-y-2">
                                <Label htmlFor="verify-code">Code de vérification</Label>
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
                                Activer le MFA
                            </Button>
                            <button
                                type="button"
                                onClick={() => { setStep(2); setCode(''); }}
                                className="w-full text-sm text-slate-700 hover:text-slate-700 flex items-center justify-center gap-1"
                            >
                                <ArrowLeft size={14} /> Revoir le secret
                            </button>
                        </>
                    )}

                    {/* Step 4: Success */}
                    {step === 4 && (
                        <>
                            <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100 text-center">
                                <p className="text-sm font-medium text-emerald-800">
                                    Votre compte est protégé par la double authentification.
                                </p>
                            </div>
                            <a href="/pro/dashboard">
                                <Button className="w-full">Retour au tableau de bord</Button>
                            </a>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
