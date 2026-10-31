#!/bin/bash
# Q08 — one production release, from a clean clone linked to the Vercel project (git deploys stay off: a release is a deliberate act).
#
#   scripts/release-production.sh <sha>
#
# 1. the commit is the pushed tip of origin/main and the checkout has no local change;
# 2. GitHub CI for that commit succeeded (when the CI workflow exists in the repository);
# 3. local gate on the same checkout: npm ci, lint, typecheck, unit gate (scripts/unit-gate.mjs), production dependency audit;
# 4. deploy (the Vercel build runs scripts/release-preflight.mjs and stops on a FAIL);
# 5. smoke test on the public address: release SHA header, readiness, one public list; on any failure, automatic rollback to the previous
#    production deployment (no rebuild) and exit 4.
set -euo pipefail
SHA=${1:?usage: scripts/release-production.sh <sha>}
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
node scripts/unit-gate.mjs
npm audit --omit=dev --audit-level=high
say "gate PASS"

# the whole output first: an early-closing pipe makes the CLI abort, and pipefail would stop the release
INSPECT=$($VERCEL inspect "$SITE" 2>&1) || true
PREV=$(printf '%s\n' "$INSPECT" | awk '$1=="url"{print $2}' | head -1)
[ -n "$PREV" ] || { say "FAIL: the current production deployment could not be read (no rollback target)"; exit 2; }
say "previous production $PREV"
$VERCEL deploy --prod --yes
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
