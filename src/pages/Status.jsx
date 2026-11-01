import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, XCircle } from 'lucide-react';

import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, useLanguage, useT } from '@/i18n';

/**
 * PKG-10 / P24 — public status page in French: the real dependencies a person relies on (accounts and appointments, e-mails, the local assistant, the state
 * of the aid information) from GET /api/status, without internals (no counts, thresholds, versions or hosts). Before: English labels and two internal monitor
 * cards (data-quality counts, ingestion thresholds) read from protected monitor endpoints, so an anonymous visitor only ever saw errors.
 * R32: the page's own words follow the interface language; each component's sentence comes from the API in French (marked lang="fr" in another language).
 */
const FETCH_TIMEOUT_MS = 5000;
const STATE = {
  operational: { label: 'Fonctionne', Icon: CheckCircle2, cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  degraded: { label: 'Fonctionne en partie', Icon: AlertTriangle, cls: 'border-amber-300 bg-amber-50 text-amber-900' },
  unavailable: { label: 'Indisponible', Icon: XCircle, cls: 'border-rose-300 bg-rose-50 text-rose-900' },
  info: { label: 'À savoir', Icon: Info, cls: 'border-slate-300 bg-slate-50 text-slate-900' },
};
const SECTIONS = [
  { id: 'comptes', title: 'Comptes et rendez-vous' },
  { id: 'emails', title: 'E-mails' },
  { id: 'assistant', title: 'Assistant' },
  { id: 'donnees', title: 'Informations sur les aides' },
];

/** R32: the state words and section titles in the interface language (the French ones above stay the defaults) */
function stateLabel(t, state) {
  switch (state) {
    case 'operational': return t('status:state.operational', 'Fonctionne');
    case 'degraded': return t('status:state.degraded', 'Fonctionne en partie');
    case 'unavailable': return t('status:state.unavailable', 'Indisponible');
    case 'info': return t('status:state.info', 'À savoir');
    default: return null;
  }
}
function sectionTitle(t, id) {
  switch (id) {
    case 'comptes': return t('status:section.comptes', 'Comptes et rendez-vous');
    case 'emails': return t('status:section.emails', 'E-mails');
    case 'assistant': return t('status:section.assistant', 'Assistant');
    case 'donnees': return t('status:section.donnees', 'Informations sur les aides');
    default: return null;
  }
}

const shownTime = (/** @type {string} */ iso) => formatDate(iso, { dateStyle: 'long', timeStyle: 'short' }) || '-';

export default function Status() {
  const { t } = useT('status');
  const { isSource } = useLanguage();
  const [data, setData] = useState(/** @type {any} */ (null));
  const [loading, setLoading] = useState(false);
  // R32: what to say is decided at render (the interface language may change): the error is a flag, the announcement a code
  const [error, setError] = useState(false);
  const [live, setLive] = useState(/** @type {'' | 'updated' | 'failed'} */ (''));

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch('/api/status', { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('status');
      const body = await r.json(); setData(body); setLive('updated');
    } catch {
      setError(true); setLive('failed');
    } finally { clearTimeout(timer); setLoading(false); }
  }, []);

  useEffect(() => { void load(); const i = setInterval(load, 60000); return () => clearInterval(i); }, [load]);

  const byId = Object.fromEntries((data?.components || []).map((/** @type {any} */ c) => [c.id, c]));
  const liveText = live === 'updated' ? t('status:live.updated', 'État mis à jour.') : live === 'failed' ? t('status:live.failed', 'Vérification impossible.') : '';
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <SEO title={t('status:seo.title', 'État du service — AccesDirectAide')} description={t('status:seo.description', 'État public des services d’AccesDirectAide : comptes, rendez-vous, e-mails, assistant et informations sur les aides.')} noindex={true} />
      <p className="sr-only" aria-live="polite">{liveText}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-slate-900">{t('status:title', 'État du service')}</h1>
        <Button onClick={load} disabled={loading} className="min-h-11 gap-2" variant="outline">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          {t('status:refresh', 'Actualiser')}
        </Button>
      </div>
      <p className="text-sm text-slate-700" data-testid="status-last-checked">{t('status:last-checked', 'Dernière vérification : {{date}}', { date: data?.checkedAt ? shownTime(data.checkedAt) : '-' })}</p>
      {error && (
        <div role="alert" data-testid="status-error-banner" className="flex items-center gap-3 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" /><span>{t('status:error', 'Impossible de vérifier l’état du service pour le moment. Le site ou votre connexion ne répond peut-être pas.')}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => {
          const c = byId[s.id]; const st = c ? STATE[/** @type {keyof typeof STATE} */ (c.state)] || STATE.info : null;
          const stKey = c && STATE[/** @type {keyof typeof STATE} */ (c.state)] ? c.state : 'info';
          return (
            <Card key={s.id} data-testid={`status-${s.id}`}>
              <CardHeader><CardTitle>{sectionTitle(t, s.id) ?? s.title}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {st ? (
                  <>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${st.cls}`} data-testid={`status-${s.id}-state`}>
                      <st.Icon className="h-4 w-4" aria-hidden="true" />{stateLabel(t, stKey) ?? st.label}
                    </span>
                    <p className="text-slate-800" {...(isSource ? {} : { lang: 'fr', dir: 'ltr' })}>{c.text}</p>
                  </>
                ) : <p className="text-slate-700">{t('status:unchecked', 'Non vérifié.')}</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-sm text-slate-700">{t('status:emergency', 'En cas d’urgence, appelez le 112 (urgences), le 15 (SAMU) ou le 115 (SAMU social) : ces numéros ne dépendent pas d’AccesDirectAide.')}</p>
    </div>
  );
}
