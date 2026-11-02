// @ts-nocheck
import CatalogueList from '@/components/admin/CatalogueList';
import { useT } from '@/i18n';

/** PKG-11 / A02 — administration of the démarches (drafts included) through /api/admin/content. */
export default function AdminDemarches() {
  const { t } = useT('admin');
  return <CatalogueList kind="demarche" title={t('admin:catalogue.demarches.title', 'Gestion des démarches')} published="publie" newPath="/admin/demarches/new" editPath={(id) => `/admin/demarches/${id}`} createLabel={t('admin:catalogue.demarches.create', 'Créer une démarche')} />;
}
