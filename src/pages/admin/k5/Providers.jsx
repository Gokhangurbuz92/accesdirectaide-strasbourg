// @ts-nocheck
import { Button } from '@/components/ui/button';
import { useK5 } from './helpers.js';
import { useT } from '@/i18n';

/**
 * R46 / N10 — « Fournisseurs et intégrations » (/admin/fournisseurs): every provider adapter of the product with its honest state, computed by the server
 * from the PRESENCE of environment variables only (GET /api/admin/provider-status): names are listed, values never. « Configuré » is not « vérifié » —
 * this page calls no provider.
 */
const STATE_STYLE = {
  CONNECTED: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  SIMULATED: 'border-amber-300 bg-amber-50 text-amber-900',
  NOT_CONFIGURED: 'border-slate-300 bg-slate-50 text-slate-800',
};

function labels(t) {
  return {
    state: {
      CONNECTED: t('admin:k5.providers.state.connected', 'Configuré'),
      SIMULATED: t('admin:k5.providers.state.simulated', 'Simulé'),
      NOT_CONFIGURED: t('admin:k5.providers.state.not_configured', 'Non configuré'),
    },
    provider: {
      mail: t('admin:k5.providers.p.mail', 'E-mail transactionnel'),
      'graph-mail': t('admin:k5.providers.p.graph_mail', 'Microsoft Graph (envoi d’e-mail)'),
      sms: t('admin:k5.providers.p.sms', 'SMS (Twilio)'),
      push: t('admin:k5.providers.p.push', 'Notifications push (Web Push)'),
      outlook: t('admin:k5.providers.p.outlook', 'Agenda Outlook (disponibilités)'),
      video: t('admin:k5.providers.p.video', 'Visio (Jitsi avec jeton)'),
      openfisca: t('admin:k5.providers.p.openfisca', 'OpenFisca (calcul indicatif)'),
      'aides-territoires': t('admin:k5.providers.p.aides_territoires', 'Aides-territoires (API)'),
      franceconnect: t('admin:k5.providers.p.franceconnect', 'FranceConnect (identité des personnes)'),
      proconnect: t('admin:k5.providers.p.proconnect', 'ProConnect (identité des professionnels)'),
      maps: t('admin:k5.providers.p.maps', 'Cartes (OpenStreetMap) et géocodage (Base Adresse Nationale)'),
      sentry: t('admin:k5.providers.p.sentry', 'Suivi des erreurs (Sentry)'),
      upstash: t('admin:k5.providers.p.upstash', 'Limites de débit et verrous (Upstash Redis)'),
      hosting: t('admin:k5.providers.p.hosting', 'Hébergement (Vercel)'),
      database: t('admin:k5.providers.p.database', 'Base de données PostgreSQL'),
    },
    reason: {
      NOOP: t('admin:k5.providers.r.noop', 'Fournisseur « noop » : aucun message n’est envoyé.'),
      TEST_OUTBOX: t('admin:k5.providers.r.test_outbox', 'Boîte de test en mémoire : rien ne quitte le serveur.'),
      SANDBOX: t('admin:k5.providers.r.sandbox', 'Mode bac à sable : le fournisseur valide mais ne délivre rien (connexion non vérifiée).'),
      COMPLETE: t('admin:k5.providers.r.complete', 'Configuration complète (le fournisseur n’est pas appelé par cette page).'),
      INCOMPLETE_CONFIGURATION: t('admin:k5.providers.r.incomplete', 'Configuration incomplète : la fonction reste fermée.'),
      OTHER_PROVIDER_SELECTED: t('admin:k5.providers.r.other_provider', 'Un autre fournisseur d’e-mail est choisi.'),
      NOT_CONFIGURED: t('admin:k5.providers.r.not_configured', 'Rien n’est configuré : la fonction reste fermée.'),
      INVALID_KEYS: t('admin:k5.providers.r.invalid_keys', 'Clés présentes mais invalides.'),
      INVALID_SUBJECT: t('admin:k5.providers.r.invalid_subject', 'Contact de l’expéditeur invalide (mailto: ou https:).'),
      MISSING_ENCRYPTION_KEY: t('admin:k5.providers.r.missing_key', 'Clé de chiffrement manquante ou trop courte.'),
      PRODUCTION_ACTIVATION_PENDING: t('admin:k5.providers.r.activation_pending', 'Activation en production pas encore approuvée.'),
      UNKNOWN_PROVIDER: t('admin:k5.providers.r.unknown_provider', 'Fournisseur inconnu : la fonction reste fermée.'),
      SANDBOX_IN_PRODUCTION: t('admin:k5.providers.r.sandbox_production', 'Mode bac à sable refusé en production.'),
      SIMULATION_MODE: t('admin:k5.providers.r.simulation', 'Aucune instance : le diagnostic fonctionne en mode simulation.'),
      PUBLIC_PROTOTYPE: t('admin:k5.providers.r.prototype', 'Point d’accès public de prototype : développement seulement, refusé en production.'),
      NO_ADAPTER: t('admin:k5.providers.r.no_adapter', 'Aucun adaptateur dans le produit pour le moment.'),
      PUBLIC_NO_CREDENTIAL: t('admin:k5.providers.r.public', 'Service public sans identifiant : rien à configurer (disponibilité non testée ici).'),
      MEMORY_STORE: t('admin:k5.providers.r.memory', 'Magasin en mémoire propre à chaque instance (développement seulement).'),
      VERCEL: t('admin:k5.providers.r.vercel', 'Déploiement Vercel.'),
      LOCAL_SERVER: t('admin:k5.providers.r.local', 'Serveur local (LAB).'),
    },
  };
}

