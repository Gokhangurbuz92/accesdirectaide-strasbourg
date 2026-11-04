/**
 * R42-POLISH (R41 review A5) — the error summary and the field message of a form (see src/lib/fieldErrors.js for the rules).
 */
import { forwardRef } from 'react';
import PropTypes from 'prop-types';
import { AlertCircle } from 'lucide-react';
import { useT } from '@/i18n';
import { errorIdOf } from '@/lib/fieldErrors';

/** @typedef {{ errors: Record<string, string>, order: string[], testid?: string }} SummaryProps */

/**
 * The list of errors at the top of the form: announced (role="alert"), focusable (the form moves the focus here on submit), each error a link that
 * moves the focus to its field. `order` gives the reading order of the fields.
 */
/** @type {import('react').ForwardRefExoticComponent<SummaryProps & import('react').RefAttributes<HTMLDivElement>>} */
export const ErrorSummary = forwardRef(/** @param {SummaryProps} props @param {import('react').ForwardedRef<HTMLDivElement>} ref */ function ErrorSummary({ errors, order, testid = 'form-error-summary' }, ref) {
  const { t } = useT('common');
  const fields = order.filter((f) => errors[f]);
  if (!fields.length) return null;
  const go = (/** @type {import('react').MouseEvent<HTMLAnchorElement>} */ e, /** @type {string} */ field) => {
    const el = document.getElementById(field);
    if (!el) return;
    e.preventDefault();
    el.focus();
    el.scrollIntoView?.({ block: 'center' });
  };
  return (
    <div ref={ref} role="alert" tabIndex={-1} aria-labelledby={`${testid}-title`} data-testid={testid}
      className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700">
      <p id={`${testid}-title`} className="flex items-center gap-2 font-semibold">
        <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
        {t('common:form.errors.summary_title', 'Le formulaire n’a pas été envoyé. Corrigez ces points :')}
      </p>
      <ul className="mt-2 list-disc space-y-1 ps-9">
        {fields.map((f) => (
          <li key={f}><a href={`#${f}`} onClick={(e) => go(e, f)} className="underline underline-offset-2 hover:no-underline">{errors[f]}</a></li>
        ))}
      </ul>
    </div>
  );
});

/** The message under a field in error (referenced by the field's aria-describedby; not a live region — the summary is the announcement). */
/** @param {{ field: string, errors: Record<string, string> }} props */
export function FieldError({ field, errors }) {
  if (!errors[field]) return null;
  return (
    <p id={errorIdOf(field)} className="flex items-start gap-1.5 text-sm font-medium text-red-700" data-testid={`${field}-error`}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{errors[field]}</span>
    </p>
  );
}
FieldError.propTypes = { field: PropTypes.string.isRequired, errors: PropTypes.object.isRequired };
