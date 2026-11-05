// R46 (N01 / N02 / N06 / B10) — the honest state of each communication channel of the appointments, for the structure's team. It never says
// « delivered » or « verified »: delivery is shown per appointment (« Suivi des notifications »). States and variable names come from the server
// (api/lib/communication-channels.js); no secret ever reaches this screen.
import { useT } from '@/i18n';

/** @typedef {{ channel: string, state: string, reason: string | null, provider: string, missing: string[], reachesPeople: boolean }} ChannelStatus */

const ORDER = ['email', 'sms', 'video', 'calendar'];

/** @param {{ channels: ChannelStatus[] | null | undefined }} props */
export default function ChannelStatusPanel({ channels }) {
  const { t } = useT('pro');
  if (!Array.isArray(channels) || !channels.length) return null;
  /** @param {string} c */
  const name = (c) => ({
    email: t('pro:channels.email_r46', 'E-mail'),
    sms: t('pro:channels.sms_r46', 'SMS'),
    video: t('pro:channels.video_r46', 'Visio'),
    calendar: t('pro:channels.calendar_r46', 'Agenda Outlook connecté'),
  })[c] || c;
  /** @param {ChannelStatus} s */
  const line = (s) => {
    switch (s.state) {
      case 'OFF': return s.channel === 'email'
        ? t('pro:channels.email_off_r46', 'Non activé : aucun e-mail n’est envoyé. Les personnes voient leurs rendez-vous et réponses dans leur espace.')
        : s.channel === 'sms' ? t('pro:channels.sms_off_r46', 'Non activé : aucun SMS n’est envoyé.')
          : s.channel === 'video' ? t('pro:channels.video_off_r46', 'Non activé : la visio n’est pas proposée aux personnes.')
            : t('pro:channels.calendar_off_r46', 'Non activé : seuls vos horaires et absences comptent pour les créneaux.');
      case 'TEST': return t('pro:channels.test_r46', 'Environnement de test : rien ne quitte la plateforme.');
      case 'SANDBOX': return t('pro:channels.sandbox_r46', 'Mode d’essai (bac à sable) : connexion au fournisseur non vérifiée, rien n’est remis à une personne.');
      case 'INCOMPLETE': return t('pro:channels.incomplete_r46', 'Configuration incomplète : rien n’est envoyé tant qu’elle n’est pas terminée.');
      case 'BLOCKED': return s.channel === 'sms'
        ? t('pro:channels.sms_blocked_r46', 'Configuré mais bloqué : aucun SMS n’est envoyé tant que la réponse « STOP » ne peut pas être prise en compte.')
        : t('pro:channels.blocked_r46', 'Configuré mais pas encore ouvert : en attente de l’accord d’activation.');
      case 'CONFIGURED': return s.channel === 'calendar'
        ? t('pro:channels.calendar_configured_r46', 'Activé : la plateforme lit seulement vos plages occupées ; elle n’écrit rien dans votre agenda.')
        : t('pro:channels.configured_r46', 'Activé. La remise de chaque message est indiquée dans le suivi du rendez-vous.');
      default: return t('pro:channels.unknown_r46', 'État inconnu : considéré comme non activé.');
    }
  };
  const sorted = [...channels].sort((a, b) => ORDER.indexOf(a.channel) - ORDER.indexOf(b.channel));
  return (
    <section aria-labelledby="pro-channels-title" data-testid="pro-channel-status" className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 id="pro-channels-title" className="text-base font-semibold text-slate-900">{t('pro:channels.title_r46', 'Canaux de notification des rendez-vous')}</h3>
      <dl className="mt-3 space-y-2 text-sm">
        {sorted.map((s) => (
          <div key={s.channel} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3" data-testid={`pro-channel-${s.channel}`} data-state={s.state}>
            <dt className="font-medium text-slate-900 sm:w-48 sm:shrink-0">{name(s.channel)}</dt>
            <dd className="text-slate-700">{line(s)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
