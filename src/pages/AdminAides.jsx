// @ts-nocheck
import CatalogueList from '@/components/admin/CatalogueList';
import { useT } from '@/i18n';

/** PKG-11 / A02 — administration of the aides (drafts included) through /api/admin/content. */
export default function AdminAides() {
  const { t } = useT('admin');
  return <CatalogueList kind="aide" title={t('admin:catalogue.aides.title', 'Gestion des aides')} published="publie" newPath="/admin/aides/new" editPath={(id) => `/admin/aides/${id}`} createLabel={t('admin:catalogue.aides.create', 'Créer une aide')} />;
}
