// @ts-nocheck
import { useId } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { MAX_NEEDS, NEED_DOMAINS, domainName, needName } from '@/lib/socialNeeds';

/**
 * G14 release 3 — choose the needs (subdomains of the 20 × 86 taxonomy) a service or an own booking page answers. One fieldset; each domain is a
 * disclosure (<details>, keyboard and screen-reader native) holding real checkboxes; the chosen needs are listed above with a « remove » button each; the
 * count is announced politely. At most MAX_NEEDS: the other boxes are disabled once reached (the server refuses more). Logical spacing only (RTL).
 * @param {{ value: string[], onChange: (next: string[]) => void, disabled?: boolean, testId?: string }} props
 */
export default function NeedPicker({ value, onChange, disabled = false, testId = 'need-picker' }) {
  const { t } = useT('pro');
  const uid = useId();
  const chosen = Array.isArray(value) ? value : [];
  const full = chosen.length >= MAX_NEEDS;
  const toggle = (id, on) => onChange(on ? [...new Set([...chosen, id])].slice(0, MAX_NEEDS) : chosen.filter((x) => x !== id));
  return (
    <fieldset className="space-y-2 text-sm text-slate-800" data-testid={testId} aria-describedby={`${uid}-hint`}>
      <legend className="font-medium text-slate-900">{t('pro:needs.legend', 'Besoins auxquels répond ce rendez-vous')}</legend>
      <p id={`${uid}-hint`} className="text-xs text-slate-700">
        {t('pro:needs.hint', 'Choisissez jusqu’à {{max}} besoins de la liste commune d’AccesDirectAide. Ils permettent aux personnes de trouver votre lieu quand elles cherchent où prendre rendez-vous pour ce besoin. Ils décrivent votre service, jamais la personne.', { max: MAX_NEEDS })}
      </p>
      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('pro:needs.chosen', 'Besoins choisis')} data-testid={`${testId}-chosen`}>
          {chosen.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-blue-900">
              <span>{needName(t, id)}</span>
              <button type="button" disabled={disabled} onClick={() => toggle(id, false)}
                className="inline-flex min-h-6 min-w-6 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                aria-label={t('pro:needs.remove', 'Retirer le besoin {{need}}', { need: needName(t, id) })}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-700" role="status" aria-live="polite" data-testid={`${testId}-count`}>
        {t('pro:needs.count', '{{n}} besoin(s) choisi(s) sur {{max}} au plus.', { n: chosen.length, max: MAX_NEEDS })}
      </p>
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
        {NEED_DOMAINS.map((d) => {
          const inDomain = d.subdomains.filter((s) => chosen.includes(s.id)).length;
          return (
            <details key={d.id} className="rounded" open={inDomain > 0 ? true : undefined}>
              <summary className="min-h-11 cursor-pointer py-2 font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">
                {domainName(t, d.id)}{inDomain > 0 ? t('pro:needs.in_domain', ' ({{n}} choisi(s))', { n: inDomain }) : ''}
              </summary>
              <div className="space-y-1 ps-4">
                {d.subdomains.map((s) => {
                  const checked = chosen.includes(s.id);
                  return (
                    <label key={s.id} htmlFor={`${uid}-${s.id}`} className="flex min-h-11 items-center gap-2">
                      <input id={`${uid}-${s.id}`} type="checkbox" className="h-5 w-5 accent-blue-700" checked={checked}
                        disabled={disabled || (!checked && full)} onChange={(e) => toggle(s.id, e.target.checked)} data-testid={`${testId}-${s.id}`} />
                      {needName(t, s.id)}
                    </label>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </fieldset>
  );
}
