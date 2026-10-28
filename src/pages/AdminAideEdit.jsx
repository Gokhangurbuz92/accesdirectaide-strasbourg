// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { AIDE_FIELDS } from '@/lib/adminCatalogueFields';

/** PKG-11 / A02 — create or edit an aide (real columns; verification and FALC texts have their own governed screens). */
export default function AdminAideEdit() {
  return <CatalogueEditor kind="aide" title="aide" fields={AIDE_FIELDS} listPath="/admin/aides" />;
}
