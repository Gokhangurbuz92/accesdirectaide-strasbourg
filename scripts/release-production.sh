#!/bin/bash
# Q08 — one production release, from a clean clone linked to the Vercel project (git deploys stay off: a release is a deliberate act).
#
#   QA_SUMMARY=<RC5_AUTHZ_QA/runs/<id>/evidence/SUMMARY.json> scripts/release-production.sh <sha>
#   (or: scripts/release-production.sh <sha> <SUMMARY.json>)
#
# 1. the commit is the pushed tip of origin/main and the checkout has no local change;
# 2. R47: the native QA evidence (QA_SUMMARY, required) is a complete PASS of exactly this commit (and tree) — scripts/lib/release-decision.mjs qa;
# 3. R47: the secret-scan guard (scripts/release-guard.mjs) on the checkout and on every commit reachable from it: any finding stops the release;
# 4. GitHub CI for that commit succeeded (when the CI workflow exists in the repository);
# 5. local gate on the same checkout: npm ci, lint, typecheck, strict typecheck and strict lint baselines (R43: the same two as CI), unit gate
#    (scripts/unit-gate.mjs), production dependency audit;
# 6. deploy (the Vercel build runs scripts/release-preflight.mjs and stops on a FAIL). R47: `deploy --no-wait`, then `vercel inspect <url>` is
#    polled until READY / ERROR / CANCELED (R46: the CLI's token expired while it followed a 5-minute build and it printed « Not authorized »
#    although the deployment became Ready). The release goes on only when the deployment is READY AND the production domain serves
#    x-release-sha = <sha>; a CLI authorization error in that case is a WARN; anything else is a FAIL (exit 5) with the rollback command;
# 7. smoke test on the public address: release SHA header, readiness, one public list; on any failure, automatic rollback to the previous
#    production deployment (no rebuild) and exit 4.
set -euo pipefail
SHA=${1:?usage: QA_SUMMARY=<SUMMARY.json> scripts/release-production.sh <sha>}
QA_SUMMARY=${QA_SUMMARY:-${2:-}}
case "$QA_SUMMARY" in ''|/*) ;; *) QA_SUMMARY="$PWD/$QA_SUMMARY" ;; esac   # relative to the caller's directory, not to the clone
DEPLOY_TIMEOUT=${RELEASE_DEPLOY_TIMEOUT:-1500}   # seconds to wait for a terminal deployment state
SITE=${RELEASE_SITE:-https://www.accesdirectaide.fr}
REPO=${RELEASE_REPO:-Gokhangurbuz92/accesdirectaide-strasbourg}
VERCEL="npx --yes vercel@65.7.0"
say() { echo "RELEASE $*"; }

cd "$(git rev-parse --show-toplevel)"
[ -f .vercel/project.json ] || { say "FAIL: this clone is not linked to the Vercel project (.vercel/project.json)"; exit 2; }
git fetch -q origin main
FULL=$(git rev-parse "$SHA^{commit}")
[ "$(git rev-parse origin/main)" = "$FULL" ] || { say "FAIL: $SHA is not the pushed tip of origin/main"; exit 2; }
git checkout -q --detach "$FULL"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { say "FAIL: tracked files differ from $SHA"; exit 2; }
say "commit ${FULL:0:7}"
DECIDE="node scripts/lib/release-decision.mjs"
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/ada-release.XXXXXX"); trap 'rm -rf "$TMPD"' EXIT
[ -n "$QA_SUMMARY" ] || { say "FAIL: QA_SUMMARY=<RC5_AUTHZ_QA/runs/<id>/evidence/SUMMARY.json> is required (native QA of exactly ${FULL:0:7})"; exit 2; }
$DECIDE qa --summary "$QA_SUMMARY" --sha "$FULL" --tree "$(git rev-parse "$FULL^{tree}")" || { say "FAIL: the native QA evidence is not a PASS of ${FULL:0:7}"; exit 2; }
# the guard's own exit code decides (never through a pipe: R46 pushed despite « leaks found: 1 » read through `| tail`)
node scripts/release-guard.mjs --log-opts "$FULL" || { say "FAIL: secret scan"; exit 2; }

if gh api "repos/$REPO/actions/workflows/ci.yml" >/dev/null 2>&1; then
  CI=$(gh run list -R "$REPO" --workflow ci.yml --commit "$FULL" --json status,conclusion -q '.[0] | "\(.status)/\(.conclusion)"')
  [ "$CI" = "completed/success" ] || { say "FAIL: GitHub CI for ${FULL:0:7} is '${CI:-absent}'"; exit 3; }
  say "GitHub CI success"
else
  say "NOTE: no GitHub CI workflow in the repository yet; the local gate is the gate"
fi

npm ci --no-audit --no-fund --loglevel=error
npm run -s lint
npm run -s typecheck
npm run -s typecheck:strict:baseline
npm run -s lint:strict:baseline
node scripts/unit-gate.mjs
npm audit --omit=dev --audit-level=high
say "gate PASS"

# the whole output first: an early-closing pipe makes the CLI abort, and pipefail would stop the release
INSPECT=$($VERCEL inspect "$SITE" 2>&1) || true
PREV=$(printf '%s\n' "$INSPECT" | awk '$1=="url"{print $2}' | head -1)
[ -n "$PREV" ] || { say "FAIL: the current production deployment could not be read (no rollback target)"; exit 2; }
say "previous production $PREV"
served_sha() { { curl -s -D - -o /dev/null "$SITE/api/health" || true; } | awk -F': ' 'tolower($1)=="x-release-sha"{print $2}' | tr -d '\r'; }
# --no-wait: the deployment is created and its URL printed; its state is then read by fresh CLI processes (each refreshes its token)
set +e; $VERCEL deploy --prod --yes --no-wait >"$TMPD/deploy.log" 2>&1; DEPLOY_RC=$?; set -e
cat "$TMPD/deploy.log"
DEPLOY_URL=$($DECIDE deploy-url "$TMPD/deploy.log") || DEPLOY_URL=""
STATE=UNKNOWN
if [ -n "$DEPLOY_URL" ]; then
  say "deployment $DEPLOY_URL (deploy exit $DEPLOY_RC); waiting for a terminal state (at most ${DEPLOY_TIMEOUT}s)"
  DEADLINE=$(( $(date +%s) + DEPLOY_TIMEOUT ))
  while :; do
    $VERCEL inspect "$DEPLOY_URL" --json >"$TMPD/inspect.json" 2>"$TMPD/inspect.err" || true
    STATE=$($DECIDE ready-state "$TMPD/inspect.json")
    case "$STATE" in READY|ERROR|CANCELED) break ;; esac
    [ "$(date +%s)" -lt "$DEADLINE" ] || { STATE="TIMEOUT($STATE)"; break; }
    sleep 15
  done
  say "deployment state $STATE"
  if [ "$STATE" = ERROR ]; then $VERCEL inspect "$DEPLOY_URL" --logs >"$TMPD/build.log" 2>&1 || true; tail -40 "$TMPD/build.log"; fi
fi
GOT=""
if [ "$STATE" = READY ]; then
  for _ in $(seq 1 30); do GOT=$(served_sha); [ "$GOT" = "$FULL" ] && break; sleep 10; done
fi
INSPECT_SITE=$($VERCEL inspect "$SITE" 2>&1) || true
ALIAS=$(printf '%s\n' "$INSPECT_SITE" | awk '$1=="url"{print $2}' | head -1)
if ! $DECIDE decide --sha "$FULL" --deploy-exit "$DEPLOY_RC" --deploy-log "$TMPD/deploy.log" --ready "$STATE" --served "$GOT" --prev "$PREV" --alias "$ALIAS"; then
  say "FAIL: the deployment is not verified as serving ${FULL:0:7} — previous production was $PREV"
  say "      restore it with: $VERCEL rollback \"$PREV\" --yes"
  exit 5
fi
smoke() {
  for _ in $(seq 1 18); do
    got=$(curl -s -D - -o /dev/null "$SITE/api/health" | awk -F': ' 'tolower($1)=="x-release-sha"{print $2}' | tr -d '\r')
    [ "${got:0:7}" = "${FULL:0:7}" ] && break; sleep 10
  done
  [ "${got:0:7}" = "${FULL:0:7}" ] || { say "SMOKE FAIL: x-release-sha is '${got}'"; return 1; }
  curl -sf "$SITE/api/health/ready" >/dev/null || { say "SMOKE FAIL: readiness"; return 1; }
  [ "$(curl -s "$SITE/api/aides?pageSize=1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).pagination.total>0?"ok":"empty")}catch{console.log("bad")}})')" = ok ] || { say "SMOKE FAIL: public list"; return 1; }
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$SITE/")" = 200 ] || { say "SMOKE FAIL: home page"; return 1; }
}
if smoke; then say "PASS ${FULL:0:7} live on $SITE"; exit 0; fi
say "rolling back to $PREV"
$VERCEL rollback "$PREV" --yes
exit 4
