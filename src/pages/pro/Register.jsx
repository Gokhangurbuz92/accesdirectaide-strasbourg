// @ts-nocheck
import { useState } from 'react';
import { passwordRuleText } from '@/lib/passwordPolicyText';
import { Link, useSearchParams } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';

import { ensureCsrfHeaders, getCsrfHeaders } from '@/lib/csrf';
import { useT } from '@/i18n';
export default function ProRegister() {
    const { t } = useT('pro');
    const [structureName, setStructureName] = useState('');
    const [siret, setSiret] = useState('');
    const [received, setReceived] = useState(false);   // G14: a request, not an open space — nothing signs in here
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
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
                // G14: pressing « Envoyer ma demande » under the terms sentence accepts them (recorded with their version, as at the invited sign-up)
                body: JSON.stringify({ structureName, siret, email, password, termsAccepted: true })
            });

            const data = await res.json();

            if (!res.ok) {
                // R43 (E1): the public structure sign-up is closed by default (Production, beta) — said in the interface language
                if (data.error === 'PRO_SELF_REGISTRATION_CLOSED') throw new Error(t('pro:register.closed', 'La création libre d\'un espace structure n\'est pas ouverte. Les structures partenaires sont créées par l\'équipe d\'Accès Direct Aide, puis leurs membres reçoivent une invitation nominative.'));
                if (data.code === 'PRO_TERMS_NOT_IN_FORCE') throw new Error(t('pro:register.terms_not_in_force', 'L’inscription d’une structure n’est pas encore ouverte : les conditions d’utilisation des professionnels ne sont pas encore en vigueur.'));
                if (data.code === 'SIRET_INVALID') throw new Error(t('pro:register.siret_invalid', 'Indiquez le numéro SIRET de la structure (14 chiffres).'));
                if (data.code === 'STRUCTURE_NAME_INVALID') throw new Error(t('pro:register.name_invalid', 'Le nom de la structure doit compter entre {{min}} et {{max}} caractères.', { min: 2, max: 200 }));
                throw new Error(data.error || t('pro:register.error', 'Erreur lors de l\'inscription'));
            }
            setReceived(true);
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
                    <CardDescription className="text-center">{t('pro:register.intro_verification', 'Demandez l’ouverture de l’espace de votre structure. Il s’ouvre après une vérification sur une source officielle.')}</CardDescription>
                </CardHeader>
                <CardContent>
                    {received ? (
                        <div role="status" className="space-y-3 text-sm text-slate-800" data-testid="pro-register-received">
                            <p className="flex items-start gap-2 font-semibold text-slate-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('pro:register.received', 'Demande reçue — votre structure sera vérifiée sur une source officielle avant l’ouverture de votre espace.')}</p>
                            <p>{t('pro:register.received_next', 'Vous recevrez un e-mail dès que la vérification sera faite, avec un lien pour activer la double authentification. Votre espace n’est pas ouvert d’ici là.')}</p>
                        </div>
                    ) : (
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
                                minLength={2}
                                maxLength={200}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="siret">{t('pro:register.siret', 'Numéro SIRET de la structure')}</Label>
                            <Input
                                id="siret"
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                value={siret}
                                onChange={e => setSiret(e.target.value)}
                                required
                                pattern="[0-9 ]{14,17}"
                                aria-describedby="siret-help"
                            />
                            <p id="siret-help" className="text-xs text-slate-700">{t('pro:register.siret_help', '14 chiffres. L’équipe d’Accès Direct Aide vérifie votre structure sur une source officielle avant d’ouvrir votre espace.')}</p>
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
                            <p id="password-rule" className="text-xs text-slate-700">{passwordRuleText()}</p>
                        </div>
                        {/* G14: the professional terms are accepted by sending the request (a contract acceptance recorded with its version, not a GDPR consent) */}
                        <div className="space-y-1 text-sm text-slate-800" data-testid="pro-register-terms-statement">
                            <p id="pro-register-terms">
                                {t('pro:register.terms_before', 'En envoyant ma demande, j’accepte les')}{' '}
                                <Link className="text-blue-900 underline" to="/cgu/professionnel">{t('pro:register_pro.terms_link', 'conditions d’utilisation des professionnels')}</Link>
                                {' '}{t('pro:register_pro.terms_and', 'et, pour ma structure, les')}{' '}
                                <Link className="text-blue-900 underline" to="/conditions-structures">{t('pro:register_pro.terms_structures_link', 'conditions pour les structures')}</Link>
                                {t('pro:register_pro.terms_after', '.')}
                            </p>
                            <p>
                                {t('pro:register_pro.privacy_before', 'Mes données sont traitées comme expliqué dans la')}{' '}
                                <Link className="text-blue-900 underline" to="/confidentialite/notice">{t('pro:register_pro.privacy_link', 'notice de confidentialité')}</Link>
                                {t('pro:register_pro.privacy_after', '.')}
                            </p>
                        </div>
                        <Button type="submit" className="w-full" disabled={loading} aria-describedby="pro-register-terms">
                            {loading ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : t('pro:register.submit_request', 'Envoyer ma demande')}
                        </Button>
                        <div className="text-center text-sm text-slate-600 mt-4">
                            {t('pro:register.deja_compte', 'Déjà un compte ?')} <Link to={loginPath} className="text-blue-600 underline underline-offset-2 hover:text-blue-800">{t('pro:register.connecter', 'Se connecter')}</Link>
                        </div>
                    </form>
                    )}
                </CardContent>
            </Card>
        </main>
    );
}
