// @ts-nocheck
/**
 * G14 / DSA art. 17(3) — the elements of a statement of reasons the moderator writes before a restriction (refusal, takedown, closure, suspension) or a
 * decision on reports: the facts (required, sent to the author — never a copy of the content), and, when the content is considered ILLEGAL, the legal ground
 * and why. The server refuses a restriction without facts (FACTS_REQUIRED) before anything changes. Optional: the reference of an account-free notice.
 */
import { useId } from 'react';
import { useT } from '@/i18n';
import { FACTS_MAX, FACTS_MIN } from '@/lib/moderation';

/** @param {{ value: { facts: string, legalGround: string, manifestlyIllegal: boolean, noticeId: string }, onChange: (v: any) => void }} props */
export default function StatementFields({ value, onChange }) {
  const { t } = useT('moderation');
  const id = useId();
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <fieldset className="space-y-2 rounded-md border border-slate-300 p-3" data-testid="statement-fields">
      <legend className="px-1 text-sm font-semibold text-slate-900">{t('moderation:statement.legend', 'Exposé des motifs (envoyé à l’auteur)')}</legend>
      <div>
        <label htmlFor={`${id}-facts`} className="block text-sm font-semibold text-slate-900">{t('moderation:statement.facts', 'Faits et circonstances')}</label>
        <p id={`${id}-facts-help`} className="text-xs text-slate-700">{t('moderation:statement.facts_help', 'Décrivez en une ou deux phrases ce qui justifie la décision, sans recopier le contenu ni une donnée sensible. Au moins {{min}} caractères.', { min: FACTS_MIN })}</p>
        <textarea id={`${id}-facts`} rows={2} maxLength={FACTS_MAX} value={value.facts} onChange={(e) => set('facts', e.target.value)} aria-describedby={`${id}-facts-help`}
          className="mt-1 w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm" />
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-900">
        <input type="checkbox" className="mt-1" checked={value.manifestlyIllegal} onChange={(e) => set('manifestlyIllegal', e.target.checked)} />
        <span>{t('moderation:statement.illegal', 'Le contenu est manifestement illicite (le fondement légal est alors obligatoire)')}</span>
      </label>
      {value.manifestlyIllegal && (
        <div>
          <label htmlFor={`${id}-ground`} className="block text-sm font-semibold text-slate-900">{t('moderation:statement.ground', 'Fondement légal et raison de l’illicéité')}</label>
          <textarea id={`${id}-ground`} rows={2} maxLength={1000} value={value.legalGround} onChange={(e) => set('legalGround', e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm" />
        </div>
      )}
      <div>
        <label htmlFor={`${id}-notice`} className="block text-sm font-semibold text-slate-900">{t('moderation:statement.notice', 'Référence du signalement sans compte (facultatif)')}</label>
        <input id={`${id}-notice`} type="text" value={value.noticeId} onChange={(e) => set('noticeId', e.target.value.trim())} autoComplete="off" dir="ltr"
          className="mt-1 w-full max-w-md rounded-md border border-slate-400 bg-white px-3 py-2 font-mono text-xs" />
      </div>
    </fieldset>
  );
}

