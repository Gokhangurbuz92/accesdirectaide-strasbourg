/**
 * TG (owner decision 24/11/2026: notifications = Web Push → e-mail → OPTIONAL Telegram, 0 €) — « Rappels sur Telegram », next to the device notifications
 * card. Every state is said in words: not offered here (capability closed, bot not configured, migration absent: « pas encore proposé », never an error),
 * off (explicit consent box + « Recevoir mes rappels sur Telegram »), pending (the single-use link, valid 10 minutes, opens Telegram where the person
 * presses « Démarrer »), on (with « Arrêter » — the link and the preference are removed, the withdrawal is recorded), and errors. The consent is recorded
 * by the server BEFORE the link is created; nothing is promised beyond « Telegram a accepté le message ». Texts in the interface language (`compte`).
 */
import { useCallback, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToneBar, ToneIcon } from '@/components/ui/Tone';
import { sectionTone } from '@/design/categoryTone';
import { citizenApi } from '@/lib/citizenApi';
import { useT } from '@/i18n';

/** the route answers « not offered here » (closed capability or beta route, channel unavailable) */
const notOffered = (/** @type {any} */ e) => [403, 404, 409, 503].includes(e?.status) && e?.code !== 'CONSENT_REQUIRED';

export default function TelegramNotifications() {
  const { t } = useT('compte');
  const tone = sectionTone('notifications');
  const [state, setState] = useState(/** @type {{ phase: string, message?: string, deepLink?: string }} */ ({ phase: 'loading' }));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await citizenApi.telegramStatus();
      if (!s?.available) { setState({ phase: 'unavailable' }); return; }
      setState((prev) => ({ phase: s.linked ? 'on' : prev.phase === 'pending' && s.pending ? 'pending' : 'off', deepLink: prev.deepLink }));
    } catch (e) { setState(notOffered(e) ? { phase: 'unavailable' } : { phase: 'error', message: /** @type {Error} */ (e).message }); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const link = async () => {
    setBusy(true);
    try {
      const out = await citizenApi.telegramLink();
      setState({ phase: 'pending', deepLink: out.deepLink });
    } catch (e) { setState(notOffered(e) ? { phase: 'unavailable' } : { phase: 'error', message: /** @type {Error} */ (e).message }); } finally { setBusy(false); }
  };
  const unlink = async () => {
    setBusy(true);
    try { await citizenApi.telegramUnlink(); setConsent(false); setState({ phase: 'off' }); } catch (e) { setState({ phase: 'error', message: /** @type {Error} */ (e).message }); } finally { setBusy(false); }
  };

  const TEXT = {
    loading: t('compte:telegram.loading', 'Vérification…'),
    unavailable: t('compte:telegram.unavailable', 'Les rappels sur Telegram ne sont pas encore proposés par ce service. Les rappels restent disponibles par e-mail.'),
    off: t('compte:telegram.off', 'Si vous utilisez Telegram, vous pouvez y recevoir vos rappels de rendez-vous et de Mon Parcours. Le message reste court : jamais votre santé, votre situation ni le nom d’un document, seulement un lien vers votre compte. C’est facultatif et vous pouvez arrêter à tout moment.'),
    pending: t('compte:telegram.pending', 'Ouvrez Telegram avec le bouton ci-dessous, puis appuyez sur « Démarrer ». Ce lien sert une seule fois et pendant 10 minutes.'),
    on: t('compte:telegram.on', 'Vos rappels arrivent aussi sur Telegram. Le site sait seulement que Telegram a accepté le message, pas que vous l’avez lu. Pour arrêter, utilisez le bouton ci-dessous ou envoyez /stop au robot.'),
    error: t('compte:telegram.error', 'La demande n’a pas abouti.'),
  };
  return (
    <Card className="relative overflow-hidden">
      <ToneBar tone={tone} />
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <ToneIcon tone={tone} icon={Send} size="sm" />
        <CardTitle as="h2" className="text-lg">{t('compte:telegram.title', 'Rappels sur Telegram')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3" data-testid="telegram-card">
        <p role="status" aria-live="polite" className="text-slate-700" data-testid="telegram-state" data-phase={state.phase}>{TEXT[/** @type {keyof typeof TEXT} */ (state.phase)]}{state.phase === 'error' && state.message ? ` ${state.message}` : ''}</p>
        {state.phase === 'off' && (
          <>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0" data-testid="telegram-consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t('compte:telegram.consent', 'J’accepte que mes rappels soient envoyés par Telegram (société établie hors de l’Union européenne). Je peux retirer cet accord à tout moment.')}</span>
            </label>
            <Button type="button" onClick={link} disabled={busy || !consent} data-testid="telegram-link">{t('compte:telegram.enable', 'Recevoir mes rappels sur Telegram')}</Button>
          </>
        )}
        {state.phase === 'pending' && state.deepLink && (
          <div className="flex flex-wrap gap-2">
            <Button asChild><a href={state.deepLink} target="_blank" rel="noopener noreferrer" data-testid="telegram-deeplink">{t('compte:telegram.open', 'Ouvrir Telegram')}</a></Button>
            <Button type="button" variant="outline" onClick={refresh} disabled={busy}>{t('compte:telegram.check', 'J’ai appuyé sur « Démarrer »')}</Button>
          </div>
        )}
        {state.phase === 'on' && <Button type="button" variant="outline" onClick={unlink} disabled={busy} data-testid="telegram-unlink">{t('compte:telegram.disable', 'Arrêter les rappels sur Telegram')}</Button>}
        {state.phase === 'error' && <Button type="button" variant="outline" onClick={refresh} disabled={busy}>{t('compte:telegram.retry', 'Réessayer')}</Button>}
      </CardContent>
    </Card>
  );
}
