// @ts-nocheck
/**
 * FALC Content Display Component
 * Displays simplified content following FALC (Facile à Lire et à Comprendre) guidelines:
 * - Short sentences (1 idea per sentence)
 * - Simple vocabulary
 * - Clear structure with headings
 * - Entity-specific sections
 */
import { falcFieldNote } from '@/lib/falcLabel';
import { asList } from '@/lib/textLists';

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

/** Section component */
function FalcSection(/** @type {Record<string, string | number | boolean | null | undefined>} */ { icon, title, children, note }) {
  if (!children) return null;
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: 'hsl(var(--primary))' }}>
        {icon} {title}
      </h2>
      {/* PKG-11 / ADM-11: whether THIS simplified text was reviewed by a person (absent when the section is not a FALC text) */}
      {note ? <p data-testid="falc-review-note" style={{ fontSize: '0.875rem', color: 'hsl(var(--foreground))', marginBottom: '0.5rem' }}>{note}</p> : null}
      <div style={{ fontSize: '1.125rem', color: 'hsl(var(--foreground))', whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>
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
          <li key={i} style={{
            fontSize: '1.125rem', padding: '0.75rem', marginBottom: '0.5rem',
            backgroundColor: 'hsl(var(--muted))', borderLeft: '4px solid hsl(var(--primary))',
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
  if (!steps || !steps.length) return null;
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: 'hsl(var(--primary))' }}>
        📋 Les étapes
      </h2>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, counterReset: 'step' }}>
        {steps.map((/** @type {{ description: string | number | boolean | null | undefined, numero: string | number | boolean | null | undefined, titre: string | number | boolean | null | undefined }} */ step, /** @type {string} */ i) => (
          <li key={i} style={{
            fontSize: '1.125rem', padding: '0.75rem', marginBottom: '0.5rem',
            backgroundColor: 'hsl(var(--muted))', borderLeft: '4px solid hsl(var(--primary))',
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
            <div>
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
  const summary = data.summary_falc || data.resume_falc || data.description_falc || toFalcText(data.cest_quoi || data.description_courte);
  const conditions = data.conditions_falc || toFalcText(data.conditions || data.pour_qui);
  const montant = data.montant_falc || toFalcText(data.montant);
  const steps = Array.isArray(data.etapes_falc) ? data.etapes_falc : [];
  const comment = steps.length ? null : toFalcText(data.comment_faire || data.demarche);
  const noteOf = (field) => (data[field] ? falcFieldNote((data.falc_field_review || {})[field] ?? null, autoAt(data)) : null);   // ADM-11
  const documents = asList(data.documents_necessaires);
  const keyPoints = data.key_points_falc || [];

  return (
    <>
      <FalcSection icon="📖" title="C'est quoi ?" note={noteOf('summary_falc')}>{summary}</FalcSection>
      <FalcSection icon="✅" title="Pour qui ?" note={noteOf('conditions_falc')}>{conditions}</FalcSection>
      <FalcSection icon="💰" title="Combien ?" note={noteOf('montant_falc')}>{montant}</FalcSection>
      <FalcSection icon="🔧" title="Comment faire ?">{comment}</FalcSection>
      <FalcStepsSection steps={steps} />
      <FalcListSection icon="📄" title="Documents à préparer" items={documents} />
      <FalcListSection icon="🔑" title="Points importants" items={keyPoints} />
      {!summary && !conditions && !montant && !comment && !steps.length && documents.length === 0 && keyPoints.length === 0 && (
        <FalcSection icon="ℹ️" title="Information">
          Les informations FALC détaillées ne sont pas encore disponibles pour cette aide.
        </FalcSection>
      )}
    </>
  );
}

function DemarcheFalcSections({ data }) {
  const summary = data.summary_falc || data.resume_falc || data.description_falc || toFalcText(data.description_courte || data.description);
  const pourQui = data.conditions_falc || toFalcText(data.pour_qui);
  const summaryNote = data.summary_falc ? falcFieldNote((data.falc_field_review || {}).summary_falc ?? null, autoAt(data)) : null;   // ADM-11
  const delai = toFalcText(data.delai);
  const cout = toFalcText(data.cout);
  const ouFaire = toFalcText(data.ou_faire);
  const steps = Array.isArray(data.etapes_falc) && data.etapes_falc.length ? data.etapes_falc : Array.isArray(data.etapes) ? data.etapes : [];
  const documents = asList(data.documents_necessaires);

  return (
    <>
      <FalcSection icon="📖" title="C'est quoi ?" note={summaryNote}>{summary}</FalcSection>
      <FalcSection icon="✅" title="Pour qui ?">{pourQui}</FalcSection>
      <FalcSection icon="⏱️" title="Combien de temps ?">{delai}</FalcSection>
      <FalcSection icon="💰" title="Combien ça coûte ?">{cout}</FalcSection>
      <FalcSection icon="📍" title="Où faire cette démarche ?">{ouFaire}</FalcSection>
      <FalcStepsSection steps={steps} />
      <FalcListSection icon="📄" title="Documents à préparer" items={documents} />
      {!summary && !pourQui && !delai && !cout && !ouFaire && steps.length === 0 && documents.length === 0 && (
        <FalcSection icon="ℹ️" title="Information">
          Les informations FALC détaillées ne sont pas encore disponibles pour cette démarche.
        </FalcSection>
      )}
    </>
  );
}

function StructureFalcSections({ data }) {
  const summary = data.resume_falc || data.summary_falc || data.description_falc || toFalcText(data.description_courte);
  const summaryNote = !data.resume_falc && data.summary_falc ? falcFieldNote((data.falc_field_review || {}).summary_falc ?? null, data?.verification_auto?.checkedAt || null) : null;   // ADM-11
  const services = Array.isArray(data.services) ? data.services : [];
  const horaires = toFalcText(data.horaires);
  const contact = [
    data.telephone && `📞 Téléphone : ${data.telephone}`,
    data.email && `📧 Email : ${data.email}`,
    data.site_web && `🌐 Site : ${data.site_web}`,
  ].filter(Boolean).join('\n');
  const adresse = [
    data.adresse,
    [data.code_postal, data.ville].filter(Boolean).join(' '),
  ].filter(Boolean).join('\n');

  return (
    <>
      <FalcSection icon="📖" title="C'est quoi ?" note={summaryNote}>{summary}</FalcSection>
      <FalcListSection icon="🛠️" title="Services proposés" items={services} />
      <FalcSection icon="🕐" title="Horaires">{horaires}</FalcSection>
      <FalcSection icon="📞" title="Contact">{contact}</FalcSection>
      <FalcSection icon="📍" title="Adresse">{adresse}</FalcSection>
      {!summary && services.length === 0 && !horaires && !contact && !adresse && (
        <FalcSection icon="ℹ️" title="Information">
          Les informations FALC détaillées ne sont pas encore disponibles pour cette structure.
        </FalcSection>
      )}
    </>
  );
}

/**
 * @param {{ falcData: any, entityType?: string }} props
 */
export default function FalcContent({ falcData, entityType }) {
  if (!falcData) {
    return (
      <div className="falc-content-empty" style={{ padding: '1rem', color: 'hsl(var(--muted-foreground))' }}>
        <p>Aucun contenu FALC disponible.</p>
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
              <strong>Version facile à lire rédigée automatiquement</strong> à partir de la source officielle, puis contrôlée automatiquement :
              phrases courtes, aucun chiffre inventé, chaque phrase relue par rapport à la source. Elle aide à comprendre ; la source officielle fait foi.
            </p>
          ) : falcData?.verification_auto && falcData?.falc_origin === 'DETERMINISTIC' ? (
            <p>
              <strong>Texte simple écrit à partir des informations officielles</strong> (Annuaire de l&apos;administration, répertoire SIRENE).
            </p>
          ) : (
            <p>
              <strong>Texte simplifié par intelligence artificielle.</strong>{' '}
              Cette version est une aide à la compréhension et ne remplace pas le texte officiel.
              Elle n&apos;a pas été vérifiée par un professionnel.
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
          💡 <strong>FALC</strong> = Facile à Lire et à Comprendre.
          Ce texte est simplifié pour être plus facile à comprendre.
        </p>
      </div>
    </div>
  );
}
