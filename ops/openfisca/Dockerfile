# G14 (owner 23/11/2026) - AccesDirectAide self-hosted OpenFisca-France for Scaleway Serverless Containers (fr-par, free tier, min-scale 0 / max-scale 1).
# Reference build for a machine WITH Docker:  docker build --platform linux/amd64 -t ada-openfisca ops/openfisca
# ops/openfisca/deploy_scaleway.mjs builds the SAME image without Docker (base mirrored by digest + one layer: the hashed wheels of requirements.lock
# installed with pip --target, the two app files below, the same Env/User/Cmd).
# OpenFisca-Core and OpenFisca-France (AGPL-3.0) are installed UNMODIFIED from PyPI: https://github.com/openfisca/openfisca-france
# Pins: requirements.txt (= scripts/openfisca-local.sh, api/lib/openfiscaPins.js; tests/unit/g14-openfisca-selfhost.test.js keeps them equal).
FROM python:3.11-slim-bookworm@sha256:e8c69d86735f6df3efa06b324694fe51f0422785f83a3bd463052636c2421944

ENV PYTHONPATH=/opt/ada-openfisca/site:/opt/ada-openfisca/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    ADA_OPENFISCA_REQUIRE_TOKEN=1 \
    PORT=8080

COPY requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --no-compile --only-binary=:all: --require-hashes --no-deps --target /opt/ada-openfisca/site -r /tmp/requirements.lock \
 && rm -rf /opt/ada-openfisca/site/bin /tmp/requirements.lock
COPY ada_openfisca_app.py gunicorn.conf.py /opt/ada-openfisca/app/

# non-root (nobody); the code is read-only for it; gunicorn's worker heartbeat goes to /tmp
USER 65534:65534
WORKDIR /opt/ada-openfisca/app
EXPOSE 8080
# health: GET /healthz (no token, version only). Engine routes: GET /spec, POST /calculate, POST /trace (token). No outbound call (no tracker).
CMD ["python", "-m", "gunicorn", "-c", "/opt/ada-openfisca/app/gunicorn.conf.py", "ada_openfisca_app:application"]
