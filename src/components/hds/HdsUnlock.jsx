// @ts-nocheck
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { proSetupMember, proUnlock, unlockCitizen } from '@/lib/hdsSharing';
import { VAULT_PASSPHRASE_MIN } from '@/lib/vaultCrypto';

/**
 * G14-R4 — unlock the keys of THIS page (memory only). Citizen: the Mon Coffre passphrase (the same key protects the shared dossiers and the attachments).
 * Professional: the personal passphrase of ADA Pro encryption (created on first use). Nothing typed here is sent: the passphrase opens a key in the browser.
 * @param {{ side: 'citizen' | 'pro', hasKey?: boolean, onDone: () => void, testid?: string }} props
 */
export default function HdsUnlock({ side, hasKey = true, onDone, testid = 'hds-unlock' }) {
  const { t } = useT('compte');
  const ids = { a: useId(), b: useId() };
  const [a, setA] = useState(''); const [b, setB] = useState('');
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState('');
  const creating = side === 'pro' && !hasKey;
  const submit = async (e) => {
    e.preventDefault(); setProblem('');
    if (creating && a.length < VAULT_PASSPHRASE_MIN) { setProblem(t('compte:hds.too_short', 'La phrase secrète doit contenir au moins {{min}} caractères.', { min: VAULT_PASSPHRASE_MIN })); return; }
    if (creating && a !== b) { setProblem(t('compte:hds.mismatch', 'Les deux phrases secrètes ne sont pas identiques.')); return; }
    setBusy(true);
    try {
      const ok = side === 'pro' ? (creating ? await proSetupMember(a) : await proUnlock(a)) : await unlockCitizen(a);
      if (ok === false) { setProblem(t('compte:hds.wrong', 'Phrase secrète incorrecte.')); return; }
      setA(''); setB(''); onDone();
    } catch (err) {
      setProblem(err?.code === 'KEYRING_REQUIRED' ? t('compte:hds.no_coffre', 'Protégez d’abord Mon Coffre par une phrase secrète.') : (err?.serverMessage || t('compte:hds.error', 'Une erreur est survenue. Réessayez.')));
    } finally { setBusy(false); }
  };
  return (
    <form className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4" onSubmit={submit} data-testid={testid}>
      <p className="text-sm text-slate-800">{side === 'pro'
        ? (creating ? t('compte:hds.pro_create_intro', 'Créez votre phrase secrète personnelle. Elle protège la clé qui ouvre les dossiers confiés à votre structure. Personne ne peut la retrouver pour vous.')
          : t('compte:hds.pro_unlock_intro', 'Tapez votre phrase secrète personnelle pour ouvrir les dossiers chiffrés de votre structure.'))
        : t('compte:hds.citizen_unlock_intro', 'Tapez la phrase secrète de Mon Coffre. Elle ouvre vos dossiers partagés et vos pièces jointes dans ce navigateur seulement.')}</p>
      <div><label htmlFor={ids.a} className="block text-sm font-medium text-slate-800">{t('compte:hds.passphrase', 'Phrase secrète')}</label>
        <input id={ids.a} type="password" autoComplete={creating ? 'new-password' : 'current-password'} className="mt-1 w-full rounded-md border border-slate-400 p-2" value={a} onChange={(e) => setA(e.target.value)} data-testid={`${testid}-pass`} /></div>
      {creating ? <div><label htmlFor={ids.b} className="block text-sm font-medium text-slate-800">{t('compte:hds.passphrase_confirm', 'Confirmez la phrase secrète')}</label>
        <input id={ids.b} type="password" autoComplete="new-password" className="mt-1 w-full rounded-md border border-slate-400 p-2" value={b} onChange={(e) => setB(e.target.value)} data-testid={`${testid}-pass2`} /></div> : null}
      {problem ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-900" data-testid={`${testid}-problem`}>{problem}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy} data-testid={`${testid}-submit`}>{busy ? t('compte:hds.working', 'Chiffrement en cours…') : creating ? t('compte:hds.create', 'Créer ma clé') : t('compte:hds.open', 'Ouvrir')}</Button>
        {side === 'citizen' ? <Link className="text-sm text-blue-800 underline" to="/compte/coffre">{t('compte:hds.go_coffre', 'Aller à Mon Coffre')}</Link> : null}
      </div>
    </form>
  );
}
