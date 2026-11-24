#!/usr/bin/env bash
# G14-R3 — OWNER-RUN deployment of the HDS service to the EXISTING Scalingo app ada-hds-strasbourg (osc-fr1, HDS option chosen at creation).
# Billable from the moment the PostgreSQL Business addon and the 2 containers exist. Run it only after the HDS appendix is accepted, the HDS contact
# person is declared and the monthly amount is approved (CONTROL/master/completion/R3_HDS_HAZIRLIK_TR.md).
#
#   bash services/hds/scripts/owner-deploy.sh --origin https://<site public> --public-keys '<kid>:<base64>'
#
# --public-keys: the line printed by `node scripts/hds-keygen.mjs <kid> <file>` (public, not a secret).
# HDS_DATA_KEYS is generated INSIDE the Scalingo environment the first time (openssl → env-set), never printed, never stored elsewhere.
# Never prints an environment value. Deploys the committed HEAD of services/hds (git archive), not the working tree.
set -euo pipefail
APP="ada-hds-strasbourg"; REGION="osc-fr1"
PLAN="${HDS_PG_PLAN:-postgresql-business-512}"; SIZE="${HDS_CONTAINER_SIZE:-S}"
ORIGIN=""; PUB=""
while [ $# -gt 0 ]; do
  case "$1" in
    --origin) ORIGIN="$2"; shift 2 ;;
    --public-keys) PUB="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$ORIGIN" =~ ^https://[a-z0-9.-]+$ ]] || { echo "--origin must be the exact https origin of the site (no path)" >&2; exit 2; }
[[ "$PUB" =~ ^[A-Za-z0-9._-]{1,64}:[A-Za-z0-9+/=]{80,200}$ ]] || { echo "--public-keys must be <kid>:<base64 SPKI> (scripts/hds-keygen.mjs)" >&2; exit 2; }
command -v scalingo >/dev/null || { echo "install the Scalingo CLI and run: scalingo login" >&2; exit 2; }
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 2; }
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
S=(scalingo --region "$REGION" --app "$APP")

echo "1/6 app $APP ($REGION)"; "${S[@]}" apps-info >/dev/null
echo "2/6 PostgreSQL addon ($PLAN, HDS-eligible Business class)"
ADDONS=$("${S[@]}" addons 2>/dev/null || true)   # captured first: « cmd | grep -q » + pipefail = SIGPIPE false negative (owner run 24/11)
if grep -qi postgresql <<< "$ADDONS"; then echo "    already present"; else
  PLANS=$("${S[@]}" addons-plans postgresql 2>/dev/null || true)
  grep -q -- "$PLAN" <<< "$PLANS" || { echo "plan $PLAN not offered: choose the smallest Business plan from 'scalingo addons-plans postgresql' and set HDS_PG_PLAN" >&2; exit 1; }
  "${S[@]}" addons-add postgresql "$PLAN"
fi
echo "3/6 environment (names only)"
"${S[@]}" env-set NODE_ENV=production "ALLOWED_ORIGIN=$ORIGIN" "HDS_TICKET_PUBLIC_KEYS=$PUB" HDS_TICKET_ISSUER=ada-main HDS_TICKET_AUDIENCE=ada-hds HDS_HEALTH_CATEGORY_ENABLED=false >/dev/null
ENVNAMES=$("${S[@]}" env 2>/dev/null | sed -E 's/=.*//' || true)   # names only kept in memory
if grep -qx 'HDS_DATA_KEYS' <<< "$ENVNAMES"; then echo "    HDS_DATA_KEYS kept"; else "${S[@]}" env-set "HDS_DATA_KEYS=k1:$(openssl rand -hex 32)" >/dev/null; echo "    HDS_DATA_KEYS generated in the HDS environment"; fi
if grep -qx 'SENTRY_DSN' <<< "$ENVNAMES"; then echo "SENTRY_DSN must not exist on the HDS app: remove it" >&2; exit 1; fi
echo "4/6 deploy HEAD:services/hds"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git -C "$ROOT" archive --format=tar.gz --prefix=ada-hds/ -o "$TMP/ada-hds.tar.gz" HEAD:services/hds
"${S[@]}" deploy "$TMP/ada-hds.tar.gz"
echo "5/6 scale web to 2 x $SIZE (HDS minimum: 2 containers)"
"${S[@]}" scale "web:2:$SIZE"
echo "6/6 readiness"
for i in $(seq 1 30); do curl -sf "https://$APP.$REGION.scalingo.io/health/ready" && { echo; echo "HDS service ready: https://$APP.$REGION.scalingo.io"; echo "Vercel (names): HDS_SERVICE_URL, HDS_TICKET_PRIVATE_KEY, HDS_TICKET_KID, then HDS_PRODUCTION_APPROVED=true only after the AIPD addendum is signed"; exit 0; }; sleep 5; done
echo "not ready after 150 s: scalingo --region $REGION --app $APP logs" >&2; exit 1
