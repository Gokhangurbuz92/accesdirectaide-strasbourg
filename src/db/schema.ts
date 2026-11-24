import crypto from 'node:crypto';
import { relations, sql } from 'drizzle-orm'
import { boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, vector } from 'drizzle-orm/pg-core'
import { sealedJson } from './sealed-json.js'

// P19 (0051): DISPOSITIF — a database before 0051 lacks it; writers ask api/_utils/schema-features.js contentTypeSchema() first
export const ContentType = pgEnum('ContentType', ['AIDE', 'DEMARCHE', 'STRUCTURE', 'ACTUALITE', 'DISPOSITIF'])

export const ReportReason = pgEnum('ReportReason', ['LIEN_MORT', 'HORAIRES_FAUX', 'INFO_FAUSSE', 'INFO_OBSOLETE', 'AUTRE'])

export const ReportStatus = pgEnum('ReportStatus', ['NEW', 'IN_PROGRESS', 'FIXED', 'REJECTED'])

export const AidCategoryCode = pgEnum('AidCategoryCode', ['LOGEMENT', 'SANTE', 'HANDICAP', 'EMPLOI', 'FAMILLE', 'ETUDES', 'MOBILITE', 'ENERGIE', 'ALIMENTATION', 'JUSTICE', 'NUMERIQUE', 'AUTRE'])

export const AidStatus = pgEnum('AidStatus', ['DRAFT', 'PUBLISHED', 'ARCHIVED'])

export const IngestJobStatus = pgEnum('IngestJobStatus', ['PENDING', 'PROCESSING', 'COMPLETED', 'ERROR'])

export const RdvBookingMode = pgEnum('RdvBookingMode', ['IN_PERSON', 'VIDEO', 'BOTH'])

export const SourceDocument = pgTable('SourceDocument', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	source_url: text('source_url'),
	fetched_at: timestamp('fetched_at', { precision: 3 }).notNull().defaultNow(),
	content_hash: text('content_hash'),
	raw_content: text('raw_content'),
	metadata: jsonb('metadata')
});

