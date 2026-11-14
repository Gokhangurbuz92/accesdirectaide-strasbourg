// @ts-nocheck
import { decide, visibleSql } from './publicVisibility.js';
import { claimsEntitlement } from './entitlementWording.js';
import { EXCLUSION_CLAUSE, withoutExclusions } from './finess-labels.js';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { expandQueryWithSynonyms } from './search-utils.js';
import { categoryVariants } from '../_services/verification/classify.js';
/** Catalogue (12/11/2026): every stored value meaning this taxonomy category (« social », « santé »… for social-sante) @param {string} c */
/**
 * Catalogue (12/11/2026): at equal quality, the records written and checked for the platform come first, then the reproduced official fiches that serve a
 * subdomain of the reference, then the others — a thousand official fiches published the same night must not push the RSA or the APL off the first page.
 */
const CURATED_FIRST = sql`(coalesce(auto_check->'texts'->>'mode', '') = 'OFFICIAL_SOURCE') ASC, (auto_check->'classification'->>'subdomain' IS NULL) ASC,`;
const categoryIn = (c) => sql`"categorie" IN (${sql.join(categoryVariants(c).map((v) => sql`${v}`), sql`, `)})`;
import { buildProvenance } from '../_utils/provenance.js';

// DTA S3B: `search_vector` is NOT created by any migration of this repository (drizzle/*.sql, src/db/schema*). PostgreSQL resolves a column at parse time, even inside a CASE branch,
// so the former runtime `pg_extension`/`information_schema` CASE guards could not protect the query: on a schema without the column every keyword (`q`) search answered 500
// (native run 2c3060: GET /api/structures?q=CAF). The column (and the unaccent extension it needs) is therefore detected ONCE per table, in JS, and the full-text clause is only built when both exist;
// otherwise the existing ILIKE predicates alone apply. A failed detection is not cached and means "no full-text".
/** @type {Map<string, Promise<boolean>>} */
const SEARCH_VECTOR_CACHE = new Map();
/** @param {string} table @returns {Promise<boolean>} */
export function hasSearchVector(table) {
  if (!SEARCH_VECTOR_CACHE.has(table)) {
    SEARCH_VECTOR_CACHE.set(table, (async () => {
      const res = await db.execute(sql`SELECT (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = 'search_vector')
        AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent')) AS ok`);
      const rows = res.rows || res;
      return Boolean(rows[0] && rows[0].ok);
    })().catch(() => { SEARCH_VECTOR_CACHE.delete(table); return false; }));
  }
  return SEARCH_VECTOR_CACHE.get(table);
}
export function resetSearchVectorCache() { SEARCH_VECTOR_CACHE.clear(); }
/** @param {boolean} sv @param {string} v */
const svOr = (sv, v) => (sv ? sql` OR ("search_vector" @@ plainto_tsquery('french', unaccent(${v})))` : sql``);

// ------------------------------------------------------------------------------------------------ R27: word search (best match level)
/**
 * Words that carry no meaning for finding a record (« aide pour payer mon loyer » → « loyer »). A query was matched as ONE phrase (or as the synonyms of
 * its words, never the words themselves): « payer loyer » and « CCAS Strasbourg » found nothing, « aide pour payer mon loyer » matched every aide.
 */
const STOPWORDS = new Set(('a au aux avec ce ces cet cette comment dans de des du elle en est et etre faire il ils j je l la le les leur lui ma me mes moi mon '
  + 'ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y d n s c m t aide aides aider besoin '
  + 'cherche chercher trouver obtenir payer avoir droit droits quel quelle quels quelles veux voudrais peux puis faut ai as suis sont ont si '
  // R40: words that say « a question about the law », not what it is about. « loi » is also the French stem of « loyer » (french_stem: loyer → loi), so
  // « aide active à mourir loi » ranked the APL and the ALS first; as a substring it matched « emploi » (France Travail, Mission locale)
  + 'loi lois legislation decret decrets').split(' '));

/**
 * R37 — everyday expressions and the administrative word the official texts use for the same thing (whole expressions, accents folded). The official
 * Service-Public sheets say « situation irrégulière », « Ehpad », « famille monoparentale », « précarité »; a person says « sans papiers », « maison de
 * retraite », « maman solo », « à la rue ». Production 02/11/2026: « se soigner sans papiers » returned the guides on lost identity papers, not the AME.
 * Only equivalences of meaning, never a route to one record.
 */
