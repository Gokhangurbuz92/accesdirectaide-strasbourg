// @ts-nocheck
import CatalogueList from '@/components/admin/CatalogueList';

/** PKG-11 / A02 — administration of the guides (ADA's own editorial content, drafts included) through /api/admin/content. */
export default function AdminGuides() {
  return <CatalogueList kind="guide" title="Gestion des guides" published="publie" newPath="/admin/guides/new" editPath={(id) => `/admin/guides/${id}`} createLabel="Créer un guide" verifiable={false} />;
}
