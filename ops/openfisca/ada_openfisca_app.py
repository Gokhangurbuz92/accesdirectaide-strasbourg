"""
G14 (owner 23/11/2026) - AccesDirectAide self-hosted OpenFisca-France Web API (Scaleway Serverless Container, free tier only).

OpenFisca-Core / OpenFisca-France are AGPL-3.0 and run UNMODIFIED: this module only builds the stock Web API
(openfisca_web_api.app.create_app, no tracker => no outbound call) and wraps it in a small WSGI gate:
  - GET /healthz           -> 200 {"ok": true, ...} (no token; used by the platform health check; reveals only the engine version)
  - GET /spec, POST /calculate, POST /trace  -> require the shared token (header X-ADA-OpenFisca-Token) when
    ADA_OPENFISCA_TOKEN_SHA256 is set (hex sha256 of OPENFISCA_AUTH_TOKEN; the token itself never sits in the container);
    with ADA_OPENFISCA_REQUIRE_TOKEN unset or "1" (the image default) and no hash configured they answer 503 (fail closed);
    ADA_OPENFISCA_REQUIRE_TOKEN=0 is for a loopback LAB run only;
  - anything else          -> 404 (the parameters/variables browsing routes are not needed by AccesDirectAide);
  - request bodies above ADA_OPENFISCA_MAX_BODY bytes (default 262144) -> 413.
The Scaleway container is also deployed with privacy=private, so the Scaleway gateway rejects calls without a valid
X-Auth-Token before the container wakes (no billed time for anonymous traffic). This gate is defence in depth.
Source of the engine: https://github.com/openfisca/openfisca-france (AGPL-3.0), https://github.com/openfisca/openfisca-core.
"""
import hashlib
import hmac
import json
import os

from openfisca_core.scripts import build_tax_benefit_system
from openfisca_web_api.app import create_app

COUNTRY_PACKAGE = "openfisca_france"
ALLOWED = {("GET", "/spec"), ("POST", "/calculate"), ("POST", "/trace")}
TOKEN_HEADER = "HTTP_X_ADA_OPENFISCA_TOKEN"

_tbs = build_tax_benefit_system(COUNTRY_PACKAGE, None, None)
_inner = create_app(_tbs, welcome_message="AccesDirectAide OpenFisca-France (AGPL-3.0, unmodified): https://github.com/openfisca/openfisca-france")

try:
    from importlib.metadata import version as _version
    _ENGINE_VERSION = _version("openfisca-france")
except Exception:  # pragma: no cover
    _ENGINE_VERSION = None


def _json(start_response, status, payload, extra=()):
    body = json.dumps(payload).encode("utf-8")
    start_response(status, [("Content-Type", "application/json"), ("Content-Length", str(len(body))), ("Cache-Control", "no-store"), *extra])
    return [body]


def make_gate(inner, token_sha256=None, max_body=262144, require_token=False):
    want = (token_sha256 or "").strip().lower() or None

    def app(environ, start_response):
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = (environ.get("PATH_INFO") or "/").rstrip("/") or "/"
        if path == "/healthz" and method in ("GET", "HEAD"):
            return _json(start_response, "200 OK", {"ok": True, "countryPackage": "openfisca-france", "version": _ENGINE_VERSION})
        if (method, path) not in ALLOWED:
            return _json(start_response, "404 Not Found", {"error": "not_found"})
        if require_token and not want:
            return _json(start_response, "503 Service Unavailable", {"error": "token_not_configured"})
        if want:
            got = environ.get(TOKEN_HEADER, "")
            digest = hashlib.sha256(got.encode("utf-8")).hexdigest() if got else ""
            if not got or not hmac.compare_digest(digest, want):
                return _json(start_response, "401 Unauthorized", {"error": "unauthorized"})
        try:
            length = int(environ.get("CONTENT_LENGTH") or 0)
        except ValueError:
            length = 0
        if length > max_body:
            return _json(start_response, "413 Payload Too Large", {"error": "too_large"})
        environ["PATH_INFO"] = path
        return inner(environ, start_response)

    return app


application = make_gate(
    _inner,
    token_sha256=os.environ.get("ADA_OPENFISCA_TOKEN_SHA256"),
    max_body=int(os.environ.get("ADA_OPENFISCA_MAX_BODY", "262144")),
    require_token=os.environ.get("ADA_OPENFISCA_REQUIRE_TOKEN", "1") != "0",
)
