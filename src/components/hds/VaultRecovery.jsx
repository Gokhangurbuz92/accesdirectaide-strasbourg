// @ts-nocheck
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/i18n';
import { saveBlob } from '@/lib/hdsClient';
import { VAULT_PASSPHRASE_MIN } from '@/lib/vaultCrypto';

/**
 * G14-R4 — Mon Coffre recovery, in the person's words (FALC). The recovery code is drawn in the browser, shown ONCE here, printed or saved by the person;
 * it is never sent nor kept by AccèsDirectAide or the host. Three pieces: the one-time display, the « forgotten passphrase » form, the security card
 * (change the passphrase, draw a new code). The cryptography is in src/lib/vaultCrypto.js; the page (CompteCoffre) wires them to the HDS service.
 */

/** the one-time display of a recovery code; `onDone` only after the person confirms they kept it @param {{ code: string, onDone: () => void }} props */
export function RecoveryCodePanel({ code, onDone }) {
  const { t } = useT('compte');
  const id = useId();
  const [kept, setKept] = useState(false);
  const fileText = () => [
    t('compte:recovery.file_title', 'Code de secours de Mon Coffre — AccèsDirectAide'),
    '', code, '',
    t('compte:recovery.file_date', 'Créé le {{date}}', { date: new Date().toLocaleDateString() }),
    t('compte:recovery.file_help', 'Ce code ouvre Mon Coffre si vous oubliez votre phrase secrète. Il ne sert qu’une fois. Gardez-le dans un endroit sûr, loin de votre téléphone ou de votre ordinateur. Ne le donnez à personne.'),
  ].join('\n');
  return (
    <Card data-testid="coffre-recovery-code" className="border-amber-300">
      <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:recovery.title', 'Votre code de secours')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-800">{t('compte:recovery.intro', 'Ce code ouvre Mon Coffre si vous oubliez votre phrase secrète. Il s’affiche une seule fois. Imprimez-le ou enregistrez-le, puis rangez-le dans un endroit sûr.')}</p>
        <p className="rounded-md border border-slate-300 bg-slate-50 p-3 text-center font-mono text-xl tracking-wider text-slate-900" dir="ltr" lang="fr" data-testid="coffre-recovery-value"
          aria-label={t('compte:recovery.code_label', 'Code de secours : {{spelled}}', { spelled: code.split('').join(' ') })}>{code}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
          <li>{t('compte:recovery.rule_once', 'Il ne sert qu’une fois : après l’avoir utilisé, vous recevrez un nouveau code.')}</li>
          <li>{t('compte:recovery.rule_secret', 'Ne le donnez à personne. AccèsDirectAide ne vous le demandera jamais.')}</li>
          <li>{t('compte:recovery.rule_lost', 'Si vous perdez à la fois votre phrase secrète et ce code, personne ne pourra ouvrir vos documents.')}</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => saveBlob(new Blob([fileText()], { type: 'text/plain;charset=utf-8' }), 'code-de-secours-mon-coffre.txt')} data-testid="coffre-recovery-download">{t('compte:recovery.download', 'Enregistrer le code (fichier)')}</Button>
          <Button type="button" variant="outline" onClick={() => window.print()} data-testid="coffre-recovery-print">{t('compte:recovery.print', 'Imprimer le code')}</Button>
        </div>
        <label htmlFor={id} className="flex items-start gap-2 text-sm text-slate-900">
          <input id={id} type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} data-testid="coffre-recovery-kept" />
          <span>{t('compte:recovery.kept', 'J’ai imprimé ou enregistré ce code et je le garde dans un endroit sûr.')}</span>
        </label>
        <Button type="button" disabled={!kept} onClick={onDone} data-testid="coffre-recovery-done">{t('compte:recovery.continue', 'Continuer')}</Button>
      </CardContent>
    </Card>
  );
}

/** « J'ai oublié ma phrase secrète » @param {{ busy: boolean, onSubmit: (code: string, passphrase: string) => void, onCancel: () => void, onProblem: (m: string) => void }} props */
export function VaultRecoveryForm({ busy, onSubmit, onCancel, onProblem }) {
  const { t } = useT('compte');
  const ids = { code: useId(), a: useId(), b: useId() };
  const [v, setV] = useState({ code: '', a: '', b: '' });
  const submit = (e) => {
    e.preventDefault();
    if (v.code.replace(/[^A-Za-z0-9]/g, '').length < 20) { onProblem(t('compte:recovery.code_short', 'Le code de secours compte 25 caractères (lettres et chiffres).')); return; }
    if (v.a.length < VAULT_PASSPHRASE_MIN) { onProblem(t('compte:coffre.e2e_too_short', 'La phrase secrète doit contenir au moins {{min}} caractères.', { min: VAULT_PASSPHRASE_MIN })); return; }
    if (v.a !== v.b) { onProblem(t('compte:coffre.e2e_mismatch', 'Les deux phrases secrètes ne sont pas identiques.')); return; }
    onSubmit(v.code, v.a);
  };
  return (
    <form className="grid gap-3" onSubmit={submit} data-testid="coffre-recover-form">
      <p className="text-sm text-slate-800">{t('compte:recovery.recover_intro', 'Tapez votre code de secours, puis choisissez une nouvelle phrase secrète. Vous recevrez aussi un nouveau code de secours.')}</p>
      <div><label htmlFor={ids.code} className="block text-sm font-medium text-slate-800">{t('compte:recovery.code_input', 'Code de secours')}</label>
        <input id={ids.code} autoComplete="off" spellCheck={false} dir="ltr" className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono uppercase" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} data-testid="coffre-recover-code" /></div>
      <div><label htmlFor={ids.a} className="block text-sm font-medium text-slate-800">{t('compte:recovery.new_passphrase', 'Nouvelle phrase secrète ({{min}} caractères au moins)', { min: VAULT_PASSPHRASE_MIN })}</label>
        <input id={ids.a} type="password" autoComplete="new-password" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={v.a} onChange={(e) => setV({ ...v, a: e.target.value })} data-testid="coffre-recover-pass" /></div>
      <div><label htmlFor={ids.b} className="block text-sm font-medium text-slate-800">{t('compte:coffre.e2e_passphrase_confirm', 'Confirmez la phrase secrète')}</label>
        <input id={ids.b} type="password" autoComplete="new-password" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={v.b} onChange={(e) => setV({ ...v, b: e.target.value })} data-testid="coffre-recover-pass2" /></div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} data-testid="coffre-recover-submit">{busy ? t('compte:coffre.e2e_working', 'Chiffrement en cours…') : t('compte:recovery.recover_submit', 'Ouvrir Mon Coffre avec le code')}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>{t('compte:recovery.back', 'Retour')}</Button>
      </div>
    </form>
  );
}

