// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import { apiClient } from '@/api/client';
import i18n, { useT } from '@/i18n';
import { explain } from '@/pages/admin/k5/helpers.js';

/**
 * PKG-11 / A02 — versions of one catalogue record, read through the routed /api/admin/content-versions (A07). Before: it called /api/admin/versions (no such
 * route) with a legacy token and read its loader before declaring it, so it threw whenever it was shown. Restoring a version needs a reason and is done on the
 * versions page (/admin/versions), never from here.
 */
export default function EntityHistory({ entityType, entityId, refreshKey }) {
  const { t } = useT('admin');
  const [versions, setVersions] = useState(null); const [problem, setProblem] = useState('');
  useEffect(() => {
    let live = true;
    apiClient.admin.k5(`content-versions?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`)
      .then((r) => { if (live) { setVersions(r.versions || []); setProblem(''); } })
      .catch((e) => { if (live) { setVersions([]); setProblem(explain(e)); } });
    return () => { live = false; };
  }, [entityType, entityId, refreshKey]);
  return (
    <section aria-labelledby="entity-history-title" className="space-y-2" data-testid="entity-history">
      <h2 id="entity-history-title" className="text-lg font-semibold text-slate-900">{t('admin:history.title', 'Historique des versions')}</h2>
      <p className="text-sm text-slate-700">
        <Trans i18n={i18n} i18nKey="admin:history.restore_hint" defaults="Chaque enregistrement garde la version précédente. Pour restaurer une version (motif obligatoire) : <0>voir les versions</0>."
          components={[<Link key="v" className="text-blue-800 underline" to={`/admin/versions?type=${encodeURIComponent(entityType)}&id=${encodeURIComponent(entityId)}`} />]} />
      </p>
      {problem ? <p role="alert" className="text-sm text-rose-800">{problem}</p> : null}
      {versions === null ? <p role="status" className="text-sm">{t('admin:history.loading', 'Chargement…')}</p> : versions.length === 0 ? <p className="text-sm">{t('admin:history.empty', 'Aucune version précédente.')}</p> : (
        <ul className="space-y-1 text-sm">
          {versions.map((v) => <li key={v.id} data-testid="entity-history-item">{new Date(v.createdAt).toLocaleString('fr-FR')} — {v.reason} — {v.actor || '—'}</li>)}
        </ul>
      )}
    </section>
  );
}
