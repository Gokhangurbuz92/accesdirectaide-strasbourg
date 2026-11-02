// @ts-nocheck
import CatalogueList from '@/components/admin/CatalogueList';
import { useT } from '@/i18n';

/** PKG-11 / A02 — administration of the dispositifs (drafts included) through /api/admin/content; publication on the site follows the D-5 verification. */
export default function AdminDispositifs() {
  const { t } = useT('admin');
  return <CatalogueList kind="dispositif" title={t('admin:catalogue.dispositifs.title', 'Gestion des dispositifs')} published="publie" newPath="/admin/dispositifs/new" editPath={(id) => `/admin/dispositifs/${id}`} createLabel={t('admin:catalogue.dispositifs.create', 'Créer un dispositif')} />;
}