/**
 * change the passphrase, or draw a new recovery code (the old one stops working); both ask for the current passphrase
 * @param {{ busy: boolean, hasRecovery: boolean, onChange: (current: string, next: string) => void, onRenew: (current: string) => void, onProblem: (m: string) => void }} props
 */
export function VaultSecurityCard({ busy, hasRecovery, onChange, onRenew, onProblem }) {
  const { t } = useT('compte');
  const ids = { cur: useId(), a: useId(), b: useId(), cur2: useId() };
  const [v, setV] = useState({ cur: '', a: '', b: '', cur2: '' });
  const change = (e) => {
    e.preventDefault();
    if (v.a.length < VAULT_PASSPHRASE_MIN) { onProblem(t('compte:coffre.e2e_too_short', 'La phrase secrète doit contenir au moins {{min}} caractères.', { min: VAULT_PASSPHRASE_MIN })); return; }
    if (v.a !== v.b) { onProblem(t('compte:coffre.e2e_mismatch', 'Les deux phrases secrètes ne sont pas identiques.')); return; }
    onChange(v.cur, v.a); setV({ ...v, cur: '', a: '', b: '' });
  };
  const renew = (e) => { e.preventDefault(); onRenew(v.cur2); setV({ ...v, cur2: '' }); };
  return (
    <Card data-testid="coffre-security">
      <CardHeader><CardTitle as="h2" className="text-lg">{t('compte:recovery.security_title', 'Protection de Mon Coffre')}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        {!hasRecovery ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="coffre-no-recovery">{t('compte:recovery.missing', 'Vous n’avez pas encore de code de secours. Créez-en un : sans lui, une phrase secrète oubliée rend vos documents illisibles.')}</p> : null}
        <form className="grid gap-3" onSubmit={change} data-testid="coffre-change-form">
          <h3 className="font-semibold text-slate-900">{t('compte:recovery.change_title', 'Changer ma phrase secrète')}</h3>
          <div><label htmlFor={ids.cur} className="block text-sm text-slate-800">{t('compte:recovery.current', 'Phrase secrète actuelle')}</label>
            <input id={ids.cur} type="password" autoComplete="current-password" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={v.cur} onChange={(e) => setV({ ...v, cur: e.target.value })} data-testid="coffre-change-current" /></div>
          <div><label htmlFor={ids.a} className="block text-sm text-slate-800">{t('compte:recovery.new_passphrase', 'Nouvelle phrase secrète ({{min}} caractères au moins)', { min: VAULT_PASSPHRASE_MIN })}</label>
            <input id={ids.a} type="password" autoComplete="new-password" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={v.a} onChange={(e) => setV({ ...v, a: e.target.value })} data-testid="coffre-change-new" /></div>
          <div><label htmlFor={ids.b} className="block text-sm text-slate-800">{t('compte:coffre.e2e_passphrase_confirm', 'Confirmez la phrase secrète')}</label>
            <input id={ids.b} type="password" autoComplete="new-password" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={v.b} onChange={(e) => setV({ ...v, b: e.target.value })} data-testid="coffre-change-new2" /></div>
          <div><Button type="submit" disabled={busy} data-testid="coffre-change-submit">{t('compte:recovery.change_submit', 'Changer la phrase secrète')}</Button></div>
        </form>
        <form className="grid gap-3" onSubmit={renew} data-testid="coffre-renew-form">
          <h3 className="font-semibold text-slate-900">{t('compte:recovery.renew_title', 'Créer un nouveau code de secours')}</h3>
          <p className="text-sm text-slate-700">{t('compte:recovery.renew_help', 'Utile si vous avez perdu votre code ou si quelqu’un l’a vu. L’ancien code ne marchera plus.')}</p>
          <div><label htmlFor={ids.cur2} className="block text-sm text-slate-800">{t('compte:recovery.current', 'Phrase secrète actuelle')}</label>
            <input id={ids.cur2} type="password" autoComplete="current-password" className="mt-1 w-full rounded-md border border-slate-300 p-2" value={v.cur2} onChange={(e) => setV({ ...v, cur2: e.target.value })} data-testid="coffre-renew-current" /></div>
          <div><Button type="submit" variant="outline" disabled={busy} data-testid="coffre-renew-submit">{t('compte:recovery.renew_submit', 'Créer un nouveau code')}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}
