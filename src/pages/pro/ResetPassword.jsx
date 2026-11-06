// @ts-nocheck
import { useState } from 'react';
import { passwordProblems } from '@/lib/passwordPolicy';
import { passwordMessageText } from '@/lib/passwordPolicyText';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { ensureCsrfHeaders, getCsrfHeaders } from '@/lib/csrf';
import { useT } from '@/i18n';
export default function ResetPassword() {
    const { t } = useT('pro');
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const navigate = useNavigate();

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [status, setStatus] = useState({ type: '', message: '' });
    const [loading, setLoading] = useState(false);

    if (!token) {
        return (
            <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
                <h1 className="text-xl font-bold text-slate-900">{t('pro:reset.nouveau_mot_passe', 'Nouveau mot de passe')}</h1>
                <Alert variant="destructive" className="max-w-md">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{t('pro:reset.lien_invalide_manquant', 'Lien invalide ou manquant.')} <Link className="underline" to="/pro/forgot-password">{t('pro:reset.demander_nouveau_lien', 'Demander un nouveau lien')}</Link></AlertDescription>
                </Alert>
            </main>
        );
    }

    const handleSubmit = async (/** @type {{ preventDefault: () => void; }} */ e) => {
        e.preventDefault();
        if (password !== confirm) {
            setStatus({ type: 'error', message: t('pro:reset.mismatch', 'Les mots de passe ne correspondent pas.') });
            return;
        }
        const problems = passwordProblems(password);   // R21: the shared rule, the same sentence as the server
        if (problems.length) {
             setStatus({ type: 'error', message: passwordMessageText(problems) });
             return;
        }

        setLoading(true);
        setStatus({ type: '', message: '' });

        try {
            const res = await fetch('/api/pro/auth/reset-password', {
                method: 'POST',
                // R7: a first visit has no __csrf cookie yet — ask the server for one first (it was refused « Forbidden »)
                headers: { 'Content-Type': 'application/json', ...((await ensureCsrfHeaders()) || getCsrfHeaders()) },
                body: JSON.stringify({ token, password })
            });
            const data = await res.json().catch(() => ({}));

            // the server's French messages (link invalid / expired, password too short); a French fallback for anything else
            if (!res.ok) throw new Error(res.status === 400 && /[éèà]|Lien|mot de passe/.test(String(data.error || '')) ? data.error : res.status === 429 ? t('pro:reset.too_many', 'Trop de tentatives : patientez quelques minutes.') : t('pro:reset.failed', 'La modification a échoué. Réessayez.'));

            setStatus({ type: 'success', message: t('pro:reset.done', 'Mot de passe modifié !') });
            setTimeout(() => navigate('/pro/login'), 2000);

        } catch (err) {
            setStatus({ type: 'error', message: err.message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <SEO title={t('pro:reset.nouveau_mot_passe', 'Nouveau mot de passe')} noindex={true} />
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle as="h1">{t('pro:reset.nouveau_mot_passe', 'Nouveau mot de passe')}</CardTitle>
                </CardHeader>
                <CardContent>
                     {status.message && (
                        <Alert variant={status.type === 'error' ? "destructive" : "default"} className={`mb-4 ${status.type === 'success' ? 'bg-green-50 text-green-800 border-green-200' : ''}`}>
                            {status.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                            <AlertDescription>{status.message}</AlertDescription>
                        </Alert>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="pass">{t('pro:reset.mot_passe', 'Mot de passe')}</Label>
                            <Input
                                id="pass"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="confirm">{t('pro:reset.confirmation', 'Confirmation')}</Label>
                            <Input
                                id="confirm"
                                type="password"
                                value={confirm}
                                onChange={e => setConfirm(e.target.value)}
                                required
                            />
                        </div>
                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? <Loader2 className="animate-spin h-4 w-4" /> : t('pro:reset.submit', 'Valider')}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </main>
    );
}
