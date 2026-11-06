import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { apiClient } from '@/api/client';
import { ensureCsrfHeaders } from '@/lib/csrf';
import SEO from '@/components/SEO';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useT } from '@/i18n';

/**
 * PKG-5 / A16 — administrator login (separate surface: POST /api/admin/login), then the MFA step: a 6-digit code when MFA is active, or the first setup
 * (authenticator QR + first code). Without MFA an administrator session can only read; every change needs MFA.
 */
/** The secret of the otpauth URI in groups of four, for an authenticator that cannot scan (or a person who cannot see the QR code). @param {string} uri */
const manualKey = (uri) => { try { return (new URL(uri).searchParams.get('secret') || '').replace(/(.{4})/g, '$1 ').trim(); } catch { return ''; } };

export default function AdminLogin() {
    const { t } = useT('admin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [step, setStep] = useState(/** @type {'credentials'|'mfa'|'setup'} */ ('credentials'));
    const [code, setCode] = useState('');
    const [otpauth, setOtpauth] = useState('');
    const [problem, setProblem] = useState('');
    const navigate = useNavigate();
    const [params] = useSearchParams();
    // R47: opened by a protected administration page without an administrator session (signed out, or signed in as a citizen or a professional)
    const restricted = params.get('reason') === 'restricted';

    const handleLogin = async (/** @type {{ preventDefault: () => void; }} */ e) => {
        e.preventDefault(); setProblem('');
        try {
            await ensureCsrfHeaders();   // the double-submit cookie for this first protected POST of the page
            const out = await apiClient.auth.adminLogin(email, password);
            if (out.mfa_required) { setStep('mfa'); return; }
            if (out.mfa_setup_required && !out.readOnly) {
                const setup = await apiClient.auth.adminMfaSetup().catch(() => null);
                if (setup?.otpauth) { setOtpauth(setup.otpauth); setStep('setup'); return; }
                // no silent fallback: without MFA the session can only read, and the person must know why
                setProblem(t('admin:login.mfa_setup_failed', 'La configuration de la MFA a échoué : réessayez de vous connecter. Sans MFA, l’administration reste en lecture seule.'));
                return;
            }
            toast.success(t('admin:login.success_read_only', 'Connexion réussie (lecture seule tant que la MFA n’est pas active)'));
            navigate('/admin');
        } catch {
            setProblem(t('admin:login.failed', 'Connexion impossible : vérifiez vos identifiants.'));
        }
    };
    const handleCode = async (/** @type {{ preventDefault: () => void; }} */ e) => {
        e.preventDefault(); setProblem('');
        try {
            await apiClient.auth.adminMfaVerify(code.trim());
            toast.success(t('admin:login.verified', 'Connexion vérifiée (MFA)'));
            navigate('/admin');
        } catch {
            setProblem(t('admin:login.invalid_code', 'Code invalide ou expiré.'));
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
            <SEO title={t('admin:login.title', 'Administration')} description={t('admin:login.seo_description', 'Connexion à l\'espace d\'administration')} path="/admin/login" noindex={true} />
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle as="h1" className="text-center">{t('admin:login.title', 'Administration')}</CardTitle>
                </CardHeader>
                <CardContent>
                    {restricted && step === 'credentials' ? <p className="mb-3 rounded border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800" data-testid="admin-login-restricted">{t('admin:login.restricted', 'Cette page est réservée à l’équipe d’administration d’Accès Direct Aide. Connectez-vous avec votre compte administrateur ; un compte citoyen ou professionnel n’y donne pas accès.')}</p> : null}
                    {problem ? <p role="alert" className="mb-3 text-red-800" data-testid="admin-login-problem">{problem}</p> : null}
                    {step === 'credentials' ? (
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div className="space-y-2">
                                <label htmlFor="email">{t('admin:login.email', 'Email')}</label>
                                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="password">{t('admin:login.password', 'Mot de passe')}</label>
                                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                            </div>
                            <Button type="submit" className="w-full">{t('admin:login.submit', 'Se connecter')}</Button>
                        </form>
                    ) : (
                        <form onSubmit={handleCode} className="space-y-4" data-testid="admin-mfa-form">
                            {step === 'setup' ? (
                                <div className="space-y-2 text-sm">
                                    <p>{t('admin:login.first_setup', 'Première connexion : ajoutez ce compte dans votre application d’authentification (scannez le code), puis saisissez le code à 6 chiffres affiché.')}</p>
                                    <div className="flex justify-center bg-white p-2"><QRCode value={otpauth} size={160} aria-label={t('admin:login.qr_label', 'Code QR de configuration MFA')} /></div>
                                    <details data-testid="admin-mfa-manual">
                                        <summary className="cursor-pointer underline">{t('admin:login.manual_summary', 'Impossible de scanner ? Saisir la clé à la main')}</summary>
                                        <p className="mt-1">{t('admin:login.manual_steps', 'Dans l’application, choisissez « saisir une clé », type « basé sur le temps » (TOTP, 6 chiffres, 30 secondes), puis recopiez :')}</p>
                                        <p className="mt-1 font-mono text-base break-all" aria-label={t('admin:login.key_label', 'Clé de configuration')}>{manualKey(otpauth)}</p>
                                        <p className="mt-1">{t('admin:login.key_warning', 'Cette clé vaut un mot de passe : ne la photographiez pas et ne la transmettez à personne.')}</p>
                                    </details>
                                </div>
                            ) : <p className="text-sm">{t('admin:login.enter_code', 'Saisissez le code à 6 chiffres de votre application d’authentification.')}</p>}
                            <div className="space-y-2">
                                <label htmlFor="mfa-code">{t('admin:login.mfa_code', 'Code MFA')}</label>
                                <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
                            </div>
                            <Button type="submit" className="w-full">{t('admin:login.validate', 'Valider')}</Button>
                        </form>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
