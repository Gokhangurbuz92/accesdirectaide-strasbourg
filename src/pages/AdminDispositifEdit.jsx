// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { DISPOSITIF_FIELDS } from '@/lib/adminCatalogueFields';

/** PKG-11 / A02 — create or edit a dispositif (real columns; verification stays with the verification register). */
export default function AdminDispositifEdit() {
  return <CatalogueEditor kind="dispositif" title="dispositif" fields={DISPOSITIF_FIELDS} listPath="/admin/dispositifs" />;
}
