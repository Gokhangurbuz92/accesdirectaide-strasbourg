// @ts-nocheck
import { useState } from 'react';
import { PASSWORD_RULE } from '@/lib/passwordPolicy';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';

import { ensureCsrfHeaders, getCsrfHeaders } from '@/lib/csrf';
import { useT } from '@/i18n';
export default function ProRegister() {
    const { t } = useT('pro');
    const [structureName, setStructureName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const next = normalizeNextPath(searchParams.get('next'), '/pro/dashboard');
    const loginPath = appendNext('/pro/login', next);

    const handleRegister = async (/** @type {{ preventDefault: () => void; }} */ e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/pro/auth/register', {
                method: 'POST',
                // R7: a first visit has no __csrf cookie yet — ask the server for one first (it was refused « Forbidden »)
                headers: { 'Content-Type': 'application/json', ...((await ensureCsrfHeaders()) || getCsrfHeaders()) },
                body: JSON.stringify({ structureName, email, password })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || t('pro:register.error', 'Erreur lors de l\'inscription'));
            }

            localStorage.setItem('pro_token', data.token);
            navigate(next);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <SEO
                title={t('pro:register.creer_compte_pro', 'Créer un compte Pro')}
                description={t('pro:register.inscription_espace_professionnel_accesdirect', 'Inscription à l\'espace professionnel AccesDirect')}
                path="/pro/register"
                noindex={true}
            />
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle as="h1" className="text-2xl text-center">{t('pro:register.creer_compte_pro', 'Créer un compte Pro')}</CardTitle>
                    <CardDescription className="text-center">{t('pro:register.rejoignez_accesdirect_pour_gerer', 'Rejoignez AccesDirect pour gérer votre structure')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleRegister} className="space-y-4">
                        {error && (
                            <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="structureName">{t('pro:register.nom_structure', 'Nom de la structure')}</Label>
                            <Input
                                id="structureName"
                                type="text"
                                placeholder={t('pro:register.ccas_paris_association_espoir', 'Ex: CCAS de Paris, Association Espoir...')}
                                value={structureName}
                                onChange={e => setStructureName(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email">{t('pro:register.email_professionnel', 'Email professionnel')}</Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">{t('pro:register.mot_passe', 'Mot de passe')}</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                minLength={8}
                                aria-describedby="password-rule"
                            />
                            <p id="password-rule" className="text-xs text-slate-700">{PASSWORD_RULE}</p>
                        </div>
                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "S'inscrire"}
                        </Button>
                        <div className="text-center text-sm text-slate-600 mt-4">
                            {t('pro:register.deja_compte', 'Déjà un compte ?')} <Link to={loginPath} className="text-blue-600 underline underline-offset-2 hover:text-blue-800">{t('pro:register.connecter', 'Se connecter')}</Link>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </main>
    );
}
