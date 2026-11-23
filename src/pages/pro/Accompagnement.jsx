// @ts-nocheck
import { useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, useT } from '@/i18n';

/**
 * G14-AID — « Accompagner une personne » (/pro/accompagnement). The professional shows a one-time code (GET /api/pro/assist-code: active account, second
 * factor passed in this session) to the person they help; the person types it in the consent screen of the « mode accompagnant » on their OWN account.
 * The professional never signs in to the person's account and never sees the person's password; the structure is recorded from the database.
 */
export default function ProAccompagnement() {
  const { t } = useT('pro');
  const [state, setState] = useState({ loading: false, code: '', validUntil: null, structureName: '', error: '' });
  const ERRORS = {
    PRO_MFA_REQUIRED: t('pro:assist.err_mfa', 'Reconnectez-vous avec la double authentification pour obtenir un code.'),
    PRO_NOT_ELIGIBLE: t('pro:assist.err_not_eligible', 'Seul un compte ADA Pro actif, avec la double authentification, peut accompagner une personne.'),
    CAPABILITY_NOT_OPEN: t('pro:assist.err_closed', 'Le mode accompagnant n’est pas encore ouvert sur ce service.'),
  };
  const getCode = async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const token = localStorage.getItem('pro_token');
      const res = await fetch('/api/pro/assist-code', { credentials: 'same-origin', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(ERRORS[data.error] || t('pro:assist.err_generic', 'Le code n’a pas pu être obtenu. Réessayez.'));
      setState({ loading: false, code: data.code, validUntil: data.validUntil, structureName: data.structureName || '', error: '' });
    } catch (err) { setState((s) => ({ ...s, loading: false, code: '', error: err.message })); }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8" data-testid="pro-assist">
      <SEO title={t('pro:assist.title', 'Accompagner une personne')} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{t('pro:assist.title', 'Accompagner une personne')}</h1>
      <Card>
        <CardHeader><CardTitle className="text-lg">{t('pro:assist.how_title', 'Comment ça marche')}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-800">
          <ol className="list-inside list-decimal space-y-1">
            <li>{t('pro:assist.step1', 'La personne se connecte elle-même à son compte, sur son téléphone ou sur un ordinateur.')}</li>
            <li>{t('pro:assist.step2', 'Elle ouvre « Mode accompagnant » dans Mon Espace et choisit ce que vous pourrez faire avec elle.')}</li>
            <li>{t('pro:assist.step3', 'Elle saisit votre adresse e-mail professionnelle et le code ci-dessous, puis son mot de passe.')}</li>
          </ol>
          <p>{t('pro:assist.never', 'Vous ne connaissez jamais son mot de passe. Vous ne pouvez pas changer ses identifiants, supprimer son compte, exporter ses données ni ouvrir Mon Coffre. Tout ce que vous faites est noté dans son historique. Elle peut arrêter à tout moment ; la session s’arrête seule au bout de 2 heures au plus.')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-lg">{t('pro:assist.code_title', 'Mon code d’accompagnement')}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-800">
          <Button type="button" onClick={getCode} disabled={state.loading} data-testid="pro-assist-get-code">{t('pro:assist.get_code', 'Afficher un code')}</Button>
          {state.error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900" data-testid="pro-assist-error">{state.error}</p> : null}
          <div aria-live="polite">
            {state.code ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-4" data-testid="pro-assist-code">
                <p className="text-3xl font-bold tracking-widest text-slate-900" dir="ltr">{state.code}</p>
                <p className="mt-1">{t('pro:assist.valid_until', 'Valable jusqu’à {{time}} environ. Ne le donnez qu’à la personne que vous accompagnez.', { time: formatDate(state.validUntil, { timeStyle: 'short' }) })}</p>
                {state.structureName ? <p className="mt-1">{t('pro:assist.structure', 'Structure enregistrée : {{name}}', { name: state.structureName })}</p> : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