export default function AdminProviders() {
  const { t } = useT('admin');
  const s = useK5('provider-status');
  const L = labels(t);
  const rows = s.data?.providers || [];
  return (
    <div className="space-y-6 p-4" data-testid="admin-providers">
      <h1 className="text-2xl font-bold">{t('admin:k5.providers.title', 'Fournisseurs et intégrations')}</h1>
      <p className="max-w-3xl text-sm text-slate-700">{t('admin:k5.providers.intro', 'État calculé seulement à partir de la présence des variables de configuration : leurs valeurs ne sont jamais lues ni affichées, et aucun fournisseur n’est appelé. « Configuré » ne veut pas dire « vérifié » : la vérification réelle se fait avec le script indiqué, lors de l’activation.')}</p>
      {s.loading ? <p role="status">{t('admin:k5.providers.loading', 'Chargement…')}</p> : null}
      {s.error ? (
        <div role="alert" data-testid="admin-providers-error" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <p>{t('admin:k5.providers.not_loaded', 'État des fournisseurs non chargé : {{why}}', { why: s.error })}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => s.load()}>{t('admin:k5.providers.retry', 'Réessayer')}</Button>
        </div>
      ) : null}
      {s.data ? (
        <p data-testid="admin-providers-summary" className="text-sm">
          {t('admin:k5.providers.summary', '{{connected}} configuré(s), {{simulated}} simulé(s), {{missing}} non configuré(s).', { connected: s.data.summary?.CONNECTED ?? 0, simulated: s.data.summary?.SIMULATED ?? 0, missing: s.data.summary?.NOT_CONFIGURED ?? 0 })}
        </p>
      ) : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <li key={r.id} className="space-y-2 rounded border p-3 text-sm" data-testid={`admin-provider-${r.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{L.provider[r.id] || r.id}</h2>
              <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${STATE_STYLE[r.state] || STATE_STYLE.NOT_CONFIGURED}`} data-testid={`admin-provider-${r.id}-state`} data-state={r.state}>
                {L.state[r.state] || r.state}
              </span>
            </div>
            <p>{L.reason[r.reasonCode] || r.reasonCode}</p>
            {r.adapter === 'ABSENT' ? <p className="text-slate-700">{t('admin:k5.providers.adapter_absent', 'Adaptateur : absent.')}</p> : null}
            {r.variables?.length ? (
              <details>
                <summary className="cursor-pointer text-blue-800">{t('admin:k5.providers.variables', 'Variables examinées ({{set}} sur {{total}} renseignées)', { set: r.variables.filter((v) => v.set).length, total: r.variables.length })}</summary>
                <ul className="mt-1 space-y-0.5">
                  {r.variables.map((v) => (
                    <li key={v.name} className="break-all font-mono text-xs" dir="ltr">
                      {v.name} — {v.set ? t('admin:k5.providers.var_set', 'renseignée') : t('admin:k5.providers.var_unset', 'absente')}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {r.verify ? <p className="break-all text-xs text-slate-700">{t('admin:k5.providers.verify', 'Vérification réelle :')} <code dir="ltr">{r.verify}</code></p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
