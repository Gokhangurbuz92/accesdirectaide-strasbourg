// R44 — refusing an appointment request from the agenda (Mode B): an optional reason among the API's fixed codes (no free text: nothing the team types
// reaches the person), the exact sentence the person will read, then an explicit confirmation. It replaces a browser confirm() that sent no reason at all.
// The reason list is a proposal awaiting the owner's approval (R43 D-5): see src/lib/refusalReasons.js.
import { useEffect, useId, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { refusalReasonChoices, refusalReasonText } from '@/lib/refusalReasons';

/** @param {{ busy: boolean, onConfirm: (reasonCode: string) => void, onCancel: () => void }} props */
export default function RefusalPanel({ busy, onConfirm, onCancel }) {
  const { t } = useT('pro');
  const id = useId();
  const [code, setCode] = useState('');
  const headingRef = useRef(/** @type {HTMLHeadingElement | null} */ (null));
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <div role="group" aria-labelledby={`${id}-title`} aria-busy={busy || undefined} data-testid="pro-agenda-refusal-panel"
      className="w-full space-y-3 rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-900">
      <h3 id={`${id}-title`} ref={headingRef} tabIndex={-1} className="font-semibold focus:outline-none">{t('pro:appointments.refusal.title', 'Refuser cette demande')}</h3>
      <p>{t('pro:appointments.refusal.intro', 'La personne en sera informée et le créneau libéré. Le motif est facultatif : la personne lit une phrase fixe, jamais un texte saisi par l’équipe.')}</p>
      <fieldset className="space-y-1">
        <legend className="font-medium">{t('pro:appointments.refusal.legend', 'Motif transmis à la personne (facultatif)')}</legend>
        {refusalReasonChoices(t).map((c) => (
          <label key={c.code || 'none'} className="flex min-h-11 items-start gap-2">
            <input type="radio" name={`${id}-reason`} value={c.code} checked={code === c.code} onChange={() => setCode(c.code)} className="mt-1 h-4 w-4" data-testid={`pro-agenda-refusal-reason-${c.code || 'NONE'}`} />
            <span>{c.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="rounded-md border border-slate-200 bg-white p-2" data-testid="pro-agenda-refusal-preview">
        <p className="text-xs font-medium text-slate-700">{t('pro:appointments.refusal.preview', 'La personne lira :')}</p>
        <p>{refusalReasonText(t, code || 'OTHER')}</p>
      </div>
      <p className="text-xs text-slate-700">{t('pro:appointments.refusal.proposal', 'Liste de motifs proposée, en attente de validation par le responsable du service. Aucune information de santé ou personnelle n’est transmise.')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" disabled={busy} data-testid="pro-agenda-refusal-confirm" onClick={() => onConfirm(code)}>{t('pro:appointments.refusal.confirm', 'Confirmer le refus')}</Button>
        <Button size="sm" variant="outline" disabled={busy} data-testid="pro-agenda-refusal-cancel" onClick={onCancel}>{t('pro:appointments.refusal.keep', 'Garder la demande')}</Button>
      </div>
    </div>
  );
}
RefusalPanel.propTypes = { busy: PropTypes.bool.isRequired, onConfirm: PropTypes.func.isRequired, onCancel: PropTypes.func.isRequired };