export const Aide = pgTable('Aide', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	slug: text('slug').unique(),
	titre: text('titre').notNull(),
	categorie: text('categorie'),
	est_urgent: boolean('est_urgent').notNull().default(false),
	territoires: text('territoires').array().notNull().default(sql`'{}'`),
	date_verification: timestamp('date_verification', { precision: 3 }),
	/** PKG-1 / D-5: public visibility is derived (api/lib/publicVisibility.js), never from statut alone. All default to the SAFE value. Only the verification handler writes these. */
	launch_eligible: boolean('launch_eligible').notNull().default(false),
	verification_status: text('verification_status').notNull().default('UNVERIFIED'),
	verified_by: text('verified_by'),
	territory_verified: boolean('territory_verified').notNull().default(false),
	publication_hold: text('publication_hold'),
	data_origin: text('data_origin').notNull().default('unclassified'),
	delai_indicatif: text('delai_indicatif'),
	cest_quoi: text('cest_quoi'),
	pour_qui: text('pour_qui'),
	ce_que_ca_aide: text('ce_que_ca_aide'),
	documents_necessaires: text('documents_necessaires').array().notNull().default(sql`'{}'`),
	etapes: jsonb('etapes'),
	ou_demander: text('ou_demander'),
	lien_demande: text('lien_demande'),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	statut: text('statut').notNull().default("brouillon"),
	updatedBy: text('updatedBy'),
	quality_score: integer('quality_score').notNull().default(0),
	commentaire_statut: text('commentaire_statut'),
	published_at: timestamp('published_at', { precision: 3 }),
	mots_cles: text('mots_cles').array().notNull().default(sql`'{}'`),
	summary_falc: text('summary_falc'),
	// PKG-6 / D19 P18: who reviewed the FALC text, when, and where it came from (IMPORTED, HUMAN, AI_LOCAL, DETERMINISTIC); unreviewed text is labelled as such
	falc_reviewed_by: text('falc_reviewed_by'),
	falc_reviewed_at: timestamp('falc_reviewed_at', { precision: 3 }),
	falc_origin: text('falc_origin'),
	/** PKG-11 / ADM-11: the review of EACH FALC field — { field: { at, by, sha256 } }; a field is shown as reviewed only while its text still has that sha256 (never public as is: by = staff e-mail) */
	falc_field_reviews: jsonb('falc_field_reviews').notNull().default({}),
	audiences: text('audiences').array().notNull().default(sql`'{}'`),
	conditions_falc: text('conditions_falc'),
	departements: text('departements').array().notNull().default(sql`'{}'`),
	montant_falc: text('montant_falc'),
	situations_vie: text('situations_vie').array().notNull().default(sql`'{}'`),
	structures_links: text('structures_links').array().notNull().default(sql`'{}'`),
	categoryId: text('categoryId'),
	providerName: text('providerName'),
	providerType: text('providerType'),
	sourceId: text('sourceId'),
	source_name: text('source_name'),
	source_url: text('source_url'),
	title: text('title'),
	description: text('description'),
	content: text('content'),
	category_code: AidCategoryCode('category_code').notNull().default("AUTRE"),
	status_code: AidStatus('status_code').notNull().default("DRAFT"),
	eligibility: jsonb('eligibility'),
	financials: jsonb('financials'),
	citations: jsonb('citations'),
	qa_score: integer('qa_score').notNull().default(0),
	qa_report: jsonb('qa_report'),
	source_org: text('source_org'),
	source_hash: text('source_hash'),
	last_checked: timestamp('last_checked', { precision: 3 }),
	geo_scope: text('geo_scope'),
	source_url_exact: text('source_url_exact'),
	territory_scope: text('territory_scope'),
	region_codes: text('region_codes').array().notNull().default(sql`'{}'`),
	department_codes: text('department_codes').array().notNull().default(sql`'{}'`),
	insee_codes: text('insee_codes').array().notNull().default(sql`'{}'`),
	content_hash: text('content_hash'),
	theme: text('theme'),
	sub_theme: text('sub_theme'),
	apply_url: text('apply_url'),
	source_last_modified: timestamp('source_last_modified', { precision: 3 }),
	fetched_at: timestamp('fetched_at', { precision: 3 }),
	montant_max: text('montant_max'),
	echelon_territorial: text('echelon_territorial'),
	code_insee_territoire: text('code_insee_territoire'),
	lien_demarche: text('lien_demarche'),
	source_donnee: text('source_donnee'),
	retrieved_at: timestamp('retrieved_at', { precision: 3 }),
	last_checked_at: timestamp('last_checked_at', { precision: 3 }),
	source_document_id: text('source_document_id'),
	externalId: text('externalId').unique(),
	
	// pgvector: 768 dimensions
	embedding: vector('embedding', { dimensions: 768 }),
	// Identifies the vector space / model used to generate this embedding
	// Required to prevent cross-model similarity corruption (e.g. Gemini 768 vs Nomic 768)
	embedding_model: text('embedding_model').default('LEGACY_UNKNOWN'),
	// PKG-11 / D16: SHA-256 of the exact text the stored embedding was computed from, and when — a changed record is re-embedded, an unchanged one is not
	embedded_text_sha256: text('embedded_text_sha256'),
	embedded_at: timestamp('embedded_at', { precision: 3 }),
	// G14-AI (migration 0060): "embedding_m3" vector(1024), "embedding_m3_sha256" text, "embedding_m3_at" timestamp(3) and the HNSW index
	// "Aide_embedding_m3_hnsw_idx" are NOT declared here (g14-r2 integration): Drizzle names every declared column in select() / insert(), so declaring them
	// made every read of "Aide" fail (« column "embedding_m3" does not exist ») on a database where 0060 is not applied yet — Production receives its
	// migrations later, separately authorised (tests/integration/m1-parcours-without-0046-db.test.js). They are read and written only through raw SQL guarded
	// by a column-presence check (api/lib/hybrid-search.js, api/lib/retrieval-index.js, scripts/reindex-embeddings.mjs). The SQL of drizzle/0060 and
	// drizzle/rollback/0060_down.sql own them; the 0060–0062 snapshots leave them out like this schema (QA v72: snapshots that kept them made
	// drizzle-kit generate emit a 0063 that DROPs them). Guard: tests/unit/g14-snapshot-schema-sync.test.js (generate must be a no-op).
	// automatic verification chain (api/_services/verification/chain.js): the FALC steps, and the summary of the last automatic check (sources read, result, texts)
	etapes_falc: jsonb('etapes_falc'),
	auto_check: jsonb('auto_check'),
}, (Aide) => ({
	'Aide_category_fkey': foreignKey({
		name: 'Aide_category_fkey',
		columns: [Aide.categoryId],
		foreignColumns: [AidCategory.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'Aide_source_fkey': foreignKey({
		name: 'Aide_source_fkey',
		columns: [Aide.sourceId],
		foreignColumns: [AidSource.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'Aide_sourceDocument_fkey': foreignKey({
		name: 'Aide_sourceDocument_fkey',
		columns: [Aide.source_document_id],
		foreignColumns: [SourceDocument.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	// HNSW index for fast cosine similarity search (pgvector)
	'Aide_embedding_hnsw_idx': index('Aide_embedding_hnsw_idx')
		.using('hnsw', Aide.embedding.op('vector_cosine_ops')),
	// G14-AI (0060): the bge-m3 HNSW index is owned by the migration (see the note on the columns above)
}));

export const AidCategory = pgTable('AidCategory', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	slug: text('slug').notNull().unique(),
	label: text('label').notNull()
});

export const LifeSituation = pgTable('LifeSituation', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	slug: text('slug').notNull().unique(),
	label: text('label').notNull()
});

export const Situation = pgTable('Situation', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	code: text('code').notNull().unique(),
	label: text('label').notNull(),
	description: text('description'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const AidSituation = pgTable('AidSituation', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	aidId: text('aidId').notNull(),
	situationId: text('situationId').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (AidSituation) => ({
	'AidSituation_aid_fkey': foreignKey({
		name: 'AidSituation_aid_fkey',
		columns: [AidSituation.aidId],
		foreignColumns: [Aide.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'AidSituation_situation_fkey': foreignKey({
		name: 'AidSituation_situation_fkey',
		columns: [AidSituation.situationId],
		foreignColumns: [Situation.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'AidSituation_aidId_situationId_unique_idx': uniqueIndex('AidSituation_aidId_situationId_key')
		.on(AidSituation.aidId, AidSituation.situationId)
}));

export const AidSource = pgTable('AidSource', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	kind: text('kind'),
	baseUrl: text('baseUrl'),
	license: text('license'),
	refreshPolicy: text('refreshPolicy'),
	lastRunAt: timestamp('lastRunAt', { precision: 3 }),
	lastStatus: text('lastStatus')
});

export const Structure = pgTable('Structure', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	nom: text('nom').notNull(),
	type_structure: text('type_structure'),
	accessibilite_pmr: boolean('accessibilite_pmr').default(false).notNull(),
	description_courte: text('description_courte'),
	adresse: text('adresse'),
	code_postal: text('code_postal'),
	ville: text('ville'),
	departement: text('departement'),
	telephone: text('telephone'),
	email: text('email'),
	site_web: text('site_web'),
	horaires: text('horaires'),
	services: text('services').array().notNull(),
	publics_accueillis: text('publics_accueillis').array().notNull(),
	date_verification: timestamp('date_verification', { precision: 3 }),
	/** PKG-1 / D-5: public visibility is derived (api/lib/publicVisibility.js), never from statut alone. All default to the SAFE value. Only the verification handler writes these. */
	launch_eligible: boolean('launch_eligible').notNull().default(false),
	verification_status: text('verification_status').notNull().default('UNVERIFIED'),
	verified_by: text('verified_by'),
	territory_verified: boolean('territory_verified').notNull().default(false),
	publication_hold: text('publication_hold'),
	data_origin: text('data_origin').notNull().default('unclassified'),
	categories_aidees: text('categories_aidees').array().notNull(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
		.$defaultFn(() => new Date())
		.$onUpdate(() => new Date())
		.notNull(),
	status: text('status').notNull().default("actif"),
	commentaire_statut: text('commentaire_statut'),
	published_at: timestamp('published_at', { precision: 3 }),
	statut: text('statut').notNull().default("brouillon"),
	updatedBy: text('updatedBy'),
	mots_cles: text('mots_cles').array().notNull().default(sql`'{}'`),
	slug: text('slug').unique(),
	summary_falc: text('summary_falc'),
	// PKG-6 / D19 P18: who reviewed the FALC text, when, and where it came from (IMPORTED, HUMAN, AI_LOCAL, DETERMINISTIC); unreviewed text is labelled as such
	falc_reviewed_by: text('falc_reviewed_by'),
	falc_reviewed_at: timestamp('falc_reviewed_at', { precision: 3 }),
	falc_origin: text('falc_origin'),
	/** PKG-11 / ADM-11: the review of EACH FALC field — { field: { at, by, sha256 } }; a field is shown as reviewed only while its text still has that sha256 (never public as is: by = staff e-mail) */
	falc_field_reviews: jsonb('falc_field_reviews').notNull().default({}),
	is_pro_enabled: boolean('is_pro_enabled').default(false).notNull(),
	settings_json: jsonb('settings_json').default("{}"),
	auto_publish: boolean('auto_publish').default(false).notNull(),
	geoloc_status: text('geoloc_status'),
	import_batch: text('import_batch'),
	import_status: text('import_status').notNull().default("pending"),
	last_sync: timestamp('last_sync', { precision: 3 }).notNull().defaultNow(),
	latitude: doublePrecision('latitude'),
	longitude: doublePrecision('longitude'),
	quality_score: integer('quality_score').notNull().default(50),
	raw_data_hash: text('raw_data_hash').unique(),
	siret: text('siret').unique(),
	source_id: text('source_id'),
	source_url: text('source_url'),
	source_url_exact: text('source_url_exact'),
	territory_scope: text('territory_scope'),
	region_codes: text('region_codes').array().notNull().default(sql`'{}'`),
	department_codes: text('department_codes').array().notNull().default(sql`'{}'`),
	insee_codes: text('insee_codes').array().notNull().default(sql`'{}'`),
	content_hash: text('content_hash'),
	type_finess: text('type_finess'),
	numero_finess: text('numero_finess').unique(),
	rna_id: text('rna_id').unique(),
	source_annuaire: text('source_annuaire'),
	retrieved_at: timestamp('retrieved_at', { precision: 3 }),
	last_checked_at: timestamp('last_checked_at', { precision: 3 }),
	source_last_modified: timestamp('source_last_modified', { precision: 3 }),
	source_document_id: text('source_document_id'),
	// automatic verification chain: the summary of the last automatic check (registries read, result, corrections)
	auto_check: jsonb('auto_check'),
	// R11 / D05: the services other public platforms list for this place (data·inclusion open data), each with its ORIGINAL producer and that producer's
	// authority (public operator / self-declared on a platform) — attributed facts, never presented as checked by the State (api/_services/verification/datainclusion.js)
	services_externes: jsonb('services_externes'),
}, (Structure) => ({
	'Structure_sourceDocument_fkey': foreignKey({
		name: 'Structure_sourceDocument_fkey',
		columns: [Structure.source_document_id],
		foreignColumns: [SourceDocument.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

export const Demarche = pgTable('Demarche', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	titre: text('titre').notNull(),
	categorie: text('categorie'),
	description_courte: text('description_courte'),
	delai: text('delai'),
	cout: text('cout'),
	date_verification: timestamp('date_verification', { precision: 3 }),
	/** PKG-1 / D-5: public visibility is derived (api/lib/publicVisibility.js), never from statut alone. All default to the SAFE value. Only the verification handler writes these. */
	launch_eligible: boolean('launch_eligible').notNull().default(false),
	verification_status: text('verification_status').notNull().default('UNVERIFIED'),
	verified_by: text('verified_by'),
	territory_verified: boolean('territory_verified').notNull().default(false),
	publication_hold: text('publication_hold'),
	data_origin: text('data_origin').notNull().default('unclassified'),
	pour_qui: text('pour_qui'),
	documents_necessaires: text('documents_necessaires').array().notNull().default(sql`'{}'`),
	etapes: jsonb('etapes'),
	ou_faire: text('ou_faire'),
	lien_officiel: text('lien_officiel'),
	sources: jsonb('sources'),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	statut: text('statut').notNull().default("brouillon"),
	updatedBy: text('updatedBy'),
	quality_score: integer('quality_score').notNull().default(0),
	commentaire_statut: text('commentaire_statut'),
	published_at: timestamp('published_at', { precision: 3 }),
	mots_cles: text('mots_cles').array().notNull().default(sql`'{}'`),
	slug: text('slug').unique(),
	summary_falc: text('summary_falc'),
	// PKG-6 / D19 P18: who reviewed the FALC text, when, and where it came from (IMPORTED, HUMAN, AI_LOCAL, DETERMINISTIC); unreviewed text is labelled as such
	falc_reviewed_by: text('falc_reviewed_by'),
	falc_reviewed_at: timestamp('falc_reviewed_at', { precision: 3 }),
	falc_origin: text('falc_origin'),
	/** PKG-11 / ADM-11: the review of EACH FALC field — { field: { at, by, sha256 } }; a field is shown as reviewed only while its text still has that sha256 (never public as is: by = staff e-mail) */
	falc_field_reviews: jsonb('falc_field_reviews').notNull().default({}),
	audiences: text('audiences').array().notNull().default(sql`'{}'`),
	departements: text('departements').array().notNull().default(sql`'{}'`),
	categoryId: text('categoryId'),
	public_cible: text('public_cible'),
	contenu_detaille: text('contenu_detaille'),
	lien_teleservice: text('lien_teleservice'),
	source_url_exact: text('source_url_exact'),
	territory_scope: text('territory_scope'),
	region_codes: text('region_codes').array().notNull().default(sql`'{}'`),
	department_codes: text('department_codes').array().notNull().default(sql`'{}'`),
	insee_codes: text('insee_codes').array().notNull().default(sql`'{}'`),
	content_hash: text('content_hash'),
	source_url: text('source_url'),
	retrieved_at: timestamp('retrieved_at', { precision: 3 }),
	last_checked_at: timestamp('last_checked_at', { precision: 3 }),
	source_last_modified: timestamp('source_last_modified', { precision: 3 }),
	source_document_id: text('source_document_id'),
	// automatic verification chain: who it is for (FALC), the FALC steps, and the summary of the last automatic check
	conditions_falc: text('conditions_falc'),
	etapes_falc: jsonb('etapes_falc'),
	auto_check: jsonb('auto_check')
}, (Demarche) => ({
	'Demarche_category_fkey': foreignKey({
		name: 'Demarche_category_fkey',
		columns: [Demarche.categoryId],
		foreignColumns: [AidCategory.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'Demarche_sourceDocument_fkey': foreignKey({
		name: 'Demarche_sourceDocument_fkey',
		columns: [Demarche.source_document_id],
		foreignColumns: [SourceDocument.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

export const Actualite = pgTable('Actualite', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	titre: text('titre').notNull(),
	contenu: text('contenu'),
	date_publication: timestamp('date_publication', { precision: 3 }).notNull().defaultNow(),
	image_url: text('image_url'),
	lien_url: text('lien_url'),
	source: text('source'),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	statut: text('statut').notNull().default("brouillon"),
	updatedBy: text('updatedBy'),
	commentaire_statut: text('commentaire_statut'),
	published_at: timestamp('published_at', { precision: 3 }),
	canonical_url: text('canonical_url').unique(),
	category: text('category').default("actualite"),
	dedupe_hash: text('dedupe_hash'),
	fetched_at: timestamp('fetched_at', { precision: 3 }),
	guid: text('guid'),
	key_points_falc: text('key_points_falc').array().notNull(),
	slug: text('slug').unique(),
	source_id: text('source_id'),
	source_name: text('source_name'),
	summary_falc: text('summary_falc'),
	territoire: text('territoire').default("FRANCE"),
	auto_publish: boolean('auto_publish').notNull().default(false),
	categorie: text('categorie').default("general"),
	departements: text('departements').array().notNull(),
	est_important: boolean('est_important').notNull().default(false),
	falc_status: text('falc_status').notNull().default("pending"),
	ingest_batch: text('ingest_batch'),
	quality_score: integer('quality_score').notNull().default(0),
	raw_data_hash: text('raw_data_hash').unique(),
	raw_payload_json: jsonb('raw_payload_json'),
	resume: text('resume'),
	score_fiabilite: integer('score_fiabilite').notNull(),
	source_nom: text('source_nom'),
	source_url: text('source_url'),
	tags: text('tags').array().notNull(),
	type_actu: text('type_actu').default("info"),
	url: text('url'),
	source_document_id: text('source_document_id')
}, (Actualite) => ({
	'Actualite_sourceDocument_fkey': foreignKey({
		name: 'Actualite_sourceDocument_fkey',
		columns: [Actualite.source_document_id],
		foreignColumns: [SourceDocument.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

export const ImportLog = pgTable('ImportLog', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	run_id: text('run_id'),
	source_name: text('source_name').notNull(),
	status: text('status').notNull(),
	items_total: integer('items_total').notNull(),
	items_new: integer('items_new').notNull(),
	items_updated: integer('items_updated').notNull(),
	items_skipped: integer('items_skipped').notNull(),
	duration_ms: integer('duration_ms'),
	logs: jsonb('logs'),
	error_count: integer('error_count').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
});

export const CronRun = pgTable('CronRun', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	job: text('job').notNull(),
	status: text('status').notNull(),
	trigger: text('trigger'),
	skipReason: text('skipReason'),
	startedAt: timestamp('startedAt', { precision: 3 }).notNull().defaultNow(),
	finishedAt: timestamp('finishedAt', { precision: 3 }),
	durationMs: integer('durationMs'),
	requestId: text('requestId'),
	vercelEnv: text('vercelEnv'),
	release: text('release'),
	metrics: jsonb('metrics'),
	errorSample: text('errorSample'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' })
		.$defaultFn(() => new Date())
		.$onUpdate(() => new Date())
		.notNull()
});

export const ReviewQueueItem = pgTable('ReviewQueueItem', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	entityType: text('entityType').notNull(),
	entityId: text('entityId').notNull(),
	entitySlug: text('entitySlug'),
	title: text('title'),
	reason: text('reason').notNull(),
	severity: text('severity').notNull(),
	status: text('status').notNull(),
	details: jsonb('details'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (ReviewQueueItem) => ({
	'ReviewQueueItem_entityType_entityId_reason_status_unique_idx': uniqueIndex('ReviewQueueItem_entityType_entityId_reason_status_key')
		.on(ReviewQueueItem.entityType, ReviewQueueItem.entityId, ReviewQueueItem.reason, ReviewQueueItem.status)
}));

export const RssSource = pgTable('RssSource', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	feed_url: text('feed_url').notNull().unique(),
	domain: text('domain').notNull(),
	trust_level: text('trust_level').notNull().default("OFFICIAL"),
	enabled: boolean('enabled').notNull().default(true),
	last_run_at: timestamp('last_run_at', { precision: 3 }),
	etag: text('etag'),
	last_modified: text('last_modified'),
	error_count: integer('error_count').notNull(),
	last_error: text('last_error'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const UpdateLog = pgTable('UpdateLog', {
	id: serial('id').notNull().primaryKey(),
	ran_at: timestamp('ran_at', { precision: 3 }).notNull().defaultNow(),
	status: text('status').notNull(),
	duration_ms: integer('duration_ms'),
	items_fetched_count: integer('items_fetched_count').notNull(),
	items_created_count: integer('items_created_count').notNull(),
	items_updated_count: integer('items_updated_count').notNull(),
	items_skipped_count: integer('items_skipped_count').notNull(),
	errors: text('errors').array().notNull(),
	source_name: text('source_name'),
	is_dry_run: boolean('is_dry_run').notNull()
});

export const IngestJob = pgTable('IngestJob', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	source: text('source').notNull(),
	status: IngestJobStatus('status').notNull().default("PENDING"),
	payload: jsonb('payload'),
	result: jsonb('result'),
	error_message: text('error_message'),
	started_at: timestamp('started_at', { precision: 3 }),
	finished_at: timestamp('finished_at', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const Source = pgTable('Source', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	type: text('type').notNull(),
	url: text('url'),
	status: text('status').notNull().default("actif"),
	trust_level: text('trust_level'),
	last_sync: timestamp('last_sync', { precision: 3 })
});

export const AdminUser = pgTable('AdminUser', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	email: text('email').notNull().unique(),
	password: text('password').notNull(),
	role: text('role').notNull().default("admin"),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	failedLoginAttempts: integer('failedLoginAttempts').notNull(),
	lastLogin: timestamp('lastLogin', { precision: 3 }),
	lockoutUntil: timestamp('lockoutUntil', { precision: 3 }),
	mfaSecret: text('mfaSecret'),
	mfaIv: text('mfaIv'),
	mfaEnabled: boolean('mfaEnabled').notNull(),
	/** PKG-11 / ADM-10: administrator sessions issued before this instant are refused (logout, password change, revocation by another administrator) */
	sessionsValidAfter: timestamp('sessionsValidAfter', { precision: 3 }),
	/** PKG-11 / ADM-10: a disabled administrator can no longer sign in, and every session of theirs is refused */
	disabledAt: timestamp('disabledAt', { precision: 3 }),
	/** PKG-11 / owner LAB audit: the TOTP time step (30 s) of the last accepted code: a code is accepted once (RFC 6238 §5.2), at sign-in as at elevation */
	mfaLastTimeStep: integer('mfaLastTimeStep'),
	/** owner LAB audit: the NAME of the person who holds the account (one person, one account — attested at creation, scripts/lab-local.mjs admin-create) */
	displayName: text('displayName')
});

export const CitizenUser = pgTable('CitizenUser', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	email: text('email').notNull().unique(),
	passwordHash: text('passwordHash').notNull(),
	emailVerifiedAt: timestamp('emailVerifiedAt', { precision: 3 }),
	phone: text('phone'),
	phoneVerifiedAt: timestamp('phoneVerifiedAt', { precision: 3 }),
	notificationEmailEnabled: boolean('notificationEmailEnabled').notNull().default(true),
	failedLoginAttempts: integer('failedLoginAttempts').notNull().default(0),
	lockoutUntil: timestamp('lockoutUntil', { precision: 3 }),
	/** PKG-11 audit: sessions issued before this instant are refused (password reset, ownership recovery, logout) — citizen tokens used to live 7 days whatever happened. */
	sessionsValidAfter: timestamp('sessionsValidAfter', { precision: 3 }),
	/** launch-readiness item 62: the last successful sign-in — the inactivity of an account is measured from it (retention report; NULL = not measured yet) */
	lastSeenAt: timestamp('lastSeenAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const AuthToken = pgTable('AuthToken', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text('userId').notNull(),
	type: text('type').notNull(),
	tokenHash: text('tokenHash').notNull().unique(),
	expiresAt: timestamp('expiresAt', { precision: 3 }).notNull(),
	usedAt: timestamp('usedAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (AuthToken) => ({
	'AuthToken_user_fkey': foreignKey({
		name: 'AuthToken_user_fkey',
		columns: [AuthToken.userId],
		foreignColumns: [CitizenUser.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

/**
 * Launch-readiness item 66 — change of a citizen account's e-mail address (right of rectification): the NEW address is kept encrypted (envelope, purpose
 * 'email-change') until the person proves it by the single-use link sent there (30 minutes); the old address is told. Expired rows are purged by cron/gdpr-purge.
 */
/**
 * R11 / N04 — a browser's Web Push subscription (W3C Push API, RFC 8030 / 8291 / 8292): the push service's address and the browser's keys, SEALED (the address is
 * a personal capability: whoever holds it can reach that browser); endpointHash (sha-256) keeps one row per browser. ACTIVE until the person or the browser ends
 * it: a push service answering 404 / 410 deletes it; repeated failures mark it FAILING (api/_services/web-push.js). Removed with the account.
 */
export const PushSubscription = pgTable('PushSubscription', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text('userId').notNull(),
	endpointHash: text('endpointHash').notNull().unique(),
	subscriptionEncrypted: text('subscriptionEncrypted').notNull(),
	pushHost: text('pushHost').notNull(),
	status: text('status').notNull().default('ACTIVE'),
	failureCount: integer('failureCount').notNull().default(0),
	lastSuccessAt: timestamp('lastSuccessAt', { precision: 3 }),
	lastFailureAt: timestamp('lastFailureAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'PushSubscription_user_fkey': foreignKey({ name: 'PushSubscription_user_fkey', columns: [t.userId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'PushSubscription_user_idx': index('PushSubscription_user_idx').on(t.userId),
	'PushSubscription_status_check': check('PushSubscription_status_check', sql`${t.status} IN ('ACTIVE', 'FAILING')`)
}));

export const EmailChangeRequest = pgTable('EmailChangeRequest', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text('userId').notNull(),
	newEmailEncrypted: text('newEmailEncrypted').notNull(),
	tokenHash: text('tokenHash').notNull().unique(),
	expiresAt: timestamp('expiresAt', { precision: 3 }).notNull(),
	usedAt: timestamp('usedAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'EmailChangeRequest_user_fkey': foreignKey({ name: 'EmailChangeRequest_user_fkey', columns: [t.userId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'EmailChangeRequest_user_idx': index('EmailChangeRequest_user_idx').on(t.userId)
}));

export const AuditLog = pgTable('AuditLog', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	action: text('action').notNull(),
	actor: text('actor'),
	target: text('target'),
	details: jsonb('details'),
	timestamp: timestamp('timestamp', { precision: 3 }).notNull().defaultNow(),
	ip: text('ip'),
	actor_id: text('actor_id'),
	entity: text('entity'),
	entity_id: text('entity_id'),
	ip_hash: text('ip_hash')
});

export const ProUser = pgTable('ProUser', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	email: text('email').notNull(),
	password_hash: text('password_hash').notNull(),
	role: text('role').notNull(),
	status: text('status').notNull().default("pending"),
	structureId: text('structureId').notNull(),
	notificationEmailEnabled: boolean('notificationEmailEnabled').notNull().default(true),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	mfa_enabled: boolean('mfa_enabled').notNull().default(false),
	/** the TOTP seed, sealed with the vault since the owner LAB audit (« v1:<iv>:<ciphertext> »); an older plain base32 seed is still read */
	mfa_secret: text('mfa_secret'),
	/** PKG-11 / owner LAB audit: the TOTP time step (30 s) of the last accepted code: a code is accepted once (RFC 6238 §5.2) */
	mfa_last_time_step: integer('mfa_last_time_step'),
	// PKG-11 / audit (session lifecycle): sessions issued before this instant are refused (password reset, explicit sign-out of every device). NULL = none revoked.
	sessionsValidAfter: timestamp('sessionsValidAfter', { precision: 3 }),
	/** PKG-4 / R20: per-category e-mail preferences ({ cases: false, ... }); absent = follows notificationEmailEnabled. In-app notices are always kept. */
	notificationPrefs: jsonb('notificationPrefs').notNull().default({}),
	/** R24 / owner decision R18.5: a member to whom the administrator delegated the structure's schedule (opening hours, closures, other members' absences) */
	canManageSchedule: boolean('canManageSchedule').notNull().default(false)
}, (ProUser) => ({
	'ProUser_structure_fkey': foreignKey({
		name: 'ProUser_structure_fkey',
		columns: [ProUser.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'ProUser_structureId_email_unique_idx': uniqueIndex('ProUser_structureId_email_key')
		.on(ProUser.structureId, ProUser.email)
}));

// [LEGACY] Service table removed — replaced by ProRdvService

export const ProRdvService = pgTable('ProRdvService', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	structureId: text('structureId').notNull(),
	name: text('name').notNull(),
	durationMinutes: integer('durationMinutes').notNull(),
	bufferBeforeMinutes: integer('bufferBeforeMinutes').notNull().default(0),
	bufferAfterMinutes: integer('bufferAfterMinutes').notNull().default(0),
	isActive: boolean('isActive').notNull().default(true),
	// PKG-3: the modalities this service is offered in (subset of the structure's bookingMode)
	modes: text('modes').array().notNull().default(sql`ARRAY['IN_PERSON']::text[]`),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	// R38: bookable without an account (in person only), on top of StructureRdvSettings.allowGuestBooking — explicit opt-in, default off
	guestBookable: boolean('guestBookable').notNull().default(false)
}, (ProRdvService) => ({
	'ProRdvService_structure_fkey': foreignKey({
		name: 'ProRdvService_structure_fkey',
		columns: [ProRdvService.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

// G14-R3 (drizzle/0063) — the needs a bookable service answers: subdomains of the 20 × 86 taxonomy (data/reference/social-domains.v1.json), with their
// domain, so the directory can list « every place that books an appointment for <subdomain> ». A separate table (not a column of "ProRdvService"): the
// code reads "ProRdvService" on databases without 0063 (Production) and Drizzle names every declared column. Only writer: api/_handlers/pro/services.js.
export const ProRdvServiceSubdomain = pgTable('ProRdvServiceSubdomain', {
	serviceId: text('serviceId').notNull(),
	subdomain: text('subdomain').notNull(),
	domain: text('domain').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'ProRdvServiceSubdomain_pkey': primaryKey({ name: 'ProRdvServiceSubdomain_pkey', columns: [t.serviceId, t.subdomain] }),
	'ProRdvServiceSubdomain_service_fkey': foreignKey({ name: 'ProRdvServiceSubdomain_service_fkey', columns: [t.serviceId], foreignColumns: [ProRdvService.id] }).onDelete('cascade').onUpdate('cascade'),
	'ProRdvServiceSubdomain_subdomain_idx': index('ProRdvServiceSubdomain_subdomain_idx').on(t.subdomain),
	'ProRdvServiceSubdomain_domain_idx': index('ProRdvServiceSubdomain_domain_idx').on(t.domain),
	'ProRdvServiceSubdomain_subdomain_check': check('ProRdvServiceSubdomain_subdomain_check', sql`${t.subdomain} ~ '^[a-z0-9-]{1,64}$'`),
	'ProRdvServiceSubdomain_domain_check': check('ProRdvServiceSubdomain_domain_check', sql`${t.domain} ~ '^[a-z0-9-]{1,64}$'`)
}));

// G14-R3 (drizzle/0063) — « appointments on our own system »: the https page where a place takes appointments itself (not an AccesDirectAide booking).
// Recorded by the structure (ADA Pro), an administrator, or proposed by an open-data import; shown publicly ONLY once an administrator APPROVED it and
// while ADA_EXTERNAL_BOOKING is open (api/lib/external-booking.js). A changed URL goes back to PENDING. Only writer: api/_services/external-booking.js.
export const StructureExternalBooking = pgTable('StructureExternalBooking', {
	structureId: text('structureId').notNull().primaryKey(),
	url: text('url').notNull(),
	platform: text('platform').notNull().default('other'),
	subdomains: text('subdomains').array().notNull().default(sql`'{}'::text[]`),
	status: text('status').notNull().default('PENDING'),
	source: text('source').notNull(),
	sourceRef: text('sourceRef'),
	submittedBy: text('submittedBy'),
	submittedAt: timestamp('submittedAt', { precision: 3 }).notNull().defaultNow(),
	reviewedBy: text('reviewedBy'),
	reviewedAt: timestamp('reviewedAt', { precision: 3 }),
	reviewNote: text('reviewNote'),
	updatedAt: timestamp('updatedAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'StructureExternalBooking_structure_fkey': foreignKey({ name: 'StructureExternalBooking_structure_fkey', columns: [t.structureId], foreignColumns: [Structure.id] }).onDelete('cascade').onUpdate('cascade'),
	'StructureExternalBooking_status_idx': index('StructureExternalBooking_status_idx').on(t.status),
	'StructureExternalBooking_url_check': check('StructureExternalBooking_url_check', sql`${t.url} ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]]*)?$' AND length(${t.url}) <= 2048`),
	'StructureExternalBooking_platform_check': check('StructureExternalBooking_platform_check', sql`${t.platform} ~ '^[a-z0-9-]{1,40}$'`),
	'StructureExternalBooking_status_check': check('StructureExternalBooking_status_check', sql`${t.status} IN ('PENDING', 'APPROVED', 'REJECTED')`),
	'StructureExternalBooking_source_check': check('StructureExternalBooking_source_check', sql`${t.source} IN ('PRO', 'ADMIN', 'IMPORT')`),
	'StructureExternalBooking_review_check': check('StructureExternalBooking_review_check', sql`${t.status} = 'PENDING' OR (${t.reviewedBy} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL)`),
	'StructureExternalBooking_subdomains_check': check('StructureExternalBooking_subdomains_check', sql`cardinality(${t.subdomains}) <= 10`)
}));

export const ProAvailabilityRule = pgTable('ProAvailabilityRule', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	structureId: text('structureId').notNull(),
	weekday: integer('weekday').notNull(),
	startTime: text('startTime').notNull(),
	endTime: text('endTime').notNull(),
	timezone: text('timezone').notNull().default("Europe/Paris"),
	isActive: boolean('isActive').notNull().default(true),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	// PKG-3: the modalities this opening period serves (default: both); slots of a modality come only from periods that serve it
	modes: text('modes').array().notNull().default(sql`ARRAY['IN_PERSON', 'VIDEO']::text[]`)
}, (ProAvailabilityRule) => ({
	'ProAvailabilityRule_structure_fkey': foreignKey({
		name: 'ProAvailabilityRule_structure_fkey',
		columns: [ProAvailabilityRule.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

export const ProAppointment = pgTable('ProAppointment', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	structureId: text('structureId').notNull(),
	serviceId: text('serviceId').notNull(),
	startAt: timestamp('startAt', { precision: 3 }).notNull(),
	endAt: timestamp('endAt', { precision: 3 }).notNull(),
	status: text('status').notNull().default("booked"),
	beneficiaryName: text('beneficiaryName').notNull(),
	beneficiaryPhone: text('beneficiaryPhone'),
	notes: text('notes'),
	createdByProUserId: text('createdByProUserId'),
	citizenUserId: text('citizenUserId'),
	citizenEmailSnapshot: text('citizenEmailSnapshot'),
	idempotencyKey: text('idempotencyKey'),
	cancelledAt: timestamp('cancelledAt', { precision: 3 }),
	cancelledBy: text('cancelledBy'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	visioRoomId: text('visioRoomId'),
	visioEnabled: boolean('visioEnabled').notNull().default(false),
	visioStartedAt: timestamp('visioStartedAt', { precision: 3 }),
	reminder_sent_at: timestamp('reminder_sent_at'),
	reminder_locked_at: timestamp('reminder_locked_at'),
	// PKG-3 / D-2: how many times the citizen moved this appointment (at most 2, DB CHECK) and when last
	rescheduleCount: integer('rescheduleCount').notNull().default(0),
	rescheduledAt: timestamp('rescheduledAt', { precision: 3 }),
	// PKG-3 / B08: when the professional recorded that the person agreed to an appointment created for them (required for a professional-created appointment)
	beneficiaryConsentAt: timestamp('beneficiaryConsentAt', { precision: 3 }),
	// PKG-3 — the appointment modality chosen at booking (IN_PERSON | VIDEO); never changed silently. Video access additionally needs the structure's approval and the
	// person's consent (both recorded) and the provider being activated.
	mode: text('mode').notNull().default('IN_PERSON'),
	visioApprovedAt: timestamp('visioApprovedAt', { precision: 3 }),
	visioApprovedByProUserId: text('visioApprovedByProUserId'),
	visioCitizenConsentAt: timestamp('visioCitizenConsentAt', { precision: 3 }),
	// R38 — account-free (« sans compte ») booking. The name goes to beneficiaryName and the note to notes (both sealed, as a professional-created appointment);
	// the e-mail and the phone are sealed here; only hashes of the e-mail, of the 6-digit code and of the manage token are kept.
	guestEmail: text('guestEmail'),
	guestEmailHash: text('guestEmailHash'),
	guestPhone: text('guestPhone'),
	guestMailConsentAt: timestamp('guestMailConsentAt', { precision: 3 }),
	guestHoldExpiresAt: timestamp('guestHoldExpiresAt', { precision: 3 }),
	guestCodeHash: text('guestCodeHash'),
	guestCodeAttempts: integer('guestCodeAttempts').notNull().default(0),
	guestConfirmedAt: timestamp('guestConfirmedAt', { precision: 3 }),
	guestManageTokenHash: text('guestManageTokenHash'),
	guestManageExpiresAt: timestamp('guestManageExpiresAt', { precision: 3 }),
	// R39 — the OPTIONAL J-1 reminder of an account-free booking: set only when the person ticked the separate box (never pre-ticked), cleared when they
	// withdraw it from their personal link; independent of guestMailConsentAt (the booking mails). Cleared by gdpr-purge step 13 with the other guest data.
	guestReminderConsentAt: timestamp('guestReminderConsentAt', { precision: 3 }),
}, (ProAppointment) => ({
	'ProAppointment_createdByProUser_fkey': foreignKey({
		name: 'ProAppointment_createdByProUser_fkey',
		columns: [ProAppointment.createdByProUserId],
		foreignColumns: [ProUser.id]
	})
		.onDelete('set null')
		.onUpdate('cascade'),
	'ProAppointment_citizenUser_fkey': foreignKey({
		name: 'ProAppointment_citizenUser_fkey',
		columns: [ProAppointment.citizenUserId],
		foreignColumns: [CitizenUser.id]
	})
		.onDelete('set null')
		.onUpdate('cascade'),
	'ProAppointment_service_fkey': foreignKey({
		name: 'ProAppointment_service_fkey',
		columns: [ProAppointment.serviceId],
		foreignColumns: [ProRdvService.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'ProAppointment_structure_fkey': foreignKey({
		name: 'ProAppointment_structure_fkey',
		columns: [ProAppointment.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'ProAppointment_citizenUserId_idempotencyKey_unique_idx': uniqueIndex('ProAppointment_citizenUserId_idempotencyKey_key')
		.on(ProAppointment.citizenUserId, ProAppointment.idempotencyKey),
	// R38: idempotency of an account-free booking (citizenUserId is NULL there, so the index above never matches)
	'ProAppointment_guest_idempotency_unique_idx': uniqueIndex('ProAppointment_guest_idempotency_key')
		.on(ProAppointment.structureId, ProAppointment.guestEmailHash, ProAppointment.idempotencyKey)
		.where(sql`"citizenUserId" IS NULL AND "guestEmailHash" IS NOT NULL`),
	'ProAppointment_guestManageTokenHash_unique_idx': uniqueIndex('ProAppointment_guestManageTokenHash_key').on(ProAppointment.guestManageTokenHash),
	'ProAppointment_guest_xor_citizen_check': check('ProAppointment_guest_xor_citizen_check', sql`"guestEmailHash" IS NULL OR "citizenUserId" IS NULL`),
	'ProAppointment_guestCodeAttempts_check': check('ProAppointment_guestCodeAttempts_check', sql`"guestCodeAttempts" BETWEEN 0 AND 5`)
}));

export const RdvConversation = pgTable('RdvConversation', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	appointmentId: text('appointmentId').notNull().unique(),
	structureId: text('structureId').notNull(),
	citizenUserId: text('citizenUserId').notNull(),
	lastMessageAt: timestamp('lastMessageAt', { precision: 3 }).notNull().defaultNow(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (RdvConversation) => ({
	'RdvConversation_appointment_fkey': foreignKey({
		name: 'RdvConversation_appointment_fkey',
		columns: [RdvConversation.appointmentId],
		foreignColumns: [ProAppointment.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'RdvConversation_structure_fkey': foreignKey({
		name: 'RdvConversation_structure_fkey',
		columns: [RdvConversation.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'RdvConversation_citizenUser_fkey': foreignKey({
		name: 'RdvConversation_citizenUser_fkey',
		columns: [RdvConversation.citizenUserId],
		foreignColumns: [CitizenUser.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

export const RdvConversationMessage = pgTable('RdvConversationMessage', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	conversationId: text('conversationId').notNull(),
	senderType: text('senderType').notNull(),
	senderCitizenUserId: text('senderCitizenUserId'),
	senderProUserId: text('senderProUserId'),
	body: text('body').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (RdvConversationMessage) => ({
	'RdvConversationMessage_conversation_fkey': foreignKey({
		name: 'RdvConversationMessage_conversation_fkey',
		columns: [RdvConversationMessage.conversationId],
		foreignColumns: [RdvConversation.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'RdvConversationMessage_senderCitizenUser_fkey': foreignKey({
		name: 'RdvConversationMessage_senderCitizenUser_fkey',
		columns: [RdvConversationMessage.senderCitizenUserId],
		foreignColumns: [CitizenUser.id]
	})
		.onDelete('set null')
		.onUpdate('cascade'),
	'RdvConversationMessage_senderProUser_fkey': foreignKey({
		name: 'RdvConversationMessage_senderProUser_fkey',
		columns: [RdvConversationMessage.senderProUserId],
		foreignColumns: [ProUser.id]
	})
		.onDelete('set null')
		.onUpdate('cascade')
}));

// RECON Pro B02 (drizzle/0049): a professional's read marker for a conversation — the moment that member last opened the thread. No relation is declared
// on purpose: the relational queries of RdvConversation stay exactly as they are on a database without this table (api/_services/conversation-read.js is
// the only reader / writer and asks the catalogue first).
export const RdvConversationRead = pgTable('RdvConversationRead', {
	conversationId: text('conversationId').notNull(),
	proUserId: text('proUserId').notNull(),
	lastReadAt: timestamp('lastReadAt', { precision: 3 }).notNull().defaultNow()
}, (RdvConversationRead) => ({
	'RdvConversationRead_pkey': primaryKey({ name: 'RdvConversationRead_pkey', columns: [RdvConversationRead.conversationId, RdvConversationRead.proUserId] }),
	'RdvConversationRead_conversation_fkey': foreignKey({
		name: 'RdvConversationRead_conversation_fkey',
		columns: [RdvConversationRead.conversationId],
		foreignColumns: [RdvConversation.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'RdvConversationRead_proUser_fkey': foreignKey({
		name: 'RdvConversationRead_proUser_fkey',
		columns: [RdvConversationRead.proUserId],
		foreignColumns: [ProUser.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'RdvConversationRead_proUser_idx': index('RdvConversationRead_proUser_idx').on(RdvConversationRead.proUserId)
}));

// C8 (drizzle/0052) — the PUBLISHED cells of one closed calendar quarter of the cross-organization statistics, frozen once (api/_services/territorial-stats.js
// freezeClosedQuarters is the only writer; an UPDATE is refused by a trigger). No organization id and no raw count: commune codes and names, the number of
// organizations per shown commune, and the cells as published. No relation is declared on purpose: the code asks the catalogue first.
export const ObservatoryQuarterSnapshot = pgTable('ObservatoryQuarterSnapshot', {
	quarter: text('quarter').notNull().primaryKey(),
	schemaVersion: text('schemaVersion').notNull(),
	rules: jsonb('rules').notNull(),
	blocks: jsonb('blocks').notNull(),
	frozenAt: timestamp('frozenAt', { precision: 3 }).notNull().defaultNow(),
	release: text('release')
}, (ObservatoryQuarterSnapshot) => ({
	'ObservatoryQuarterSnapshot_quarter_format_check': check('ObservatoryQuarterSnapshot_quarter_format_check', sql`${ObservatoryQuarterSnapshot.quarter} ~ '^[0-9]{4}-T[1-4]$'`)
}));

// G14-OBS (drizzle/0062) — anonymous demand signals of the public site: a count per UTC day, closed-list signal and code, and (searches only) an INSEE
// commune of the Eurométropole. No user id, no IP, no time of day, no free text (CHECK constraints). Rolled up and DELETED once the quarter is frozen
// (api/_services/demand-signals.js is the only writer and reader).
export const DemandSignalDaily = pgTable('DemandSignalDaily', {
	day: date('day').notNull(),
	signal: text('signal').notNull(),
	code: text('code').notNull(),
	commune: text('commune').notNull().default(''),
	count: integer('count').notNull().default(0)
}, (t) => ({
	'DemandSignalDaily_pkey': primaryKey({ name: 'DemandSignalDaily_pkey', columns: [t.day, t.signal, t.code, t.commune] }),
	'DemandSignalDaily_signal_check': check('DemandSignalDaily_signal_check', sql`${t.signal} IN ('search_need', 'search_category', 'situation', 'parcours_added', 'parcours_closed', 'social_referral')`),
	'DemandSignalDaily_code_check': check('DemandSignalDaily_code_check', sql`${t.code} ~ '^[A-Za-z0-9_-]{1,64}$'`),
	'DemandSignalDaily_commune_check': check('DemandSignalDaily_commune_check', sql`${t.commune} ~ '^(67[0-9]{3}|HORS)?$' AND (${t.commune} = '' OR ${t.signal} = 'search_need')`),
	'DemandSignalDaily_count_check': check('DemandSignalDaily_count_check', sql`${t.count} >= 0`)
}));

// G14-OBS (drizzle/0062) — the PUBLISHED grid of one closed quarter of the demand signals (cells below the threshold stored masked), frozen once; UPDATE refused by a trigger.
export const DemandSignalQuarter = pgTable('DemandSignalQuarter', {
	quarter: text('quarter').notNull().primaryKey(),
	schemaVersion: text('schemaVersion').notNull(),
	rules: jsonb('rules').notNull(),
	published: jsonb('published').notNull(),
	frozenAt: timestamp('frozenAt', { precision: 3 }).notNull().defaultNow(),
	release: text('release')
}, (t) => ({
	'DemandSignalQuarter_quarter_format_check': check('DemandSignalQuarter_quarter_format_check', sql`${t.quarter} ~ '^[0-9]{4}-T[1-4]$'`)
}));

export const RdvNotificationLog = pgTable('RdvNotificationLog', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	kind: text('kind').notNull().default("MESSAGE_EMAIL"),
	conversationId: text('conversationId').notNull(),
	messageId: text('messageId').notNull(),
	recipientType: text('recipientType').notNull(),
	sentAt: timestamp('sentAt', { precision: 3 }).notNull().defaultNow()
}, (RdvNotificationLog) => ({
	'RdvNotificationLog_conversation_fkey': foreignKey({
		name: 'RdvNotificationLog_conversation_fkey',
		columns: [RdvNotificationLog.conversationId],
		foreignColumns: [RdvConversation.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'RdvNotificationLog_message_fkey': foreignKey({
		name: 'RdvNotificationLog_message_fkey',
		columns: [RdvNotificationLog.messageId],
		foreignColumns: [RdvConversationMessage.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'RdvNotificationLog_messageId_recipientType_unique_idx': uniqueIndex('RdvNotificationLog_messageId_recipientType_key')
		.on(RdvNotificationLog.messageId, RdvNotificationLog.recipientType)
}));

export const ProTimeOff = pgTable('ProTimeOff', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	structureId: text('structureId').notNull(),
	/** R24 / owner decision R18.5: the member who is absent; NULL = a closure of the whole structure (the only kind that removes public booking slots) */
	proUserId: text('proUserId'),
	startAt: timestamp('startAt', { precision: 3 }).notNull(),
	endAt: timestamp('endAt', { precision: 3 }).notNull(),
	reason: text('reason'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (ProTimeOff) => ({
	'ProTimeOff_structure_fkey': foreignKey({
		name: 'ProTimeOff_structure_fkey',
		columns: [ProTimeOff.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'ProTimeOff_proUser_fkey': foreignKey({
		name: 'ProTimeOff_proUser_fkey',
		columns: [ProTimeOff.proUserId],
		foreignColumns: [ProUser.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'ProTimeOff_proUserId_idx': index('ProTimeOff_proUserId_idx').on(ProTimeOff.proUserId)
}));

export const StructureRdvSettings = pgTable('StructureRdvSettings', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	structureId: text('structureId').notNull().unique(),
	isPublished: boolean('isPublished').notNull(),
	bookingMode: RdvBookingMode('bookingMode').notNull().default("IN_PERSON"),
	contactEmail: text('contactEmail'),
	contactPhone: text('contactPhone'),
	publishedAt: timestamp('publishedAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	// R38: the structure accepts account-free booking (explicit opt-in by an administrator, default off; never inferred from its activities)
	allowGuestBooking: boolean('allowGuestBooking').notNull().default(false)
}, (StructureRdvSettings) => ({
	'StructureRdvSettings_structure_fkey': foreignKey({
		name: 'StructureRdvSettings_structure_fkey',
		columns: [StructureRdvSettings.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

export const Invitation = pgTable('Invitation', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	structureId: text('structureId').notNull(),
	email: text('email').notNull(),
	role: text('role').notNull(),
	token: text('token').notNull().unique(),
	expires_at: timestamp('expires_at', { precision: 3 }).notNull(),
	used_at: timestamp('used_at', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (Invitation) => ({
	'Invitation_structure_fkey': foreignKey({
		name: 'Invitation_structure_fkey',
		columns: [Invitation.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

export const ConsentLog = pgTable('ConsentLog', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	policy_version: text('policy_version').notNull(),
	policy_hash: text('policy_hash').notNull(),
	subject_type: text('subject_type').notNull(),
	subject_id: text('subject_id').notNull(),
	created_at: timestamp('created_at', { precision: 3 }).notNull().defaultNow()
,
	purpose: text('purpose'),
	decision: boolean('decision'),
	withdrawn_at: timestamp('withdrawn_at', { precision: 3 }),
	superseded_by: text('superseded_by'),
	collection_channel: text('collection_channel'),
	guardian_involved: boolean('guardian_involved'),
	proof_level: text('proof_level')
});

// [LEGACY] Availability, Beneficiary, Appointment, Message, Attachment tables removed
// Replaced by ProAvailabilityRule, ProAppointment, RdvConversation, RdvConversationMessage

export const Guide = pgTable('Guide', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	slug: text('slug').notNull().unique(),
	titre: text('titre').notNull(),
	resume_falc: text('resume_falc'),
	contenu_json: jsonb('contenu_json'),
	categorie: text('categorie'),
	publics: text('publics').array().notNull(),
	contexte: text('contexte').array().notNull(),
	mots_cles: text('mots_cles').array().notNull(),
	sources_urls: text('sources_urls').array().notNull(),
	statut: text('statut').notNull().default("brouillon"),
	published_at: timestamp('published_at', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const ToolboxItem = pgTable('ToolboxItem', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	slug: text('slug').notNull().unique(),
	titre: text('titre').notNull(),
	resume_falc: text('resume_falc'),
	type: text('type').notNull(),
	categorie: text('categorie'),
	publics: text('publics').array().notNull(),
	url_download: text('url_download'),
	contenu_html: text('contenu_html'),
	statut: text('statut').notNull().default("brouillon"),
	published_at: timestamp('published_at', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const PartnershipRequest = pgTable('PartnershipRequest', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	structureName: text('structureName').notNull(),
	city: text('city'),
	type: text('type'),
	website: text('website').notNull(),
	email: text('email').notNull(),
	message: text('message'),
	status: text('status').notNull().default("pending"),
	consent: boolean('consent').notNull(),
	ip_hash: text('ip_hash'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const EntityVersion = pgTable('EntityVersion', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	entity_type: text('entity_type').notNull(),
	entity_id: text('entity_id').notNull(),
	snapshot_json: jsonb('snapshot_json').notNull(),
	reason: text('reason'),
	actor_email: text('actor_email'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
});

export const Dispositif = pgTable('Dispositif', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	date_verification: timestamp('date_verification', { precision: 3 }),
	/** PKG-1 / D-5: public visibility is derived (api/lib/publicVisibility.js), never from statut alone. All default to the SAFE value. Only the verification handler writes these. */
	launch_eligible: boolean('launch_eligible').notNull().default(false),
	verification_status: text('verification_status').notNull().default('UNVERIFIED'),
	verified_by: text('verified_by'),
	territory_verified: boolean('territory_verified').notNull().default(false),
	publication_hold: text('publication_hold'),
	data_origin: text('data_origin').notNull().default('unclassified'),
	slug: text('slug').unique(),
	titre: text('titre').notNull(),
	description_falc: text('description_falc'),
	public: text('public').array().notNull(),
	departement: text('departement'),
	montant: text('montant'),
	liens: jsonb('liens'),
	status: text('status').notNull().default("actif"),
	statut: text('statut').notNull().default("brouillon"),
	published_at: timestamp('published_at', { precision: 3 }),
	summary_falc: text('summary_falc'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	source_url_exact: text('source_url_exact'),
	territory_scope: text('territory_scope'),
	content_hash: text('content_hash'),
	source_url: text('source_url'),
	retrieved_at: timestamp('retrieved_at', { precision: 3 }),
	last_checked_at: timestamp('last_checked_at', { precision: 3 }),
	source_last_modified: timestamp('source_last_modified', { precision: 3 }),
	source_document_id: text('source_document_id'),
	// PKG-11 / P09: the aides and structures an administrator links to this dispositif (shown on the site only when they are themselves public, D-5)
	related_aide_ids: text('related_aide_ids').array().notNull().default(sql`'{}'`),
	related_structure_ids: text('related_structure_ids').array().notNull().default(sql`'{}'`),
	/** PKG-12 hardening (0037): the automatic verification chain checks dispositifs like aides — origin of the FALC text and last automatic check */
	falc_origin: text('falc_origin'),
	auto_check: jsonb('auto_check')
}, (Dispositif) => ({
	'Dispositif_sourceDocument_fkey': foreignKey({
		name: 'Dispositif_sourceDocument_fkey',
		columns: [Dispositif.source_document_id],
		foreignColumns: [SourceDocument.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

export const SourceSnapshot = pgTable('SourceSnapshot', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	entity_type: text('entity_type').notNull(),
	entity_id: text('entity_id').notNull(),
	fetched_at: timestamp('fetched_at', { precision: 3 }).notNull().defaultNow(),
	raw_excerpt: text('raw_excerpt'),
	content_hash: text('content_hash'),
	http_status: integer('http_status'),
	final_url: text('final_url'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
});

export const ResourceAccessibility = pgTable('ResourceAccessibility', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	slug: text('slug').notNull().unique(),
	title: text('title').notNull(),
	type: text('type').notNull(),
	content: text('content'),
	source_url: text('source_url'),
	territory_scope: text('territory_scope'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	status: text('status').notNull().default("draft"),
	retrieved_at: timestamp('retrieved_at', { precision: 3 }),
	last_checked_at: timestamp('last_checked_at', { precision: 3 }),
	source_last_modified: timestamp('source_last_modified', { precision: 3 }),
	/**
	 * C12 (owner decision b, 0050) — the publication record of a document of /ressources, written ONLY by api/_services/resource-publication.js. The name of the
	 * official publisher of source_url; the moment a named administrator (MFA) confirmed the document against that source (server clock, never a client value,
	 * never an import time) and who did it (reviewer_type « admin » + reviewer_id = the administrator's e-mail, as AuditLog.actor_id); the content version
	 * confirmed; publication and withdrawal times and the withdrawal reason. Rows created before 0050 have none of them and are never public until a human
	 * completes them. A database without 0050 lacks these columns: every reader uses api/_utils/schema-features.js resourceTable().
	 */
	source_publisher: text('source_publisher'),
	verified_at: timestamp('verified_at', { precision: 3 }),
	reviewer_type: text('reviewer_type'),
	reviewer_id: text('reviewer_id'),
	verified_version: text('verified_version'),
	published_at: timestamp('published_at', { precision: 3 }),
	withdrawn_at: timestamp('withdrawn_at', { precision: 3 }),
	withdrawal_reason: text('withdrawal_reason')
}, (t) => ({
	// 0050: a verification date never stands alone — it comes with its reviewer, the publisher and the official address (true of every row before 0050: no date)
	'ResourceAccessibility_verification_check': check('ResourceAccessibility_verification_check', sql`${t.verified_at} IS NULL OR (${t.reviewer_type} IS NOT NULL AND ${t.reviewer_id} IS NOT NULL AND ${t.source_publisher} IS NOT NULL AND ${t.source_url} IS NOT NULL AND ${t.verified_version} IS NOT NULL)`)
}));

/**
 * C12 (0050) — append-only ledger of every publication step of a /ressources document (create, edit, verify, publish, withdraw): who (actorType + actorId),
 * when, from which status to which, the source and the content version at that moment. The database refuses UPDATE and DELETE (trigger "ada_append_only").
 * No foreign key, like ContentVerification: the ledger outlives its document.
 */
export const ResourcePublicationEvent = pgTable('ResourcePublicationEvent', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	resourceId: text('resourceId').notNull(),
	action: text('action').notNull(),
	fromStatus: text('fromStatus'),
	toStatus: text('toStatus').notNull(),
	actorType: text('actorType').notNull(),
	actorId: text('actorId').notNull(),
	sourceUrl: text('sourceUrl'),
	sourcePublisher: text('sourcePublisher'),
	contentVersion: text('contentVersion'),
	note: text('note'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'ResourcePublicationEvent_resource_idx': index('ResourcePublicationEvent_resource_idx').on(t.resourceId, t.createdAt),
	'ResourcePublicationEvent_action_check': check('ResourcePublicationEvent_action_check', sql`${t.action} IN ('CREATE', 'EDIT', 'VERIFY', 'PUBLISH', 'WITHDRAW')`),
	'ResourcePublicationEvent_status_check': check('ResourcePublicationEvent_status_check', sql`${t.toStatus} IN ('draft', 'published', 'withdrawn')`)
}));

export const ContentReport = pgTable('ContentReport', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	contentType: ContentType('contentType').notNull(),
	contentId: text('contentId').notNull(),
	reason: ReportReason('reason').notNull(),
	message: text('message'),
	pageUrl: text('pageUrl'),
	reporterEmail: text('reporterEmail'),
	status: ReportStatus('status').notNull().default("NEW"),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const SyncRun = pgTable('SyncRun', {
	attempts: integer('attempts').default(0).notNull(),
	nextRunAt: timestamp('nextRunAt', { precision: 3 }),
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	source_id: text('source_id'),
	status: text('status').notNull(),
	started_at: timestamp('started_at', { precision: 3 }).notNull().defaultNow(),
	ended_at: timestamp('ended_at', { precision: 3 }),
	error: text('error'),
	stats: jsonb('stats'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const ConversationLog = pgTable('ConversationLog', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	message: text('message').notNull(),
	intent: text('intent'),
	searchMode: text('searchMode').notNull().default("rag"),
	sourceCount: integer('sourceCount').notNull(),
	sessionId: text('sessionId'),
	metadata: jsonb('metadata'),
	rating: integer('rating'),
	userComment: text('userComment')
});

export const SharedDiagnostic = pgTable('SharedDiagnostic', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	expiresAt: timestamp('expiresAt', { precision: 3 }).notNull(),
	/** launch-readiness item 60 (DPIA A2): the person's answers, encrypted at rest ({ enc: "v2:…" } in the database, the plain object in the application) */
	situation: sealedJson('situation').notNull(),
	results: jsonb('results').notNull(),
	viewCount: integer('viewCount').notNull()
,
	rightsSecretHash: text('rightsSecretHash'),
	/** RC5: SHA-256 of the READ/SHARE token carried by the share link. rightsSecretHash stays the OWNER secret (destructive rights). NULL = legacy row (link secret == owner secret). */
	shareTokenHash: text('shareTokenHash'),
	privacySubjectId: text('privacySubjectId'),
	subjectType: text('subjectType'),
	/** PKG-1 / K0: account-based ownership beside the owner secret. NULL = owned by the secret only (account-free dossier). Set by claim (owner secret + session) or by creation under a session. */
	ownerCitizenId: text('ownerCitizenId')
}, (SharedDiagnostic) => ({
	'SharedDiagnostic_ownerCitizen_idx': index('SharedDiagnostic_ownerCitizen_idx').on(SharedDiagnostic.ownerCitizenId),
	// PKG-11 / PUB-6: share/create.js is byte-pinned (no size check, no rate limit there): the database bounds what one dossier may store (64 KiB of answers,
	// 1 MiB of assessment) — an oversized request fails like any refused insert, without touching the pinned handler
	'SharedDiagnostic_situation_size_check': check('SharedDiagnostic_situation_size_check', sql`octet_length(${SharedDiagnostic.situation}::text) <= 65536`),
	'SharedDiagnostic_results_size_check': check('SharedDiagnostic_results_size_check', sql`octet_length(${SharedDiagnostic.results}::text) <= 1048576`)
}));

/**
 * Chat between ONE structure and the holder of a shared diagnostic (anonymous sharer who owns the capability).
 * One thread per (shared diagnostic, structure). Deleting/revoking/expiring-and-purging the SharedDiagnostic cascades to threads and messages.
 * Message bodies are opaque client-encrypted blobs (additionally wrapped server-side) — see api/_handlers/secure-messages.js.
 */
export const SharedDossierThread = pgTable('SharedDossierThread', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	sharedDiagnosticId: text('sharedDiagnosticId').notNull(),
	structureId: text('structureId').notNull(),
	openedByProUserId: text('openedByProUserId').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	lastMessageAt: timestamp('lastMessageAt', { precision: 3 }).notNull().defaultNow()
}, (SharedDossierThread) => ({
	'SharedDossierThread_sharedDiagnostic_fkey': foreignKey({
		name: 'SharedDossierThread_sharedDiagnostic_fkey',
		columns: [SharedDossierThread.sharedDiagnosticId],
		foreignColumns: [SharedDiagnostic.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'SharedDossierThread_structure_fkey': foreignKey({
		name: 'SharedDossierThread_structure_fkey',
		columns: [SharedDossierThread.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'SharedDossierThread_diagnostic_structure_unique_idx': uniqueIndex('SharedDossierThread_diagnostic_structure_key')
		.on(SharedDossierThread.sharedDiagnosticId, SharedDossierThread.structureId)
}));

export const SharedDossierMessage = pgTable('SharedDossierMessage', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	threadId: text('threadId').notNull(),
	senderType: text('senderType').notNull(),
	senderProUserId: text('senderProUserId'),
	body: text('body').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (SharedDossierMessage) => ({
	'SharedDossierMessage_thread_fkey': foreignKey({
		name: 'SharedDossierMessage_thread_fkey',
		columns: [SharedDossierMessage.threadId],
		foreignColumns: [SharedDossierThread.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'SharedDossierMessage_thread_createdAt_idx': index('SharedDossierMessage_thread_createdAt_idx')
		.on(SharedDossierMessage.threadId, SharedDossierMessage.createdAt)
}));

/**
 * RC5: which STRUCTURE may work on which shared dossier.  A grant is created only by redeeming the share token (POST /api/pro/dossier/redeem) with a pro session of that
 * structure; knowing a shareId grants nothing.  The owner (rightsSecret) can revoke a grant; a revoked grant is never re-created by the same token.
 * Deleting the dossier (revocation / purge) cascades.
 */
export const SharedDossierGrant = pgTable('SharedDossierGrant', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	sharedDiagnosticId: text('sharedDiagnosticId').notNull(),
	structureId: text('structureId').notNull(),
	grantedByProUserId: text('grantedByProUserId').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	revokedAt: timestamp('revokedAt', { precision: 3 }),
	/** RC5-product: how the grant came to be ('invite' = owner-issued, organization-bound, single use; 'legacy_link' = transitional pre-RC5 link, flag-gated). */
	grantedVia: text('grantedVia').notNull().default('invite'),
	inviteId: text('inviteId'),
	/** RC5-product: purposes the OWNER agreed to for THIS organization (comma separated): PURP-06 sharing (always), PURP-05 AI/external provider (only if the owner turns it on, revocable). */
	purposes: text('purposes').notNull().default('PURP-06'),
	purposesUpdatedAt: timestamp('purposesUpdatedAt', { precision: 3 })
}, (SharedDossierGrant) => ({
	'SharedDossierGrant_sharedDiagnostic_fkey': foreignKey({
		name: 'SharedDossierGrant_sharedDiagnostic_fkey',
		columns: [SharedDossierGrant.sharedDiagnosticId],
		foreignColumns: [SharedDiagnostic.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'SharedDossierGrant_structure_fkey': foreignKey({
		name: 'SharedDossierGrant_structure_fkey',
		columns: [SharedDossierGrant.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'SharedDossierGrant_diagnostic_structure_unique_idx': uniqueIndex('SharedDossierGrant_diagnostic_structure_key')
		.on(SharedDossierGrant.sharedDiagnosticId, SharedDossierGrant.structureId)
}));

/**
 * RC5-product: citizen-issued invitation bound to ONE organization (immutable Structure.id), single use, short lived, purpose bound.
 * Only the SHA-256 of the token is stored. Redeeming it (pro session of THAT organization, active member) creates the grant.
 */
export const SharedDossierInvite = pgTable('SharedDossierInvite', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	sharedDiagnosticId: text('sharedDiagnosticId').notNull(),
	structureId: text('structureId').notNull(),
	tokenHash: text('tokenHash').notNull(),
	purpose: text('purpose').notNull().default('PURP-06'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	expiresAt: timestamp('expiresAt', { precision: 3 }).notNull(),
	usedAt: timestamp('usedAt', { precision: 3 }),
	usedByProUserId: text('usedByProUserId'),
	revokedAt: timestamp('revokedAt', { precision: 3 })
}, (SharedDossierInvite) => ({
	'SharedDossierInvite_sharedDiagnostic_fkey': foreignKey({
		name: 'SharedDossierInvite_sharedDiagnostic_fkey',
		columns: [SharedDossierInvite.sharedDiagnosticId],
		foreignColumns: [SharedDiagnostic.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'SharedDossierInvite_structure_fkey': foreignKey({
		name: 'SharedDossierInvite_structure_fkey',
		columns: [SharedDossierInvite.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'SharedDossierInvite_token_unique_idx': uniqueIndex('SharedDossierInvite_tokenHash_key')
		.on(SharedDossierInvite.tokenHash),
	'SharedDossierInvite_dossier_structure_idx': index('SharedDossierInvite_dossier_structure_idx')
		.on(SharedDossierInvite.sharedDiagnosticId, SharedDossierInvite.structureId),
	'SharedDossierInvite_one_pending_idx': uniqueIndex('SharedDossierInvite_one_pending_key')
		.on(SharedDossierInvite.sharedDiagnosticId, SharedDossierInvite.structureId)
		.where(sql`"usedAt" IS NULL AND "revokedAt" IS NULL`)
}));

export const ProNotification = pgTable('ProNotification', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text('userId').notNull(),
	structureId: text('structureId').notNull(),
	type: text('type').notNull(),
	title: text('title').notNull(),
	message: text('message').notNull(),
	readAt: timestamp('readAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	metadata: jsonb('metadata')
}, (ProNotification) => ({
	'ProNotification_user_fkey': foreignKey({
		name: 'ProNotification_user_fkey',
		columns: [ProNotification.userId],
		foreignColumns: [ProUser.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

export const ProOutlookToken = pgTable('ProOutlookToken', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text('userId').notNull().unique(),
	email: text('email'),
	accessTokenEnc: text('accessTokenEnc').notNull(),
	refreshTokenEnc: text('refreshTokenEnc').notNull(),
	iv: text('iv').notNull(),
	expiresAt: timestamp('expiresAt', { precision: 3 }).notNull(),
	scope: text('scope'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (ProOutlookToken) => ({
	'ProOutlookToken_user_fkey': foreignKey({
		name: 'ProOutlookToken_user_fkey',
		columns: [ProOutlookToken.userId],
		foreignColumns: [ProUser.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

export const ProAuditLog = pgTable('ProAuditLog', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	proUserId: text('proUserId').notNull(),
	action: text('action').notNull(),
	entityType: text('entityType'),
	entityId: text('entityId'),
	metadata: jsonb('metadata'),
	structureId: text('structureId').notNull()
}, (ProAuditLog) => ({
	'ProAuditLog_proUser_fkey': foreignKey({
		name: 'ProAuditLog_proUser_fkey',
		columns: [ProAuditLog.proUserId],
		foreignColumns: [ProUser.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

// [LEGACY] ProMessage table removed — System C eradicated (dead code, replaced by RdvConversationMessage)

export const UserConsent = pgTable('UserConsent', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	citizenId: text('citizenId').notNull(),
	structureId: text('structureId').notNull(),
	purpose: text('purpose').notNull(),
	expiresAt: timestamp('expiresAt', { precision: 3 }).notNull(),
	ipAddress: text('ipAddress')
});

export const AideToLifeSituation = pgTable('_AideToLifeSituation', {
	LifeSituationId: text('A').notNull(),
	AideId: text('B').notNull()
}, (AideToLifeSituation) => ({
	'_AideToLifeSituation_LifeSituation_fkey': foreignKey({
		name: '_AideToLifeSituation_LifeSituation_fkey',
		columns: [AideToLifeSituation.LifeSituationId],
		foreignColumns: [LifeSituation.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade'),
	'_AideToLifeSituation_Aide_fkey': foreignKey({
		name: '_AideToLifeSituation_Aide_fkey',
		columns: [AideToLifeSituation.AideId],
		foreignColumns: [Aide.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

// ═══════════════════════════════════════════════════════════════════
// CITIZEN SEARCH MVP — Taxonomy, ProProfile & Junction Tables
// ═══════════════════════════════════════════════════════════════════

export const NeedCategory = pgTable('NeedCategory', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	slug: text('slug').notNull().unique(),
	label: text('label').notNull(),
	description: text('description'),
	icon: text('icon'),
	color: text('color'),
	keywords: text('keywords').array().notNull().default(sql`'{}'`),
	sortOrder: integer('sortOrder').notNull().default(0),
	isActive: boolean('isActive').notNull().default(true),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const AudienceCategory = pgTable('AudienceCategory', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	slug: text('slug').notNull().unique(),
	label: text('label').notNull(),
	sortOrder: integer('sortOrder').notNull().default(0),
	isActive: boolean('isActive').notNull().default(true),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const ModalityType = pgTable('ModalityType', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	slug: text('slug').notNull().unique(),
	label: text('label').notNull(),
	icon: text('icon'),
	sortOrder: integer('sortOrder').notNull().default(0),
	isActive: boolean('isActive').notNull().default(true),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const ProProfile = pgTable('ProProfile', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	proUserId: text('proUserId').notNull().unique(),
	displayName: text('displayName'),
	jobTitle: text('jobTitle'),
	descriptionPublic: text('descriptionPublic'),
	photoUrl: text('photoUrl'),
	isPubliclyVisible: boolean('isPubliclyVisible').notNull().default(false),
	acceptsNewClients: boolean('acceptsNewClients').notNull().default(true),
	contactMode: text('contactMode').notNull().default('both'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (ProProfile) => ({
	'ProProfile_proUser_fkey': foreignKey({
		name: 'ProProfile_proUser_fkey',
		columns: [ProProfile.proUserId],
		foreignColumns: [ProUser.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

// ── Junction Tables ──────────────────────────────────────────────

export const StructureNeed = pgTable('StructureNeed', {
	structureId: text('structureId').notNull(),
	needCategoryId: text('needCategoryId').notNull()
}, (StructureNeed) => ({
	'StructureNeed_pk': uniqueIndex('StructureNeed_pk').on(StructureNeed.structureId, StructureNeed.needCategoryId),
	'StructureNeed_structure_fkey': foreignKey({
		name: 'StructureNeed_structure_fkey',
		columns: [StructureNeed.structureId],
		foreignColumns: [Structure.id]
	}).onDelete('cascade').onUpdate('cascade'),
	'StructureNeed_need_fkey': foreignKey({
		name: 'StructureNeed_need_fkey',
		columns: [StructureNeed.needCategoryId],
		foreignColumns: [NeedCategory.id]
	}).onDelete('cascade').onUpdate('cascade')
}));

export const StructureAudience = pgTable('StructureAudience', {
	structureId: text('structureId').notNull(),
	audienceCategoryId: text('audienceCategoryId').notNull()
}, (StructureAudience) => ({
	'StructureAudience_pk': uniqueIndex('StructureAudience_pk').on(StructureAudience.structureId, StructureAudience.audienceCategoryId),
	'StructureAudience_structure_fkey': foreignKey({
		name: 'StructureAudience_structure_fkey',
		columns: [StructureAudience.structureId],
		foreignColumns: [Structure.id]
	}).onDelete('cascade').onUpdate('cascade'),
	'StructureAudience_audience_fkey': foreignKey({
		name: 'StructureAudience_audience_fkey',
		columns: [StructureAudience.audienceCategoryId],
		foreignColumns: [AudienceCategory.id]
	}).onDelete('cascade').onUpdate('cascade')
}));

export const StructureModality = pgTable('StructureModality', {
	structureId: text('structureId').notNull(),
	modalityTypeId: text('modalityTypeId').notNull()
}, (StructureModality) => ({
	'StructureModality_pk': uniqueIndex('StructureModality_pk').on(StructureModality.structureId, StructureModality.modalityTypeId),
	'StructureModality_structure_fkey': foreignKey({
		name: 'StructureModality_structure_fkey',
		columns: [StructureModality.structureId],
		foreignColumns: [Structure.id]
	}).onDelete('cascade').onUpdate('cascade'),
	'StructureModality_modality_fkey': foreignKey({
		name: 'StructureModality_modality_fkey',
		columns: [StructureModality.modalityTypeId],
		foreignColumns: [ModalityType.id]
	}).onDelete('cascade').onUpdate('cascade')
}));

export const ProProfileNeed = pgTable('ProProfileNeed', {
	proProfileId: text('proProfileId').notNull(),
	needCategoryId: text('needCategoryId').notNull()
}, (ProProfileNeed) => ({
	'ProProfileNeed_pk': uniqueIndex('ProProfileNeed_pk').on(ProProfileNeed.proProfileId, ProProfileNeed.needCategoryId),
	'ProProfileNeed_profile_fkey': foreignKey({
		name: 'ProProfileNeed_profile_fkey',
		columns: [ProProfileNeed.proProfileId],
		foreignColumns: [ProProfile.id]
	}).onDelete('cascade').onUpdate('cascade'),
	'ProProfileNeed_need_fkey': foreignKey({
		name: 'ProProfileNeed_need_fkey',
		columns: [ProProfileNeed.needCategoryId],
		foreignColumns: [NeedCategory.id]
	}).onDelete('cascade').onUpdate('cascade')
}));

export const ProProfileAudience = pgTable('ProProfileAudience', {
	proProfileId: text('proProfileId').notNull(),
	audienceCategoryId: text('audienceCategoryId').notNull()
}, (ProProfileAudience) => ({
	'ProProfileAudience_pk': uniqueIndex('ProProfileAudience_pk').on(ProProfileAudience.proProfileId, ProProfileAudience.audienceCategoryId),
	'ProProfileAudience_profile_fkey': foreignKey({
		name: 'ProProfileAudience_profile_fkey',
		columns: [ProProfileAudience.proProfileId],
		foreignColumns: [ProProfile.id]
	}).onDelete('cascade').onUpdate('cascade'),
	'ProProfileAudience_audience_fkey': foreignKey({
		name: 'ProProfileAudience_audience_fkey',
		columns: [ProProfileAudience.audienceCategoryId],
		foreignColumns: [AudienceCategory.id]
	}).onDelete('cascade').onUpdate('cascade')
}));

// ═══════════════════════════════════════════════════════════════════
// RELATIONS
// ═══════════════════════════════════════════════════════════════════

export const SourceDocumentRelations = relations(SourceDocument, ({ many }) => ({
	aides: many(Aide, {
		relationName: 'AideToSourceDocument'
	}),
	structures: many(Structure, {
		relationName: 'SourceDocumentToStructure'
	}),
	dispositifs: many(Dispositif, {
		relationName: 'DispositifToSourceDocument'
	}),
	demarches: many(Demarche, {
		relationName: 'DemarcheToSourceDocument'
	}),
	actualites: many(Actualite, {
		relationName: 'ActualiteToSourceDocument'
	})
}));

export const AideRelations = relations(Aide, ({ one, many }) => ({
	category: one(AidCategory, {
		relationName: 'AidCategoryToAide',
		fields: [Aide.categoryId],
		references: [AidCategory.id]
	}),
	source: one(AidSource, {
		relationName: 'AidSourceToAide',
		fields: [Aide.sourceId],
		references: [AidSource.id]
	}),
	situations: many(AideToLifeSituation, {
		relationName: 'AideToAideToLifeSituation'
	}),
	aidSituations: many(AidSituation, {
		relationName: 'AidSituationToAide'
	}),
	sourceDocument: one(SourceDocument, {
		relationName: 'AideToSourceDocument',
		fields: [Aide.source_document_id],
		references: [SourceDocument.id]
	})
}));

export const AidCategoryRelations = relations(AidCategory, ({ many }) => ({
	aides: many(Aide, {
		relationName: 'AidCategoryToAide'
	}),
	demarches: many(Demarche, {
		relationName: 'DemarcheToCategory'
	})
}));

export const LifeSituationRelations = relations(LifeSituation, ({ many }) => ({
	aides: many(AideToLifeSituation, {
		relationName: 'LifeSituationToAideToLifeSituation'
	}),
	demarches: many(Demarche, {
		relationName: 'DemarcheToSituation'
	})
}));

export const SituationRelations = relations(Situation, ({ many }) => ({
	aidRelations: many(AidSituation, {
		relationName: 'AidSituationToSituation'
	})
}));

export const AidSituationRelations = relations(AidSituation, ({ one }) => ({
	aid: one(Aide, {
		relationName: 'AidSituationToAide',
		fields: [AidSituation.aidId],
		references: [Aide.id]
	}),
	situation: one(Situation, {
		relationName: 'AidSituationToSituation',
		fields: [AidSituation.situationId],
		references: [Situation.id]
	})
}));

export const AidSourceRelations = relations(AidSource, ({ many }) => ({
	aides: many(Aide, {
		relationName: 'AidSourceToAide'
	})
}));

export const StructureRelations = relations(Structure, ({ one, many }) => ({
	sourceDocument: one(SourceDocument, {
		relationName: 'SourceDocumentToStructure',
		fields: [Structure.source_document_id],
		references: [SourceDocument.id]
	}),
	invitations: many(Invitation, {
		relationName: 'InvitationToStructure'
	}),
	proUsers: many(ProUser, {
		relationName: 'ProUserToStructure'
	}),
	proRdvServices: many(ProRdvService, {
		relationName: 'ProRdvServiceToStructure'
	}),
	proRdvRules: many(ProAvailabilityRule, {
		relationName: 'ProAvailabilityRuleToStructure'
	}),
	proRdvSlots: many(ProAppointment, {
		relationName: 'ProAppointmentToStructure'
	}),
	proRdvTimeOffs: many(ProTimeOff, {
		relationName: 'ProTimeOffToStructure'
	}),
	rdvSettings: many(StructureRdvSettings, {
		relationName: 'StructureToStructureRdvSettings'
	}),
	rdvConversations: many(RdvConversation, {
		relationName: 'RdvConversationToStructure'
	}),
	// Citizen Search MVP
	needs: many(StructureNeed, {
		relationName: 'StructureToStructureNeed'
	}),
	audiences: many(StructureAudience, {
		relationName: 'StructureToStructureAudience'
	}),
	modalities: many(StructureModality, {
		relationName: 'StructureToStructureModality'
	})
}));

export const DemarcheRelations = relations(Demarche, ({ one, many }) => ({
	category: one(AidCategory, {
		relationName: 'DemarcheToCategory',
		fields: [Demarche.categoryId],
		references: [AidCategory.id]
	}),
	situations: many(LifeSituation, {
		relationName: 'DemarcheToSituation'
	}),
	sourceDocument: one(SourceDocument, {
		relationName: 'DemarcheToSourceDocument',
		fields: [Demarche.source_document_id],
		references: [SourceDocument.id]
	})
}));

export const ActualiteRelations = relations(Actualite, ({ one }) => ({
	sourceDocument: one(SourceDocument, {
		relationName: 'ActualiteToSourceDocument',
		fields: [Actualite.source_document_id],
		references: [SourceDocument.id]
	})
}));

export const CitizenUserRelations = relations(CitizenUser, ({ many }) => ({
	authTokens: many(AuthToken, {
		relationName: 'AuthTokenToCitizenUser'
	}),
	proAppointments: many(ProAppointment, {
		relationName: 'ProAppointmentCitizenUser'
	}),
	rdvConversations: many(RdvConversation, {
		relationName: 'CitizenUserToRdvConversation'
	}),
	rdvMessagesSent: many(RdvConversationMessage, {
		relationName: 'RdvMessageSenderCitizen'
	})
}));

export const AuthTokenRelations = relations(AuthToken, ({ one }) => ({
	user: one(CitizenUser, {
		relationName: 'AuthTokenToCitizenUser',
		fields: [AuthToken.userId],
		references: [CitizenUser.id]
	})
}));

export const ProUserRelations = relations(ProUser, ({ many, one }) => ({

	proAppointmentsCreated: many(ProAppointment, {
		relationName: 'ProAppointmentCreatedBy'
	}),
	rdvMessagesSent: many(RdvConversationMessage, {
		relationName: 'RdvMessageSenderPro'
	}),
	notifications: many(ProNotification, {
		relationName: 'ProNotificationToProUser'
	}),
	outlookToken: many(ProOutlookToken, {
		relationName: 'ProOutlookTokenToProUser'
	}),
	proAuditLogs: many(ProAuditLog, {
		relationName: 'ProAuditLogToProUser'
	}),
	structure: one(Structure, {
		relationName: 'ProUserToStructure',
		fields: [ProUser.structureId],
		references: [Structure.id]
	}),
	// Citizen Search MVP
	proProfile: one(ProProfile, {
		relationName: 'ProUserToProProfile',
		fields: [ProUser.id],
		references: [ProProfile.proUserId]
	})
}));

// [LEGACY] ServiceRelations removed

export const ProRdvServiceRelations = relations(ProRdvService, ({ many, one }) => ({
	appointments: many(ProAppointment, {
		relationName: 'ProAppointmentToProRdvService'
	}),
	structure: one(Structure, {
		relationName: 'ProRdvServiceToStructure',
		fields: [ProRdvService.structureId],
		references: [Structure.id]
	})
}));

export const ProAvailabilityRuleRelations = relations(ProAvailabilityRule, ({ one }) => ({
	structure: one(Structure, {
		relationName: 'ProAvailabilityRuleToStructure',
		fields: [ProAvailabilityRule.structureId],
		references: [Structure.id]
	})
}));

export const ProAppointmentRelations = relations(ProAppointment, ({ one, many }) => ({
	createdByProUser: one(ProUser, {
		relationName: 'ProAppointmentCreatedBy',
		fields: [ProAppointment.createdByProUserId],
		references: [ProUser.id]
	}),
	citizenUser: one(CitizenUser, {
		relationName: 'ProAppointmentCitizenUser',
		fields: [ProAppointment.citizenUserId],
		references: [CitizenUser.id]
	}),
	service: one(ProRdvService, {
		relationName: 'ProAppointmentToProRdvService',
		fields: [ProAppointment.serviceId],
		references: [ProRdvService.id]
	}),
	structure: one(Structure, {
		relationName: 'ProAppointmentToStructure',
		fields: [ProAppointment.structureId],
		references: [Structure.id]
	}),
	conversation: many(RdvConversation, {
		relationName: 'ProAppointmentToRdvConversation'
	})
}));

export const RdvConversationRelations = relations(RdvConversation, ({ one, many }) => ({
	appointment: one(ProAppointment, {
		relationName: 'ProAppointmentToRdvConversation',
		fields: [RdvConversation.appointmentId],
		references: [ProAppointment.id]
	}),
	structure: one(Structure, {
		relationName: 'RdvConversationToStructure',
		fields: [RdvConversation.structureId],
		references: [Structure.id]
	}),
	citizenUser: one(CitizenUser, {
		relationName: 'CitizenUserToRdvConversation',
		fields: [RdvConversation.citizenUserId],
		references: [CitizenUser.id]
	}),
	messages: many(RdvConversationMessage, {
		relationName: 'RdvConversationToRdvConversationMessage'
	}),
	notifications: many(RdvNotificationLog, {
		relationName: 'RdvConversationToRdvNotificationLog'
	})
}));

export const RdvConversationMessageRelations = relations(RdvConversationMessage, ({ one, many }) => ({
	conversation: one(RdvConversation, {
		relationName: 'RdvConversationToRdvConversationMessage',
		fields: [RdvConversationMessage.conversationId],
		references: [RdvConversation.id]
	}),
	senderCitizenUser: one(CitizenUser, {
		relationName: 'RdvMessageSenderCitizen',
		fields: [RdvConversationMessage.senderCitizenUserId],
		references: [CitizenUser.id]
	}),
	senderProUser: one(ProUser, {
		relationName: 'RdvMessageSenderPro',
		fields: [RdvConversationMessage.senderProUserId],
		references: [ProUser.id]
	}),
	notifications: many(RdvNotificationLog, {
		relationName: 'RdvConversationMessageToRdvNotificationLog'
	})
}));

export const RdvNotificationLogRelations = relations(RdvNotificationLog, ({ one }) => ({
	conversation: one(RdvConversation, {
		relationName: 'RdvConversationToRdvNotificationLog',
		fields: [RdvNotificationLog.conversationId],
		references: [RdvConversation.id]
	}),
	message: one(RdvConversationMessage, {
		relationName: 'RdvConversationMessageToRdvNotificationLog',
		fields: [RdvNotificationLog.messageId],
		references: [RdvConversationMessage.id]
	})
}));

export const ProTimeOffRelations = relations(ProTimeOff, ({ one }) => ({
	structure: one(Structure, {
		relationName: 'ProTimeOffToStructure',
		fields: [ProTimeOff.structureId],
		references: [Structure.id]
	})
}));

export const StructureRdvSettingsRelations = relations(StructureRdvSettings, ({ one }) => ({
	structure: one(Structure, {
		relationName: 'StructureToStructureRdvSettings',
		fields: [StructureRdvSettings.structureId],
		references: [Structure.id]
	})
}));

export const InvitationRelations = relations(Invitation, ({ one }) => ({
	structure: one(Structure, {
		relationName: 'InvitationToStructure',
		fields: [Invitation.structureId],
		references: [Structure.id]
	})
}));

// [LEGACY] AvailabilityRelations, BeneficiaryRelations, AppointmentRelations,
// MessageRelations, AttachmentRelations removed — superseded by Pro/Rdv equivalents

export const DispositifRelations = relations(Dispositif, ({ one }) => ({
	sourceDocument: one(SourceDocument, {
		relationName: 'DispositifToSourceDocument',
		fields: [Dispositif.source_document_id],
		references: [SourceDocument.id]
	})
}));

export const ProNotificationRelations = relations(ProNotification, ({ one }) => ({
	user: one(ProUser, {
		relationName: 'ProNotificationToProUser',
		fields: [ProNotification.userId],
		references: [ProUser.id]
	})
}));

export const ProOutlookTokenRelations = relations(ProOutlookToken, ({ one }) => ({
	user: one(ProUser, {
		relationName: 'ProOutlookTokenToProUser',
		fields: [ProOutlookToken.userId],
		references: [ProUser.id]
	})
}));

export const ProAuditLogRelations = relations(ProAuditLog, ({ one }) => ({
	proUser: one(ProUser, {
		relationName: 'ProAuditLogToProUser',
		fields: [ProAuditLog.proUserId],
		references: [ProUser.id]
	})
}));

export const AideToLifeSituationRelations = relations(AideToLifeSituation, ({ one }) => ({
	LifeSituation: one(LifeSituation, {
		relationName: 'LifeSituationToAideToLifeSituation',
		fields: [AideToLifeSituation.LifeSituationId],
		references: [LifeSituation.id]
	}),
	Aide: one(Aide, {
		relationName: 'AideToAideToLifeSituation',
		fields: [AideToLifeSituation.AideId],
		references: [Aide.id]
	})
}));

// ── Citizen Search MVP Relations ─────────────────────────────────

export const NeedCategoryRelations = relations(NeedCategory, ({ many }) => ({
	structureNeeds: many(StructureNeed, {
		relationName: 'NeedCategoryToStructureNeed'
	}),
	proProfileNeeds: many(ProProfileNeed, {
		relationName: 'NeedCategoryToProProfileNeed'
	})
}));

export const AudienceCategoryRelations = relations(AudienceCategory, ({ many }) => ({
	structureAudiences: many(StructureAudience, {
		relationName: 'AudienceCategoryToStructureAudience'
	}),
	proProfileAudiences: many(ProProfileAudience, {
		relationName: 'AudienceCategoryToProProfileAudience'
	})
}));

export const ModalityTypeRelations = relations(ModalityType, ({ many }) => ({
	structureModalities: many(StructureModality, {
		relationName: 'ModalityTypeToStructureModality'
	})
}));

export const ProProfileRelations = relations(ProProfile, ({ one, many }) => ({
	proUser: one(ProUser, {
		relationName: 'ProUserToProProfile',
		fields: [ProProfile.proUserId],
		references: [ProUser.id]
	}),
	needs: many(ProProfileNeed, {
		relationName: 'ProProfileToProProfileNeed'
	}),
	audiences: many(ProProfileAudience, {
		relationName: 'ProProfileToProProfileAudience'
	})
}));

export const StructureNeedRelations = relations(StructureNeed, ({ one }) => ({
	structure: one(Structure, {
		relationName: 'StructureToStructureNeed',
		fields: [StructureNeed.structureId],
		references: [Structure.id]
	}),
	needCategory: one(NeedCategory, {
		relationName: 'NeedCategoryToStructureNeed',
		fields: [StructureNeed.needCategoryId],
		references: [NeedCategory.id]
	})
}));

export const StructureAudienceRelations = relations(StructureAudience, ({ one }) => ({
	structure: one(Structure, {
		relationName: 'StructureToStructureAudience',
		fields: [StructureAudience.structureId],
		references: [Structure.id]
	}),
	audienceCategory: one(AudienceCategory, {
		relationName: 'AudienceCategoryToStructureAudience',
		fields: [StructureAudience.audienceCategoryId],
		references: [AudienceCategory.id]
	})
}));

export const StructureModalityRelations = relations(StructureModality, ({ one }) => ({
	structure: one(Structure, {
		relationName: 'StructureToStructureModality',
		fields: [StructureModality.structureId],
		references: [Structure.id]
	}),
	modalityType: one(ModalityType, {
		relationName: 'ModalityTypeToStructureModality',
		fields: [StructureModality.modalityTypeId],
		references: [ModalityType.id]
	})
}));

export const ProProfileNeedRelations = relations(ProProfileNeed, ({ one }) => ({
	proProfile: one(ProProfile, {
		relationName: 'ProProfileToProProfileNeed',
		fields: [ProProfileNeed.proProfileId],
		references: [ProProfile.id]
	}),
	needCategory: one(NeedCategory, {
		relationName: 'NeedCategoryToProProfileNeed',
		fields: [ProProfileNeed.needCategoryId],
		references: [NeedCategory.id]
	})
}));

export const ProProfileAudienceRelations = relations(ProProfileAudience, ({ one }) => ({
	proProfile: one(ProProfile, {
		relationName: 'ProProfileToProProfileAudience',
		fields: [ProProfileAudience.proProfileId],
		references: [ProProfile.id]
	}),
	audienceCategory: one(AudienceCategory, {
		relationName: 'AudienceCategoryToProProfileAudience',
		fields: [ProProfileAudience.audienceCategoryId],
		references: [AudienceCategory.id]
	})
}));

// ─── AI Metrics ─────────────────────────────────────────────────────────────
export const AiMetric = pgTable('AiMetric', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	type: text('type').notNull(),           // chat, discovery, scheduler, hive-scan, falc
	model: text('model').notNull(),         // gemini-2.0-flash
	promptTokens: integer('prompt_tokens').notNull().default(0),
	completionTokens: integer('completion_tokens').notNull().default(0),
	totalTokens: integer('total_tokens').notNull().default(0),
	latencyMs: integer('latency_ms').notNull().default(0),
	success: boolean('success').notNull().default(true),
	circuitBreakerOpen: boolean('circuit_breaker_open').notNull().default(false),
	errorMessage: text('error_message'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
});

// ─── Phase 8 Official Data & Integrations ────────────────────────────────────

export const SourceType = pgEnum('SourceType', ['REST_API', 'GRAPHQL', 'HTML_SCRAPER', 'RSS_ATOM', 'CSV', 'XML', 'JSON_FILE', 'CURATED']);

export const SourceStatus = pgEnum('SourceStatus', ['ACTIVE', 'DISABLED', 'PAUSED', 'ERROR']);

export const SourceCapability = pgEnum('SourceCapability', ['LEGAL', 'REGULATORY', 'BENEFIT_RULE', 'BENEFIT_PARAMETER', 'PROCEDURAL', 'DIRECTORY', 'STATISTICAL', 'REFERENCE', 'OPEN_DATA_CATALOG', 'LOCAL_SERVICE']);

export const SourceRegistryEntry = pgTable('SourceRegistryEntry', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	sourceId: text('source_id').notNull().unique(),
	name: text('name').notNull(),
	type: SourceType('type').notNull(),
	endpoint: text('endpoint'),
	cronSchedule: text('cron_schedule'),
	authConfig: jsonb('auth_config'),
	rateLimits: jsonb('rate_limits'),
	capabilities: text('capabilities').array().notNull().default(sql`'{}'`),
	producerAuthority: text('producer_authority'),
	distributionPlatform: text('distribution_platform'),
	trustedDomains: text('trusted_domains').array().notNull().default(sql`'{}'`),
	connectorClass: text('connector_class'),
	territory: text('territory'),
	organisation: text('organisation'),
	licenceUrl: text('licence_url'),
	licenceName: text('licence_name'),
	reuseConditions: text('reuse_conditions'),
	updateFrequency: text('update_frequency'),
	status: SourceStatus('status').notNull().default('ACTIVE'),
	failureCount: integer('failure_count').notNull().default(0),
	lastSyncAt: timestamp('last_sync_at', { precision: 3 }),
	lastSuccessAt: timestamp('last_success_at', { precision: 3 }),
	disabledAt: timestamp('disabled_at', { precision: 3 }),
	/** automatic verification chain (api/_services/verification/sources.js): NATIONAL | ORGANISME | REGIONAL | DEPARTEMENTAL | PREFECTURE | COMMUNAL | REGISTRE,
	 *  what makes the source official, and the page that shows it (e.g. its entry in the Annuaire de l'administration) */
	level: text('level'),
	attestation: text('attestation'),
	attestationUrl: text('attestation_url'),
	/** PKG-12 hardening (0037): health of the source (nightly for the feeds, monthly visit of the sites: answered, delay, failures, outage since), its current
	 *  version (archive date, Last-Modified…) and the date it last changed, the addresses it redirected to, and the source that replaced it */
	health: jsonb('health'),
	contentVersion: text('content_version'),
	lastChangeAt: timestamp('last_change_at', { precision: 3 }),
	redirects: jsonb('redirects'),
	successorSourceId: text('successor_source_id'),
	createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { precision: 3 }).notNull().defaultNow()
});

export const DiffState = pgEnum('DiffState', ['NEW', 'UPDATED', 'UNCHANGED', 'REMOVED', 'CONFLICTING']);

export const ChangeClassification = pgEnum('ChangeClassification', ['RAW_CONTENT_CHANGED', 'NORMALIZED_FACT_CHANGED', 'METADATA_ONLY_CHANGED']);

export const SourceDiff = pgTable('SourceDiff', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	sourceId: text('source_id'),
	entityType: text('entity_type').notNull(),
	entityId: text('entity_id').notNull(),
	previousHash: text('previous_hash'),
	currentHash: text('current_hash'),
	diffState: DiffState('diff_state').notNull(),
	changeClassification: ChangeClassification('change_classification'),
	detectedAt: timestamp('detected_at', { precision: 3 }).notNull().defaultNow(),
	processedAt: timestamp('processed_at', { precision: 3 })
});

export const ConflictResolutionStatus = pgEnum('ConflictResolutionStatus', ['PENDING', 'RESOLVED', 'IGNORED']);

export const ConflictRecord = pgTable('ConflictRecord', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	entityType: text('entity_type').notNull(),
	entityId: text('entity_id').notNull(),
	sourceAId: text('source_a_id'),
	sourceBId: text('source_b_id'),
	conflictData: jsonb('conflict_data'),
	resolutionStatus: ConflictResolutionStatus('resolution_status').notNull().default('PENDING'),
	resolvedBy: text('resolved_by'),
	resolutionRationale: text('resolution_rationale'),
	reviewQueueItemId: text('review_queue_item_id'),
	createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { precision: 3 }).notNull().defaultNow()
});

/**
 * Automatic verification chain — the journal of what the automatic checks found and did, record by record (« Veille automatique »): the owner's digest and the
 * public « vérifié automatiquement le … » line are read from here and from the ContentVerification ledger (which keeps the decisions themselves).
 * kind: SOURCE | EXISTENCE | CHANGE | TEXTS | IDENTITY | DUPLICATE | NEW_RECORD | REGISTRY; outcome: OK | UPDATED | PUBLISHED | WITHDRAWN | CORRECTED | CREATED |
 * RETRY | UNRESOLVED | SKIPPED.
 */
export const VeilleEvent = pgTable('VeilleEvent', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	runId: text('run_id').notNull(),
	entityType: text('entity_type'),
	entityId: text('entity_id'),
	kind: text('kind').notNull(),
	outcome: text('outcome').notNull(),
	summary: text('summary').notNull(),
	details: jsonb('details'),
	createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow()
}, (VeilleEvent) => ({
	'VeilleEvent_entity_idx': index('VeilleEvent_entity_idx').on(VeilleEvent.entityType, VeilleEvent.entityId),
	'VeilleEvent_run_idx': index('VeilleEvent_run_idx').on(VeilleEvent.runId),
	'VeilleEvent_created_idx': index('VeilleEvent_created_idx').on(VeilleEvent.createdAt)
}));

export const FreshnessAction = pgEnum('FreshnessAction', ['FLAG_STALE', 'AUTO_REFRESH', 'DISABLE']);

export const FreshnessPolicy = pgTable('FreshnessPolicy', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	sourceId: text('source_id'),
	categoryPattern: text('category_pattern'),
	entityType: text('entity_type'),
	ttlDays: integer('ttl_days').notNull(),
	priority: integer('priority').notNull().default(0),
	actionOnExpire: FreshnessAction('action_on_expire').notNull().default('FLAG_STALE'),
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { precision: 3 }).notNull().defaultNow()
});
// ═══════════════════════════════════════════════════════════════
// Phase 9: National Geography & Scalability
// ═══════════════════════════════════════════════════════════════

export const TerritoryType = pgEnum('TerritoryType', [
  'COUNTRY',
  'REGION',
  'DEPARTEMENT',
  'EPCI',
  'COMMUNE',
  'COMMUNE_ASSOCIEE',
  'COMMUNE_DELEGUEE',
  'MUNICIPAL_ARRONDISSEMENT',
  'ADMINISTRATIVE_ARRONDISSEMENT',
  'SPECIAL_STATUS_COLLECTIVITY',
  'QPV'
]);

export const TerritoryStatus = pgEnum('TerritoryStatus', ['CURRENT', 'HISTORICAL']);

export const TerritoryRelationType = pgEnum('TerritoryRelationType', [
  'PART_OF',
  'MEMBER_OF',
  'CONTAINS',
  'OVERLAPS',
  'REPLACED_BY'
]);

export const ApplicabilityEntityType = pgEnum('ApplicabilityEntityType', ['BENEFIT', 'PROCEDURE']);

export const ServiceAreaType = pgEnum('ServiceAreaType', [
  'LOCAL',
  'MULTI_TERRITORY',
  'REGIONAL',
  'DEPARTMENTAL',
  'NATIONAL',
  'REMOTE',
  'UNKNOWN'
]);

export const Territory = pgTable('Territory', {
  id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  authority: text('authority').notNull(),       // 'INSEE', 'BANATIC', 'ANCT'
  type: TerritoryType('type').notNull(),
  officialCode: text('official_code').notNull(),
  status: TerritoryStatus('status').notNull().default('CURRENT'),
  validFrom: timestamp('valid_from', { precision: 3 }),
  validTo: timestamp('valid_to', { precision: 3 }),
  sourceId: text('source_id'),
  sourceVersion: text('source_version'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
  canonicalIdx: uniqueIndex('territory_canonical_idx').on(t.authority, t.type, t.officialCode),
  typeIdx: index('territory_type_idx').on(t.type),
  statusIdx: index('territory_status_idx').on(t.status),
  officialCodeIdx: index('territory_official_code_idx').on(t.officialCode)
}));

export const TerritoryLabelHistory = pgTable('TerritoryLabelHistory', {
  id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  territoryId: text('territory_id').notNull(),
  name: text('name').notNull(),
  validFrom: timestamp('valid_from', { precision: 3 }),
  validTo: timestamp('valid_to', { precision: 3 }),
  sourceId: text('source_id'),
  sourceVersion: text('source_version'),
  createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
  territoryIdx: index('label_history_territory_idx').on(t.territoryId)
}));

export const TerritoryRelation = pgTable('TerritoryRelation', {
  id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  sourceId: text('source_territory_id').notNull(),
  targetId: text('target_territory_id').notNull(),
  type: TerritoryRelationType('type').notNull(),
  validFrom: timestamp('valid_from', { precision: 3 }),
  validTo: timestamp('valid_to', { precision: 3 }),
  sourceRefId: text('source_ref_id'),
  sourceVersion: text('source_version'),
  createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
  sourceIdx: index('relation_source_idx').on(t.sourceId),
  targetIdx: index('relation_target_idx').on(t.targetId),
  typeIdx: index('relation_type_idx').on(t.type),
  pairIdx: index('relation_pair_idx').on(t.sourceId, t.targetId, t.type)
}));

export const Applicability = pgTable('Applicability', {
  id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  entityType: ApplicabilityEntityType('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  territoryId: text('territory_id').notNull(),
  isExclusion: boolean('is_exclusion').notNull().default(false),
  validFrom: timestamp('valid_from', { precision: 3 }),
  validTo: timestamp('valid_to', { precision: 3 }),
  sourceId: text('source_id'),
  createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
  entityIdx: index('applicability_entity_idx').on(t.entityType, t.entityId),
  territoryIdx: index('applicability_territory_idx').on(t.territoryId),
  lookupIdx: index('applicability_lookup_idx').on(t.entityType, t.entityId, t.territoryId)
}));

export const StructureServiceArea = pgTable('StructureServiceArea', {
  id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
  structureId: text('structure_id').notNull(),
  serviceType: ServiceAreaType('service_type').notNull(),
  territoryId: text('territory_id'),
  validFrom: timestamp('valid_from', { precision: 3 }),
  validTo: timestamp('valid_to', { precision: 3 }),
  sourceId: text('source_id'),
  createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
  structureIdx: index('service_area_structure_idx').on(t.structureId),
  territoryIdx: index('service_area_territory_idx').on(t.territoryId)
}));


export const GuardianRelationship = pgTable('GuardianRelationship', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	minorId: text('minorId').notNull(),
	guardianId: text('guardianId').notNull(),
	status: text('status').notNull(), // DECLARED, EMAIL_VERIFIED, STRONGER_VERIFICATION_REQUIRED, VERIFIED_STRONG, REVOKED
	scopes: jsonb('scopes').notNull().default([]),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const DSRRequest = pgTable('DSRRequest', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	subjectType: text('subjectType').notNull(),
	subjectId: text('subjectId').notNull(),
	requestType: text('requestType').notNull(),
	status: text('status').notNull(),
	executionMode: text('executionMode').notNull(),
	affectedDomains: jsonb('affectedDomains').notNull().default([]),
	reasonCode: text('reasonCode'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	completedAt: timestamp('completedAt', { precision: 3 }),
	/** PKG-4: human review of an access request touching organization-held records (decision, reviewer, released extract — encrypted); never decided by the system */
	reviewOutcome: jsonb('reviewOutcome')
});

export const LegalHold = pgTable('LegalHold', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	dataCategory: text('dataCategory').notNull(),
	recordId: text('recordId').notNull(),
	reasonCode: text('reasonCode').notNull(),
	createdBy: text('createdBy').notNull(),
	status: text('status').notNull(), // ACTIVE, RELEASED
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	releasedAt: timestamp('releasedAt', { precision: 3 }),
	// PKG-5 / A12: releasing a hold re-enables deletion, so it needs two people (one proposes with a reason, a DIFFERENT administrator confirms)
	releaseProposedBy: text('releaseProposedBy'),
	releaseProposedAt: timestamp('releaseProposedAt', { precision: 3 }),
	releaseReason: text('releaseReason'),
	releasedBy: text('releasedBy'),
	/** G12 (0058): released by the proposer as the SOLE MFA administrator, after 24 h (the CHECK admits proposer = releaser only then) */
	releaseSoleAdministrator: boolean('releaseSoleAdministrator').notNull().default(false)
});

/** PKG-1 / D-5: append-only ledger of human content verifications (a trigger forbids UPDATE and DELETE). The entity columns are a denormalised projection written by the same transaction. */
export const ContentVerification = pgTable('ContentVerification', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	entityType: text('entityType').notNull(),
	entityId: text('entityId').notNull(),
	outcome: text('outcome').notNull(), // VERIFIED | REJECTED | HOLD | RELEASE_HOLD
	reviewerId: text('reviewerId').notNull(),
	reviewerRole: text('reviewerRole').notNull(),
	sourceUrl: text('sourceUrl'),
	evidenceNote: text('evidenceNote'),
	territoryConfirmed: boolean('territoryConfirmed').notNull().default(false),
	verifiedAt: timestamp('verifiedAt', { precision: 3 }).notNull().defaultNow(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	/** owner LAB audit: sha-256 of the public content the reviewer saw (api/_services/content-verification.js contentVersion): a VERIFY or a RELEASE_HOLD is
	 *  refused when the record changed since, and the ledger keeps which version was approved. NULL for decisions recorded before migration 0034. */
	contentVersion: text('contentVersion')
}, (ContentVerification) => ({
	'ContentVerification_entity_idx': index('ContentVerification_entity_idx').on(ContentVerification.entityType, ContentVerification.entityId)
}));

/**
 * D13 (owner LAB audit) — the duplicate register: a human decision, on institutional evidence, that two directory records are the SAME organization (one kept,
 * the other held off the public directory) or DISTINCT (the pair is no longer proposed). Bound to the content versions read; a new decision supersedes the
 * previous one for the pair (supersededAt), nothing is deleted.
 */
export const StructureDuplicateDecision = pgTable('StructureDuplicateDecision', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	structureA: text('structureA').notNull(),
	structureB: text('structureB').notNull(),
	decision: text('decision').notNull(),
	primaryId: text('primaryId'),
	evidenceUrl: text('evidenceUrl').notNull(),
	note: text('note').notNull(),
	reviewerId: text('reviewerId').notNull(),
	versionA: text('versionA').notNull(),
	versionB: text('versionB').notNull(),
	decidedAt: timestamp('decidedAt', { precision: 3 }).notNull().defaultNow(),
	supersededAt: timestamp('supersededAt', { precision: 3 })
}, (t) => ({
	// RESTRICT: a structure named in a recorded decision cannot be hard-deleted silently (structures are archived, never deleted, in normal operation)
	'StructureDuplicateDecision_a_fkey': foreignKey({ name: 'StructureDuplicateDecision_a_fkey', columns: [t.structureA], foreignColumns: [Structure.id] }).onDelete('restrict'),
	'StructureDuplicateDecision_b_fkey': foreignKey({ name: 'StructureDuplicateDecision_b_fkey', columns: [t.structureB], foreignColumns: [Structure.id] }).onDelete('restrict'),
	'StructureDuplicateDecision_active_pair_idx': uniqueIndex('StructureDuplicateDecision_active_pair_key').on(t.structureA, t.structureB).where(sql`"supersededAt" IS NULL`),
	'StructureDuplicateDecision_ordered_check': check('StructureDuplicateDecision_ordered_check', sql`"structureA" < "structureB"`),
	'StructureDuplicateDecision_decision_check': check('StructureDuplicateDecision_decision_check', sql`"decision" IN ('SAME_ENTITY', 'DISTINCT')`),
	'StructureDuplicateDecision_primary_check': check('StructureDuplicateDecision_primary_check', sql`("decision" = 'DISTINCT' AND "primaryId" IS NULL) OR ("decision" = 'SAME_ENTITY' AND "primaryId" IS NOT NULL AND "primaryId" IN ("structureA", "structureB"))`),
}));

/** PKG-1 / K0: account profile. Minimal by design: age BAND (never a birth date), optional territory, accessibility preferences. */
export const CitizenProfile = pgTable('CitizenProfile', {
	userId: text('userId').notNull().primaryKey(),
	displayName: text('displayName'),
	preferredLanguage: text('preferredLanguage').notNull().default('fr'),
	ageBand: text('ageBand'),
	departement: text('departement'),
	accessibilityPrefs: jsonb('accessibilityPrefs').notNull().default({}),
	prefillConsent: boolean('prefillConsent').notNull().default(false),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	/** PKG-2 / C11: personal history is OPT-IN (off by default); switching it off erases the entries. */
	historyEnabled: boolean('historyEnabled').notNull().default(false)
}, (CitizenProfile) => ({
	'CitizenProfile_user_fkey': foreignKey({ name: 'CitizenProfile_user_fkey', columns: [CitizenProfile.userId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade')
}));

/** PKG-1 / K0: household members of an account (age band + relation only). */
export const HouseholdMember = pgTable('HouseholdMember', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text('userId').notNull(),
	relation: text('relation').notNull(),
	ageBand: text('ageBand'),
	label: text('label'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (HouseholdMember) => ({
	'HouseholdMember_user_fkey': foreignKey({ name: 'HouseholdMember_user_fkey', columns: [HouseholdMember.userId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'HouseholdMember_user_idx': index('HouseholdMember_user_idx').on(HouseholdMember.userId)
}));

/** PKG-1 / K0: server-enforced notification preferences, one row per (channel, category). Absent row = safe default (service e-mail on, everything else off, marketing never on by default). */
export const NotificationPreference = pgTable('NotificationPreference', {
	userId: text('userId').notNull(),
	channel: text('channel').notNull(),
	category: text('category').notNull(),
	enabled: boolean('enabled').notNull(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (NotificationPreference) => ({
	'NotificationPreference_pk': primaryKey({ name: 'NotificationPreference_pk', columns: [NotificationPreference.userId, NotificationPreference.channel, NotificationPreference.category] }),
	'NotificationPreference_user_fkey': foreignKey({ name: 'NotificationPreference_user_fkey', columns: [NotificationPreference.userId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade')
}));

/**
 * PKG-2 / K2 — Mon Parcours (C07/C12): the steps a person follows, persisted per account. Built from the account-free plan d'action of a dossier the account OWNS (origin PLAN)
 * or added by the person (origin MANUAL). Status is the person's own tracking; ADA never decides a right. A deadline exists only with its official source (dueSourceUrl).
 */
export const ParcoursItem = pgTable('ParcoursItem', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text('userId').notNull(),
	origin: text('origin').notNull(),
	sourceShareId: text('sourceShareId'),
	planKey: text('planKey'),
	stepKind: text('stepKind').notNull(),
	itemCodes: text('itemCodes').array().notNull().default(sql`ARRAY[]::text[]`),
	title: text('title').notNull(),
	status: text('status').notNull().default('NOT_STARTED'),
	dueDate: timestamp('dueDate', { precision: 3 }),
	dueSourceUrl: text('dueSourceUrl'),
	note: text('note'),
	// M1 (0046): the durable « who does what next » of the step — need, who acts, links, dependency, next action, honest closure (api/lib/parcours-plan-step.js). NULL = a step without it.
	planStep: jsonb('planStep'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (ParcoursItem) => ({
	'ParcoursItem_user_fkey': foreignKey({ name: 'ParcoursItem_user_fkey', columns: [ParcoursItem.userId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'ParcoursItem_share_fkey': foreignKey({ name: 'ParcoursItem_share_fkey', columns: [ParcoursItem.sourceShareId], foreignColumns: [SharedDiagnostic.id] }).onDelete('set null').onUpdate('cascade'),
	'ParcoursItem_user_idx': index('ParcoursItem_user_idx').on(ParcoursItem.userId),
	'ParcoursItem_user_planKey_key': uniqueIndex('ParcoursItem_user_planKey_key').on(ParcoursItem.userId, ParcoursItem.planKey)
}));

/** PKG-2 / C07: append-only history of a Parcours item (who changed what, when). Deleted only with the item or the account (cascade). */
export const ParcoursEvent = pgTable('ParcoursEvent', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	itemId: text('itemId').notNull(),
	userId: text('userId').notNull(),
	kind: text('kind').notNull(),
	fromStatus: text('fromStatus'),
	toStatus: text('toStatus'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (ParcoursEvent) => ({
	'ParcoursEvent_item_fkey': foreignKey({ name: 'ParcoursEvent_item_fkey', columns: [ParcoursEvent.itemId], foreignColumns: [ParcoursItem.id] }).onDelete('cascade').onUpdate('cascade'),
	'ParcoursEvent_item_idx': index('ParcoursEvent_item_idx').on(ParcoursEvent.itemId)
}));

/** PKG-2 / C10: favourites of published records (aide, demarche, structure). */
export const CitizenFavorite = pgTable('CitizenFavorite', {
	userId: text('userId').notNull(),
	entityType: text('entityType').notNull(),
	entityId: text('entityId').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (CitizenFavorite) => ({
	'CitizenFavorite_pk': primaryKey({ name: 'CitizenFavorite_pk', columns: [CitizenFavorite.userId, CitizenFavorite.entityType, CitizenFavorite.entityId] }),
	'CitizenFavorite_user_fkey': foreignKey({ name: 'CitizenFavorite_user_fkey', columns: [CitizenFavorite.userId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade')
}));

/** PKG-2 / C11: opt-in personal history (searches, viewed records, diagnostics, plans). Never used for analytics; erased when the person switches it off. */
export const CitizenHistoryEntry = pgTable('CitizenHistoryEntry', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text('userId').notNull(),
	kind: text('kind').notNull(),
	label: text('label').notNull(),
	ref: text('ref'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (CitizenHistoryEntry) => ({
	'CitizenHistoryEntry_user_fkey': foreignKey({ name: 'CitizenHistoryEntry_user_fkey', columns: [CitizenHistoryEntry.userId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'CitizenHistoryEntry_user_idx': index('CitizenHistoryEntry_user_idx').on(CitizenHistoryEntry.userId, CitizenHistoryEntry.createdAt)
}));

/**
 * X04 (expansion, migration 0053) — Academy and events. AcademyItem: an editorial page (LESSON) or a dated public event (EVENT), written by a named
 * administrator and published only through draft → review → published (api/_services/academy-events.js, the only writer). It holds NO personal data: the
 * organizer is an organisation name, the place a public venue. Closed by default: capability « community.events », surface « events ».
 */
export const AcademyItem = pgTable('AcademyItem', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	kind: text('kind').notNull(),
	status: text('status').notNull().default('draft'),
	slug: text('slug'),
	title: text('title').notNull(),
	summary: text('summary').notNull().default(''),
	body: text('body').notNull().default(''),
	// checked human translations only: { en: { title, summary, body }, … } — a language without one shows the French text marked lang="fr"
	translations: jsonb('translations').notNull().default({}),
	organizerName: text('organizerName'),
	startsAt: timestamp('startsAt', { precision: 3 }),
	endsAt: timestamp('endsAt', { precision: 3 }),
	registrationClosesAt: timestamp('registrationClosesAt', { precision: 3 }),
	venueName: text('venueName'),
	venueAddress: text('venueAddress'),
	venueCommune: text('venueCommune'),
	capacity: integer('capacity'),
	accessibilityFeatures: text('accessibilityFeatures').array().notNull().default(sql`ARRAY[]::text[]`),
	accessibilityNote: text('accessibilityNote'),
	reviewNote: text('reviewNote'),
	statusNote: text('statusNote'),
	createdBy: text('createdBy').notNull(),
	updatedBy: text('updatedBy').notNull(),
	submittedBy: text('submittedBy'),
	approvedBy: text('approvedBy'),
	approvedAt: timestamp('approvedAt', { precision: 3 }),
	publishedAt: timestamp('publishedAt', { precision: 3 }),
	cancelledAt: timestamp('cancelledAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (t) => ({
	'AcademyItem_slug_key': uniqueIndex('AcademyItem_slug_key').on(t.slug),
	'AcademyItem_public_idx': index('AcademyItem_public_idx').on(t.kind, t.status, t.startsAt),
	'AcademyItem_kind_check': check('AcademyItem_kind_check', sql`${t.kind} IN ('LESSON', 'EVENT')`),
	'AcademyItem_status_check': check('AcademyItem_status_check', sql`${t.status} IN ('draft', 'review', 'published', 'cancelled', 'withdrawn')`),
	'AcademyItem_capacity_check': check('AcademyItem_capacity_check', sql`${t.capacity} IS NULL OR (${t.capacity} >= 1 AND ${t.capacity} <= 5000)`),
	'AcademyItem_dates_check': check('AcademyItem_dates_check', sql`${t.startsAt} IS NULL OR ${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
	'AcademyItem_published_check': check('AcademyItem_published_check', sql`${t.status} IN ('draft', 'review') OR (${t.slug} IS NOT NULL AND ${t.publishedAt} IS NOT NULL AND ${t.approvedBy} IS NOT NULL)`),
	'AcademyItem_event_check': check('AcademyItem_event_check', sql`${t.kind} = 'LESSON' OR ${t.status} IN ('draft', 'review') OR (${t.startsAt} IS NOT NULL AND ${t.endsAt} IS NOT NULL AND ${t.capacity} IS NOT NULL AND ${t.venueName} IS NOT NULL)`)
}));

/**
 * X04 (0053) — a signed-in adult citizen's registration to a published EVENT. Minimal: the account, the event, the state, the times and — optional, only
 * with the person's explicit choice — ONE accessibility need from a closed list (no free text). Cancelling clears the need. Deleted with the account
 * (ON DELETE CASCADE: account deletion, DSR erasure, step 6c) and with the event. The organizer sees counts only (api/_services/academy-events.js).
 */
export const EventRegistration = pgTable('EventRegistration', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	itemId: text('itemId').notNull(),
	citizenUserId: text('citizenUserId').notNull(),
	status: text('status').notNull().default('REGISTERED'),
	accessibilityNeed: text('accessibilityNeed'),
	accessibilityNeedAt: timestamp('accessibilityNeedAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	cancelledAt: timestamp('cancelledAt', { precision: 3 })
}, (t) => ({
	'EventRegistration_item_fkey': foreignKey({ name: 'EventRegistration_item_fkey', columns: [t.itemId], foreignColumns: [AcademyItem.id] }).onDelete('cascade').onUpdate('cascade'),
	'EventRegistration_user_fkey': foreignKey({ name: 'EventRegistration_user_fkey', columns: [t.citizenUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'EventRegistration_item_user_key': uniqueIndex('EventRegistration_item_user_key').on(t.itemId, t.citizenUserId),
	'EventRegistration_user_idx': index('EventRegistration_user_idx').on(t.citizenUserId),
	'EventRegistration_status_check': check('EventRegistration_status_check', sql`${t.status} IN ('REGISTERED', 'CANCELLED')`),
	'EventRegistration_need_check': check('EventRegistration_need_check', sql`${t.accessibilityNeed} IS NULL OR ${t.accessibilityNeed} IN ('STEP_FREE_ACCESS', 'LSF_INTERPRETATION', 'LIVE_CAPTIONS', 'HEARING_LOOP', 'FALC_MATERIALS', 'LARGE_PRINT_MATERIALS', 'QUIET_SPACE', 'ACCOMPANYING_PERSON')`),
	'EventRegistration_need_state_check': check('EventRegistration_need_state_check', sql`(${t.accessibilityNeed} IS NULL) = (${t.accessibilityNeedAt} IS NULL) AND (${t.status} = 'REGISTERED' OR ${t.accessibilityNeed} IS NULL)`)
}));

/**
 * X02 (expansion, migration 0054) — a testimonial written by a signed-in adult citizen, published only after moderation and only with the person's explicit
 * consent (one ConsentLog row, purpose TESTIMONIAL_PUBLICATION, the testimonial id in policy_hash). The text and the chosen first name / pseudonym exist ONLY
 * while the testimonial is pending or published: a withdrawal (by the person, at any time), a rejection or a takedown erases both (CHECK). At most one
 * pending or published testimonial per account. Deleted with the account (ON DELETE CASCADE: account deletion, DSR erasure, step 6c). Only writer:
 * api/_services/testimonials.js. Closed by default: capability « community.testimonials », surface « testimonials ».
 */
export const Testimonial = pgTable('Testimonial', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	citizenUserId: text('citizenUserId').notNull(),
	status: text('status').notNull().default('pending'),
	displayName: text('displayName'),
	body: text('body'),
	lang: text('lang').notNull(),
	consentVersion: text('consentVersion').notNull(),
	moderationReason: text('moderationReason'),
	moderatedBy: text('moderatedBy'),
	moderatedAt: timestamp('moderatedAt', { precision: 3 }),
	submittedAt: timestamp('submittedAt', { precision: 3 }).notNull().defaultNow(),
	publishedAt: timestamp('publishedAt', { precision: 3 }),
	withdrawnAt: timestamp('withdrawnAt', { precision: 3 }),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (t) => ({
	'Testimonial_user_fkey': foreignKey({ name: 'Testimonial_user_fkey', columns: [t.citizenUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'Testimonial_active_user_key': uniqueIndex('Testimonial_active_user_key').on(t.citizenUserId).where(sql`status IN ('pending', 'published')`),
	'Testimonial_public_idx': index('Testimonial_public_idx').on(t.status, t.publishedAt),
	'Testimonial_status_check': check('Testimonial_status_check', sql`${t.status} IN ('pending', 'published', 'rejected', 'withdrawn', 'taken_down')`),
	'Testimonial_lang_check': check('Testimonial_lang_check', sql`${t.lang} IN ('fr', 'en', 'de', 'tr', 'ar', 'uk')`),
	'Testimonial_text_state_check': check('Testimonial_text_state_check', sql`(${t.status} IN ('pending', 'published') AND ${t.body} IS NOT NULL AND ${t.displayName} IS NOT NULL) OR (${t.status} NOT IN ('pending', 'published') AND ${t.body} IS NULL AND ${t.displayName} IS NULL)`),
	'Testimonial_length_check': check('Testimonial_length_check', sql`(${t.body} IS NULL OR char_length(${t.body}) BETWEEN 30 AND 1500) AND (${t.displayName} IS NULL OR char_length(${t.displayName}) BETWEEN 2 AND 40)`),
	'Testimonial_published_check': check('Testimonial_published_check', sql`${t.status} <> 'published' OR (${t.publishedAt} IS NOT NULL AND ${t.moderatedBy} IS NOT NULL)`),
	'Testimonial_reason_check': check('Testimonial_reason_check', sql`${t.moderationReason} IS NULL OR ${t.moderationReason} IN ('HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC')`)
}));

/**
 * X02 (0054) — a report of abuse on a published testimonial by a signed-in citizen: the testimonial, the reporting account, ONE reason from a closed list (no
 * free text), the time. One report per account and testimonial. The moderator sees counts per reason, never who reported. Deleted when the testimonial
 * leaves public view (withdrawal, takedown) or when the moderator dismisses the reports, and with either account (ON DELETE CASCADE).
 */
export const TestimonialReport = pgTable('TestimonialReport', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	testimonialId: text('testimonialId').notNull(),
	reporterUserId: text('reporterUserId').notNull(),
	reason: text('reason').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'TestimonialReport_testimonial_fkey': foreignKey({ name: 'TestimonialReport_testimonial_fkey', columns: [t.testimonialId], foreignColumns: [Testimonial.id] }).onDelete('cascade').onUpdate('cascade'),
	'TestimonialReport_user_fkey': foreignKey({ name: 'TestimonialReport_user_fkey', columns: [t.reporterUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'TestimonialReport_once_key': uniqueIndex('TestimonialReport_once_key').on(t.testimonialId, t.reporterUserId),
	'TestimonialReport_reporter_idx': index('TestimonialReport_reporter_idx').on(t.reporterUserId, t.createdAt),
	'TestimonialReport_reason_check': check('TestimonialReport_reason_check', sql`${t.reason} IN ('HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC')`)
}));

/**
 * X01 (expansion, migration 0055) — the community's PSEUDONYMOUS PRINCIPAL (R47 § 8: « a new public principal so CitizenUser is never exposed »). One row
 * per adult account that joined the community: an opaque random id (never the account id) and the pseudonym the person CHOSE (never prefilled, never the
 * e-mail; unique without regard to case; immutable — it disappears only when the person leaves the community or the account is deleted). Everything public or
 * shown to a moderator names this pseudonym, never the account. Deleted with the account (ON DELETE CASCADE). Only writer: api/_services/community-stories.js.
 */
export const CommunityMember = pgTable('CommunityMember', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	citizenUserId: text('citizenUserId').notNull(),
	pseudonym: text('pseudonym').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'CommunityMember_user_fkey': foreignKey({ name: 'CommunityMember_user_fkey', columns: [t.citizenUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'CommunityMember_user_key': uniqueIndex('CommunityMember_user_key').on(t.citizenUserId),
	'CommunityMember_pseudonym_key': uniqueIndex('CommunityMember_pseudonym_key').on(sql`lower(${t.pseudonym})`),
	'CommunityMember_pseudonym_check': check('CommunityMember_pseudonym_check', sql`char_length(${t.pseudonym}) BETWEEN 3 AND 24 AND ${t.pseudonym} !~ '[@[:space:]]'`)
}));

/**
 * X01 (0055) — a story (« histoire ») written by a community member, published only after moderation and with the person's explicit consent (one ConsentLog
 * row, purpose COMMUNITY_STORY_PUBLICATION, the story id in policy_hash). The title and the text exist ONLY while the story is pending or published: a
 * withdrawal (by the person, at any time), a rejection or a takedown erases both (CHECK). Keyed on the PSEUDONYMOUS member, not on the account. Deleted with
 * the member (leaving the community) and so with the account (cascade). No image, no link, no contact (refused by the service).
 */
export const CommunityStory = pgTable('CommunityStory', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	memberId: text('memberId').notNull(),
	status: text('status').notNull().default('pending'),
	title: text('title'),
	body: text('body'),
	lang: text('lang').notNull(),
	consentVersion: text('consentVersion').notNull(),
	moderationReason: text('moderationReason'),
	moderatedBy: text('moderatedBy'),
	moderatedAt: timestamp('moderatedAt', { precision: 3 }),
	submittedAt: timestamp('submittedAt', { precision: 3 }).notNull().defaultNow(),
	publishedAt: timestamp('publishedAt', { precision: 3 }),
	withdrawnAt: timestamp('withdrawnAt', { precision: 3 }),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (t) => ({
	'CommunityStory_member_fkey': foreignKey({ name: 'CommunityStory_member_fkey', columns: [t.memberId], foreignColumns: [CommunityMember.id] }).onDelete('cascade').onUpdate('cascade'),
	'CommunityStory_member_idx': index('CommunityStory_member_idx').on(t.memberId, t.submittedAt),
	'CommunityStory_public_idx': index('CommunityStory_public_idx').on(t.status, t.publishedAt),
	'CommunityStory_status_check': check('CommunityStory_status_check', sql`${t.status} IN ('pending', 'published', 'rejected', 'withdrawn', 'taken_down')`),
	'CommunityStory_lang_check': check('CommunityStory_lang_check', sql`${t.lang} IN ('fr', 'en', 'de', 'tr', 'ar', 'uk')`),
	'CommunityStory_text_state_check': check('CommunityStory_text_state_check', sql`(${t.status} IN ('pending', 'published') AND ${t.title} IS NOT NULL AND ${t.body} IS NOT NULL) OR (${t.status} NOT IN ('pending', 'published') AND ${t.title} IS NULL AND ${t.body} IS NULL)`),
	'CommunityStory_length_check': check('CommunityStory_length_check', sql`(${t.title} IS NULL OR char_length(${t.title}) BETWEEN 5 AND 120) AND (${t.body} IS NULL OR char_length(${t.body}) BETWEEN 50 AND 3000)`),
	'CommunityStory_published_check': check('CommunityStory_published_check', sql`${t.status} <> 'published' OR (${t.publishedAt} IS NOT NULL AND ${t.moderatedBy} IS NOT NULL)`),
	'CommunityStory_reason_check': check('CommunityStory_reason_check', sql`${t.moderationReason} IS NULL OR ${t.moderationReason} IN ('HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC')`)
}));

/**
 * X01 (0055) — a report of abuse on a published story by a signed-in citizen: the story, the reporting account, ONE reason from a closed list (no free text),
 * the time. One report per account and story. The moderator sees counts per reason, never who reported. Deleted when the story leaves public view
 * (withdrawal, takedown) or when the moderator dismisses the reports, and with either account (ON DELETE CASCADE).
 */
export const CommunityStoryReport = pgTable('CommunityStoryReport', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	storyId: text('storyId').notNull(),
	reporterUserId: text('reporterUserId').notNull(),
	reason: text('reason').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'CommunityStoryReport_story_fkey': foreignKey({ name: 'CommunityStoryReport_story_fkey', columns: [t.storyId], foreignColumns: [CommunityStory.id] }).onDelete('cascade').onUpdate('cascade'),
	'CommunityStoryReport_user_fkey': foreignKey({ name: 'CommunityStoryReport_user_fkey', columns: [t.reporterUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'CommunityStoryReport_once_key': uniqueIndex('CommunityStoryReport_once_key').on(t.storyId, t.reporterUserId),
	'CommunityStoryReport_reporter_idx': index('CommunityStoryReport_reporter_idx').on(t.reporterUserId, t.createdAt),
	'CommunityStoryReport_reason_check': check('CommunityStoryReport_reason_check', sql`${t.reason} IN ('HEALTH_DETAIL', 'PERSONAL_DATA', 'OFFENSIVE', 'MISLEADING', 'ADVERTISING', 'OFF_TOPIC')`)
}));

/**
 * PKG-2 / C09 — Mon Coffre: the person's own documents. Bytes are envelope-encrypted server-side (api/lib/data-keys.js) before the storage adapter sees them; the file name is
 * encrypted too. scanStatus states honestly that no antivirus scan exists yet (NOT_SCANNED); the type is checked from the content, not from the declared name.
 */
export const CitizenDocument = pgTable('CitizenDocument', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	userId: text('userId').notNull(),
	category: text('category').notNull(),
	filenameEncrypted: text('filenameEncrypted').notNull(),
	mimeType: text('mimeType').notNull(),
	byteLength: integer('byteLength').notNull(),
	checksumSha256: text('checksumSha256').notNull(),
	storageKey: text('storageKey').notNull(),
	scanStatus: text('scanStatus').notNull().default('NOT_SCANNED'),
	expiresAt: timestamp('expiresAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (CitizenDocument) => ({
	'CitizenDocument_user_fkey': foreignKey({ name: 'CitizenDocument_user_fkey', columns: [CitizenDocument.userId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'CitizenDocument_user_idx': index('CitizenDocument_user_idx').on(CitizenDocument.userId)
}));

/**
 * PKG-2 / C08 — one row per reminder of a sourced Parcours deadline (threshold J7 / J1, per channel). The row is CLAIMED before sending (exactly once even with concurrent crons)
 * and records honestly whether the provider really delivered it (DELIVERED / NOT_DELIVERED) or why nothing was sent (NO_CONSENT).
 */
export const ParcoursReminder = pgTable('ParcoursReminder', {
	itemId: text('itemId').notNull(),
	threshold: text('threshold').notNull(),
	channel: text('channel').notNull(),
	status: text('status').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (ParcoursReminder) => ({
	'ParcoursReminder_pk': primaryKey({ name: 'ParcoursReminder_pk', columns: [ParcoursReminder.itemId, ParcoursReminder.threshold, ParcoursReminder.channel] }),
	'ParcoursReminder_item_fkey': foreignKey({ name: 'ParcoursReminder_item_fkey', columns: [ParcoursReminder.itemId], foreignColumns: [ParcoursItem.id] }).onDelete('cascade').onUpdate('cascade')
}));

/**
 * PKG-2 / C23 — a delegation the person (principal) gives to someone they trust (delegate): scoped to READ-ONLY views (never a write, never the principal's session),
 * time-limited (at most one year), revocable at any time by either side. Legal mandates (tuteur, curateur, représentant) need a proof whose verification process is not
 * designed yet: the database keeps them PROOF_REQUIRED and refuses ACTIVE for them (fail-closed) until that human-designed process exists.
 */
export const CitizenDelegation = pgTable('CitizenDelegation', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	principalUserId: text('principalUserId').notNull(),
	delegateUserId: text('delegateUserId'),
	inviteEmail: text('inviteEmail').notNull(),
	inviteTokenHash: text('inviteTokenHash'),
	inviteExpiresAt: timestamp('inviteExpiresAt', { precision: 3 }),
	role: text('role').notNull(),
	scopes: text('scopes').array().notNull(),
	status: text('status').notNull().default('INVITED'),
	proofStatus: text('proofStatus').notNull(),
	expiresAt: timestamp('expiresAt', { precision: 3 }).notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	acceptedAt: timestamp('acceptedAt', { precision: 3 }),
	endedAt: timestamp('endedAt', { precision: 3 }),
	endedBy: text('endedBy')
}, (CitizenDelegation) => ({
	'CitizenDelegation_principal_fkey': foreignKey({ name: 'CitizenDelegation_principal_fkey', columns: [CitizenDelegation.principalUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'CitizenDelegation_delegate_fkey': foreignKey({ name: 'CitizenDelegation_delegate_fkey', columns: [CitizenDelegation.delegateUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'CitizenDelegation_principal_idx': index('CitizenDelegation_principal_idx').on(CitizenDelegation.principalUserId),
	'CitizenDelegation_delegate_idx': index('CitizenDelegation_delegate_idx').on(CitizenDelegation.delegateUserId),
	'CitizenDelegation_inviteTokenHash_key': uniqueIndex('CitizenDelegation_inviteTokenHash_key').on(CitizenDelegation.inviteTokenHash),
	'CitizenDelegation_live_key': uniqueIndex('CitizenDelegation_live_key').on(CitizenDelegation.principalUserId, CitizenDelegation.inviteEmail).where(sql`"status" IN ('INVITED', 'ACTIVE', 'PROOF_REQUIRED')`)
}));

/** PKG-2 / C23: append-only log of what a delegate viewed, shown to the principal. Deleted only with the delegation or the account (cascade). */
export const DelegationAccessEvent = pgTable('DelegationAccessEvent', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	delegationId: text('delegationId').notNull(),
	principalUserId: text('principalUserId').notNull(),
	action: text('action').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (DelegationAccessEvent) => ({
	'DelegationAccessEvent_delegation_fkey': foreignKey({ name: 'DelegationAccessEvent_delegation_fkey', columns: [DelegationAccessEvent.delegationId], foreignColumns: [CitizenDelegation.id] }).onDelete('cascade').onUpdate('cascade'),
	'DelegationAccessEvent_delegation_idx': index('DelegationAccessEvent_delegation_idx').on(DelegationAccessEvent.delegationId)
}));

/**
 * PKG-3 / B04-B06 — one row per notice about an appointment (cancellation, move, booking by the structure, J-1 reminder, video approval), per recipient and channel, with the
 * HONEST outcome: DELIVERED only when the provider really delivered, NOT_DELIVERED when no provider is configured, NO_CONSENT when the person did not opt in for that kind,
 * NO_RECIPIENT when nobody can receive it. Never the message text, never an address.
 */
export const AppointmentNotice = pgTable('AppointmentNotice', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	appointmentId: text('appointmentId').notNull(),
	kind: text('kind').notNull(),
	recipient: text('recipient').notNull(),
	channel: text('channel').notNull(),
	status: text('status').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (AppointmentNotice) => ({
	'AppointmentNotice_appointment_fkey': foreignKey({ name: 'AppointmentNotice_appointment_fkey', columns: [AppointmentNotice.appointmentId], foreignColumns: [ProAppointment.id] }).onDelete('cascade').onUpdate('cascade'),
	'AppointmentNotice_appointment_idx': index('AppointmentNotice_appointment_idx').on(AppointmentNotice.appointmentId)
}));

/**
 * PKG-4 / R06 R07 R11 R12 — the follow-up of ONE citizen dossier by ONE organization (exists only while the organization holds the citizen's grant on that dossier).
 * Controlled status and outcome vocabularies (DB CHECK); the assignee is a member of the same organization; history is append-only (ProCaseEvent).
 */
export const ProCase = pgTable('ProCase', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	sharedDiagnosticId: text('sharedDiagnosticId').notNull(),
	structureId: text('structureId').notNull(),
	status: text('status').notNull().default('NEW'),
	assigneeProUserId: text('assigneeProUserId'),
	outcome: text('outcome'),
	outcomeCitizenSummary: text('outcomeCitizenSummary'),
	openedAt: timestamp('openedAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	closedAt: timestamp('closedAt', { precision: 3 })
}, (ProCase) => ({
	'ProCase_dossier_fkey': foreignKey({ name: 'ProCase_dossier_fkey', columns: [ProCase.sharedDiagnosticId], foreignColumns: [SharedDiagnostic.id] }).onDelete('cascade').onUpdate('cascade'),
	'ProCase_structure_fkey': foreignKey({ name: 'ProCase_structure_fkey', columns: [ProCase.structureId], foreignColumns: [Structure.id] }).onDelete('cascade').onUpdate('cascade'),
	'ProCase_assignee_fkey': foreignKey({ name: 'ProCase_assignee_fkey', columns: [ProCase.assigneeProUserId], foreignColumns: [ProUser.id] }).onDelete('set null').onUpdate('cascade'),
	'ProCase_dossier_structure_key': uniqueIndex('ProCase_dossier_structure_key').on(ProCase.sharedDiagnosticId, ProCase.structureId),
	'ProCase_structure_status_idx': index('ProCase_structure_status_idx').on(ProCase.structureId, ProCase.status),
	'ProCase_assignee_idx': index('ProCase_assignee_idx').on(ProCase.assigneeProUserId)
}));

/** PKG-4: append-only history of a case (who did what, when). Values are codes, never note text. */
export const ProCaseEvent = pgTable('ProCaseEvent', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	caseId: text('caseId').notNull(),
	structureId: text('structureId').notNull(),
	actorProUserId: text('actorProUserId'),
	kind: text('kind').notNull(),
	fromValue: text('fromValue'),
	toValue: text('toValue'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (ProCaseEvent) => ({
	'ProCaseEvent_case_fkey': foreignKey({ name: 'ProCaseEvent_case_fkey', columns: [ProCaseEvent.caseId], foreignColumns: [ProCase.id] }).onDelete('cascade').onUpdate('cascade'),
	'ProCaseEvent_case_idx': index('ProCaseEvent_case_idx').on(ProCaseEvent.caseId)
}));

/** PKG-4 / R08: notes on a case. INTERNAL = the organization's team only; CITIZEN = also shown to the person. Bodies are envelope-encrypted (purpose case-note). */
export const ProCaseNote = pgTable('ProCaseNote', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	caseId: text('caseId').notNull(),
	structureId: text('structureId').notNull(),
	authorProUserId: text('authorProUserId'),
	visibility: text('visibility').notNull(),
	bodyEncrypted: text('bodyEncrypted').notNull(),
	mentions: text('mentions').array().notNull().default(sql`ARRAY[]::text[]`),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (ProCaseNote) => ({
	'ProCaseNote_case_fkey': foreignKey({ name: 'ProCaseNote_case_fkey', columns: [ProCaseNote.caseId], foreignColumns: [ProCase.id] }).onDelete('cascade').onUpdate('cascade'),
	'ProCaseNote_author_fkey': foreignKey({ name: 'ProCaseNote_author_fkey', columns: [ProCaseNote.authorProUserId], foreignColumns: [ProUser.id] }).onDelete('set null').onUpdate('cascade'),
	'ProCaseNote_case_idx': index('ProCaseNote_case_idx').on(ProCaseNote.caseId)
}));

/**
 * PKG-4 / R09 R10 R11 — a closed-loop referral of a citizen dossier from one organization to another. The receiving organization gets access ONLY through a grant the
 * CITIZEN authorizes for this referral; it sees the dossier projection for its own organization plus the referral message — never the sender's internal notes.
 */
export const Referral = pgTable('Referral', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	sharedDiagnosticId: text('sharedDiagnosticId').notNull(),
	fromStructureId: text('fromStructureId').notNull(),
	toStructureId: text('toStructureId').notNull(),
	fromCaseId: text('fromCaseId'),
	createdByProUserId: text('createdByProUserId'),
	status: text('status').notNull().default('DRAFT'),
	reasonCode: text('reasonCode').notNull(),
	messageEncrypted: text('messageEncrypted'),
	responseCode: text('responseCode'),
	responseMessageEncrypted: text('responseMessageEncrypted'),
	outcome: text('outcome'),
	outcomeCitizenSummary: text('outcomeCitizenSummary'),
	grantId: text('grantId'),
	appointmentId: text('appointmentId'),
	idempotencyKey: text('idempotencyKey'),
	citizenDecisionAt: timestamp('citizenDecisionAt', { precision: 3 }),
	sentAt: timestamp('sentAt', { precision: 3 }),
	acknowledgedAt: timestamp('acknowledgedAt', { precision: 3 }),
	respondedAt: timestamp('respondedAt', { precision: 3 }),
	dueAt: timestamp('dueAt', { precision: 3 }),
	overdueNotifiedAt: timestamp('overdueNotifiedAt', { precision: 3 }),
	closedAt: timestamp('closedAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull(),
	/** M2 / G3 (0047): the declined referral this one follows. A link only: the new referral starts at PENDING_CITIZEN and needs the person's own authorization. */
	previousReferralId: text('previousReferralId'),
	/** M2 / G3 (0047): the organization a declining receiver suggests (identifier only; nothing is disclosed to it). Only on a DECLINED / CLOSED referral. */
	suggestedStructureId: text('suggestedStructureId'),
	/** M2 / G4 (0047): the one « needs a human follow-up » notice was sent (accepted without a recorded step, or a suggestion nobody acted on) */
	followUpNotifiedAt: timestamp('followUpNotifiedAt', { precision: 3 })
}, (Referral) => ({
	'Referral_previous_fkey': foreignKey({ name: 'Referral_previous_fkey', columns: [Referral.previousReferralId], foreignColumns: [Referral.id] }).onDelete('set null').onUpdate('cascade'),
	'Referral_suggested_fkey': foreignKey({ name: 'Referral_suggested_fkey', columns: [Referral.suggestedStructureId], foreignColumns: [Structure.id] }).onDelete('set null').onUpdate('cascade'),
	'Referral_previous_idx': index('Referral_previous_idx').on(Referral.previousReferralId),
	'Referral_previous_live_key': uniqueIndex('Referral_previous_live_key').on(Referral.previousReferralId).where(sql`"previousReferralId" IS NOT NULL AND "status" IN ('DRAFT', 'PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO', 'ACCEPTED', 'IN_PROGRESS')`),
	'Referral_dossier_fkey': foreignKey({ name: 'Referral_dossier_fkey', columns: [Referral.sharedDiagnosticId], foreignColumns: [SharedDiagnostic.id] }).onDelete('cascade').onUpdate('cascade'),
	'Referral_from_fkey': foreignKey({ name: 'Referral_from_fkey', columns: [Referral.fromStructureId], foreignColumns: [Structure.id] }).onDelete('cascade').onUpdate('cascade'),
	'Referral_to_fkey': foreignKey({ name: 'Referral_to_fkey', columns: [Referral.toStructureId], foreignColumns: [Structure.id] }).onDelete('cascade').onUpdate('cascade'),
	'Referral_case_fkey': foreignKey({ name: 'Referral_case_fkey', columns: [Referral.fromCaseId], foreignColumns: [ProCase.id] }).onDelete('set null').onUpdate('cascade'),
	'Referral_creator_fkey': foreignKey({ name: 'Referral_creator_fkey', columns: [Referral.createdByProUserId], foreignColumns: [ProUser.id] }).onDelete('set null').onUpdate('cascade'),
	'Referral_appointment_fkey': foreignKey({ name: 'Referral_appointment_fkey', columns: [Referral.appointmentId], foreignColumns: [ProAppointment.id] }).onDelete('set null').onUpdate('cascade'),
	'Referral_to_status_idx': index('Referral_to_status_idx').on(Referral.toStructureId, Referral.status),
	'Referral_from_idx': index('Referral_from_idx').on(Referral.fromStructureId),
	'Referral_dossier_idx': index('Referral_dossier_idx').on(Referral.sharedDiagnosticId),
	'Referral_idempotency_key': uniqueIndex('Referral_idempotency_key').on(Referral.fromStructureId, Referral.idempotencyKey),
	'Referral_live_key': uniqueIndex('Referral_live_key').on(Referral.sharedDiagnosticId, Referral.toStructureId).where(sql`"status" IN ('DRAFT', 'PENDING_CITIZEN', 'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO', 'ACCEPTED', 'IN_PROGRESS')`)
}));

/** PKG-4: append-only history of a referral (transition, actor side, time). */
export const ReferralEvent = pgTable('ReferralEvent', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	referralId: text('referralId').notNull(),
	actorType: text('actorType').notNull(),
	actorId: text('actorId'),
	fromStatus: text('fromStatus'),
	toStatus: text('toStatus').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (ReferralEvent) => ({
	'ReferralEvent_referral_fkey': foreignKey({ name: 'ReferralEvent_referral_fkey', columns: [ReferralEvent.referralId], foreignColumns: [Referral.id] }).onDelete('cascade').onUpdate('cascade'),
	'ReferralEvent_referral_idx': index('ReferralEvent_referral_idx').on(ReferralEvent.referralId)
}));

/**
 * M2 add-on / B01 (0048) — the history of the texts exchanged on a referral (the proposal's message, the receiver's answers, the sender's replies). Append-only
 * (the database allows one update only: re-sealing the ciphertext under a rotated key). Sealed like Referral.messageEncrypted (purpose referral-message,
 * context « referral:<referralId> »). Referral.messageEncrypted / responseMessageEncrypted stay the current text of each side.
 */
export const ReferralMessage = pgTable('ReferralMessage', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	referralId: text('referralId').notNull(),
	side: text('side').notNull(),
	bodyEncrypted: text('bodyEncrypted').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (ReferralMessage) => ({
	'ReferralMessage_referral_fkey': foreignKey({ name: 'ReferralMessage_referral_fkey', columns: [ReferralMessage.referralId], foreignColumns: [Referral.id] }).onDelete('cascade').onUpdate('cascade'),
	'ReferralMessage_referral_idx': index('ReferralMessage_referral_idx').on(ReferralMessage.referralId, ReferralMessage.createdAt)
}));

/**
 * M2 / G5 (0047) — « référent de parcours »: a named contact person for the person's path, DECLARATIVE. This row gives NO access to the dossier (access is the
 * SharedDossierGrant alone — api/_utils/share-access.js never reads this table) and carries no legal responsibility. A professional volunteers (PROPOSED);
 * only the person makes it effective (ACCEPTED_BY_CITIZEN, citizenDecisionAt enforced by the database) and ends it at any time. One current row per dossier.
 */
export const DossierReferent = pgTable('DossierReferent', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	sharedDiagnosticId: text('sharedDiagnosticId').notNull(),
	structureId: text('structureId').notNull(),
	proUserId: text('proUserId'),
	/** the name the professional agreed to show (displayNameConsentAt) to the person and to the organizations holding an active grant */
	displayName: text('displayName').notNull(),
	status: text('status').notNull().default('PROPOSED'),
	displayNameConsentAt: timestamp('displayNameConsentAt', { precision: 3 }).notNull(),
	proposedAt: timestamp('proposedAt', { precision: 3 }).notNull().defaultNow(),
	citizenDecisionAt: timestamp('citizenDecisionAt', { precision: 3 }),
	endedAt: timestamp('endedAt', { precision: 3 }),
	endedBy: text('endedBy'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (DossierReferent) => ({
	'DossierReferent_dossier_fkey': foreignKey({ name: 'DossierReferent_dossier_fkey', columns: [DossierReferent.sharedDiagnosticId], foreignColumns: [SharedDiagnostic.id] }).onDelete('cascade').onUpdate('cascade'),
	'DossierReferent_structure_fkey': foreignKey({ name: 'DossierReferent_structure_fkey', columns: [DossierReferent.structureId], foreignColumns: [Structure.id] }).onDelete('cascade').onUpdate('cascade'),
	'DossierReferent_pro_fkey': foreignKey({ name: 'DossierReferent_pro_fkey', columns: [DossierReferent.proUserId], foreignColumns: [ProUser.id] }).onDelete('set null').onUpdate('cascade'),
	'DossierReferent_current_key': uniqueIndex('DossierReferent_current_key').on(DossierReferent.sharedDiagnosticId).where(sql`"status" IN ('PROPOSED', 'ACCEPTED_BY_CITIZEN')`),
	'DossierReferent_structure_idx': index('DossierReferent_structure_idx').on(DossierReferent.structureId),
	'DossierReferent_pro_idx': index('DossierReferent_pro_idx').on(DossierReferent.proUserId)
}));

/** M2 (0047): append-only history of a référent de parcours (who proposed, the person's decision, how it ended). Codes only. */
export const DossierReferentEvent = pgTable('DossierReferentEvent', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	referentId: text('referentId').notNull(),
	actorType: text('actorType').notNull(),
	actorId: text('actorId'),
	fromStatus: text('fromStatus'),
	toStatus: text('toStatus').notNull(),
	reason: text('reason'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (DossierReferentEvent) => ({
	'DossierReferentEvent_referent_fkey': foreignKey({ name: 'DossierReferentEvent_referent_fkey', columns: [DossierReferentEvent.referentId], foreignColumns: [DossierReferent.id] }).onDelete('cascade').onUpdate('cascade'),
	'DossierReferentEvent_referent_idx': index('DossierReferentEvent_referent_idx').on(DossierReferentEvent.referentId)
}));

/**
 * PKG-4 / E02 E05 — a change a structure's team PROPOSES to its own public profile (or its service area). Nothing is published by the proposal: an ADA reviewer (admin with
 * MFA) accepts or rejects it; only an accepted proposal changes the Structure record (D-5: no direct publication of unverified facts). Provenance: who, when, which value.
 */
export const StructureProposal = pgTable('StructureProposal', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	structureId: text('structureId').notNull(),
	proposedByProUserId: text('proposedByProUserId'),
	field: text('field').notNull(),
	proposedValue: text('proposedValue').notNull(),
	previousValue: text('previousValue'),
	status: text('status').notNull().default('PENDING'),
	reviewedBy: text('reviewedBy'),
	reviewedAt: timestamp('reviewedAt', { precision: 3 }),
	reviewNote: text('reviewNote'),
	/** PKG-4 / D-5: the official source the reviewer checked the value against (allowed domains only) */
	reviewSourceUrl: text('reviewSourceUrl'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (StructureProposal) => ({
	'StructureProposal_structure_fkey': foreignKey({ name: 'StructureProposal_structure_fkey', columns: [StructureProposal.structureId], foreignColumns: [Structure.id] }).onDelete('cascade').onUpdate('cascade'),
	'StructureProposal_author_fkey': foreignKey({ name: 'StructureProposal_author_fkey', columns: [StructureProposal.proposedByProUserId], foreignColumns: [ProUser.id] }).onDelete('set null').onUpdate('cascade'),
	'StructureProposal_status_idx': index('StructureProposal_status_idx').on(StructureProposal.status, StructureProposal.createdAt),
	'StructureProposal_structure_idx': index('StructureProposal_structure_idx').on(StructureProposal.structureId)
}));

/**
 * PKG-4 / R14 — a file attached to a professional <-> citizen appointment conversation. Bytes are envelope-encrypted in object storage (purpose 'message-attachment');
 * the row holds the encrypted file name and metadata only. Readable by the citizen of the conversation and the active members of its structure; erased with the
 * conversation (cascade) and the blob purged by the erasure path.
 */
export const RdvMessageAttachment = pgTable('RdvMessageAttachment', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	conversationId: text('conversationId').notNull(),
	messageId: text('messageId').notNull(),
	uploaderType: text('uploaderType').notNull(),
	storageKey: text('storageKey').notNull(),
	filenameEncrypted: text('filenameEncrypted').notNull(),
	mimeType: text('mimeType').notNull(),
	byteLength: integer('byteLength').notNull(),
	checksumSha256: text('checksumSha256').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'RdvMessageAttachment_conversation_fkey': foreignKey({ name: 'RdvMessageAttachment_conversation_fkey', columns: [t.conversationId], foreignColumns: [RdvConversation.id] }).onDelete('cascade').onUpdate('cascade'),
	'RdvMessageAttachment_message_fkey': foreignKey({ name: 'RdvMessageAttachment_message_fkey', columns: [t.messageId], foreignColumns: [RdvConversationMessage.id] }).onDelete('cascade').onUpdate('cascade'),
	'RdvMessageAttachment_conversation_idx': index('RdvMessageAttachment_conversation_idx').on(t.conversationId)
}));

/** PKG-5 / A15: administrator kill switches. An override can only force a flag OFF (enabling still needs the deployment's environment); history is in AuditLog. */
export const FeatureFlagOverride = pgTable('FeatureFlagOverride', {
	key: text('key').notNull().primaryKey(),
	forcedOff: boolean('forcedOff').notNull(),
	reason: text('reason').notNull(),
	setBy: text('setBy').notNull(),
	setAt: timestamp('setAt', { precision: 3 }).notNull().defaultNow()
});

/** PKG-5 / A19: support / help requests. Free text and contact are sealed (data-keys purpose 'support'); never linked to a dossier. */
export const SupportRequest = pgTable('SupportRequest', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	category: text('category').notNull(),
	messageEncrypted: text('messageEncrypted').notNull(),
	contactEncrypted: text('contactEncrypted'),
	status: text('status').notNull().default('OPEN'),
	assignedTo: text('assignedTo'),
	resolutionNote: text('resolutionNote'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3 }).notNull().defaultNow(),
	closedAt: timestamp('closedAt', { precision: 3 })
}, (t) => ({
	'SupportRequest_status_idx': index('SupportRequest_status_idx').on(t.status, t.createdAt)
}));

/** PKG-5 / I05: a partner agreement as RECORDED by an administrator from a real signed document (reference only); nothing is pre-filled. */
export const PartnerAgreement = pgTable('PartnerAgreement', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	partnerName: text('partnerName').notNull(),
	kind: text('kind').notNull(),
	status: text('status').notNull().default('DRAFT'),
	scope: text('scope'),
	documentRef: text('documentRef'),
	signedAt: timestamp('signedAt', { precision: 3 }),
	signedByPartner: text('signedByPartner'),
	recordedBy: text('recordedBy').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	endedAt: timestamp('endedAt', { precision: 3 })
});

/** PKG-5 / I01: institutional accounts (collectivité, partners): aggregate statistics only, never a dossier. Active only under a SIGNED agreement. */
export const InstitutionAccount = pgTable('InstitutionAccount', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	email: text('email').notNull().unique(),
	passwordHash: text('passwordHash').notNull(),
	organisationName: text('organisationName').notNull(),
	territory: text('territory').notNull(),
	status: text('status').notNull().default('PENDING_AGREEMENT'),
	agreementId: text('agreementId'),
	createdBy: text('createdBy').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	lastLogin: timestamp('lastLogin', { precision: 3 }),
	failedLoginAttempts: integer('failedLoginAttempts').notNull().default(0),
	lockoutUntil: timestamp('lockoutUntil', { precision: 3 }),
	/** R24 / owner decision R21.1: the SHA-256 of the pending self-service reset link (never the token itself) and its expiry; NULL = no pending link */
	resetTokenHash: text('resetTokenHash'),
	resetExpiresAt: timestamp('resetExpiresAt', { precision: 3 })
}, (t) => ({
	'InstitutionAccount_resetTokenHash_key': uniqueIndex('InstitutionAccount_resetTokenHash_key').on(t.resetTokenHash),
	'InstitutionAccount_agreement_fkey': foreignKey({ name: 'InstitutionAccount_agreement_fkey', columns: [t.agreementId], foreignColumns: [PartnerAgreement.id] }).onDelete('restrict').onUpdate('cascade')
}));

/** PKG-5 / A12: assisted ownership recovery (the person lost access to their e-mail). One administrator proposes with the identity evidence, a DIFFERENT one decides. */
export const OwnershipRecoveryCase = pgTable('OwnershipRecoveryCase', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	citizenUserId: text('citizenUserId').notNull(),
	newEmailEncrypted: text('newEmailEncrypted').notNull(),
	evidenceNote: text('evidenceNote').notNull(),
	status: text('status').notNull().default('PROPOSED'),
	proposedBy: text('proposedBy').notNull(),
	proposedAt: timestamp('proposedAt', { precision: 3 }).notNull().defaultNow(),
	decidedBy: text('decidedBy'),
	decidedAt: timestamp('decidedAt', { precision: 3 }),
	decisionNote: text('decisionNote'),
	/** G12 (0058): decided by the proposer as the SOLE MFA administrator, after 24 h (the CHECK admits proposer = decider only then) */
	soleAdministrator: boolean('soleAdministrator').notNull().default(false)
}, (t) => ({
	'OwnershipRecoveryCase_user_fkey': foreignKey({ name: 'OwnershipRecoveryCase_user_fkey', columns: [t.citizenUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade')
}));

/** PKG-6 / D22 D19: human oversight queue for AI / automatic outputs before they reach the public (FALC drafts). Only public content: no personal data is stored here. */
export const AiOutputReview = pgTable('AiOutputReview', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	kind: text('kind').notNull(),
	entityType: text('entityType').notNull(),
	entityId: text('entityId').notNull(),
	field: text('field').notNull(),
	origin: text('origin').notNull(),
	model: text('model'),
	sourceTextHash: text('sourceTextHash').notNull(),
	outputText: text('outputText').notNull(),
	status: text('status').notNull().default('PENDING'),
	createdBy: text('createdBy').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	reviewedBy: text('reviewedBy'),
	reviewedAt: timestamp('reviewedAt', { precision: 3 }),
	reviewNote: text('reviewNote'),
	/** PKG-6 / R17: a dossier synthesis draft belongs to ONE shared dossier (deleted with it: erasure, expiry purge) and ONE organization (only its members see it). */
	sharedDiagnosticId: text('sharedDiagnosticId'),
	scopeStructureId: text('scopeStructureId')
}, (t) => ({
	'AiOutputReview_status_idx': index('AiOutputReview_status_idx').on(t.status, t.createdAt),
	'AiOutputReview_sharedDiagnostic_idx': index('AiOutputReview_sharedDiagnostic_idx').on(t.sharedDiagnosticId, t.scopeStructureId),
	'AiOutputReview_sharedDiagnostic_fkey': foreignKey({
		name: 'AiOutputReview_sharedDiagnostic_fkey',
		columns: [t.sharedDiagnosticId],
		foreignColumns: [SharedDiagnostic.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
}));

/**
 * R18 (R31) — ADA Pro « Sélections d'orientation »: a professional's working basket of verified public records (aides, démarches, lieux) organized around needs.
 * items: [{ key, kind: 'aide'|'demarche'|'structure', refId, followUp, addedAt }] — references and codes only; the label and the professional's reasons are in
 * privateEncrypted (sealed JSON, purpose orientation-basket, context basket:<id>). A basket holds no dossier data; a linked case is reached only through the
 * case's own grant and access rule (api/_services/orientation-basket.js).
 */
export const ProOrientationBasket = pgTable('ProOrientationBasket', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	structureId: text('structureId').notNull(),
	ownerProUserId: text('ownerProUserId'),
	caseId: text('caseId'),
	needCodes: text('needCodes').array().notNull().default(sql`ARRAY[]::text[]`),
	items: jsonb('items').notNull().default(sql`'[]'::jsonb`),
	privateEncrypted: text('privateEncrypted').notNull(),
	status: text('status').notNull().default('ACTIVE'),
	sharedAt: timestamp('sharedAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (t) => ({
	'ProOrientationBasket_structure_fkey': foreignKey({ name: 'ProOrientationBasket_structure_fkey', columns: [t.structureId], foreignColumns: [Structure.id] }).onDelete('cascade').onUpdate('cascade'),
	'ProOrientationBasket_owner_fkey': foreignKey({ name: 'ProOrientationBasket_owner_fkey', columns: [t.ownerProUserId], foreignColumns: [ProUser.id] }).onDelete('set null').onUpdate('cascade'),
	'ProOrientationBasket_case_fkey': foreignKey({ name: 'ProOrientationBasket_case_fkey', columns: [t.caseId], foreignColumns: [ProCase.id] }).onDelete('set null').onUpdate('cascade'),
	'ProOrientationBasket_owner_idx': index('ProOrientationBasket_owner_idx').on(t.structureId, t.ownerProUserId, t.status)
}));

/**
 * P27 (R31) — the publisher's funding-application workspace (« Dossiers de financement », administrators only). content holds the sections, the budget, the
 * financing plan, milestones and the supporting-document checklist; every save keeps the previous content in FundingDossierVersion. An amount or an award is
 * never assumed: an awarded line needs the funder's decision reference, a confirmed budget line its supporting document (api/_services/funding-dossiers.js).
 */
export const FundingDossier = pgTable('FundingDossier', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	funderName: text('funderName'),
	programmeName: text('programmeName'),
	programmeUrl: text('programmeUrl'),
	deadline: timestamp('deadline', { precision: 3 }),
	status: text('status').notNull().default('EN_PREPARATION'),
	content: jsonb('content').notNull().default(sql`'{}'::jsonb`),
	version: integer('version').notNull().default(1),
	decisionRef: text('decisionRef'),
	decisionAt: timestamp('decisionAt', { precision: 3 }),
	submittedAt: timestamp('submittedAt', { precision: 3 }),
	createdBy: text('createdBy').notNull(),
	updatedBy: text('updatedBy').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
});

export const FundingDossierVersion = pgTable('FundingDossierVersion', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	dossierId: text('dossierId').notNull(),
	version: integer('version').notNull(),
	status: text('status').notNull(),
	content: jsonb('content').notNull(),
	savedBy: text('savedBy').notNull(),
	note: text('note'),
	savedAt: timestamp('savedAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'FundingDossierVersion_dossier_fkey': foreignKey({ name: 'FundingDossierVersion_dossier_fkey', columns: [t.dossierId], foreignColumns: [FundingDossier.id] }).onDelete('cascade').onUpdate('cascade'),
	'FundingDossierVersion_dossier_version_key': uniqueIndex('FundingDossierVersion_dossier_version_key').on(t.dossierId, t.version)
}));

/**
 * Q14 (R31) — one observed task of the Strasbourg pilot (protocol docs/pilot/PROTOCOLE_PILOTE.md). No name, no contact — but pseudonymised, not anonymous:
 * participantCode is drawn from the server and written on the paper consent form that carries the name (kept by the publisher, outside the product).
 * assistiveTech can reveal a disability (GDPR art. 9): recorded only with a separate explicit consent. conductedAt keeps the day only. Recorded only with
 * consentRecorded = true; reported only as aggregates with small-number suppression (api/_services/pilot-measures.js).
 */
export const PilotSession = pgTable('PilotSession', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	protocolVersion: text('protocolVersion').notNull(),
	participantCode: text('participantCode').notNull(),
	journeyCode: text('journeyCode').notNull(),
	environment: text('environment').notNull().default('PRODUCTION'),
	deviceType: text('deviceType').notNull(),
	assistiveTech: text('assistiveTech'),
	outcome: text('outcome').notNull(),
	assistance: text('assistance').notNull(),
	durationSeconds: integer('durationSeconds'),
	errorCount: integer('errorCount').notNull().default(0),
	clarity: integer('clarity'),
	accessibilityIssues: text('accessibilityIssues').array().notNull().default(sql`ARRAY[]::text[]`),
	observation: text('observation'),
	consentRecorded: boolean('consentRecorded').notNull(),
	conductedAt: timestamp('conductedAt', { precision: 3 }).notNull(),
	recordedBy: text('recordedBy').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'PilotSession_journey_idx': index('PilotSession_journey_idx').on(t.journeyCode, t.protocolVersion),
	'PilotSession_consent_check': check('PilotSession_consent_check', sql`${t.consentRecorded} = true`)
}));

/**
 * X05 (expansion, migration 0056) — an inclusive job listing of an EMPLOYER = an existing Structure that ADA verified (E01: statut 'actif' AND
 * verification_status 'VERIFIED', checked again at submission, at approval and on every public read). Lifecycle: draft → pending (moderation) → published →
 * expired (its own end date) — or rejected (back to the employer, editable), withdrawn (by the employer) or taken_down (by the moderation). Required fields
 * only; the inclusive accommodations come from a closed list; the application goes through the EMPLOYER'S OWN channel (an https address or an e-mail): ADA
 * stores NOTHING about applicants (no table, no form, no click count). No column for a discriminatory criterion exists (Code du travail L1132-1; the service
 * refuses such fields). No column names the professional who wrote it (the audit trail does). Deleted with the Structure row (cascade).
 * Only writer: api/_services/job-board.js.
 */
export const JobListing = pgTable('JobListing', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	structureId: text('structureId').notNull(),
	status: text('status').notNull().default('draft'),
	title: text('title').notNull(),
	contractType: text('contractType').notNull(),
	city: text('city').notNull(),
	postalCode: text('postalCode').notNull(),
	description: text('description').notNull(),
	accommodations: text('accommodations').array().notNull(),
	applyMethod: text('applyMethod').notNull(),
	/** G13: erased (NULL) once the listing has ended — at organisation closure at once; the « end + 30 days » purge step is in the X05 opening package */
	applyTarget: text('applyTarget'),
	expiresOn: date('expiresOn', { mode: 'string' }).notNull(),
	moderationReason: text('moderationReason'),
	moderatedBy: text('moderatedBy'),
	moderatedAt: timestamp('moderatedAt', { precision: 3 }),
	submittedAt: timestamp('submittedAt', { precision: 3 }),
	publishedAt: timestamp('publishedAt', { precision: 3 }),
	withdrawnAt: timestamp('withdrawnAt', { precision: 3 }),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (t) => ({
	'JobListing_structure_fkey': foreignKey({ name: 'JobListing_structure_fkey', columns: [t.structureId], foreignColumns: [Structure.id] }).onDelete('cascade').onUpdate('cascade'),
	'JobListing_structure_idx': index('JobListing_structure_idx').on(t.structureId, t.createdAt),
	'JobListing_public_idx': index('JobListing_public_idx').on(t.status, t.expiresOn),
	'JobListing_status_check': check('JobListing_status_check', sql`${t.status} IN ('draft', 'pending', 'published', 'rejected', 'withdrawn', 'taken_down', 'expired')`),
	'JobListing_contract_check': check('JobListing_contract_check', sql`${t.contractType} IN ('CDI', 'CDD', 'CDDI', 'INTERIM', 'APPRENTISSAGE', 'PROFESSIONNALISATION', 'STAGE')`),
	'JobListing_length_check': check('JobListing_length_check', sql`char_length(${t.title}) BETWEEN 5 AND 120 AND char_length(${t.city}) BETWEEN 2 AND 80 AND char_length(${t.description}) BETWEEN 50 AND 3000`),
	'JobListing_postal_check': check('JobListing_postal_check', sql`${t.postalCode} ~ '^[0-9]{5}$'`),
	'JobListing_accommodations_check': check('JobListing_accommodations_check', sql`cardinality(${t.accommodations}) BETWEEN 1 AND 10 AND ${t.accommodations} <@ ARRAY['STEP_FREE_ACCESS', 'ADAPTED_WORKSTATION', 'FLEXIBLE_HOURS', 'PART_TIME_POSSIBLE', 'TUTOR_SUPPORT', 'EASY_READ_INSTRUCTIONS', 'SIGN_LANGUAGE_INTERPRETING', 'NO_DIPLOMA_REQUIRED', 'BEGINNERS_WELCOME', 'PUBLIC_TRANSPORT_ACCESS']::text[]`),
	'JobListing_apply_check': check('JobListing_apply_check', sql`${t.applyMethod} IN ('url', 'email') AND ((${t.applyTarget} IS NULL AND ${t.status} IN ('withdrawn', 'taken_down', 'expired')) OR (${t.applyTarget} IS NOT NULL AND char_length(${t.applyTarget}) BETWEEN 6 AND 300 AND (${t.applyMethod} <> 'url' OR ${t.applyTarget} ~ '^https://')))`),
	'JobListing_published_check': check('JobListing_published_check', sql`${t.status} <> 'published' OR (${t.publishedAt} IS NOT NULL AND ${t.moderatedBy} IS NOT NULL)`),
	'JobListing_reason_check': check('JobListing_reason_check', sql`${t.moderationReason} IS NULL OR ${t.moderationReason} IN ('DISCRIMINATORY_CRITERION', 'MISLEADING_OR_ENTITLEMENT', 'HEALTH_DATA_REQUESTED', 'APPLICATION_CHANNEL', 'NOT_A_JOB_OFFER', 'INCOMPLETE')`)
}));

/*
 * X03 (expansion, migration 0057) — ENTRAIDE: peer support between adults, under a PSEUDONYMOUS principal of its own (EntraideMember — never the X01 story
 * pseudonym, never the account). ⚠ A DEDICATED AIPD IS MANDATORY BEFORE ANY OPENING (matching people on their needs is a sensitive inference): capability
 * « community.entraide » (outside the AIPD), surface « entraide » opened by nothing. Privacy by design: CLOSED lists of practical help categories (no health,
 * disability, addiction, legal-status, religion, sexuality or ethnicity category) and of coarse areas (commune / quartier — never an address or a position); a
 * short logistics note only (≤ 280, no contact, no link, no money); NO scoring and no automatic matching: a person browses anonymous offers and asks; the
 * volunteer accepts; only then each side sees the other's pseudonym and MAY share an e-mail (explicit, revocable). No messaging. Everything is deleted with
 * the member (leaving Entraide) and so with the account (cascade). Only writer: api/_services/entraide.js.
 */
export const EntraideMember = pgTable('EntraideMember', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	citizenUserId: text('citizenUserId').notNull(),
	pseudonym: text('pseudonym').notNull(),
	status: text('status').notNull().default('active'),
	charterVersion: text('charterVersion').notNull(),
	charterAcceptedAt: timestamp('charterAcceptedAt', { precision: 3 }).notNull(),
	suspendedAt: timestamp('suspendedAt', { precision: 3 }),
	suspensionReason: text('suspensionReason'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (t) => ({
	'EntraideMember_user_fkey': foreignKey({ name: 'EntraideMember_user_fkey', columns: [t.citizenUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'EntraideMember_user_key': uniqueIndex('EntraideMember_user_key').on(t.citizenUserId),
	'EntraideMember_pseudonym_key': uniqueIndex('EntraideMember_pseudonym_key').on(sql`lower(${t.pseudonym})`),
	'EntraideMember_pseudonym_check': check('EntraideMember_pseudonym_check', sql`char_length(${t.pseudonym}) BETWEEN 3 AND 24 AND ${t.pseudonym} !~ '[@[:space:]]'`),
	'EntraideMember_status_check': check('EntraideMember_status_check', sql`(${t.status} = 'active' AND ${t.suspendedAt} IS NULL AND ${t.suspensionReason} IS NULL) OR (${t.status} = 'suspended' AND ${t.suspendedAt} IS NOT NULL AND ${t.suspensionReason} IS NOT NULL AND ${t.suspensionReason} IN ('HARASSMENT', 'MONEY_REQUEST', 'UNSAFE_BEHAVIOUR', 'INAPPROPRIATE_CONTENT', 'SENSITIVE_DATA', 'SPAM'))`)
}));

/** X03 (0057) — an offer of practical help by a member: a category and an area from closed lists, an optional logistics note (erased when it closes). */
export const EntraideOffer = pgTable('EntraideOffer', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	memberId: text('memberId').notNull(),
	category: text('category').notNull(),
	area: text('area').notNull(),
	note: text('note'),
	status: text('status').notNull().default('open'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	closedAt: timestamp('closedAt', { precision: 3 }),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (t) => ({
	'EntraideOffer_member_fkey': foreignKey({ name: 'EntraideOffer_member_fkey', columns: [t.memberId], foreignColumns: [EntraideMember.id] }).onDelete('cascade').onUpdate('cascade'),
	'EntraideOffer_member_idx': index('EntraideOffer_member_idx').on(t.memberId, t.createdAt),
	'EntraideOffer_browse_idx': index('EntraideOffer_browse_idx').on(t.status, t.category, t.area),
	'EntraideOffer_status_check': check('EntraideOffer_status_check', sql`${t.status} IN ('open', 'paused', 'closed')`),
	'EntraideOffer_category_check': check('EntraideOffer_category_check', sql`${t.category} IN ('ADMIN_APPOINTMENT', 'SHOPPING', 'DIGITAL_HELP', 'FRENCH_CONVERSATION', 'PET_CARE', 'MOVING_HELP')`),
	'EntraideOffer_area_check': check('EntraideOffer_area_check', sql`${t.area} IN ('STRASBOURG_CENTRE', 'STRASBOURG_GARE', 'STRASBOURG_KRUTENAU_ESPLANADE', 'STRASBOURG_ORANGERIE_CONSEIL_DES_XV', 'STRASBOURG_ROBERTSAU_WACKEN', 'STRASBOURG_CRONENBOURG', 'STRASBOURG_HAUTEPIERRE_POTERIES', 'STRASBOURG_KOENIGSHOFFEN_MONTAGNE_VERTE_ELSAU', 'STRASBOURG_MEINAU', 'STRASBOURG_NEUDORF_PORT_DU_RHIN', 'STRASBOURG_NEUHOF', 'SCHILTIGHEIM', 'BISCHHEIM', 'HOENHEIM', 'ILLKIRCH_GRAFFENSTADEN', 'LINGOLSHEIM', 'OSTWALD', 'AUTRE_EUROMETROPOLE')`),
	'EntraideOffer_note_check': check('EntraideOffer_note_check', sql`(${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND 280) AND (${t.status} <> 'closed' OR (${t.note} IS NULL AND ${t.closedAt} IS NOT NULL))`)
}));

/**
 * X03 (0057) — a request for help, sent by a member ON ONE OFFER (never a published need): an optional logistics note, the state of the double opt-in
 * (pending → accepted by the volunteer, or declined / withdrawn / ended). The note exists only while pending or accepted. One active request per offer and person.
 */
export const EntraideRequest = pgTable('EntraideRequest', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	offerId: text('offerId').notNull(),
	requesterId: text('requesterId').notNull(),
	note: text('note'),
	status: text('status').notNull().default('pending'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	decidedAt: timestamp('decidedAt', { precision: 3 }),
	closedAt: timestamp('closedAt', { precision: 3 }),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (t) => ({
	'EntraideRequest_offer_fkey': foreignKey({ name: 'EntraideRequest_offer_fkey', columns: [t.offerId], foreignColumns: [EntraideOffer.id] }).onDelete('cascade').onUpdate('cascade'),
	'EntraideRequest_requester_fkey': foreignKey({ name: 'EntraideRequest_requester_fkey', columns: [t.requesterId], foreignColumns: [EntraideMember.id] }).onDelete('cascade').onUpdate('cascade'),
	'EntraideRequest_active_key': uniqueIndex('EntraideRequest_active_key').on(t.offerId, t.requesterId).where(sql`${t.status} IN ('pending', 'accepted')`),
	'EntraideRequest_requester_idx': index('EntraideRequest_requester_idx').on(t.requesterId, t.createdAt),
	'EntraideRequest_status_check': check('EntraideRequest_status_check', sql`${t.status} IN ('pending', 'accepted', 'declined', 'withdrawn', 'ended')`),
	'EntraideRequest_note_check': check('EntraideRequest_note_check', sql`(${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND 280) AND (${t.note} IS NULL OR ${t.status} IN ('pending', 'accepted'))`)
}));

/** X03 (0057) — the e-mail ONE side chose to show to the other on an ACCEPTED request (explicit, revocable: revoking deletes the row; ending the request too). */
export const EntraideContactShare = pgTable('EntraideContactShare', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	requestId: text('requestId').notNull(),
	memberId: text('memberId').notNull(),
	email: text('email').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'EntraideContactShare_request_fkey': foreignKey({ name: 'EntraideContactShare_request_fkey', columns: [t.requestId], foreignColumns: [EntraideRequest.id] }).onDelete('cascade').onUpdate('cascade'),
	'EntraideContactShare_member_fkey': foreignKey({ name: 'EntraideContactShare_member_fkey', columns: [t.memberId], foreignColumns: [EntraideMember.id] }).onDelete('cascade').onUpdate('cascade'),
	'EntraideContactShare_once_key': uniqueIndex('EntraideContactShare_once_key').on(t.requestId, t.memberId),
	'EntraideContactShare_email_check': check('EntraideContactShare_email_check', sql`char_length(${t.email}) BETWEEN 6 AND 254 AND ${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`)
}));

/** X03 (0057) — a report of one member about another (reason from a closed list, no free text), once per pair; the moderator sees counts, never who. */
export const EntraideReport = pgTable('EntraideReport', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	reporterId: text('reporterId').notNull(),
	targetId: text('targetId').notNull(),
	reason: text('reason').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'EntraideReport_reporter_fkey': foreignKey({ name: 'EntraideReport_reporter_fkey', columns: [t.reporterId], foreignColumns: [EntraideMember.id] }).onDelete('cascade').onUpdate('cascade'),
	'EntraideReport_target_fkey': foreignKey({ name: 'EntraideReport_target_fkey', columns: [t.targetId], foreignColumns: [EntraideMember.id] }).onDelete('cascade').onUpdate('cascade'),
	'EntraideReport_once_key': uniqueIndex('EntraideReport_once_key').on(t.reporterId, t.targetId),
	'EntraideReport_target_idx': index('EntraideReport_target_idx').on(t.targetId),
	'EntraideReport_reporter_idx': index('EntraideReport_reporter_idx').on(t.reporterId, t.createdAt),
	'EntraideReport_reason_check': check('EntraideReport_reason_check', sql`${t.reason} IN ('HARASSMENT', 'MONEY_REQUEST', 'UNSAFE_BEHAVIOUR', 'INAPPROPRIATE_CONTENT', 'SENSITIVE_DATA', 'SPAM')`),
	'EntraideReport_self_check': check('EntraideReport_self_check', sql`${t.reporterId} <> ${t.targetId}`)
}));

/** X03 (0057) — a block: the two members no longer see each other's offers and cannot ask each other; active requests between them end. */
export const EntraideBlock = pgTable('EntraideBlock', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	blockerId: text('blockerId').notNull(),
	blockedId: text('blockedId').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'EntraideBlock_blocker_fkey': foreignKey({ name: 'EntraideBlock_blocker_fkey', columns: [t.blockerId], foreignColumns: [EntraideMember.id] }).onDelete('cascade').onUpdate('cascade'),
	'EntraideBlock_blocked_fkey': foreignKey({ name: 'EntraideBlock_blocked_fkey', columns: [t.blockedId], foreignColumns: [EntraideMember.id] }).onDelete('cascade').onUpdate('cascade'),
	'EntraideBlock_pair_key': uniqueIndex('EntraideBlock_pair_key').on(t.blockerId, t.blockedId),
	'EntraideBlock_blocked_idx': index('EntraideBlock_blocked_idx').on(t.blockedId),
	'EntraideBlock_self_check': check('EntraideBlock_self_check', sql`${t.blockerId} <> ${t.blockedId}`)
}));

/**
 * G14 (migration 0059) — moderation staffing and DSA flows for the expansion content (X01 stories, X02 testimonials, X05 job listings, X03 Entraide).
 * Only writer: api/_services/moderation-dsa.js. Nothing here opens a feature: the capabilities stay closed until the owner opens them, and the services
 * refuse (fail closed) while no NAMED person holds the role a function needs.
 *   ModerationRole      a role held by an EXISTING administrator account (named, MFA): MODERATOR (X01, X02, X05, X03) or ENTRAIDE_SAFETY_OFFICER (X03).
 *   ContentNotice       a notice sent WITHOUT an account (DSA art. 16): the public form, or an e-mail to the contact address recorded by a moderator.
 *   ModerationDecision  the statement of reasons of every restriction and of every decision on a notice or a report (DSA art. 16(5), 17).
 *   ModerationAppeal    the internal complaint against a decision, six months (DSA art. 20, owner decision 30).
 *   ModerationSanction  a warning, then a time-limited suspension, for repeated misuse (DSA art. 23).
 */
export const ModerationRole = pgTable('ModerationRole', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	adminUserId: text('adminUserId').notNull(),
	role: text('role').notNull(),
	charterAcknowledgedAt: timestamp('charterAcknowledgedAt', { precision: 3 }).notNull(),
	assignedBy: text('assignedBy').notNull(),
	assignedAt: timestamp('assignedAt', { precision: 3 }).notNull().defaultNow(),
	revokedAt: timestamp('revokedAt', { precision: 3 }),
	revokedBy: text('revokedBy')
}, (t) => ({
	'ModerationRole_admin_fkey': foreignKey({ name: 'ModerationRole_admin_fkey', columns: [t.adminUserId], foreignColumns: [AdminUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'ModerationRole_active_key': uniqueIndex('ModerationRole_active_key').on(t.adminUserId, t.role).where(sql`${t.revokedAt} IS NULL`),
	'ModerationRole_role_check': check('ModerationRole_role_check', sql`${t.role} IN ('MODERATOR', 'ENTRAIDE_SAFETY_OFFICER')`),
	'ModerationRole_revoke_check': check('ModerationRole_revoke_check', sql`(${t.revokedAt} IS NULL) = (${t.revokedBy} IS NULL)`)
}));

export const ContentNotice = pgTable('ContentNotice', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	channel: text('channel').notNull(),
	contentType: text('contentType').notNull(),
	contentRef: text('contentRef').notNull(),
	category: text('category').notNull(),
	explanation: text('explanation').notNull(),
	notifierName: text('notifierName'),
	notifierEmail: text('notifierEmail'),
	notifierKey: text('notifierKey'),
	goodFaith: boolean('goodFaith').notNull(),
	declaredTrustedFlagger: boolean('declaredTrustedFlagger').notNull().default(false),
	priority: text('priority').notNull().default('ordinary'),
	status: text('status').notNull().default('received'),
	outcome: text('outcome'),
	decisionId: text('decisionId'),
	appealTokenHash: text('appealTokenHash'),
	acknowledgedAt: timestamp('acknowledgedAt', { precision: 3 }),
	decidedAt: timestamp('decidedAt', { precision: 3 }),
	decidedBy: text('decidedBy'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (t) => ({
	'ContentNotice_queue_idx': index('ContentNotice_queue_idx').on(t.status, t.priority, t.createdAt),
	'ContentNotice_notifier_idx': index('ContentNotice_notifier_idx').on(t.notifierKey, t.createdAt),
	'ContentNotice_channel_check': check('ContentNotice_channel_check', sql`${t.channel} IN ('public_form', 'email')`),
	'ContentNotice_type_check': check('ContentNotice_type_check', sql`${t.contentType} IN ('testimonial', 'story', 'job_listing', 'entraide', 'other')`),
	'ContentNotice_category_check': check('ContentNotice_category_check', sql`${t.category} IN ('ILLEGAL_CONTENT', 'TERMS_VIOLATION', 'SAFETY_THREAT', 'CHILD_SAFETY')`),
	'ContentNotice_length_check': check('ContentNotice_length_check', sql`char_length(${t.contentRef}) BETWEEN 3 AND 500 AND char_length(${t.explanation}) BETWEEN 20 AND 3000 AND (${t.notifierName} IS NULL OR char_length(${t.notifierName}) BETWEEN 2 AND 120) AND (${t.notifierEmail} IS NULL OR (char_length(${t.notifierEmail}) BETWEEN 6 AND 254 AND ${t.notifierEmail} ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'))`),
	// DSA art. 16(2)(c): name and e-mail are required, except for a notice about the offences of Directive 2011/93/EU (CHILD_SAFETY)
	'ContentNotice_identity_check': check('ContentNotice_identity_check', sql`${t.category} = 'CHILD_SAFETY' OR (${t.notifierName} IS NOT NULL AND ${t.notifierEmail} IS NOT NULL)`),
	'ContentNotice_good_faith_check': check('ContentNotice_good_faith_check', sql`${t.goodFaith} = true`),
	'ContentNotice_priority_check': check('ContentNotice_priority_check', sql`${t.priority} IN ('urgent', 'trusted', 'ordinary')`),
	// null-safe (G14 QA v30 finding): a NULL outcome / response made the whole rule NULL, which a CHECK accepts
	'ContentNotice_status_check': check('ContentNotice_status_check', sql`(${t.status} = 'received' AND ${t.outcome} IS NULL AND ${t.decidedAt} IS NULL) OR (${t.status} = 'decided' AND ${t.outcome} IS NOT NULL AND ${t.outcome} IN ('action_taken', 'no_action', 'not_processed') AND ${t.decidedAt} IS NOT NULL AND ${t.decidedBy} IS NOT NULL)`)
}));

export const ModerationDecision = pgTable('ModerationDecision', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	contentType: text('contentType').notNull(),
	contentId: text('contentId').notNull(),
	action: text('action').notNull(),
	reasonCode: text('reasonCode').notNull(),
	facts: text('facts').notNull(),
	legalGround: text('legalGround'),
	termsClause: text('termsClause').notNull(),
	source: text('source').notNull(),
	automated: boolean('automated').notNull().default(false),
	manifestlyIllegal: boolean('manifestlyIllegal').notNull().default(false),
	restrictionEndsAt: timestamp('restrictionEndsAt', { precision: 3 }),
	subjectUserId: text('subjectUserId'),
	subjectStructureId: text('subjectStructureId'),
	notifierUserIds: text('notifierUserIds').array().notNull().default(sql`ARRAY[]::text[]`),
	noticeId: text('noticeId'),
	decidedBy: text('decidedBy').notNull(),
	decidedAt: timestamp('decidedAt', { precision: 3 }).notNull().defaultNow(),
	appealUntil: timestamp('appealUntil', { precision: 3 }).notNull(),
	statementChannel: text('statementChannel').notNull().default('none'),
	statementSentAt: timestamp('statementSentAt', { precision: 3 }),
	authoritiesInformedAt: timestamp('authoritiesInformedAt', { precision: 3 })
}, (t) => ({
	'ModerationDecision_subject_fkey': foreignKey({ name: 'ModerationDecision_subject_fkey', columns: [t.subjectUserId], foreignColumns: [CitizenUser.id] }).onDelete('set null').onUpdate('cascade'),
	'ModerationDecision_structure_fkey': foreignKey({ name: 'ModerationDecision_structure_fkey', columns: [t.subjectStructureId], foreignColumns: [Structure.id] }).onDelete('set null').onUpdate('cascade'),
	'ModerationDecision_notice_fkey': foreignKey({ name: 'ModerationDecision_notice_fkey', columns: [t.noticeId], foreignColumns: [ContentNotice.id] }).onDelete('set null').onUpdate('cascade'),
	'ModerationDecision_content_idx': index('ModerationDecision_content_idx').on(t.contentType, t.contentId),
	'ModerationDecision_subject_idx': index('ModerationDecision_subject_idx').on(t.subjectUserId, t.decidedAt),
	'ModerationDecision_type_check': check('ModerationDecision_type_check', sql`${t.contentType} IN ('testimonial', 'story', 'job_listing', 'entraide_member', 'entraide_offer', 'notice')`),
	'ModerationDecision_action_check': check('ModerationDecision_action_check', sql`${t.action} IN ('rejected', 'taken_down', 'offer_closed', 'member_suspended', 'member_reinstated', 'reports_dismissed', 'notice_no_action')`),
	'ModerationDecision_source_check': check('ModerationDecision_source_check', sql`${t.source} IN ('notice', 'report', 'own_initiative', 'pre_publication_review')`),
	// DSA art. 17(3)(c): a person decides, never an automaton
	'ModerationDecision_human_check': check('ModerationDecision_human_check', sql`${t.automated} = false`),
	'ModerationDecision_length_check': check('ModerationDecision_length_check', sql`char_length(${t.facts}) BETWEEN 10 AND 2000 AND char_length(${t.termsClause}) BETWEEN 3 AND 300 AND (${t.legalGround} IS NULL OR char_length(${t.legalGround}) BETWEEN 3 AND 1000)`),
	'ModerationDecision_illegal_check': check('ModerationDecision_illegal_check', sql`${t.manifestlyIllegal} = false OR ${t.legalGround} IS NOT NULL`),
	'ModerationDecision_channel_check': check('ModerationDecision_channel_check', sql`${t.statementChannel} IN ('email', 'in_app', 'none') AND ((${t.statementChannel} = 'none') = (${t.statementSentAt} IS NULL))`)
}));

export const ModerationAppeal = pgTable('ModerationAppeal', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	decisionId: text('decisionId').notNull(),
	appellantKind: text('appellantKind').notNull(),
	appellantUserId: text('appellantUserId'),
	noticeId: text('noticeId'),
	body: text('body').notNull(),
	status: text('status').notNull().default('open'),
	response: text('response'),
	reviewedBy: text('reviewedBy'),
	reviewedAt: timestamp('reviewedAt', { precision: 3 }),
	soleModerator: boolean('soleModerator').notNull().default(false),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'ModerationAppeal_decision_fkey': foreignKey({ name: 'ModerationAppeal_decision_fkey', columns: [t.decisionId], foreignColumns: [ModerationDecision.id] }).onDelete('cascade').onUpdate('cascade'),
	'ModerationAppeal_user_fkey': foreignKey({ name: 'ModerationAppeal_user_fkey', columns: [t.appellantUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'ModerationAppeal_notice_fkey': foreignKey({ name: 'ModerationAppeal_notice_fkey', columns: [t.noticeId], foreignColumns: [ContentNotice.id] }).onDelete('cascade').onUpdate('cascade'),
	'ModerationAppeal_user_once_key': uniqueIndex('ModerationAppeal_user_once_key').on(t.decisionId, t.appellantUserId).where(sql`${t.appellantUserId} IS NOT NULL`),
	'ModerationAppeal_notice_once_key': uniqueIndex('ModerationAppeal_notice_once_key').on(t.decisionId, t.noticeId).where(sql`${t.noticeId} IS NOT NULL`),
	'ModerationAppeal_queue_idx': index('ModerationAppeal_queue_idx').on(t.status, t.createdAt),
	'ModerationAppeal_kind_check': check('ModerationAppeal_kind_check', sql`${t.appellantKind} IN ('author', 'notifier') AND ((${t.appellantUserId} IS NOT NULL) <> (${t.noticeId} IS NOT NULL))`),
	'ModerationAppeal_body_check': check('ModerationAppeal_body_check', sql`char_length(${t.body}) BETWEEN 10 AND 2000`),
	'ModerationAppeal_status_check': check('ModerationAppeal_status_check', sql`(${t.status} = 'open' AND ${t.reviewedAt} IS NULL) OR (${t.status} IN ('upheld', 'reversed', 'modified') AND ${t.reviewedAt} IS NOT NULL AND ${t.reviewedBy} IS NOT NULL AND ${t.response} IS NOT NULL AND char_length(${t.response}) BETWEEN 10 AND 2000)`)
}));

export const ModerationSanction = pgTable('ModerationSanction', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	subjectUserId: text('subjectUserId'),
	notifierKey: text('notifierKey'),
	scope: text('scope').notNull(),
	kind: text('kind').notNull(),
	reason: text('reason').notNull(),
	createdBy: text('createdBy').notNull(),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	endsAt: timestamp('endsAt', { precision: 3 }),
	liftedAt: timestamp('liftedAt', { precision: 3 }),
	liftedBy: text('liftedBy')
}, (t) => ({
	'ModerationSanction_user_fkey': foreignKey({ name: 'ModerationSanction_user_fkey', columns: [t.subjectUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'ModerationSanction_user_idx': index('ModerationSanction_user_idx').on(t.subjectUserId, t.scope),
	'ModerationSanction_key_idx': index('ModerationSanction_key_idx').on(t.notifierKey, t.scope),
	'ModerationSanction_subject_check': check('ModerationSanction_subject_check', sql`(${t.subjectUserId} IS NOT NULL) <> (${t.notifierKey} IS NOT NULL)`),
	'ModerationSanction_scope_check': check('ModerationSanction_scope_check', sql`${t.scope} IN ('publishing', 'notices')`),
	'ModerationSanction_kind_check': check('ModerationSanction_kind_check', sql`(${t.kind} = 'warning' AND ${t.endsAt} IS NULL) OR (${t.kind} = 'suspension' AND ${t.endsAt} IS NOT NULL AND ${t.endsAt} > ${t.createdAt})`),
	'ModerationSanction_reason_check': check('ModerationSanction_reason_check', sql`char_length(${t.reason}) BETWEEN 10 AND 1000`),
	'ModerationSanction_lift_check': check('ModerationSanction_lift_check', sql`(${t.liftedAt} IS NULL) = (${t.liftedBy} IS NULL)`)
}));

/**
 * G14-PS (owner decision 23/11/2026) — the SOCIAL referral (« orientation sociale »), non-HDS by construction: closed reasons (1 to 3), no free text, no
 * document, only between organisations classified NOT_ESSMS (api/lib/social-referral-policy.js), with the person's consent. Separate from "Referral" (the
 * HDS referral of a dossier, closed until certified hosting): that table requires a shared dossier and its grant. Migration drizzle/0061_g14_ps_social_referrals.sql
 * (NOT in the journal yet — numbered after g14-ai's 0060; the owner runs it). The code answers SOCIAL_REFERRALS_NOT_AVAILABLE on a database without it.
 */
export const SocialReferral = pgTable('SocialReferral', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	fromStructureId: text('fromStructureId').notNull(),
	toStructureId: text('toStructureId').notNull(),
	createdByProUserId: text('createdByProUserId'),
	/** NULL until the person enters the code in Mon Espace (or consents on the professional's screen) */
	citizenId: text('citizenId'),
	status: text('status').notNull().default('PENDING_CITIZEN'),
	reasonCodes: text('reasonCodes').array().notNull(),
	responseCode: text('responseCode'),
	/** sha256 of the one-time code given to the person (the code itself is never stored); cleared once used */
	claimCodeHash: text('claimCodeHash').unique(),
	claimExpiresAt: timestamp('claimExpiresAt', { precision: 3 }),
	shareEmail: boolean('shareEmail').notNull().default(false),
	sharePhone: boolean('sharePhone').notNull().default(false),
	consentChannel: text('consentChannel'),
	citizenDecisionAt: timestamp('citizenDecisionAt', { precision: 3 }),
	sentAt: timestamp('sentAt', { precision: 3 }),
	dueAt: timestamp('dueAt', { precision: 3 }),
	overdueNotifiedAt: timestamp('overdueNotifiedAt', { precision: 3 }),
	respondedAt: timestamp('respondedAt', { precision: 3 }),
	closedAt: timestamp('closedAt', { precision: 3 }),
	idempotencyKey: text('idempotencyKey'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (t) => ({
	'SocialReferral_from_fkey': foreignKey({ name: 'SocialReferral_from_fkey', columns: [t.fromStructureId], foreignColumns: [Structure.id] }).onDelete('cascade').onUpdate('cascade'),
	'SocialReferral_to_fkey': foreignKey({ name: 'SocialReferral_to_fkey', columns: [t.toStructureId], foreignColumns: [Structure.id] }).onDelete('cascade').onUpdate('cascade'),
	'SocialReferral_creator_fkey': foreignKey({ name: 'SocialReferral_creator_fkey', columns: [t.createdByProUserId], foreignColumns: [ProUser.id] }).onDelete('set null').onUpdate('cascade'),
	'SocialReferral_citizen_fkey': foreignKey({ name: 'SocialReferral_citizen_fkey', columns: [t.citizenId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'SocialReferral_idempotency_key': uniqueIndex('SocialReferral_idempotency_key').on(t.fromStructureId, t.idempotencyKey),
	'SocialReferral_to_status_idx': index('SocialReferral_to_status_idx').on(t.toStructureId, t.status),
	'SocialReferral_from_idx': index('SocialReferral_from_idx').on(t.fromStructureId),
	'SocialReferral_citizen_idx': index('SocialReferral_citizen_idx').on(t.citizenId),
	'SocialReferral_status_check': check('SocialReferral_status_check', sql`${t.status} IN ('PENDING_CITIZEN', 'SENT', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'CANCELLED', 'WITHDRAWN', 'EXPIRED', 'CLOSED')`),
	'SocialReferral_reasons_check': check('SocialReferral_reasons_check', sql`cardinality(${t.reasonCodes}) BETWEEN 1 AND 3 AND ${t.reasonCodes} <@ ARRAY['HOUSING', 'EMPLOYMENT', 'TRAINING', 'INCOME_BUDGET', 'ENERGY', 'ADMIN_PROCEDURES', 'ACCESS_TO_RIGHTS', 'MOBILITY', 'DIGITAL', 'FOOD']::text[]`),
	'SocialReferral_response_check': check('SocialReferral_response_check', sql`(${t.responseCode} IS NULL AND ${t.status} <> 'DECLINED') OR (${t.status} = 'DECLINED' AND ${t.responseCode} IS NOT NULL AND ${t.responseCode} IN ('OUT_OF_SCOPE', 'NO_CAPACITY', 'ALREADY_SUPPORTED', 'OUT_OF_TERRITORY'))`),
	'SocialReferral_channel_check': check('SocialReferral_channel_check', sql`${t.consentChannel} IS NULL OR ${t.consentChannel} IN ('MON_ESPACE', 'ASSISTED_ON_SCREEN')`),
	'SocialReferral_distinct_check': check('SocialReferral_distinct_check', sql`${t.fromStructureId} <> ${t.toStructureId}`),
	'SocialReferral_consent_check': check('SocialReferral_consent_check', sql`${t.status} NOT IN ('SENT', 'ACCEPTED', 'DECLINED', 'COMPLETED', 'WITHDRAWN') OR (${t.citizenId} IS NOT NULL AND ${t.citizenDecisionAt} IS NOT NULL AND ${t.consentChannel} IS NOT NULL AND ${t.sentAt} IS NOT NULL)`),
	'SocialReferral_closed_check': check('SocialReferral_closed_check', sql`(${t.status} IN ('PENDING_CITIZEN', 'SENT', 'ACCEPTED')) = (${t.closedAt} IS NULL)`)
}));

/** G14-PS: append-only history of a social referral (transition, actor side, time; the channel of an assisted consent). */
export const SocialReferralEvent = pgTable('SocialReferralEvent', {
	id: text('id').notNull().primaryKey().$defaultFn(() => crypto.randomUUID()),
	referralId: text('referralId').notNull(),
	actorType: text('actorType').notNull(),
	actorId: text('actorId'),
	fromStatus: text('fromStatus'),
	toStatus: text('toStatus').notNull(),
	channel: text('channel'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'SocialReferralEvent_referral_fkey': foreignKey({ name: 'SocialReferralEvent_referral_fkey', columns: [t.referralId], foreignColumns: [SocialReferral.id] }).onDelete('cascade').onUpdate('cascade'),
	'SocialReferralEvent_referral_idx': index('SocialReferralEvent_referral_idx').on(t.referralId, t.createdAt),
	'SocialReferralEvent_actor_check': check('SocialReferralEvent_actor_check', sql`${t.actorType} IN ('SENDER', 'RECEIVER', 'CITIZEN', 'SYSTEM')`)
}));

/** G14-R3G (migration 0064): the representative of a protected adult under a court measure — facts extracted by the administrator, never the decision itself. */
export const LegalProtectionMandate = pgTable('LegalProtectionMandate', {
	id: text('id').notNull().primaryKey(),
	protectedUserId: text('protectedUserId').notNull(),
	representativeUserId: text('representativeUserId').notNull(),
	representativeKind: text('representativeKind').notNull(),
	mjpmForm: text('mjpmForm'),
	structureId: text('structureId'),
	siret: text('siret'),
	measure: text('measure').notNull(),
	mode: text('mode').notNull(),
	scopePerson: boolean('scopePerson').notNull().default(false),
	scopeAssets: boolean('scopeAssets').notNull().default(false),
	areas: text('areas').array().notNull().default(sql`'{}'::text[]`),
	courtName: text('courtName').notNull(),
	decisionDate: date('decisionDate', { mode: 'string' }).notNull(),
	measureEndsOn: date('measureEndsOn', { mode: 'string' }),
	validUntil: date('validUntil', { mode: 'string' }),
	decisionRefHmac: text('decisionRefHmac'),
	status: text('status').notNull().default('DECLARED'),
	personContestedAt: timestamp('personContestedAt', { precision: 3 }),
	verifiedAt: timestamp('verifiedAt', { precision: 3 }),
	verifiedBy: text('verifiedBy'),
	verificationMethod: text('verificationMethod'),
	verificationNote: text('verificationNote'),
	endedAt: timestamp('endedAt', { precision: 3 }),
	endedBy: text('endedBy'),
	endReason: text('endReason'),
	createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
	updatedAt: timestamp('updatedAt', { precision: 3 }).notNull().defaultNow()
}, (t) => ({
	'LegalProtectionMandate_protected_fkey': foreignKey({ name: 'LegalProtectionMandate_protected_fkey', columns: [t.protectedUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'LegalProtectionMandate_representative_fkey': foreignKey({ name: 'LegalProtectionMandate_representative_fkey', columns: [t.representativeUserId], foreignColumns: [CitizenUser.id] }).onDelete('cascade').onUpdate('cascade'),
	'LegalProtectionMandate_structure_fkey': foreignKey({ name: 'LegalProtectionMandate_structure_fkey', columns: [t.structureId], foreignColumns: [Structure.id] }).onDelete('set null').onUpdate('cascade'),
	'LegalProtectionMandate_protected_idx': index('LegalProtectionMandate_protected_idx').on(t.protectedUserId),
	'LegalProtectionMandate_representative_idx': index('LegalProtectionMandate_representative_idx').on(t.representativeUserId),
	'LegalProtectionMandate_status_idx': index('LegalProtectionMandate_status_idx').on(t.status),
	'LegalProtectionMandate_live_key': uniqueIndex('LegalProtectionMandate_live_key').on(t.protectedUserId, t.representativeUserId).where(sql`"status" IN ('DECLARED', 'VERIFIED', 'SUSPENDED')`),
	'LegalProtectionMandate_not_self_check': check('LegalProtectionMandate_not_self_check', sql`"protectedUserId" <> "representativeUserId"`),
	'LegalProtectionMandate_kind_check': check('LegalProtectionMandate_kind_check', sql`"representativeKind" IN ('FAMILLE', 'MJPM')`),
	'LegalProtectionMandate_mjpm_form_check': check('LegalProtectionMandate_mjpm_form_check', sql`("representativeKind" = 'MJPM') = ("mjpmForm" IS NOT NULL) AND ("mjpmForm" IS NULL OR "mjpmForm" IN ('SERVICE', 'INDIVIDUEL', 'PREPOSE'))`),
	'LegalProtectionMandate_pro_fields_check': check('LegalProtectionMandate_pro_fields_check', sql`"representativeKind" = 'MJPM' OR ("structureId" IS NULL AND "siret" IS NULL)`),
	'LegalProtectionMandate_siret_check': check('LegalProtectionMandate_siret_check', sql`"siret" IS NULL OR "siret" ~ '^[0-9]{14}$'`),
	'LegalProtectionMandate_measure_check': check('LegalProtectionMandate_measure_check', sql`"measure" IN ('TUTELLE', 'CURATELLE_SIMPLE', 'CURATELLE_RENFORCEE', 'CURATELLE_AMENAGEE', 'HABILITATION_FAMILIALE_GENERALE', 'HABILITATION_FAMILIALE_SPECIALE', 'SAUVEGARDE_MANDAT_SPECIAL')`),
	'LegalProtectionMandate_mode_check': check('LegalProtectionMandate_mode_check', sql`"mode" IN ('REPRESENTATION', 'ASSISTANCE')`),
	'LegalProtectionMandate_measure_mode_check': check('LegalProtectionMandate_measure_mode_check', sql`("measure" <> 'TUTELLE' OR "mode" = 'REPRESENTATION') AND ("measure" NOT LIKE 'CURATELLE_%' OR "mode" = 'ASSISTANCE')`),
	'LegalProtectionMandate_habilitation_family_check': check('LegalProtectionMandate_habilitation_family_check', sql`"measure" NOT LIKE 'HABILITATION_FAMILIALE_%' OR "representativeKind" = 'FAMILLE'`),
	'LegalProtectionMandate_scope_check': check('LegalProtectionMandate_scope_check', sql`"scopePerson" OR "scopeAssets"`),
	'LegalProtectionMandate_areas_check': check('LegalProtectionMandate_areas_check', sql`"areas" <@ ARRAY['RDV', 'PARCOURS']::text[]`),
	'LegalProtectionMandate_court_check': check('LegalProtectionMandate_court_check', sql`char_length("courtName") BETWEEN 3 AND 120`),
	'LegalProtectionMandate_dates_check': check('LegalProtectionMandate_dates_check', sql`("measureEndsOn" IS NULL OR "measureEndsOn" > "decisionDate") AND ("validUntil" IS NULL OR "validUntil" > "decisionDate")`),
	'LegalProtectionMandate_term_check': check('LegalProtectionMandate_term_check', sql`"measure" = 'HABILITATION_FAMILIALE_SPECIALE' OR "measureEndsOn" IS NOT NULL`),
	'LegalProtectionMandate_status_check': check('LegalProtectionMandate_status_check', sql`"status" IN ('DECLARED', 'VERIFIED', 'SUSPENDED', 'REJECTED', 'ENDED')`),
	'LegalProtectionMandate_verified_check': check('LegalProtectionMandate_verified_check', sql`"status" NOT IN ('VERIFIED', 'SUSPENDED') OR ("verifiedAt" IS NOT NULL AND "verifiedBy" IS NOT NULL AND "verificationMethod" IS NOT NULL AND "validUntil" IS NOT NULL AND cardinality("areas") >= 1)`),
	'LegalProtectionMandate_method_check': check('LegalProtectionMandate_method_check', sql`"verificationMethod" IS NULL OR "verificationMethod" IN ('ORIGINAL_SHOWN', 'CERTIFIED_COPY_EXAMINED', 'COURT_CONFIRMATION')`),
	'LegalProtectionMandate_note_check': check('LegalProtectionMandate_note_check', sql`"verificationNote" IS NULL OR (char_length("verificationNote") BETWEEN 10 AND 500 AND "verificationNote" !~ '[<>]')`),
	'LegalProtectionMandate_ended_check': check('LegalProtectionMandate_ended_check', sql`("status" IN ('REJECTED', 'ENDED')) = ("endedAt" IS NOT NULL) AND ("endedAt" IS NULL OR ("endedBy" IS NOT NULL AND "endReason" IS NOT NULL))`),
	'LegalProtectionMandate_ended_by_check': check('LegalProtectionMandate_ended_by_check', sql`"endedBy" IS NULL OR "endedBy" IN ('REPRESENTATIVE', 'ADMIN')`),
	'LegalProtectionMandate_end_reason_check': check('LegalProtectionMandate_end_reason_check', sql`"endReason" IS NULL OR "endReason" IN ('RENOUNCED', 'NOT_VERIFIED', 'MAINLEVEE', 'MEASURE_CHANGED', 'CONTEST_UPHELD', 'DECEASED', 'OTHER')`),
	'LegalProtectionMandate_hmac_check': check('LegalProtectionMandate_hmac_check', sql`"decisionRefHmac" IS NULL OR "decisionRefHmac" ~ '^[0-9a-f]{64}$'`)
}));
