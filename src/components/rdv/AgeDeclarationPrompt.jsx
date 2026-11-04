// R42-A07 — an account created before R42 has no age statement: before an appointment, the person states (never pre-ticked) that they are 18 or over.
// A statement, not a verification; no date of birth. The server (POST /api/citizen/age-declaration, R42-AUTH) records it and checks it on every booking.
import { useId, useState } from 'react';
import { csrfFetch } from '@/lib/csrf';
import { useT } from '@/i18n';

/** @param {{ onDeclared: () => void }} props */
export default function AgeDeclarationPrompt({ onDeclared }) {
  const { t } = useT('booking');
  const id = useId();
  const [checked, setChecked] = useState(false);
  const [state, setState] = useState(/** @type {'idle' | 'sending' | 'failed'} */ ('idle'));
  const submit = async () => {
    setState('sending');
    try {
      const res = await csrfFetch('/api/citizen/age-declaration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adult: true }) });
      if (!res.ok) { setState('failed'); return; }
      setState('idle'); onDeclared();
    } catch { setState('failed'); }
  };
  return (
    <section className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-5" data-testid="booking-age-declaration" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="text-base font-semibold text-slate-900">{t('booking:age.title', 'Une dernière vérification')}</h2>
      <p className="text-sm text-slate-800">{t('booking:age.text', 'La prise de rendez-vous en ligne est réservée aux personnes de 18 ans ou plus. Aucune date de naissance ni pièce d’identité n’est demandée.')}</p>
      <label className="flex min-h-11 items-start gap-2 text-sm text-slate-900">
        <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => setChecked(e.target.checked)} data-testid="booking-age-checkbox" />
        {t('booking:age.statement', 'Je déclare avoir 18 ans ou plus.')}
      </label>
      <button type="button" disabled={!checked || state === 'sending'} onClick={submit} data-testid="booking-age-submit"
        className="min-h-11 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('booking:age.submit', 'Confirmer et continuer')}</button>
      <p className="text-xs text-slate-700">{t('booking:age.minor', 'Vous avez moins de 18 ans ? Contactez directement la structure, avec un représentant légal si besoin. En cas de danger : 119 (Enfance en danger) ; en urgence : 112.')}</p>
      {state === 'failed' ? <p role="alert" className="text-sm text-red-800">{t('booking:age.failed', 'Votre déclaration n’a pas pu être enregistrée. Réessayez.')}</p> : null}
    </section>
  );
}
