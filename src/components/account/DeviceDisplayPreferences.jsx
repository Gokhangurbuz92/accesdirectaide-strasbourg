// @ts-nocheck
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ACCESSIBILITY_EVENT, applyDisplayPreferences, readDisplayPreferences, resetDisplayPreferences } from '@/lib/accountAccessibility';
import { useT } from '@/i18n';

/**
 * P2b (owner decision 08/11/2026, D2 V2 option B): the display preferences live ON THIS DEVICE ONLY (src/lib/accountAccessibility.js).
 * A change applies at once to the whole site and is kept in this browser; nothing is sent to the server or stored in the account, so the choices do not
 * follow the person to another device. The note says so, and « reset » puts every display preference of this device back.
 * `controls`: the full set (profile screen) or the note and the reset button only (the settings screen has its own controls).
 */
export default function DeviceDisplayPreferences({ controls = true, idPrefix = 'pf' }) {
  const { t } = useT('compte');
  const [prefs, setPrefs] = useState(() => readDisplayPreferences());
  const [status, setStatus] = useState('');
  useEffect(() => {
    const refresh = () => setPrefs(readDisplayPreferences());
    window.addEventListener(ACCESSIBILITY_EVENT, refresh);
    return () => window.removeEventListener(ACCESSIBILITY_EVENT, refresh);
  }, []);
  const change = (patch) => { setStatus(''); applyDisplayPreferences(patch); setPrefs(readDisplayPreferences()); };
  const reset = () => { resetDisplayPreferences(); setPrefs(readDisplayPreferences()); setStatus(t('compte:profile.display_reset_done', 'Affichage réinitialisé sur cet appareil.')); };
  const noteId = `${idPrefix}-display-note`;

  return (
    <section className="space-y-3" data-testid={`${idPrefix}-display`} aria-labelledby={`${idPrefix}-display-title`}>
      <h2 id={`${idPrefix}-display-title`} className="text-base font-semibold text-slate-900">{t('compte:profile.display_device_title', 'Affichage sur cet appareil')}</h2>
      <p id={noteId} data-testid={`${idPrefix}-display-note`} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
        {t('compte:profile.display_device_note', 'Ces réglages sont enregistrés uniquement dans ce navigateur, sur cet appareil. Ils ne sont pas envoyés à AccesDirectAide et ne sont pas enregistrés dans votre compte. Ils ne se synchronisent donc pas : sur un autre appareil ou un autre navigateur, il faut les choisir à nouveau. Ils restent sur cet appareil après la déconnexion. Ils servent seulement à l’affichage et ne disent rien de votre santé ou d’un handicap.')}
      </p>
      {controls ? (
        <fieldset className="space-y-2" aria-describedby={noteId}>
          <legend className="text-sm font-medium text-slate-800">{t('compte:profile.accessibilite', 'Accessibilité')}</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="pf-falc" checked={prefs.falc} onChange={(e) => change({ falc: e.target.checked })} /> {t('compte:profile.preferer_les_textes_francais', 'Préférer les textes en français facile (FALC)')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="pf-contrast" checked={prefs.highContrast} onChange={(e) => change({ highContrast: e.target.checked })} /> {t('compte:profile.contraste_renforce', 'Contraste renforcé')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="pf-motion" checked={prefs.reduceMotion} onChange={(e) => change({ reduceMotion: e.target.checked })} /> {t('compte:profile.reduce_motion', 'Réduire les animations')}</label>
          <div>
            <label htmlFor="pf-scale" className="block text-sm text-slate-800">{t('compte:profile.taille_texte', 'Taille du texte')}</label>
            <select id="pf-scale" data-testid="pf-scale" className="mt-1 rounded-md border border-slate-300 p-2" value={prefs.textScale || 'custom'} onChange={(e) => change({ textScale: e.target.value })}>
              {prefs.textScale ? null : <option value="custom" disabled>{`${prefs.fontSize} %`}</option>}{/* a size set with the A−/A+ buttons of the header */}
              <option value="normal">{t('compte:profile.normale', 'Normale')}</option><option value="large">{t('compte:profile.grande', 'Grande')}</option><option value="xlarge">{t('compte:profile.tres_grande', 'Très grande')}</option>
            </select>
          </div>
        </fieldset>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="min-h-11" data-testid={`${idPrefix}-display-reset`} aria-describedby={noteId} onClick={reset}>{t('compte:profile.display_reset', 'Réinitialiser l’affichage')}</Button>
        <p role="status" aria-live="polite" data-testid={`${idPrefix}-display-status`} className="text-sm text-slate-800">{status}</p>
      </div>
    </section>
  );
}
