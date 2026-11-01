// @ts-nocheck
import { Trans } from 'react-i18next';
import { useFalc } from '@/contexts/FalcContext';
import i18n, { useT } from '@/i18n';

/**
 * In the normal version of a page: the easy-to-read version exists and is different (short sentences, everyday words) — one click to read it instead.
 * (It replaces the « Résumé facile à lire » box that repeated the simplified text inside the normal page.)
 * R32: the easy-to-read version is in French; the translations of this invitation say so.
 */
export default function FalcInvite() {
  const { t } = useT('shared');
  const { isFalcEnabled, toggleFalc } = useFalc();
  if (isFalcEnabled) return null;
  return (
    <div data-testid="falc-invite" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-slate-800"><Trans i18n={i18n} i18nKey="shared:falc.invite.text" defaults="Une version <strong>facile à lire</strong> existe : phrases courtes, mots de tous les jours." /></p>
      <button type="button" onClick={toggleFalc} className="rounded-md border border-blue-700 bg-white px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-50">
        {t('shared:falc.invite.button', 'Lire la version facile')}
      </button>
    </div>
  );
}
