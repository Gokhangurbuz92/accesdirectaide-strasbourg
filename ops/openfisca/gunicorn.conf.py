# G14 - gunicorn settings for the AccesDirectAide OpenFisca container (smallest footprint that serves the diagnostic).
# One worker (each worker loads the whole OpenFisca-France tax-benefit system, ~200+ MB), 2 threads; the app is loaded in the worker only (preload would keep a second copy in the master).
# Scaleway Serverless Containers inject PORT; default 8080. No access log (request lines only would still be noise; bodies are never logged).
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8080')}"
workers = int(os.environ.get("ADA_OPENFISCA_WORKERS", "1"))
threads = int(os.environ.get("ADA_OPENFISCA_THREADS", "2"))
preload_app = False
timeout = 180   # also bounds the worker BOOT: loading OpenFisca-France on 0.56 vCPU can take well over 30 s and a 30 s timeout kills the booting worker in a loop (requests are still capped at 60 s by the platform)
graceful_timeout = 5
keepalive = 5
accesslog = None
errorlog = "-"
loglevel = "warning"
worker_tmp_dir = "/tmp"
