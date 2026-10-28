#!/usr/bin/env node
// PKG-11 / D16 — operator: rebuild the aide index from what people can see, with the LOCAL embedding model only (api/lib/retrieval-index.js).
// Usage: DATABASE_URL=… node scripts/reindex-embeddings.mjs [--dry-run] [--limit=1000]
// Only D-5-visible aides are embedded; unchanged records are left alone; nothing is sent outside this machine.
import { db } from '../src/db/index.js';
import { localOllamaEmbedder, rebuildAideIndex } from '../api/lib/retrieval-index.js';

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const model = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const summary = await rebuildAideIndex({ db, embed: localOllamaEmbedder({ model }), model, limit: Number(args.get('limit') || 1000), dryRun: Boolean(args.get('dry-run')) });
console.log('REINDEX_RESULT ' + JSON.stringify(summary));
process.exit(summary.failed ? 1 : 0);
