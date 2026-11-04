/**
 * R43 (A5, RGAA 11.10 / 11.11) — the state of one form's field errors, shared by the back-office and account forms (same rules as src/lib/fieldErrors.js):
 *   - `check(errs)` records the errors of a submit; when there is at least one, the error summary receives the focus (it is role="alert": announced once);
 *   - `clear(field)` removes the error of a field the person is fixing (nothing is announced while typing);
 *   - `reset()` forgets every error (the form was sent, or closed).
 * One instance per form: a page with three forms has three summaries, each next to its own form.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { withoutError } from '@/lib/fieldErrors';

export function useFormErrors() {
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [attempt, setAttempt] = useState(0);
  const summaryRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  useEffect(() => { if (attempt) summaryRef.current?.focus(); }, [attempt]);
  const check = useCallback(/** @param {Record<string, string>} errs @returns {boolean} true when the form can be sent */ (errs) => {
    setErrors(errs);
    if (Object.keys(errs).length) { setAttempt((n) => n + 1); return false; }
    return true;
  }, []);
  const clear = useCallback((/** @type {string} */ field) => setErrors((prev) => withoutError(prev, field)), []);
  const reset = useCallback(() => setErrors({}), []);
  return { errors, check, clear, reset, summaryRef };
}
