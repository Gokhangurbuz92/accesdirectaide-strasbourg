// @ts-nocheck
import { Button } from '@/components/ui/button';
import { useK5 } from './helpers.js';
import { useT, formatDateTime } from '@/i18n';

/**
 * R46 / Q07 — « Signaux de sécurité » (/admin/securite): what the 5-minute health check watches in the audit trail — refused sign-ins, refused MFA codes,
 * exports of personal or audit data — as counts with their thresholds, the alerts they call for now, and the security alerts already sent through the alert
 * channel. Aggregates only (GET /api/admin/security-signals): no address, no e-mail.
 */
function alertName(t, name) {
  const m = {
    'security.failed_login_burst': t('admin:k5.security.alert.failed_login', 'Rafale de connexions refusées'),
    'security.mfa_failure_burst': t('admin:k5.security.alert.mfa', 'Rafale de codes MFA refusés'),
    'security.export_burst': t('admin:k5.security.alert.export', 'Exports de données inhabituels'),
  };
  return m[name] || name;
}

function Signal({ id, title, value, threshold, hint, over }) {
  return (
    <li className={`rounded border p-3 text-sm ${over ? 'border-rose-300 bg-rose-50' : ''}`} data-testid={`admin-security-${id}`} data-over={over ? 'true' : 'false'}>
      <p className="font-semibold">{title}</p>
      <p className="text-2xl font-bold" data-testid={`admin-security-${id}-count`}>{value}</p>
      <p className="text-slate-700">{threshold}</p>
      {hint ? <p className="text-slate-700">{hint}</p> : null}
    </li>
  );
}

export default function AdminSecurity() {
  const { t } = useT('admin');
  const s = useK5('security-signals');
  const c = s.data?.counts;
  const th = c?.thresholds;
  return (
    <div className="space-y-6 p-4" data-testid="admin-security">
      <h1 className="text-2xl font-bold">{t('admin:k5.security.title', 'Signaux de sécurité')}</h1>
      <p className="max-w-3xl text-sm text-slate-700">{t('admin:k5.security.intro', 'Le contrôle de santé (toutes les 5 minutes) lit le journal d’audit et envoie une alerte par le canal d’alerte quand un seuil est atteint. Seuls des nombres sont montrés ici : aucune adresse, aucun e-mail.')}</p>
      {s.loading ? <p role="status">{t('admin:k5.security.loading', 'Chargement…')}</p> : null}
      {s.error ? (
        <div role="alert" data-testid="admin-security-error" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <p>{t('admin:k5.security.not_loaded', 'Signaux non chargés : {{why}}', { why: s.error })}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => s.load()}>{t('admin:k5.security.retry', 'Réessayer')}</Button>
        </div>
      ) : null}
      {c ? (
        <>
          <ul className="grid gap-3 sm:grid-cols-3">
            <Signal id="failed-logins" title={t('admin:k5.security.failed_logins', 'Connexions refusées')} value={c.failedLogins.count} over={c.failedLogins.count >= th.failedLogins}
              threshold={t('admin:k5.security.window_threshold', 'en {{minutes}} min — seuil {{threshold}}', { minutes: th.windowMinutes, threshold: th.failedLogins })}
              hint={t('admin:k5.security.sources', 'depuis {{n}} source(s)', { n: c.failedLogins.sources })} />
            <Signal id="mfa-failures" title={t('admin:k5.security.mfa_failures', 'Codes MFA refusés')} value={c.mfaFailures.count} over={c.mfaFailures.count >= th.mfaFailures}
              threshold={t('admin:k5.security.window_threshold', 'en {{minutes}} min — seuil {{threshold}}', { minutes: th.windowMinutes, threshold: th.mfaFailures })}
              hint={t('admin:k5.security.accounts', 'sur {{n}} compte(s) au plus', { n: c.mfaFailures.actors })} />
            <Signal id="exports" title={t('admin:k5.security.exports', 'Exports de données (1 heure)')} value={c.exports.count} over={c.exports.count >= th.exportsPerHour || c.exports.maxPerActor >= th.exportsPerActorPerHour}
              threshold={t('admin:k5.security.export_threshold', 'seuil {{all}} au total, {{per}} par personne', { all: th.exportsPerHour, per: th.exportsPerActorPerHour })}
              hint={t('admin:k5.security.max_per_actor', 'jusqu’à {{n}} par la même personne', { n: c.exports.maxPerActor })} />
          </ul>
          <section aria-labelledby="sec-now" className="space-y-2">
            <h2 id="sec-now" className="font-semibold">{t('admin:k5.security.now_heading', 'Alertes appelées maintenant')}</h2>
            {s.data.alertsNow.length ? (
              <ul className="list-disc ps-5 text-sm" data-testid="admin-security-now">{s.data.alertsNow.map((a) => <li key={a.name}>{alertName(t, a.name)}</li>)}</ul>
            ) : <p className="text-sm" data-testid="admin-security-now-none">{t('admin:k5.security.none_now', 'Aucun seuil atteint.')}</p>}
          </section>
          <section aria-labelledby="sec-sent" className="space-y-2">
            <h2 id="sec-sent" className="font-semibold">{t('admin:k5.security.sent_heading', 'Alertes de sécurité déjà envoyées')}</h2>
            {s.data.alertsSent.length ? (
              <ul className="space-y-1 text-sm" data-testid="admin-security-sent">
                {s.data.alertsSent.map((a, i) => <li key={`${a.name}-${i}`}>{formatDateTime(a.timestamp)} — {alertName(t, a.name)}{a.details?.count !== undefined ? ` (${a.details.count})` : ''}</li>)}
              </ul>
            ) : <p className="text-sm">{t('admin:k5.security.none_sent', 'Aucune alerte de sécurité dans le journal des alertes.')}</p>}
          </section>
        </>
      ) : null}
    </div>
  );
}
