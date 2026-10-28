// @ts-nocheck
import { useState, useEffect } from 'react';
import { PASSWORD_RULE, passwordMessage, passwordProblems } from '@/lib/passwordPolicy';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SEO from '@/components/SEO';
import { ensureCsrfHeaders, getCsrfHeaders } from '@/lib/csrf';
import {
    Loader2,
    ShieldCheck,
    CheckCircle2,
    AlertCircle,
    Building2,
    Eye,
    EyeOff,
} from 'lucide-react';

/**
 * RegisterPro — Page d'inscription via lien d'invitation
 *
 * URL: /pro/register?token=...
 *
 * 1. Valide le token côté API (GET)
 * 2. Affiche le formulaire de création de mot de passe
 * 3. Crée le compte (POST) et redirige vers le dashboard
 */
export default function RegisterPro() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') || '';

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [invitation, setInvitation] = useState(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // 1. Validate token on mount
    useEffect(() => {
        if (!token) {
            setError('Aucun token d\'invitation fourni.');
            setLoading(false);
            return;
        }

        const validate = async () => {
            try {
                const res = await fetch(
                    `/api/pro/auth/register-invite?token=${encodeURIComponent(token)}`
                );
                const data = await res.json();

                if (!res.ok) {
                    setError(data.error || 'Invitation invalide.');
                    return;
                }

                setInvitation(data);
            } catch {
                setError('Impossible de valider l\'invitation.');
            } finally {
                setLoading(false);
            }
        };

        validate();
    }, [token]);

    // 2. Submit registration
    const handleSubmit = async (/** @type {{ preventDefault: () => void; }} */ e) => {
        e.preventDefault();
        setError('');

        const problems = passwordProblems(password);   // R21: the shared rule, the same sentence as the server
        if (problems.length) {
            setError(passwordMessage(problems));
            return;
        }

        if (password !== confirmPassword) {
            setError('Les mots de passe ne correspondent pas.');
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch('/api/pro/auth/register-invite', {
                method: 'POST',
                // R7: a first visit has no __csrf cookie yet — ask the server for one first (it was refused « Forbidden »)
                headers: { 'Content-Type': 'application/json', ...((await ensureCsrfHeaders()) || getCsrfHeaders()) },
                body: JSON.stringify({ token, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Erreur lors de l\'inscription.');
                return;
            }

            // Store JWT and redirect
            localStorage.setItem('pro_token', data.token);
            setSuccess(true);

            setTimeout(() => {
                navigate('/pro/dashboard');
            }, 1500);
        } catch {
            setError('Erreur réseau. Veuillez réessayer.');
        } finally {
            setSubmitting(false);
        }
    };

    // Loading state
    if (loading) {
        return (
            <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
                <SEO
                    title="Inscription Professionnelle"
                    description="Rejoignez votre structure sur ADA"
                    noindex
                />
                <div className="w-full max-w-md space-y-4" role="status" aria-label="Vérification de l'invitation">
                    <div className="animate-pulse space-y-4">
                        <div className="flex justify-center">
                            <div className="h-14 w-14 rounded-2xl bg-indigo-100" />
                        </div>
                        <div className="h-6 w-48 mx-auto bg-slate-200 rounded-lg" />
                        <div className="h-4 w-32 mx-auto bg-slate-100 rounded" />
                        <div className="border border-slate-200 rounded-xl p-6 space-y-3">
                            <div className="h-4 w-full bg-slate-100 rounded" />
                            <div className="h-4 w-2/3 bg-slate-100 rounded" />
                            <div className="h-10 w-full bg-slate-100 rounded-lg" />
                        </div>
                    </div>
                    <span className="sr-only">Vérification de votre invitation en cours…</span>
                </div>
            </main>
        );
    }

    // Error state (invalid/expired token)
    if (error && !invitation) {
        return (
            <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
                <SEO title="Invitation invalide" noindex />
                <Card className="w-full max-w-md">
                    <CardContent className="p-8 text-center">
                        <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <AlertCircle className="text-red-500" size={28} />
                        </div>
                        <h1 className="text-xl font-bold text-slate-900 mb-2">
                            Invitation invalide
                        </h1>
                        <p className="text-sm text-slate-700 mb-6">{error}</p>
                        <Link
                            to="/pro/login"
                            className="text-indigo-600 font-medium text-sm hover:underline"
                        >
                            Se connecter à un compte existant
                        </Link>
                    </CardContent>
                </Card>
            </main>
        );
    }

    // Success state
    if (success) {
        return (
            <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
                <
// @ts-ignore
                SEO title="Inscription réussie" noindex />
                <Card className="w-full max-w-md">
                    <CardContent className="p-8 text-center">
                        <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle2 className="text-emerald-700" size={28} />
                        </div>
                        <h1 className="text-xl font-bold text-slate-900 mb-2">
                            Bienvenue dans l&apos;équipe !
                        </h1>
                        <p className="text-sm text-slate-700">
                            Redirection vers votre espace professionnel...
                        </p>
                    </CardContent>
                </Card>
            </main>
        );
    }

    // Registration form
    return (
        <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
            <SEO
                title="Inscription Professionnelle - ADA"
                description="Rejoignez votre structure sur AccesDirectAide"
                noindex
            />

            <div className="w-full max-w-md space-y-6">
                {/* Context banner */}
                <div className="text-center">
                    <div className="inline-flex p-3 bg-indigo-100 rounded-2xl mb-4">
                        <Building2 className="text-indigo-600" size={28} />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900">
                        Rejoindre l&apos;équipe
                    </h1>
                    <p className="text-slate-700 mt-1 text-sm">
                        Vous êtes invité(e) à rejoindre
                    </p>
                </div>

                {/* Invitation details */}
                <Card className="border-indigo-200 bg-indigo-50/30">
                    <CardContent className="p-4 space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                            <Building2 size={14} className="text-indigo-600" />
                            <span className="font-semibold text-slate-900">
                                {invitation?.structureName}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                            <span>Email :</span>
                            <span className="font-medium">{invitation?.email}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                            <span>Rôle :</span>
                            <span className="font-medium">
                                {invitation?.role === 'STRUCTURE_ADMIN'
                                    ? 'Administrateur'
                                    : 'Professionnel'}
                            </span>
                        </div>
                    </CardContent>
                </Card>

                {/* Registration form */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Créer votre accès</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="reg-password">Mot de passe</Label>
                                <div className="relative">
                                    <Input
                                        id="reg-password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        aria-describedby="reg-password-rule"
                                        required
                                        autoComplete="new-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((v) => !v)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600"
                                        aria-label={showPassword ? 'Masquer' : 'Afficher'}
                                    >
                                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                                <p id="reg-password-rule" className="text-xs text-slate-700">{PASSWORD_RULE}</p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="reg-confirm">Confirmer le mot de passe</Label>
                                <Input
                                    id="reg-confirm"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="Retapez le mot de passe"
                                    required
                                    autoComplete="new-password"
                                />
                            </div>

                            {error && (
                                <div
                                    className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2"
                                    role="alert"
                                >
                                    <AlertCircle size={14} /> {error}
                                </div>
                            )}

                            <Button
                                type="submit"
                                disabled={submitting}
                                className="w-full"
                            >
                                {submitting ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                {submitting ? 'Création en cours...' : 'Créer mon accès'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                {/* Security notice */}
                <div className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                    <ShieldCheck size={14} className="shrink-0" aria-hidden="true" />
                    <span>
                        Votre mot de passe n&apos;est jamais conservé en clair (empreinte). Messages et documents
                        échangés sont chiffrés à l&apos;enregistrement, sur une connexion chiffrée (HTTPS).
                    </span>
                </div>
            </div>
        </main>
    );
}
