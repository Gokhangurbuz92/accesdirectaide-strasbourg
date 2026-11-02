// @ts-nocheck
import CatalogueList from '@/components/admin/CatalogueList';
import { useT } from '@/i18n';

/** PKG-11 / A02 — administration of the guides (ADA's own editorial content, drafts included) through /api/admin/content. */
export default function AdminGuides() {
  const { t } = useT('admin');
  return <CatalogueList kind="guide" title={t('admin:catalogue.guides.title', 'Gestion des guides')} published="publie" newPath="/admin/guides/new" editPath={(id) => `/admin/guides/${id}`} createLabel={t('admin:catalogue.guides.create', 'Créer un guide')} verifiable={false} />;
}
