import { useEffect, useState } from 'react';
import { CheckCircle2, Download, MonitorSmartphone, MoreVertical, PlusSquare, Share, X } from 'lucide-react';
import { useT } from '@/i18n';
import { TONES } from '@/design/categoryTone';
import { ToneIcon } from '@/components/ui/Tone';
import { dismissInstall, installDismissed, installKind, onInstallChange, promptInstall } from '@/lib/pwaInstall';

/**
 * 24/11/2026 — « Installer l'application »: the same offer on every device. `variant="card"` is the block placed in Mon Espace, the ADA Pro dashboard and
 * the guides; `variant="floating"` is the discreet suggestion at the bottom of the public pages (closable, remembered 60 days on this device, never shown
 * on an installed app or when nothing can be offered). Chrome / Edge: one button opens the browser's own dialog. iPhone / iPad / Mac Safari / Firefox /
 * other Android browsers: the steps of their own menu (no site can install itself there).
 * @param {{ variant?: 'card' | 'floating', audience?: 'citizen' | 'pro' }} props
 */
export default function InstallApp({ variant = 'card', audience = 'citizen' }) {
  const { t } = useT('shared');
  const [kind, setKind] = useState(() => installKind());
  const [hidden, setHidden] = useState(() => variant === 'floating' && installDismissed());
  const [result, setResult] = useState(/** @type {string | null} */ (null));
  useEffect(() => onInstallChange(() => setKind(installKind())), []);
  useEffect(() => { setKind(installKind()); }, []);

  if (kind === 'installed') {
    return variant === 'card' ? (
      <p className="flex items-center gap-2 text-sm text-emerald-800" data-testid="install-app-done">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('shared:install.installed', 'L’application est installée sur cet appareil.')}
      </p>
    ) : null;
  }
  // the floating suggestion only where it can act or explain briefly
  if (variant === 'floating' && (hidden || kind === 'other' || kind === 'firefox')) return null;

  const title = audience === 'pro' ? t('shared:install.title_pro', 'Installer ADA Pro sur cet appareil') : t('shared:install.title', 'Installer l’application AccesDirectAide');
  const why = t('shared:install.why', 'Une icône sur votre écran d’accueil ou votre bureau et l’ouverture en plein écran. Gratuit, sans magasin d’applications.');

  /** @type {Array<[import('react').ElementType, string]>} */
  const steps = (() => {
    switch (kind) {
      case 'ios': return [
        [Share, t('shared:install.ios.1', 'Dans Safari, touchez le bouton Partager (le carré avec une flèche vers le haut).')],
        [PlusSquare, t('shared:install.ios.2', 'Choisissez « Sur l’écran d’accueil ». Si vous ne le voyez pas, faites défiler la liste.')],
        [CheckCircle2, t('shared:install.ios.3', 'Touchez « Ajouter ». Ouvrez ensuite AccesDirectAide depuis son icône.')],
      ];
      case 'mac-safari': return [
        [Share, t('shared:install.mac.1', 'Dans Safari, ouvrez le menu Fichier (ou le bouton Partager).')],
        [PlusSquare, t('shared:install.mac.2', 'Choisissez « Ajouter au Dock ».')],
      ];
      case 'android-other': return [
        [MoreVertical, t('shared:install.android.1', 'Ouvrez le menu du navigateur (les trois points).')],
        [PlusSquare, t('shared:install.android.2', 'Choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».')],
      ];
      case 'firefox': return [[MoreVertical, t('shared:install.firefox', 'Firefox sur ordinateur ne permet pas d’installer un site. Utilisez Chrome, Edge ou Safari, ou ajoutez un favori.')]];
      case 'other': return [[MoreVertical, t('shared:install.other', 'Cherchez « Installer » ou « Ajouter à l’écran d’accueil » dans le menu de votre navigateur.')]];
      default: return [];
    }
  })();

  const install = async () => { const r = await promptInstall(); setResult(r); setKind(installKind()); };
  const close = () => { dismissInstall(); setHidden(true); };

  const body = (
    <>
      <div className="flex items-start gap-3">
        <ToneIcon tone={TONES.blue} icon={MonitorSmartphone} />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-700">{why}</p>
        </div>
        {variant === 'floating' && (
          <button type="button" onClick={close} className="-m-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            aria-label={t('shared:install.close', 'Ne plus proposer')} data-testid="install-app-close">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {kind === 'prompt' ? (
        <button type="button" onClick={install} data-testid="install-app-button"
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2">
          <Download className="h-4 w-4" aria-hidden="true" />{t('shared:install.button', 'Installer l’application')}
        </button>
      ) : (
        <ol className="mt-3 space-y-2" data-testid="install-app-steps" data-install-kind={kind}>
          {steps.map(([Icon, text], i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-800">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800" aria-hidden="true">{i + 1}</span>
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" /><span>{text}</span>
            </li>
          ))}
        </ol>
      )}
      {result === 'dismissed' && <p className="mt-2 text-sm text-slate-600" role="status">{t('shared:install.later', 'Pas de problème : vous pourrez l’installer plus tard depuis votre espace.')}</p>}
    </>
  );

  if (variant === 'floating') {
    return (
      <section aria-label={title} data-testid="install-app-floating"
        className="fixed start-6 bottom-[calc(1.5rem+var(--cookie-banner-offset,0px))] z-[45] hidden w-[26rem] max-w-[calc(100vw-10rem)] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:block">
        {body}
      </section>
    );
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="install-app-card" aria-label={title}>{body}</section>;
}
