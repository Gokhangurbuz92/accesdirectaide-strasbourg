import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import fs from "fs";
import path from "path";
import { config as dotenvConfig } from "dotenv";

function apiMiddlewarePlugin() {
  return {
    name: "accesdirectaide-api-proxy",
    configureServer(server) {
      // Proxy /api/* requests to the tsx dev-server on port 3000.
      // Run `npm run dev:api` in a separate terminal first.
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (!(url.startsWith("/api") || url === "/robots.txt" || url === "/sitemap.xml")) {
          return next();
        }

        const http = await import("http");
        const options = {
          hostname: "localhost",
          port: 3000,
          path: url,
          method: req.method,
          headers: { ...req.headers, host: "localhost:3000" },
        };

        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on("error", (err) => {
          if (!res.headersSent) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              error: "API Dev Server Unavailable",
              message: "Run `npm run dev:api` in a separate terminal to start the API server.",
              details: err.message,
            }));
          }
        });

        // Pipe request body to proxy
        req.pipe(proxyReq, { end: true });
      });
    },
  };
}

/**
 * Sandbox / mock runs have no API proxy. Without this guard an extensionless /api/... request that matches a server file (e.g. /api/monitor/pro-rdv ->
 * api/monitor/pro-rdv.js) was transformed and SERVED to the browser as a module (server source exposed), and its server-only imports (pino, pg, drizzle,
 * Sentry) made the dev server re-optimize dependencies and reload every open page in the middle of a run. Such a path is now handled exactly like every
 * other /api path that matches no file (the tests mock the API they use): the server source tree is never served.
 */
