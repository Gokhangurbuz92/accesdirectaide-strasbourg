FROM python:3.10-slim
WORKDIR /app
# R46 (D10): the SAME pins as scripts/openfisca-local.sh and tests/fixtures/openfisca-france-176-variables.json (the versions the request protocol was
# verified against, R14). Change all three together. OpenFisca-France / OpenFisca-Core are AGPL-3.0: hosting the engine for others is an owner decision (R14.1).
RUN pip install --no-cache-dir "openfisca-core[web-api]==44.7.1" "openfisca-france==176.1.6"
EXPOSE 2000
# The API states its version (Country-Package-Version header); set OPENFISCA_FRANCE_VERSION=176.1.6 on the application so a different engine fails closed.
CMD ["openfisca", "serve", "--country-package", "openfisca_france", "--port", "2000", "--bind", "0.0.0.0"]
