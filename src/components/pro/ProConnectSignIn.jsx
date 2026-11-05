import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ensureCsrfHeaders, getCsrfHeaders } from '@/lib/csrf';
import { useT } from '@/i18n';

/**
 * R46 / N09 — ProConnect on the professional sign-in page (api/_handlers/pro/auth/proconnect.js).
 * - CONFIGURED: an « S'identifier avec ProConnect » link (a full-page navigation to the federation); DISCONNECTED: one honest status line, no button.
 * - Back from the federation (`?proconnect=<outcome>`): « continue » completes the hand-off (HttpOnly cookie, never a token in the URL) and hands the ADA
 *   second-factor step to the page (onMfaToken); the other outcomes are explained in the interface language.
 * ProConnect never creates an account and never replaces the ADA second factor.
 * @param {{ next: string, onMfaToken: (token: string) => void }} props
 */
export default function ProConnectSignIn({ next, onMfaToken }) {
  const { t } = useT('pro');
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(/** @type {null | 'CONFIGURED' | 'DISCONNECTED'} */ (null));
  const [message, setMessage] = useState('');
  const [organizations, setOrganizations] = useState(/** @type {{ structureId: string, name: string }[]} */ ([]));
  const [structureId, setStructureId] = useState('');
  const [busy, setBusy] = useState(false);
  const outcome = params.get('proconnect');
  const done = useRef(false);

  useEffect(() => {
    let live = true;
    fetch('/api/pro/auth/proconnect/status', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && (d.status === 'CONFIGURED' || d.status === 'DISCONNECTED')) setStatus(d.status); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  const messages = {
    disconnected: t('pro:proconnect.outcome_disconnected', 'La connexion avec ProConnect n’est pas activée. Utilisez votre adresse et votre mot de passe.'),
    cancelled: t('pro:proconnect.outcome_cancelled', 'Connexion ProConnect annulée.'),
    failed: t('pro:proconnect.outcome_failed', 'La connexion avec ProConnect n’a pas abouti. Réessayez ou utilisez votre mot de passe.'),
    unavailable: t('pro:proconnect.outcome_unavailable', 'ProConnect ne répond pas pour le moment. Réessayez plus tard ou utilisez votre mot de passe.'),
    too_many: t('pro:login.too_many', 'Trop de tentatives : patientez quelques minutes.'),
    no_account: t('pro:proconnect.outcome_no_account', 'Aucun compte professionnel actif ne correspond à cette identité. Un compte est créé uniquement sur invitation de l’administrateur de votre structure.'),
    mfa_enrolment_required: t('pro:proconnect.outcome_mfa_enrolment', 'Votre compte doit d’abord activer la vérification en deux étapes : demandez une invitation d’activation à l’administrateur de votre structure.'),
  };

  const complete = async (/** @type {string} */ chosen) => {
    setBusy(true); setMessage('');
    try {
      const r = await fetch('/api/pro/auth/proconnect/complete', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...((await ensureCsrfHeaders()) || getCsrfHeaders()) },
        body: JSON.stringify(chosen ? { structureId: chosen } : {}),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409 && d.code === 'ORGANIZATION_CHOICE_REQUIRED') { setOrganizations(Array.isArray(d.organizations) ? d.organizations : []); return; }
      if (!r.ok || !d.mfa_token) { setMessage(r.status === 403 ? messages.no_account : messages.failed); return; }
      const rest = new URLSearchParams(params); rest.delete('proconnect'); setParams(rest, { replace: true });
      try { localStorage.setItem('pro_login_via', 'proconnect'); } catch { /* the federation logout is then not offered */ }
      onMfaToken(d.mfa_token);
    } catch {
      setMessage(messages.failed);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!outcome || done.current) return;
    done.current = true;
    if (outcome === 'continue') { complete(''); return; }
    setMessage(/** @type {Record<string, string>} */ (messages)[outcome] || messages.failed);
  }, [outcome]);   // eslint-disable-line react-hooks/exhaustive-deps -- once per return from the federation

  const startHref = `/api/pro/auth/proconnect/start?next=${encodeURIComponent(next)}`;
  return (
    <div className="mt-6 space-y-3" data-testid="pro-proconnect">
      {message ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900" data-testid="pro-proconnect-message">{message}</p> : null}
      {organizations.length > 1 ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (structureId) complete(structureId); }} data-testid="pro-proconnect-organizations">
          <label htmlFor="pro-proconnect-org" className="block text-slate-700 font-bold text-xs uppercase tracking-widest">{t('pro:login.organisation', 'Organisation')}</label>
          <select id="pro-proconnect-org" className="h-14 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base" value={structureId} onChange={(e) => setStructureId(e.target.value)} required>
            <option value="">{t('pro:login.choisissez_organisation', 'Choisissez l\'organisation')}</option>
            {organizations.map((o) => <option key={o.structureId} value={o.structureId}>{o.name}</option>)}
          </select>
          <button type="submit" disabled={busy || !structureId} className="w-full min-h-[44px] rounded-2xl bg-slate-900 px-4 text-white font-bold disabled:opacity-70">{t('pro:proconnect.continue', 'Continuer avec cette organisation')}</button>
        </form>
      ) : null}
      {status === 'CONFIGURED' ? (
        <>
          <a href={startHref} className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border-2 border-blue-800 bg-white px-4 text-base font-bold text-blue-900 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-700" data-testid="pro-proconnect-start">
            {t('pro:proconnect.start', 'S’identifier avec ProConnect')}
          </a>
          <p className="text-center text-xs text-slate-600">{t('pro:proconnect.help', 'ProConnect vérifie votre identité professionnelle. Votre compte Accès Direct Aide (créé sur invitation) et votre code de vérification restent nécessaires.')}</p>
        </>
      ) : null}
      {status === 'DISCONNECTED' && !message ? (
        <p className="text-center text-xs text-slate-600" data-testid="pro-proconnect-status">{t('pro:proconnect.status_disconnected', 'Connexion par ProConnect : non activée pour le moment.')}</p>
      ) : null}
    </div>
  );
}