export const EVERYDAY_PHRASES = [
  // R40: the end of life as people and the press name it (« aide active à mourir », « suicide assisté », « euthanasie ») is what the official sheets call
  // « fin de vie » (F32010 directives anticipées, F39676 soins palliatifs, F706 allocation d'accompagnement), searched as ONE expression: its words alone
  // (« active », « fin », « vie ») found the RSA (« solidarité active ») and the ARE (« fin de contrat »). « _ » joins the words of one expression.
  [/\b(aide (active )?a mourir|aide medicale a mourir|suicides? assistes?|assistance au suicide|euthanasie|mourir dans la dignite|fin de vie)\b/g, 'fin_de_vie'],
  // R39: suicide prevention is the national listening line of the official sheet « numéros d'urgence et d'écoute » (F33954, the 3114), not a psychologist
  [/\b(prevention du suicide|idees suicidaires|pensees suicidaires|envie de me suicider)\b/g, 'numero ecoute suicide'],
  // R38 (D16): paying for a care home is what the sheet calls « aide sociale à l'hébergement » (F2444), not the list of care homes (F255) — before « ehpad »
  [/\b(payer|financer|regler) (la |une |l')?(maisons? de retraite|ehpad)\b/g, 'aide sociale hebergement agee'],
  // R38 (D16): parents who « entrust » their child to child protection: the sheet « Placement volontaire d'un enfant par ses parents » (F959)
  [/\bconfier (mon|ma|mes|notre|nos) (enfants?|fils|filles?|bebes?) (a l'?\s?)?ase\b/g, 'placement volontaire enfant parents ase'],
  // R41: the everyday names of a childminder are what the official sheets call a « mode de garde » (F38243 « Vous avez trouvé un mode de garde pour votre
  // enfant : aides financières ») or an « assistante maternelle »: « aide pour payer la nounou » had one word, « nounou », found in no record
  [/\b(nounous?|nourrices?)\b/g, 'mode_de_garde assistante_maternelle'],
  // R41: « how long to keep » papers is the official « durée de conservation » (F19134); « temps » alone matched « en même temps » in the sheets on
  // lost and stolen identity papers. Only the question of a duration of keeping, never a place to store documents.
  [/\b(pendant |pour )?(combien de temps|jusqu'a quand) (faut[\s-]+il |dois[\s-]+je |je dois |on doit |doit[\s-]+on )?(garder|conserver)\b/g, 'duree_de_conservation'],
  // R41: depression is a matter of « santé mentale » (F34917 « Consultation d'un psychologue ou d'un psychiatre »). Not a crisis by itself: the crisis
  // signal (search-safety.js) reads the query as typed, so words of distress in the same query still show the 3114.
  [/\b(depressions?|depressi(f|fs|ve|ves)|deprimee?s?|souffrance psychique)\b/g, 'sante_mentale'],
  // R41: a cheap complementary health insurance: the public one for modest incomes is the « complémentaire santé solidaire » (C2S: « gratuite ou payante
  // selon le niveau des revenus », as its published record says; the Assurance maladie decides). « mutuelle » is kept, so the general complementary-insurance démarche is found too.
  [/\bmutuelles? (pas chere?s?|moins chere?s?|gratuites?|a petit prix|bon marche|economiques?)\b/g, 'mutuelle complementaire_sante_solidaire'],
  // R41: the name of the French card (F34049), searched as ONE expression — it is also what a card for disabled people asked in another language becomes
  // (data/i18n/search-lexicon.json « disability-card »); its words alone found the « carte de séjour » démarches
  [/\bcarte (de )?mobilite inclusion\b/g, 'carte_mobilite_inclusion'],
  [/\b(sans[\s-]+papiers?|pas de papiers)\b/g, 'irreguliere'],
  [/\bmaisons? de retraite\b/g, 'ehpad'],
  [/\bgrands?[\s-]+(meres?|peres?|parents)\b/g, 'agee'],
  [/\baide sociale (a|de) l'?\s?enfance\b/g, 'ase'],
  [/\b(maman|papa|parent|mere|pere)s? (solo|seule?s?|celibataires?)\b/g, 'monoparentale'],
  [/\b(dans la rue|a la rue|sans[\s-]+abris?)\b/g, 'precarite'],
  [/\b(petites? (pension|retraite)s?|petits revenus|faibles revenus|peu de revenus)\b/g, 'precarite'],
  // R38: helping a dependent relative is what the official sheets call « proche aidant » (congé de proche aidant, F16920)
  [/\b((arreter|cesser|reduire|quitter) de travailler pour (aider|m'?\s?occuper d[e'])|m'?\s?occuper d[e'] ?(ma|mon) (mere|pere|parent|proche|mari|femme)|aider (ma|mon) (mere|pere|parent|proche) (dependante?|malade|agee?|handicapee?))\b/g, 'aidant'],
];
const everydayToOfficial = (folded) => EVERYDAY_PHRASES.reduce((t, [re, word]) => t.replace(re, ` ${word} `), folded);

/** the meaningful words of a query, without accents, at most 6 (a 5-digit postal code is a word) @param {string} q */
export function searchWords(q) {
  const words = everydayToOfficial(foldAccents(q).replace(/’/g, "'")).replace(/[^a-z0-9_\s'’-]/g, ' ').split(/[\s'’-]+/)
    .map((w) => w.replace(/^_+|_+$/g, '')).filter((w) => w && (w.length >= 2 || /\d/.test(w)) && !STOPWORDS.has(w)).map((w) => w.replace(/_+/g, ' '));
  return [...new Set(words)].slice(0, 6);
}

/** a word and its synonyms, without accents; a plural « s » / « x » dropped so that « loyers » finds « loyer » @param {string} w */
export function wordTerms(w) {
  if (w.includes(' ')) return [w];   // R40: an expression (« fin de vie ») is matched as written: the synonyms of its words are other meanings
  const base = w.length > 4 ? w.replace(/[sx]$/, '') : w;
  return [...new Set([base, ...expandQueryWithSynonyms(w).map(foldAccents)].map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 12);
}

/**
 * R40: how one term matches a folded text. A term of at most 3 letters is matched as a WHOLE word (PostgreSQL \\m … \\M): as a substring « vie » was
 * in « envie » and « service », « fin » in « afin » and « financière », « ame » in « amende »; longer terms keep the substring match that finds plurals,
 * compounds and inflections (« logement » in « logements », « endettement » in « surendettement »).
 * @param {any} folded the folded column (SQL) @param {string} t a folded term
 */
export const isShortTerm = (/** @type {string} */ t) => t.length <= 3 && !t.includes(' ');
const termMatch = (folded, t) => (isShortTerm(t) ? sql`${folded} ~ ${`\\m${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\M`}` : sql`${folded} LIKE ${`%${t}%`}`);

/**
 * The SQL of a word search over some text columns (fixed identifiers): one group per word (the word OR one of its synonyms in one of the columns, or in
 * the full-text vector), the number of groups a record matches, and the number matched in its title.
 * @param {string} q @param {string[]} columns @param {string} titleColumn @param {boolean} sv @param {(term: string) => any} [extra] another match for a term
 */
export function wordPlan(q, columns, titleColumn, sv, extra) {
  const words = searchWords(q);
  if (!words.length) return null;
  const group = (w, cols) => sql`(${sql.join(wordTerms(w).flatMap((t) => [...cols.map((c) => termMatch(FOLDED(c), t)), ...(extra && cols.length > 1 ? [extra(t)] : [])]), sql.raw(' OR '))}${cols.length > 1 ? svOr(sv, w) : sql``})`;
  const count = (cols) => sql.join(words.map((w) => sql`(CASE WHEN ${group(w, cols)} THEN 1 ELSE 0 END)`), sql.raw(' + '));
  // 12/11/2026: the word itself in the title weighs more than a synonym of it (« hébergement » ranked « Maison : travaux extérieurs » first through « maison »)
  const exact = (cols) => sql.join(words.map((w) => { const base = foldAccents(w.length > 4 && !w.includes(' ') ? w.replace(/[sx]$/, '') : w); return sql`(CASE WHEN (${sql.join(cols.map((c) => termMatch(FOLDED(c), base)), sql.raw(' OR '))}) THEN 1 ELSE 0 END)`; }), sql.raw(' + '));
  return { words, matchCount: sql`(${count(columns)})`, titleHits: sql`(${count([titleColumn])})`, exactTitleHits: sql`(${exact([titleColumn])})`, hits: (cols) => sql`(${exact(cols)})` };
}

/**
 * Only the records that match the most words of the query (all of them when some record does): « CCAS Strasbourg » gives the CCAS of Strasbourg, not
 * every CCAS and every place in Strasbourg; a word found nowhere does not empty the result.
 * @param {string} table @param {any[]} conditions the other conditions of the search @param {{ matchCount: any }} plan
 */
export async function bestMatchCondition(table, conditions, plan) {
  const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql.raw(' AND '))}` : sql``;
  const res = await db.execute(sql`SELECT coalesce(max(${plan.matchCount}), 0)::int AS best FROM ${sql.raw(`"${table}"`)} ${where}`);
  const best = Number((res.rows || res)[0]?.best || 0);
  return sql`${plan.matchCount} >= ${Math.max(1, best)}`;
}

/** R26: the topics of the Aides menu and the words that put a record under each (written without accents; matched as whole-word starts) */
export const THEME_WORDS = {
  logement: ['logement', 'loyer', 'hlm', 'hebergement'],
  sante: ['sante', 'soins', 'maladie', 'medical'],
  handicap: ['handicap'],
  emploi: ['emploi', 'chomage', 'travail', 'activite', 'entreprise'],
  famille: ['famille', 'enfant', 'parent'],
};
const ACCENTED = 'àâäéèêëîïôöùûüç'; const PLAIN = 'aaaeeeeiioouuuc';
/** @param {unknown} v */
export const foldAccents = (v) => String(v || '').toLowerCase().replace(/[àâäéèêëîïôöùûüç]/g, (c) => PLAIN[ACCENTED.indexOf(c)]);
/** a PostgreSQL regular expression for a topic (\\m = start of a word), or null for a topic without a word list */
export const themePattern = (theme) => (THEME_WORDS[theme] ? `\\m(${THEME_WORDS[theme].join('|')})` : null);
/** a column, lower-cased and without accents, in SQL (a fixed identifier, never user input) @param {string} col */
const FOLDED = (col) => sql.raw(`translate(lower(coalesce(${col}, '')), '${ACCENTED}', '${PLAIN}')`);
/** @param {boolean} sv */
const svFlag = (sv) => (sv ? sql`TRUE` : sql`FALSE`);
/** @param {boolean} sv @param {string} v */
const svRank = (sv, v) => (sv ? sql`ts_rank_cd("search_vector", plainto_tsquery('french', unaccent(${v})))` : sql`0`);

/**
 * Builds and executes a search query for Aides.
 */
/**
 * @param {any} db
 * @param {any} params
 */
export async function searchAides(params) {
  const {
    q,
    theme, sousTheme,
    public: audience,
    territoire: geo,
    organisme: provider,
    urgent,
    statut = 'publie',
    publicOnly = true,
    sort,
    page, pageSize,
    // Legacy mapping
    category, situation, providerType
  } = params;

  const LIMIT = Number(pageSize) || 20;
  const OFFSET = (Math.max(1, Number(page) || 1) - 1) * LIMIT;

  // D-5: the public list contains only records that pass the visibility rules; only an authenticated admin caller (publicOnly === false) may choose another statut.
  const conditions = [publicOnly === false ? sql`statut = ${statut}` : visibleSql('aide')];

  const sv = q ? await hasSearchVector('Aide') : false;
  // 1. Full Text Search with Synonym Expansion
  // Use ILIKE fallback when search_vector or unaccent extension is missing
  // R27: word search, applied below once every other filter is known (best match level)
  const plan = q ? wordPlan(q, ['"titre"', '"cest_quoi"', '"description"'], '"titre"', sv) : null;

  // 2. Filters
  const effectiveTheme = theme || category;
  if (effectiveTheme) {
    // Match new 'theme' column OR legacy category relation — R26: OR the record's own category, OR the topic's words in its title and description
    // (accents ignored). The verified records carry a coarse « categorie » and almost never a « theme », so the Aides menu (Logement, Santé, Handicap,
    // Emploi, Famille) returned nothing for every topic.
    const t = foldAccents(effectiveTheme);
    const pattern = themePattern(t);
    conditions.push(sql`("theme" = ${effectiveTheme} OR "categoryId" = ${effectiveTheme} OR EXISTS (SELECT 1 FROM "AidCategory" c WHERE c.id = "Aide"."categoryId" AND c.slug = ${effectiveTheme})
      OR ${FOLDED('"categorie"')} = ${t} OR ${categoryIn(effectiveTheme)}${pattern ? sql` OR (${FOLDED('"titre"')} || ' ' || ${FOLDED('"description"')}) ~ ${pattern}` : sql``})`);
  }

  if (sousTheme) {
    conditions.push(sql`"sub_theme" = ${sousTheme}`);
  }

  const effectiveAudience = audience; // 'public' alias
  if (effectiveAudience) {
    conditions.push(sql`${effectiveAudience} = ANY("audiences")`);
  }

  if (situation) {
    // Support both new AidSituation/Situation mapping and legacy LifeSituation mapping.
    conditions.push(sql`(
      EXISTS (
        SELECT 1
        FROM "AidSituation" relation
        JOIN "Situation" situation ON situation.id = relation."situationId"
        WHERE relation."aidId" = "Aide".id
          AND situation.code = ${situation}
      )
      OR EXISTS (
        SELECT 1
        FROM "_AideToLifeSituation" relation
        JOIN "LifeSituation" situation ON situation.id = relation."A"
        WHERE relation."B" = "Aide".id
          AND situation.slug = ${situation}
      )
    )`);
  }

  const effectiveGeo = geo; // 'territoire' alias
  if (effectiveGeo) {
    conditions.push(sql`${effectiveGeo} = ANY("territoires")`);
  }

  if (provider) {
    conditions.push(sql`"providerName" = ${provider}`);
  }

  if (providerType) {
    conditions.push(sql`"providerType" = ${providerType}`);
  }

  if (urgent === 'true') {
    conditions.push(sql`"est_urgent" = true`);
  }

  if (plan) conditions.push(await bestMatchCondition('Aide', conditions, plan));
  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql.raw(' AND '))}`
    : sql``;

  // 3. Sorting - Safe mapping with whitelist
  let orderBy;
  let selectRank = sql``;

  // P2: external sort aliases (stable contract) -> internal implementation
  /** @type {Record<string, string>} */
  const sortAliases = {
    relevance: 'pertinence',
    recent: '-published_at',
    '-recent': 'published_at',
    quality: '-quality_score',
    '-quality': 'quality_score',
  };

  const effectiveSort = sortAliases[sort] || sort;

  // Parse sort parameter (handle prefix "-" for DESC)
  const sortDirection = effectiveSort?.startsWith('-') ? 'DESC' : 'ASC';
  const sortField = effectiveSort?.startsWith('-') ? effectiveSort.substring(1) : effectiveSort;

  // Safe column mapping (whitelist only)
  /** @type {Record<string, string>} */
  const SAFE_SORT_COLUMNS = {
    'date': 'published_at',
    'alpha': 'titre',
    'created_date': 'updatedAt',
    'updated_date': 'updatedAt',
    'published_at': 'published_at',
    'date_publication': 'published_at',
    'titre': 'titre',
    'quality_score': 'quality_score',
  };

  if (q && (effectiveSort === 'pertinence' || sortField === 'pertinence')) {
    selectRank = plan ? sql`, (${plan.exactTitleHits} * 3 + ${plan.titleHits}) as rank` : sql`, CASE WHEN ${svFlag(sv)} THEN ${svRank(sv, q)} ELSE CASE WHEN "titre" ILIKE ${'%' + q + '%'} THEN 2 WHEN "cest_quoi" ILIKE ${'%' + q + '%'} THEN 1 ELSE 0 END END as rank`;
    orderBy = sql`ORDER BY rank DESC, published_at DESC, id ASC`;
  } else if (sortField === 'pertinence') {
    // Relevance sorting requires q. Without q we fallback to date.
    orderBy = sql`ORDER BY published_at DESC, id ASC`;
  } else if (sortField && SAFE_SORT_COLUMNS[sortField]) {
    const dbColumn = SAFE_SORT_COLUMNS[sortField];
    const safeColumn = sql.raw(`"${dbColumn}"`);

    // P2: quality sort should remain stable and useful, even when many scores are equal.
    if (dbColumn === 'quality_score') {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, ${CURATED_FIRST} published_at DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, published_at DESC, id ASC`;
    } else {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, id ASC`;
    }
  } else {
    // Default fallback
    orderBy = sql`ORDER BY published_at DESC, id ASC`;
  }

  // 4. Execution
  const itemsQuery = sql`
    SELECT id ${selectRank}
    FROM "Aide"
    ${whereClause}
    ${orderBy}
    LIMIT ${LIMIT} OFFSET ${OFFSET}
  `;

  const countQuery = sql`
    SELECT count(*) as total
    FROM "Aide"
    ${whereClause}
  `;

  // Facets Query (Aggregation)
  // We want counts for themes, organismes, territoires, publics
  // This can be heavy, so we might want to cache or simplify.
  // For now, let's do simple GROUP BYs on the filtered set (except the filter itself? No, standard is filtered set).
  // Actually, standard facet behavior is "drill down", so facets show counts within current results.

  // To avoid huge SQL complexity, we'll fetch basic stats.
  // Note: Aggregating arrays (audiences, territoires) requires UNNEST.

  const facetsQuery = sql`
    SELECT
        (SELECT json_object_agg(t, c) FROM (SELECT "theme" as t, count(*) as c FROM "Aide" ${whereClause} AND "theme" IS NOT NULL GROUP BY "theme") t) as themes,
        (SELECT json_object_agg(p, c) FROM (SELECT "providerName" as p, count(*) as c FROM "Aide" ${whereClause} AND "providerName" IS NOT NULL GROUP BY "providerName") p) as organismes,
        (SELECT json_object_agg(a, c) FROM (SELECT unnest("audiences") as a, count(*) as c FROM "Aide" ${whereClause} GROUP BY a) a) as publics,
        (SELECT json_object_agg(ter, c) FROM (SELECT unnest("territoires") as ter, count(*) as c FROM "Aide" ${whereClause} GROUP BY ter) t) as territoires
  `;

  const [itemsRes, countRes, facetsRes] = await Promise.all([
    db.execute(itemsQuery),
    db.execute(countQuery),
    db.execute(facetsQuery)
  ]);
  const items = itemsRes.rows || itemsRes;
  const countResult = countRes.rows || countRes;
  const facetsResult = facetsRes.rows || facetsRes;

  // Enrich items
  const itemIds = items.map((/** @type {{ id: string }} */ i) => i.id);
  /**
   * @type {({ provenance: { verifiedAt: string | null; fetchedAt: string | null; sourceUrl: string | null; sourceHost: string | null; }; id: string; } | { rank: number | undefined; provenance: { verifiedAt: string | null; fetchedAt: string | null; sourceUrl: string | null; sourceHost: string | null; }; id: string; } | null)[]}
   */
  let enrichedItems = [];
  if (itemIds.length > 0) {
    const fullItems = await db.query.Aide.findMany({
      where: (aide, { inArray }) => inArray(aide.id, itemIds),
      columns: {
        id: true,
        slug: true,
        titre: true,
        categorie: true,
        theme: true,
        sub_theme: true,
        cest_quoi: true,
        summary_falc: true,
        est_urgent: true,
        territoires: true,
        date_verification: true,
        statut: true, launch_eligible: true, verification_status: true, verified_by: true, territory_verified: true, publication_hold: true, data_origin: true,
        quality_score: true,
        published_at: true,
        updatedAt: true,
        providerName: true,
        source_name: true,
        source_org: true,
        source_url: true,
        fetched_at: true,
      },
      with: {
        sourceDocument: {
          columns: {
            fetched_at: true,
            source_url: true,
          },
        },
      },
    });

    const itemMap = new Map(fullItems.map((/** @type {{ id: string }} */ i) => [i.id, i]));
    enrichedItems = items.map((/** @type {{ id: string, rank?: number }} */ raw) => {
      const full = itemMap.get(raw.id);
      if (!full) return null;
      const { sourceDocument, verified_by: _reviewer, publication_hold: _hold, ...safeFull } = full;
      const visibility = decide(full, 'aide');
      const baseItem = {
        ...safeFull,
        provenance: buildProvenance({
          verifiedAt: visibility.contentStatus === 'VERIFIED' ? safeFull.date_verification : null,
          fetchedAt: sourceDocument?.fetched_at || safeFull.fetched_at,
          sourceUrl: sourceDocument?.source_url || safeFull.source_url,
        }),
        contentStatus: visibility.contentStatus,
      };
      if (q) {
        return { ...baseItem, rank: raw.rank };
      }
      return baseItem;
    }).filter(Boolean);
  }

  const rawFacets = (facetsResult && facetsResult[0]) ? facetsResult[0] : {};

  return {
    items: enrichedItems,
    total: Number(countResult[0].total || 0),
    facets: {
      themes: rawFacets.themes || {},
      organismes: rawFacets.organismes || {},
      publics: rawFacets.publics || {},
      territoires: rawFacets.territoires || {}
    }
  };
}

/**
 * Builds and executes a search query for Demarches.
 */
/**
 * @param {any} db
 * @param {any} params
 */
export async function searchDemarches(params) {
  const {
    q,
    category,
    theme,
    situation,
    geo,
    territoire,
    territory,
    audience,
    online,
    statut = 'publie',
    statut_in,
    publicOnly = true,
    source,
    sort,
    page,
    pageSize,
    hideTestContent = false,
  } = params;

  const effectiveCategory = theme || category;
  const effectiveGeo = geo || territoire || territory;
  const LIMIT = Number(pageSize) || 20;
  const OFFSET = (Math.max(1, Number(page) || 1) - 1) * LIMIT;

  // Phase 3: support statut_in (array) for multi-value filtering
  const conditions = [];
  if (publicOnly !== false) {
    conditions.push(visibleSql('demarche'));   // D-5: published AND verified/current/eligible (statut_in is ignored for the public)
  } else if (statut_in && Array.isArray(statut_in) && statut_in.length > 0) {
    conditions.push(sql`statut = ANY(ARRAY[${sql.join(statut_in, sql.raw(', '))}]::text[])`);
  } else {
    conditions.push(sql`statut = ${statut}`);
  }

  const sv = q ? await hasSearchVector('Demarche') : false;
  // R27: word search over titre + description, applied below once every other filter is known (best match level)
  const plan = q ? wordPlan(q, ['"titre"', '"description_courte"'], '"titre"', sv) : null;

  if (effectiveCategory) {
    // Catalogue (12/11/2026): the démarche's own category too — the chips filtered on the category relation only, which the verified records do not carry
    conditions.push(sql`("categoryId" = ${effectiveCategory} OR EXISTS (SELECT 1 FROM "AidCategory" c WHERE c.id = "Demarche"."categoryId" AND c.slug = ${effectiveCategory}) OR ${categoryIn(effectiveCategory)})`);
  }

  if (situation) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM "_DemarcheToSituation" j
      JOIN "LifeSituation" s ON s.id = j."B"
      WHERE j."A" = "Demarche".id AND s.slug = ${situation}
    )`);
  }

  if (params.territoryFilter && params.territoryFilter.userTerritoryIds && params.territoryFilter.userTerritoryIds.length > 0) {
    const territoryIds = params.territoryFilter.userTerritoryIds;
    const valuesList = sql.join(territoryIds.map((/** @type {string | number | boolean | null | undefined} */ id, /** @type {string | number | boolean | null | undefined} */ idx) => sql`(${id}::text, ${idx}::int)`), sql`, `);
    conditions.push(sql`
      (
        NOT EXISTS (SELECT 1 FROM "Applicability" app WHERE app.entity_type = 'PROCEDURE' AND app.entity_id = "Demarche".id)
        OR (
          SELECT app.is_exclusion 
          FROM "Applicability" app
          JOIN (VALUES ${valuesList}) AS t(tid, depth) ON app.territory_id = t.tid
          WHERE app.entity_type = 'PROCEDURE' AND app.entity_id = "Demarche".id
          ORDER BY t.depth ASC, app.is_exclusion ASC
          LIMIT 1
        ) = false
      )
    `);
  } else if (effectiveGeo) {
    // Legacy fallback if no canonical territory context
    conditions.push(sql`${effectiveGeo} = ANY("departements")`);
  } else {
    // No context: Only National procedures (those without inclusions) remain discoverable.
    // Local procedures (those with inclusions) require a territory context.
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM "Applicability" app WHERE app.entity_type = 'PROCEDURE' AND app.entity_id = "Demarche".id AND app.is_exclusion = false)`);
  }

  if (audience) {
    conditions.push(sql`${audience} = ANY("audiences")`);
  }

  if (online === 'true' || online === '1') {
    conditions.push(sql`("lien_officiel" IS NOT NULL AND "lien_officiel" <> '')`);
  }

  if (hideTestContent) {
    conditions.push(sql`NOT ("titre" ILIKE 'Test%' OR "titre" ILIKE 'Démarche Test%' OR "titre" ILIKE 'Demarche Test%')`);
  }

  if (plan) conditions.push(await bestMatchCondition('Demarche', conditions, plan));
  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql.raw(' AND '))}`
    : sql``;

  let orderBy;
  let selectRank = sql``;

  /** @type {Record<string, string>} */
  const sortAliases = {
    relevance: 'pertinence',
    recent: '-published_at',
    '-recent': 'published_at',
    quality: '-quality_score',
    '-quality': 'quality_score',
  };

  const effectiveSort = sortAliases[sort] || sort;
  const sortDirection = effectiveSort?.startsWith('-') ? 'DESC' : 'ASC';
  const sortField = effectiveSort?.startsWith('-') ? effectiveSort.substring(1) : effectiveSort;

  /** @type {Record<string, string>} */
  const SAFE_SORT_COLUMNS = {
    'date': 'published_at',
    'alpha': 'titre',
    'created_date': 'updatedAt',
    'updated_date': 'updatedAt',
    'published_at': 'published_at',
    'date_publication': 'published_at',
    'titre': 'titre',
    'quality_score': 'quality_score',
  };

  if (q && (effectiveSort === 'pertinence' || sortField === 'pertinence')) {
    // Use simple ordering by titre match when search_vector is missing
    selectRank = plan ? sql`, (${plan.exactTitleHits} * 3 + ${plan.titleHits}) as rank` : sql`, CASE WHEN "titre" ILIKE ${'%' + q + '%'} THEN 2 WHEN "description_courte" ILIKE ${'%' + q + '%'} THEN 1 ELSE 0 END as rank`;
    orderBy = sql`ORDER BY rank DESC, published_at DESC, id ASC`;
  } else if (sortField === 'pertinence') {
    // Relevance sorting requires q. Without q we fallback to date.
    orderBy = sql`ORDER BY published_at DESC, id ASC`;
  } else if (sortField && SAFE_SORT_COLUMNS[sortField]) {
    const dbColumn = SAFE_SORT_COLUMNS[sortField];
    const safeColumn = sql.raw(`"${dbColumn}"`);

    if (dbColumn === 'quality_score') {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, ${CURATED_FIRST} published_at DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, published_at DESC, id ASC`;
    } else {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, id ASC`;
    }
  } else if (q) {
    selectRank = plan ? sql`, (${plan.exactTitleHits} * 3 + ${plan.titleHits}) as rank` : sql`, CASE WHEN "titre" ILIKE ${'%' + q + '%'} THEN 2 WHEN "description_courte" ILIKE ${'%' + q + '%'} THEN 1 ELSE 0 END as rank`;
    orderBy = sql`ORDER BY rank DESC, published_at DESC, id ASC`;
  } else {
    // Default without q: quality first, then recent.
    orderBy = sql`ORDER BY "quality_score" DESC, published_at DESC, id ASC`;
  }

  const itemsQuery = sql`SELECT id ${selectRank} FROM "Demarche" ${whereClause} ${orderBy} LIMIT ${LIMIT} OFFSET ${OFFSET}`;
  const countQuery = sql`SELECT count(*) as total FROM "Demarche" ${whereClause}`;

  const [itemsRes, countRes] = await Promise.all([
    db.execute(itemsQuery),
    db.execute(countQuery)
  ]);
  const items = itemsRes.rows || itemsRes;
  const countResult = countRes.rows || countRes;

  const itemIds = items.map((/** @type {{ id: string }} */ i) => i.id);
  let enrichedItems = [];
  if (itemIds.length > 0) {
    const fullItems = await db.query.Demarche.findMany({
      where: (demarche, { inArray }) => inArray(demarche.id, itemIds),
      columns: {
        id: true,
        slug: true,
        titre: true,
        categorie: true,
        description_courte: true,
        summary_falc: true,
        delai: true,
        lien_officiel: true,
        source_url: true,
        source_url_exact: true,
        date_verification: true,
        statut: true, launch_eligible: true, verification_status: true, verified_by: true, territory_verified: true, publication_hold: true, data_origin: true,
        quality_score: true,
        published_at: true,
        updatedAt: true,
      },
      with: {
        sourceDocument: {
          columns: {
            fetched_at: true,
            source_url: true,
          },
        },
        category: {
          columns: {
            id: true,
            slug: true,
            label: true,
          },
        },
      },
    });
    const itemMap = new Map(fullItems.map((/** @type {{ id: string }} */ i) => [i.id, i]));
    enrichedItems = items.map((/** @type {{ id: string, rank?: number }} */ raw) => {
      const full = itemMap.get(raw.id);
      if (!full) return null;
      const { sourceDocument, verified_by: _reviewer, publication_hold: _hold, ...safeFull } = full;
      const visibility = decide(full, 'demarche');
      const baseItem = {
        ...safeFull,
        provenance: buildProvenance({
          verifiedAt: visibility.contentStatus === 'VERIFIED' ? safeFull.date_verification : null,
          fetchedAt: sourceDocument?.fetched_at,
          sourceUrl: sourceDocument?.source_url || safeFull.source_url || safeFull.source_url_exact,
        }),
        contentStatus: visibility.contentStatus,
      };
      if (q) return { ...baseItem, rank: raw.rank };
      return baseItem;
    }).filter(Boolean);
  }

  return {
    items: enrichedItems,
    total: Number(countResult[0].total || 0)
  };
}

/**
 * SRCH-DISP-1: the dispositifs (official Service-Public fiches published as Dispositif records — « Carte Vitale », « Prise en charge d'une affection de
 * longue durée (ALD) ») in the universal search. Same word search as the démarches (each meaningful word, its synonyms, best match level), over the title
 * and the simplified texts. Visibility: EXACTLY the rule of the public list (api/_handlers/dispositifs/index.js: visibleSql('dispositif')) — published,
 * verified, launch-eligible, not on hold, real origin, current verification, with a source. A query with no meaningful word gets no dispositif.
 * @param {{ q: string, page?: number, pageSize?: number }} params
 */
export async function searchDispositifs(params) {
  const { q, page, pageSize } = params;
  const LIMIT = Math.max(1, Math.min(50, Number(pageSize) || 5));
  const OFFSET = (Math.max(1, Number(page) || 1) - 1) * LIMIT;
  const sv = q ? await hasSearchVector('Dispositif') : false;
  const plan = q ? wordPlan(q, ['"titre"', '"summary_falc"', '"description_falc"'], '"titre"', sv) : null;
  if (!plan) return { items: [] };
  const conditions = [visibleSql('dispositif')];   // D-5: the public list's condition, never widened
  conditions.push(await bestMatchCondition('Dispositif', conditions, plan));
  const res = await db.execute(sql`SELECT id, slug, titre, summary_falc, description_falc FROM "Dispositif" WHERE ${sql.join(conditions, sql.raw(' AND '))}
    ORDER BY (${plan.exactTitleHits} * 3 + ${plan.titleHits}) DESC, ${plan.matchCount} DESC, (auto_check ? 'official') ASC, titre ASC, id ASC LIMIT ${LIMIT} OFFSET ${OFFSET}`);
  const rows = res.rows || res;
  // a simplified text that asserts a right is withheld from the public (as stripReviewFields does); the word « null » is no text
  const text = (/** @type {unknown} */ v) => (typeof v === 'string' && v.trim() && !/^\s*(null|undefined)\s*$/i.test(v) && !claimsEntitlement(v) ? v.trim() : null);
  return {
    items: rows.map((/** @type {Record<string, any>} */ r) => {
      const description = text(r.summary_falc) || text(r.description_falc);
      return { id: r.id, slug: r.slug, titre: r.titre, description: description && description.length > 240 ? `${description.slice(0, 237).trimEnd()}…` : description };
    }),
  };
}

/**
 * Builds and executes a search query for Structures.
 */
/**
 * @param {any} db
 * @param {any} params
 */
export async function searchStructures(params) {
  const { q, city, zip, type, departement, pmr, sort, page, pageSize, serves } = params;
  const LIMIT = Number(pageSize) || 20;
  const OFFSET = (Math.max(1, Number(page) || 1) - 1) * LIMIT;

  const conditions = [visibleSql('structure')];   // D-5: active AND verified/current/eligible
  // PKG-11 / E05: « serves this commune » = the commune is in the organization's service area (insee_codes), which reaches the record only through a reviewed
  // Espace Structure proposal, and a geography change accepted without the reviewer confirming the territory withdraws territory_verified — so every place that
  // stays visible here (D-5 requires territory_verified) has a REVIEWED area. Being located in a commune (city) is a different, weaker fact.
  if (serves) conditions.push(sql`${String(serves)} = ANY(coalesce("Structure"."insee_codes", ARRAY[]::text[]))`);

  const sv = q ? await hasSearchVector('Structure') : false;
  // PKG-11 / E04: what a structure DECLARES it does (catalogue `services`) and the services it offers for booking on ADA (active, published booking only) feed the
  // search — before, a search for « aide administrative » found only names and short descriptions. Shown as « why shown », never as a promise of suitability.
  const like = q ? '%' + q + '%' : null;
  const serviceMatch = q ? sql`(EXISTS (SELECT 1 FROM unnest(coalesce("Structure"."services", ARRAY[]::text[])) AS declared(x) WHERE regexp_replace(declared.x, ${EXCLUSION_CLAUSE}, '', 'gi') ILIKE ${like})
      OR ("Structure"."is_pro_enabled" = true AND EXISTS (SELECT 1 FROM "ProRdvService" bookable WHERE bookable."structureId" = "Structure".id AND bookable."isActive" = true AND bookable.name ILIKE ${like})))` : null;
  // R27: word search over the name, description, commune, postal code and type, plus the declared services; applied below once every other filter is
  // known (best match level): « CCAS Strasbourg » = a CCAS in Strasbourg
  // R34: and the services data·inclusion attributes to the place (Structure.services_externes: the schema's service name and themes, never free text) — 478
  // services on 269 public places that no search read: « aide aux aidants » found nothing, « apprendre le français » found « Croix-Rouge française »
  const declared = (t) => sql`(EXISTS (SELECT 1 FROM unnest(coalesce("Structure"."services", ARRAY[]::text[])) AS declared(x) WHERE translate(lower(regexp_replace(declared.x, ${EXCLUSION_CLAUSE}, '', 'gi')), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc') LIKE ${`%${t}%`})
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof("Structure"."services_externes"->'services') = 'array' THEN "Structure"."services_externes"->'services' ELSE '[]'::jsonb END) AS ext(x)
      WHERE translate(lower(coalesce(ext.x->>'nom', '') || ' ' || coalesce(ext.x->>'themes', '') || ' ' || coalesce(ext.x->>'type', '')), 'àâäéèêëîïôöùûüç’', 'aaaeeeeiioouuuc''') LIKE ${`%${t}%`})
    OR ("Structure"."is_pro_enabled" = true AND EXISTS (SELECT 1 FROM "ProRdvService" bookable WHERE bookable."structureId" = "Structure".id AND bookable."isActive" = true
      AND translate(lower(bookable.name), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc') LIKE ${`%${t}%`})))`;   // R34: E04's bookable services, lost when R27 moved to the word plan
  const plan = q ? wordPlan(q, ['"nom"', '"description_courte"', '"ville"', '"code_postal"', '"type_structure"'], '"nom"', sv, declared) : null;
  // the words of the query found in what the place DOES (its services), ranked above words found only in its name
  const serviceHits = plan ? sql`(${sql.join(plan.words.map((w) => sql`(CASE WHEN (${sql.join(wordTerms(w).map((t) => declared(t)), sql.raw(' OR '))}) THEN 1 ELSE 0 END)`), sql.raw(' + '))})` : null;

  // Phase 9: StructureServiceArea Filtering (FR-010)
  if (params.territoryFilter && params.territoryFilter.userTerritoryIds && params.territoryFilter.userTerritoryIds.length > 0) {
    const territoryIds = params.territoryFilter.userTerritoryIds;
    const joinedIds = sql.join(territoryIds.map(id => sql`${id}`));
    conditions.push(sql`
      (
        NOT EXISTS (SELECT 1 FROM "StructureServiceArea" ssa WHERE ssa.structure_id = "Structure".id)
        OR EXISTS (
          SELECT 1 FROM "StructureServiceArea" ssa 
          WHERE ssa.structure_id = "Structure".id 
            AND (ssa.service_type = 'NATIONAL' OR ssa.territory_id IN (${joinedIds}))
        )
      )
    `);
  } else {
    // Phase 9 semantics: If no context, restrict to NATIONAL or missing service areas (prevent local leakage)
    conditions.push(sql`
      (
        NOT EXISTS (SELECT 1 FROM "StructureServiceArea" ssa WHERE ssa.structure_id = "Structure".id)
        OR EXISTS (
          SELECT 1 FROM "StructureServiceArea" ssa 
          WHERE ssa.structure_id = "Structure".id 
            AND ssa.service_type = 'NATIONAL'
        )
      )
    `);
    // Legacy fallback
    if (city) conditions.push(sql`"ville" ILIKE ${'%' + city + '%'}`);
    if (zip) conditions.push(sql`"code_postal" = ${zip}`);
    if (departement) conditions.push(sql`"departement" = ${departement}`);
  }

  if (type && type !== '_all') {
    // Handle legacy values like "Association" vs "association"
    conditions.push(sql`LOWER("type_structure") = LOWER(${type})`);
  }

  const wantsPmr = pmr === 'true' || pmr === '1';
  if (wantsPmr) {
    conditions.push(sql`"accessibilite_pmr" = true`);
  }

  if (plan) conditions.push(await bestMatchCondition('Structure', conditions, plan));
  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql.raw(' AND '))}`
    : sql``;

  let orderBy;
  let selectRank = sql``;

  // P4: external sort aliases (stable contract) -> internal implementation
  /** @type {Record<string, string>} */
  const sortAliases = {
    relevance: 'pertinence',
    recent: '-updated_date',
    '-recent': 'updated_date',
    quality: '-quality_score',
    '-quality': 'quality_score',
    alpha: 'nom',
    '-alpha': '-nom',
  };

  const effectiveSort = sortAliases[sort] || sort;
  const sortDirection = effectiveSort?.startsWith('-') ? 'DESC' : 'ASC';
  const sortField = effectiveSort?.startsWith('-') ? effectiveSort.substring(1) : effectiveSort;

  /** @type {Record<string, string>} */
  const SAFE_SORT_COLUMNS = {
    updated_date: 'updatedAt',
    nom: 'nom',
    quality_score: 'quality_score',
  };

  if (q && (effectiveSort === 'pertinence' || sortField === 'pertinence')) {
    // 12/11/2026: a place whose own name or type is the word (« CCAS ») comes before a place that only declares a service mentioning it
    selectRank = plan ? sql`, (${plan.exactTitleHits} * 4 + ${plan.hits(['"type_structure"'])} * 4 + ${serviceHits} * 2 + ${plan.titleHits}) as rank` : sql`, CASE WHEN ${svFlag(sv)} THEN ${svRank(sv, q)} ELSE CASE WHEN "nom" ILIKE ${'%' + q + '%'} THEN 2 WHEN "description_courte" ILIKE ${'%' + q + '%'} THEN 1 WHEN ${serviceMatch} THEN 1 ELSE 0 END END as rank`;
    // 12/11/2026: at equal relevance, the places of Strasbourg first (the platform's territory), then the rest of the département
    orderBy = sql`ORDER BY rank DESC, (lower(coalesce("ville", '')) LIKE 'strasbourg%') DESC, quality_score DESC, nom ASC, id ASC`;
  } else if (sortField === 'pertinence') {
    // Relevance sorting requires q. Without q we fallback to quality.
    orderBy = sql`ORDER BY quality_score DESC, "updatedAt" DESC, id ASC`;
  } else if (sortField && SAFE_SORT_COLUMNS[sortField]) {
    const dbColumn = SAFE_SORT_COLUMNS[sortField];
    const safeColumn = sql.raw(`"${dbColumn}"`);

    if (dbColumn === 'quality_score') {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, "updatedAt" DESC, nom ASC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, "updatedAt" DESC, nom ASC, id ASC`;
    } else if (dbColumn === 'updatedAt') {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, id ASC`;
    } else {
      orderBy = sortDirection === 'DESC'
        ? sql`ORDER BY ${safeColumn} DESC, id ASC`
        : sql`ORDER BY ${safeColumn} ASC, id ASC`;
    }
  } else {
    // Default fallback (stable & useful): quality first, then most recent
    orderBy = sql`ORDER BY quality_score DESC, "updatedAt" DESC, id ASC`;
  }

  const itemsQuery = sql`SELECT id ${selectRank} FROM "Structure" ${whereClause} ${orderBy} LIMIT ${LIMIT} OFFSET ${OFFSET}`;
  const countQuery = sql`SELECT count(*) as total FROM "Structure" ${whereClause}`;

  const [itemsRes, countRes] = await Promise.all([
    db.execute(itemsQuery),
    db.execute(countQuery)
  ]);
  const items = itemsRes.rows || itemsRes;
  const countResult = countRes.rows || countRes;

  const itemIds = items.map((/** @type {{ id: string }} */ i) => i.id);
  let enrichedItems = [];
  if (itemIds.length > 0) {
    const fullItems = await db.query.Structure.findMany({
      where: (structure, { inArray }) => inArray(structure.id, itemIds),
      columns: {
        id: true,
        slug: true,
        nom: true,
        type_structure: true,
        accessibilite_pmr: true,
        description_courte: true,
        date_verification: true,
        launch_eligible: true, verification_status: true, verified_by: true, territory_verified: true, publication_hold: true, data_origin: true,
        source_url: true,
        source_url_exact: true,
        adresse: true,
        code_postal: true,
        ville: true,
        departement: true,
        latitude: true,
        longitude: true,
        telephone: true,
        email: true,
        site_web: true,
        horaires: true,
        updatedAt: true,
        published_at: true,
        quality_score: true,
        statut: true,
        status: true,
        is_pro_enabled: true,
        services: true,
      },
      with: {
        sourceDocument: {
          columns: {
            fetched_at: true,
            source_url: true,
          },
        },
      },
    });
    const itemMap = new Map(fullItems.map((/** @type {{ id: string }} */ i) => [i.id, i]));
    // E04 « why shown »: the declared or bookable services that match the words searched (max 3 per structure; text as the structure wrote it)
    /** @type {Map<string, string[]>} */
    const whyShown = new Map();
    if (q) {
      const needle = String(q).toLowerCase();
      for (const f of fullItems) {
        const declared = (Array.isArray(f.services) ? f.services : []).filter((/** @type {unknown} */ x) => typeof x === 'string' && withoutExclusions(x).toLowerCase().includes(needle));
        if (declared.length) whyShown.set(f.id, declared.slice(0, 3));
      }
      const bookable = (await db.execute(sql`SELECT b."structureId" AS sid, b.name FROM "ProRdvService" b JOIN "Structure" s ON s.id = b."structureId"
        WHERE b."structureId" IN (${sql.join(itemIds.map((/** @type {string} */ i) => sql`${i}`), sql`, `)}) AND b."isActive" = true AND s."is_pro_enabled" = true AND b.name ILIKE ${like}
        ORDER BY b.name`)).rows || [];
      for (const r of bookable) {
        const list = whyShown.get(String(r.sid)) || [];
        if (list.length < 3 && !list.includes(String(r.name))) whyShown.set(String(r.sid), [...list, String(r.name)]);
      }
    }
    enrichedItems = items.map((/** @type {{ id: string, rank?: number }} */ raw) => {
      const full = itemMap.get(raw.id);
      if (!full) return null;
      const { sourceDocument, verified_by: _reviewer, publication_hold: _hold, ...safeFull } = full;
      const visibility = decide(full, 'structure');
      const baseItem = {
        ...safeFull,
        provenance: buildProvenance({
          verifiedAt: visibility.contentStatus === 'VERIFIED' ? safeFull.date_verification : null,
          fetchedAt: sourceDocument?.fetched_at,
          sourceUrl: sourceDocument?.source_url || safeFull.source_url || safeFull.source_url_exact,
        }),
        contentStatus: visibility.contentStatus,
      };
      if (q) return { ...baseItem, rank: raw.rank, ...(whyShown.has(raw.id) ? { whyShown: { services: whyShown.get(raw.id) } } : {}) };
      return baseItem;
    }).filter(Boolean);
  }

  return {
    items: enrichedItems,
    total: Number(countResult[0].total || 0)
  };
}
