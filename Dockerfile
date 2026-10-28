# ============================================================
# Accès Direct Aide — Dockerfile (self-hosted API image)
# ============================================================
# Launch-readiness item 51 (2026-10-25): the former image could not work — Node 20 (the project requires >= 22), a Prisma client generation (Prisma
# is gone: Drizzle), and `src/` excluded by .dockerignore while the API imports src/db. NOT built or run in the LAB (no Docker there): build and smoke-test it
# before relying on it. The approved deployment is Vercel; this image is the self-hosting path of the pending hosting decision (Q12).
#
# Usage:
#   docker build -t ada-api .
#   docker run -p 3000:3000 --env-file .env.production ada-api
# The API only (api/server.js); the web pages are the static build (`vite build`) served by the reverse proxy.
# ============================================================

# ── Stage 1: dependencies, from the lockfile ─────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages ./packages
# full install: tsx (TypeScript loader of src/db) is needed at run time; no install scripts
RUN npm ci --ignore-scripts

# ── Stage 2: runner ──────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodejs

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages ./packages
COPY api ./api
COPY src/db ./src/db
COPY src/config ./src/config
COPY src/lib ./src/lib
COPY data ./data
COPY scripts/release-preflight.mjs ./scripts/release-preflight.mjs

USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Standalone HTTP server (wraps the Vercel-style router); tsx loads the TypeScript modules of src/db
CMD ["node", "--import", "tsx", "api/server.js"]