function apiSourceGuardPlugin() {
  const SOURCE_SUFFIXES = ["", ".js", ".mjs", ".ts", ".jsx", ".tsx", ".json", "/index.js", "/index.ts"];
  const isServerSource = (rel) => SOURCE_SUFFIXES.some((suffix) => { try { return fs.statSync(path.join(__dirname, rel + suffix)).isFile(); } catch { return false; } });
  return {
    name: "accesdirectaide-api-source-guard",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [pathname, query] = (req.url || "").split("?");
        if ((pathname === "/api" || pathname.startsWith("/api/")) && isServerSource(decodeURIComponent(pathname).replace(/^\/+/, ""))) {
          req.url = "/__api_source_not_served__" + pathname + (query ? "?" + query : "");
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    process.env.ADA_STAGE6_SANDBOX === "1" ? apiSourceGuardPlugin() : apiMiddlewarePlugin(),
    process.env.SENTRY_AUTH_TOKEN
      ? sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        // the maps go to Sentry only: deleted from the build once uploaded, never served
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map', './dist-real/**/*.map'] },
      })
      : null,
  ].filter(Boolean),

  define: {
    "import.meta.env.VITE_GIT_COMMIT_SHA": JSON.stringify(
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.VITE_GIT_COMMIT_SHA ||
      "dev"
    ),
  },

  server: {
    allowedHosts: true,
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    extensions: [".mjs", ".js", ".jsx", ".ts", ".tsx", ".json"],
  },

  optimizeDeps: {
    esbuildOptions: {
      loader: {
        ".js": "jsx",
      },
    },
  },

  build: {
    // source maps only for the Sentry upload (hidden, then deleted by the plugin); none in a build without it — the source is never published
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? "hidden" : false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // ── Backend leak guard (PR #4) ──────────────────────
          // Exclude server-only modules that may be transitively pulled in.
          if (id.includes('node_modules/undici') ||
            id.includes('node_modules/pino') ||
            id.includes('node_modules/@prisma') ||
            id.includes('node_modules/prisma') ||
            id.includes('node_modules/bcrypt') ||
            id.includes('node_modules/jsonwebtoken') ||
            id.includes('node_modules/nodemailer')) {
            return undefined; // Let Vite tree-shake these out
          }

          // ── Sentry (isolated for async loading) ────────────
          if (id.includes('node_modules/@sentry')) {
            return 'sentry-vendor';
          }

          // ── React core ─────────────────────────────────────
          if (id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')) {
            return 'react-vendor';
          }

          // ── React Router ───────────────────────────────────
          if (id.includes('node_modules/react-router') ||
            id.includes('node_modules/@remix-run/router')) {
            return 'react-router-vendor';
          }

          // ── Framer Motion (lazy-loaded) ────────────────────
          if (id.includes('node_modules/framer-motion')) {
            return 'framer-motion';
          }

          // ── Charts (recharts + d3 transitive deps) ─────────
          if (id.includes('node_modules/recharts') ||
            id.includes('node_modules/d3-') ||
            id.includes('node_modules/victory') ||
            id.includes('node_modules/internmap') ||
            id.includes('node_modules/delaunator')) {
            return 'charts-vendor';
          }

          // ── PDF (heavy, lazy-loaded) ───────────────────────
          if (id.includes('node_modules/jspdf') ||
            id.includes('node_modules/html2canvas') ||
            id.includes('node_modules/dompurify')) {
            return 'pdf-vendor';
          }

          // ── Pro-only ecosystem (lazy-loaded) ───────────────
          if (id.includes('node_modules/react-day-picker') ||
            id.includes('node_modules/react-markdown') ||
            id.includes('node_modules/react-resizable-panels') ||
            id.includes('node_modules/remark-') ||
            id.includes('node_modules/rehype-') ||
            id.includes('node_modules/unified') ||
            id.includes('node_modules/mdast-') ||
            id.includes('node_modules/hast-') ||
            id.includes('node_modules/unist-') ||
            id.includes('node_modules/micromark') ||
            id.includes('node_modules/vfile')) {
            return 'pro-ecosystem';
          }

          // ── React ecosystem (query, helmet, forms) ─────────
          if (id.includes('node_modules/@tanstack/react-query') ||
            id.includes('node_modules/@tanstack/query-core') ||
            id.includes('node_modules/react-helmet-async') ||
            id.includes('node_modules/react-hook-form') ||
            id.includes('node_modules/@hookform')) {
            return 'react-ecosystem';
          }

          // ── Icons (lucide — deduplicated, PR #4) ───────────
          if (id.includes('node_modules/lucide-react') ||
            id.includes('node_modules/lucide')) {
            return 'icon-vendor';
          }

          // ── UI primitives (Radix + accessories) ────────────
          if (id.includes('node_modules/@radix-ui') ||
            id.includes('node_modules/cmdk') ||
            id.includes('node_modules/vaul') ||
            id.includes('node_modules/sonner') ||
            id.includes('node_modules/embla-carousel') ||
            id.includes('node_modules/@floating-ui') ||
            id.includes('node_modules/aria-hidden') ||
            id.includes('node_modules/react-remove-scroll')) {
            return 'ui-vendor';
          }

          // ── Crypto / E2EE ──────────────────────────────────
          if (id.includes('node_modules/tweetnacl') ||
            id.includes('node_modules/crypto-js') ||
            id.includes('node_modules/nacl')) {
            return 'crypto-vendor';
          }

          // ── QR code ────────────────────────────────────────
          if (id.includes('node_modules/qrcode') ||
            id.includes('node_modules/react-qr-code') ||
            id.includes('node_modules/qr.js')) {
            return 'qr-vendor';
          }

          // ── Utilities (date-fns, zod, clsx, etc.) ──────────
          if (id.includes('node_modules/date-fns') ||
            id.includes('node_modules/zod') ||
            id.includes('node_modules/clsx') ||
            id.includes('node_modules/class-variance-authority') ||
            id.includes('node_modules/tailwind-merge') ||
            id.includes('node_modules/@sindresorhus/slugify')) {
            return 'utils-vendor';
          }

          // ── Lodash (heavy, tree-shake resistant) ────────────
          if (id.includes('node_modules/lodash')) {
            return 'lodash-vendor';
          }

          // ── Motion DOM (framer-motion runtime deps) ─────────
          if (id.includes('node_modules/motion-dom') ||
            id.includes('node_modules/motion-utils')) {
            return 'motion-vendor';
          }

          // ── Core-JS polyfills ───────────────────────────────
          if (id.includes('node_modules/core-js')) {
            return 'polyfills-vendor';
          }

          // ── Catch-all for remaining node_modules ───────────
          if (id.includes('node_modules/')) {
            return 'vendor';
          }
        },
      },
    },
  },

  test: {
    globals: true,
    environment: "node",
    // DB-backed integration tests share a single Postgres schema.
    // Running files concurrently makes the suite flaky (race conditions / non-deterministic state).
    fileParallelism: false,
    maxWorkers: 1,
    include: [
      "src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "api/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "scripts/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    exclude: ["node_modules", "dist", ".vercel", "e2e", "**/*.spec.js", "**/*.spec.ts"],
    setupFiles: ["./tests/setup-env.js"],
    environmentMatchGlobs: [
      ["tests/components/**", "jsdom"],
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        "node_modules/",
        "dist/",
        "e2e/",
        "tests/",
        "scripts/_deprecated/",
        ".storybook/",
        "**/*.test.*",
        "**/*.spec.*",
        "vite.config.js",
      ],
    },
  },
});
