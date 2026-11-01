// @ts-nocheck
/**
 * FALC Content Display Component
 * Displays simplified content following FALC (Facile à Lire et à Comprendre) guidelines:
 * - Short sentences (1 idea per sentence)
 * - Simple vocabulary
 * - Clear structure with headings
 * - Entity-specific sections
 * R32: FALC is simplified FRENCH. The easy-to-read texts (and the record's own words: hours, address) stay in French whatever the interface language,
 * marked lang="fr"; only the headings and the explanations around them are translated, and the translations say that the text is in French.
 */
import { Trans } from 'react-i18next';
import { falcFieldNote } from '@/lib/falcLabel';
import { asList } from '@/lib/textLists';
import i18n, { formatDate, useLanguage, useT } from '@/i18n';

/** the easy-to-read texts are French: screen readers and the page reader pronounce them in French */
const FR = { lang: 'fr', dir: 'ltr' };

/** Helper: strip HTML to plain text */
function stripHtml(/** @type {string | number | boolean | null | undefined} */ text) {
  if (!text) return '';
  return String(text).replace(/<[^>]+>/g, '').trim();
}

/** Helper: truncate to short FALC-friendly sentences */
function toFalcText(/** @type {string | number | boolean | null | undefined} */ text, maxLen = 300) {
  const plain = stripHtml(text);
  if (!plain) return '';
  if (plain.length <= maxLen) return plain;
  const cut = plain.slice(0, maxLen);
  const lastDot = cut.lastIndexOf('.');
  return lastDot > maxLen / 2 ? cut.slice(0, lastDot + 1) : cut + '…';
}

/**
 * R32: the line of falcFieldNote (src/lib/falcLabel.js) in the interface language — same three cases, same dates. In French it is the line of
 * falcFieldNote itself.
 */
function useFieldNote() {
  const { t } = useT('shared');
  const { isSource } = useLanguage();
  const day = (d) => formatDate(d, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return (at, auto) => {
    const fr = falcFieldNote(at, auto);
    if (fr === null || isSource) return fr;
    if (!at && auto) return t('shared:falc.note.auto', 'Rédigé à partir de la fiche officielle et contrôlé automatiquement le {{date}}', { date: day(auto) });
    return at ? t('shared:falc.note.reviewed', 'Relu par une personne le {{date}}', { date: day(at) }) : t('shared:falc.note.unreviewed', 'Texte simplifié non relu par une personne');
  };
}

/** Section component */
function FalcSection(/** @type {Record<string, string | number | boolean | null | undefined>} */ { icon, title, children, note, lang = FR }) {
  if (!children) return null;
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: 'hsl(var(--primary))' }}>
        {icon} {title}
      </h2>
      {/* PKG-11 / ADM-11: whether THIS simplified text was reviewed by a person (absent when the section is not a FALC text) */}
      {note ? <p data-testid="falc-review-note" style={{ fontSize: '0.875rem', color: 'hsl(var(--foreground))', marginBottom: '0.5rem' }}>{note}</p> : null}
      <div {...(lang || {})} style={{ fontSize: '1.125rem', color: 'hsl(var(--foreground))', whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>
        {children}
      </div>
    </section>
  );
}

