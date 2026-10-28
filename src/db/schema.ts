import crypto from 'node:crypto';
import { relations, sql } from 'drizzle-orm'
import { boolean, check, doublePrecision, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, vector } from 'drizzle-orm/pg-core'
import { sealedJson } from './sealed-json.js'

export const ContentType = pgEnum('ContentType', ['AIDE', 'DEMARCHE', 'STRUCTURE', 'ACTUALITE'])

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
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (ProRdvService) => ({
	'ProRdvService_structure_fkey': foreignKey({
		name: 'ProRdvService_structure_fkey',
		columns: [ProRdvService.structureId],
		foreignColumns: [Structure.id]
	})
		.onDelete('cascade')
		.onUpdate('cascade')
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
		.on(ProAppointment.citizenUserId, ProAppointment.idempotencyKey)
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
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
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
	source_last_modified: timestamp('source_last_modified', { precision: 3 })
});

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
	releasedBy: text('releasedBy')
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
	updatedAt: timestamp('updatedAt', { precision: 3, mode: 'date' }).$defaultFn(() => new Date()).$onUpdate(() => new Date()).notNull()
}, (Referral) => ({
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
	decisionNote: text('decisionNote')
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