/** List section for arrays */
// @ts-ignore
function FalcListSection({ icon, title, items }) {
  if (!items || !items.length) return null;
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: 'hsl(var(--primary))' }}>
        {icon} {title}
      </h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((/** @type {{ nom: string | number | boolean | null | undefined, title: string | number | boolean | null | undefined, titre: string | number | boolean | null | undefined }} */ item, /** @type {string | number} */ i) => (
          <li key={i} {...FR} style={{
            fontSize: '1.125rem', padding: '0.75rem', marginBottom: '0.5rem',
            backgroundColor: 'hsl(var(--muted))', borderInlineStart: '4px solid hsl(var(--primary))',
            borderRadius: '0.25rem'
          }}>
            {typeof item === 'string' ? item : (item?.titre || item?.title || item?.nom || JSON.stringify(item))}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Steps section */
function FalcStepsSection({ steps }) {
  const { t } = useT('shared');
  if (!steps || !steps.length) return null;
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: 'hsl(var(--primary))' }}>
        📋 {t('shared:falc.steps', 'Les étapes')}
      </h2>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, counterReset: 'step' }}>
        {steps.map((/** @type {{ description: string | number | boolean | null | undefined, numero: string | number | boolean | null | undefined, titre: string | number | boolean | null | undefined }} */ step, /** @type {string} */ i) => (
          <li key={i} style={{
            fontSize: '1.125rem', padding: '0.75rem', marginBottom: '0.5rem',
            backgroundColor: 'hsl(var(--muted))', borderInlineStart: '4px solid hsl(var(--primary))',
            borderRadius: '0.25rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
          }}>
            <span style={{
              minWidth: '2rem', height: '2rem', borderRadius: '50%',
              backgroundColor: 'hsl(var(--primary))', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 'bold', flexShrink: 0,
            }}>
              {step?.numero || i + 1}
            </span>
            <div {...FR}>
              {typeof step === 'string' ? <span>{step}</span> : null}
              {step?.titre && <strong>{step.titre}</strong>}
              {step?.description && <p style={{ margin: '0.25rem 0 0' }}>{toFalcText(step.description)}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// --- Entity-Type Section Renderers ---

const autoAt = (data) => data?.verification_auto?.textsWrittenAt || null;   // texts written from the official source and checked automatically
function AideFalcSections({ data }) {
  const { t } = useT('shared');
  const fieldNote = useFieldNote();
  const summary = data.summary_falc || data.resume_falc || data.description_falc || toFalcText(data.cest_quoi || data.description_courte);
  const conditions = data.conditions_falc || toFalcText(data.conditions || data.pour_qui);
  const montant = data.montant_falc || toFalcText(data.montant);
  const steps = Array.isArray(data.etapes_falc) ? data.etapes_falc : [];
  const comment = steps.length ? null : toFalcText(data.comment_faire || data.demarche);
  const noteOf = (field) => (data[field] ? fieldNote((data.falc_field_review || {})[field] ?? null, autoAt(data)) : null);   // ADM-11
  const documents = asList(data.documents_necessaires);
  const keyPoints = data.key_points_falc || [];

  return (
    <>
      <FalcSection icon="📖" title={t('shared:falc.what', "C'est quoi ?")} note={noteOf('summary_falc')}>{summary}</FalcSection>
      <FalcSection icon="✅" title={t('shared:falc.who', 'Pour qui ?')} note={noteOf('conditions_falc')}>{conditions}</FalcSection>
      <FalcSection icon="💰" title={t('shared:falc.amount', 'Combien ?')} note={noteOf('montant_falc')}>{montant}</FalcSection>
      <FalcSection icon="🔧" title={t('shared:falc.how', 'Comment faire ?')}>{comment}</FalcSection>
      <FalcStepsSection steps={steps} />
      <FalcListSection icon="📄" title={t('shared:falc.documents', 'Documents à préparer')} items={documents} />
      <FalcListSection icon="🔑" title={t('shared:falc.keyPoints', 'Points importants')} items={keyPoints} />
      {!summary && !conditions && !montant && !comment && !steps.length && documents.length === 0 && keyPoints.length === 0 && (
        <FalcSection icon="ℹ️" title={t('shared:falc.info', 'Information')} lang={null}>
          {t('shared:falc.empty.aide', 'Les informations FALC détaillées ne sont pas encore disponibles pour cette aide.')}
        </FalcSection>
      )}
    </>
  );
}

function DemarcheFalcSections({ data }) {
  const { t } = useT('shared');
  const fieldNote = useFieldNote();
  const summary = data.summary_falc || data.resume_falc || data.description_falc || toFalcText(data.description_courte || data.description);
  const pourQui = data.conditions_falc || toFalcText(data.pour_qui);
  const summaryNote = data.summary_falc ? fieldNote((data.falc_field_review || {}).summary_falc ?? null, autoAt(data)) : null;   // ADM-11
  const delai = toFalcText(data.delai);
  const cout = toFalcText(data.cout);
  const ouFaire = toFalcText(data.ou_faire);
  const steps = Array.isArray(data.etapes_falc) && data.etapes_falc.length ? data.etapes_falc : Array.isArray(data.etapes) ? data.etapes : [];
  const documents = asList(data.documents_necessaires);

  return (
    <>
      <FalcSection icon="📖" title={t('shared:falc.what', "C'est quoi ?")} note={summaryNote}>{summary}</FalcSection>
      <FalcSection icon="✅" title={t('shared:falc.who', 'Pour qui ?')}>{pourQui}</FalcSection>
      <FalcSection icon="⏱️" title={t('shared:falc.duration', 'Combien de temps ?')}>{delai}</FalcSection>
      <FalcSection icon="💰" title={t('shared:falc.cost', 'Combien ça coûte ?')}>{cout}</FalcSection>
      <FalcSection icon="📍" title={t('shared:falc.where', 'Où faire cette démarche ?')}>{ouFaire}</FalcSection>
      <FalcStepsSection steps={steps} />
      <FalcListSection icon="📄" title={t('shared:falc.documents', 'Documents à préparer')} items={documents} />
      {!summary && !pourQui && !delai && !cout && !ouFaire && steps.length === 0 && documents.length === 0 && (
        <FalcSection icon="ℹ️" title={t('shared:falc.info', 'Information')} lang={null}>
          {t('shared:falc.empty.demarche', 'Les informations FALC détaillées ne sont pas encore disponibles pour cette démarche.')}
        </FalcSection>
      )}
    </>
  );
}

function StructureFalcSections({ data }) {
  const { t } = useT('shared');
  const fieldNote = useFieldNote();
  const summary = data.resume_falc || data.summary_falc || data.description_falc || toFalcText(data.description_courte);
  const summaryNote = !data.resume_falc && data.summary_falc ? fieldNote((data.falc_field_review || {}).summary_falc ?? null, data?.verification_auto?.checkedAt || null) : null;   // ADM-11
  const services = Array.isArray(data.services) ? data.services : [];
  const horaires = toFalcText(data.horaires);
  // the labels are in the interface language; the phone number, e-mail and address of the place are never translated
  const contact = [
    data.telephone && `📞 ${t('shared:falc.contact.phone', 'Téléphone : {{value}}', { value: data.telephone })}`,
    data.email && `📧 ${t('shared:falc.contact.email', 'Email : {{value}}', { value: data.email })}`,
    data.site_web && `🌐 ${t('shared:falc.contact.site', 'Site : {{value}}', { value: data.site_web })}`,
  ].filter(Boolean).join('\n');
  const adresse = [
    data.adresse,
    [data.code_postal, data.ville].filter(Boolean).join(' '),
  ].filter(Boolean).join('\n');

  return (
    <>
      <FalcSection icon="📖" title={t('shared:falc.what', "C'est quoi ?")} note={summaryNote}>{summary}</FalcSection>
      <FalcListSection icon="🛠️" title={t('shared:falc.services', 'Services proposés')} items={services} />
      <FalcSection icon="🕐" title={t('shared:falc.hours', 'Horaires')}>{horaires}</FalcSection>
      <FalcSection icon="📞" title={t('shared:falc.contact', 'Contact')} lang={null}>{contact}</FalcSection>
      <FalcSection icon="📍" title={t('shared:falc.address', 'Adresse')}>{adresse}</FalcSection>
      {!summary && services.length === 0 && !horaires && !contact && !adresse && (
        <FalcSection icon="ℹ️" title={t('shared:falc.info', 'Information')} lang={null}>
          {t('shared:falc.empty.structure', 'Les informations FALC détaillées ne sont pas encore disponibles pour cette structure.')}
        </FalcSection>
      )}
    </>
  );
}

/**
 * @param {{ falcData: any, entityType?: string }} props
 */
export default function FalcContent({ falcData, entityType }) {
  const { t } = useT('shared');
  if (!falcData) {
    return (
      <div className="falc-content-empty" style={{ padding: '1rem', color: 'hsl(var(--muted-foreground))' }}>
        <p>{t('shared:falc.none', 'Aucun contenu FALC disponible.')}</p>
      </div>
    );
  }

  return (
    <div className="falc-content" style={{ lineHeight: '1.8' }}>
      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800" role="note" data-testid="falc-origin-note">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0" aria-hidden="true">{falcData?.verification_auto ? '✔' : '🤖'}</span>
          {/* what the reader is told depends on where the text comes from (automatic verification chain: written from the official source, then checked) */}
          {falcData?.verification_auto?.textsWrittenAt && falcData?.falc_origin === 'AI_LOCAL' ? (
            <p>
              <Trans i18n={i18n} i18nKey="shared:falc.origin.auto" defaults="<strong>Version facile à lire rédigée automatiquement</strong> à partir de la source officielle, puis contrôlée automatiquement : phrases courtes, aucun chiffre inventé, chaque phrase relue par rapport à la source. Elle aide à comprendre ; la source officielle fait foi." />
            </p>
          ) : falcData?.verification_auto && falcData?.falc_origin === 'DETERMINISTIC' ? (
            <p>
              <Trans i18n={i18n} i18nKey="shared:falc.origin.official" defaults="<strong>Texte simple écrit à partir des informations officielles</strong> (Annuaire de l'administration, répertoire SIRENE)." />
            </p>
          ) : (
            <p>
              <Trans i18n={i18n} i18nKey="shared:falc.origin.ai" defaults="<strong>Texte simplifié par intelligence artificielle.</strong> Cette version est une aide à la compréhension et ne remplace pas le texte officiel. Elle n'a pas été vérifiée par un professionnel." />
            </p>
          )}
        </div>
      </div>
      {entityType === 'demarche' ? (
        <DemarcheFalcSections data={falcData} />
      ) : entityType === 'structure' ? (
        <StructureFalcSections data={falcData} />
      ) : (
        <AideFalcSections data={falcData} />
      )}

      {/* FALC Help Text */}
      <div
        className="falc-help"
        style={{
          marginTop: '2rem', padding: '1rem',
          backgroundColor: 'hsl(var(--accent))', borderRadius: '0.5rem',
          fontSize: '0.875rem', color: 'hsl(var(--muted-foreground))'
        }}
      >
        <p style={{ margin: 0 }}>
          💡 <Trans i18n={i18n} i18nKey="shared:falc.help" defaults="<strong>FALC</strong> = Facile à Lire et à Comprendre. Ce texte est simplifié pour être plus facile à comprendre." />
        </p>
      </div>
    </div>
  );
}
